import { expect, test, type Page } from '@playwright/test';
import { installBooleanFixtures } from './boolean-fixtures';

/**
 * Archetype: switching between the surfaces of a workspace (WP8 cluster C).
 *
 * Eight page-level actions state the same contract with different nouns —
 * "the selected surface becomes active WITHOUT LOSING state held by the
 * others". The second half is the one with teeth: a switcher that silently
 * remounts its siblings destroys work a researcher has already done, and
 * nothing about the visible tab strip reveals it.
 *
 * So each surface here proves three things: exactly one control is selected
 * at a time, the selected surface's own content is actually on screen, and
 * text typed into one surface is still there after a round trip through
 * another. Where a surface has no input to type into, it is NOT claimed —
 * see the deferred list at the bottom.
 */

interface ViewSurface {
  route: string;
  label: string;
  /** Accessible names of the controls that switch surfaces, in strip order. */
  views: { control: string; marker: RegExp }[];
  /** Typed state that must survive a round trip through another surface. */
  persists: { inView: string; input: string; value: string };
}

const ACCOUNTING: ViewSurface = {
    route: '/accounting',
    label: 'accounting workspaces',
    views: [
      { control: 'Standards Directory', marker: /Curated ASC Topic Directory/i },
      { control: 'Review Checklist', marker: /Technical Accounting Review Checklist/i },
      { control: 'Ask AI for ASCs', marker: /Ask AI for Accounting Guidance/i },
    ],
    persists: { inView: 'Ask AI for ASCs', input: 'Technical accounting guidance question', value: 'lease modification under ASC 842' },
};

const ESG: ViewSurface = {
    route: '/esg',
    label: 'ESG research sections',
    views: [
      { control: 'Framework Navigator', marker: /Interoperability Matrices/i },
      { control: 'Disclosure Heatmap', marker: /AI-Rated ESG Disclosure Heatmap/i },
      { control: 'Earnings Releases', marker: /Recent 8-K earnings candidates/i },
    ],
    persists: { inView: 'Earnings Releases', input: 'Filter recent 8-K candidates by company', value: 'Northwind' },
};

const MNA: ViewSurface = {
    route: '/mna',
    label: 'M&A workflows',
    views: [
      { control: 'Deal Screener', marker: /Recent M&A Filings/i },
      { control: 'Clause Library', marker: /AI Clause Extraction/i },
    ],
    persists: { inView: 'Deal Screener', input: 'Filter M&A filings by entity name', value: 'Halloway' },
};

async function waitForIdentity(page: Page) {
  await page.waitForFunction(
    () => Boolean(document.documentElement.dataset.urcIdentityScope),
    undefined,
    { timeout: 30_000 }
  );
}

/** The switch controls for a surface, addressed exactly by accessible name. */
function control(page: Page, name: string) {
  return page.getByRole('button', { name, exact: true }).first();
}

/**
 * Titles below are spelled out rather than generated from `surface.label`.
 * The WP8 meta-test proves an automation claim by string-matching the test
 * title in this file's SOURCE, so a template-literal title would make every
 * claim against this spec unverifiable — and it caught exactly that when the
 * titles were generated.
 */
async function assertSurfaceSwitching(page: Page, surface: ViewSurface) {
  await installBooleanFixtures(page);
  await page.goto(surface.route, { waitUntil: 'domcontentloaded' });
  await waitForIdentity(page);
  await expect(control(page, surface.views[0].control)).toBeVisible({ timeout: 20_000 });

  // Every surface activates, and does so exclusively: selecting one must
  // deselect the rest, or the strip is lying about where the user is.
  for (const view of surface.views) {
    await control(page, view.control).click();
    await expect(page.getByText(view.marker).first()).toBeVisible({ timeout: 20_000 });
    for (const other of surface.views) {
      await expect(
        control(page, other.control),
        `${surface.label}: "${other.control}" selected-state after choosing "${view.control}"`
      ).toHaveAttribute('aria-pressed', other.control === view.control ? 'true' : 'false');
    }
  }

  // The contract's real promise: a round trip through another surface must
  // not discard what was already entered here.
  const { inView, input, value } = surface.persists;
  await control(page, inView).click();
  const field = page.getByLabel(input, { exact: true }).first();
  await expect(field).toBeVisible({ timeout: 20_000 });
  await field.fill(value);

  const detour = surface.views.find(v => v.control !== inView)!;
  await control(page, detour.control).click();
  await expect(page.getByText(detour.marker).first()).toBeVisible({ timeout: 20_000 });

  await control(page, inView).click();
  await expect(
    page.getByLabel(input, { exact: true }).first(),
    `${surface.label}: "${inView}" lost its typed input after a detour through "${detour.control}"`
  ).toHaveValue(value);
}

test.describe('archetype: switching workspace surfaces', () => {
  test('accounting workspaces activate exclusively and preserve sibling surface state', async ({ page }) => {
    await assertSurfaceSwitching(page, ACCOUNTING);
  });

  test('ESG research sections activate exclusively and preserve sibling surface state', async ({ page }) => {
    await assertSurfaceSwitching(page, ESG);
  });

  test('M&A workflows activate exclusively and preserve sibling surface state', async ({ page }) => {
    await assertSurfaceSwitching(page, MNA);
  });

  /**
   * The IPO Center is the only surface built as a real ARIA tablist, so it is
   * where global.tabs is provable. Note what is deliberately NOT asserted:
   * every tab carrying aria-controls. IPOCenter renders only the active
   * panel, so a static aria-controls would be a dangling IDREF — a worse
   * defect than the omission. The rule enforced instead is that any
   * aria-controls present must resolve to a real tabpanel.
   */
  test('global.tabs keeps one tab selected, tabbable, and honestly associated', async ({ page }) => {
    await installBooleanFixtures(page);
    await page.goto('/ipo', { waitUntil: 'domcontentloaded' });
    await waitForIdentity(page);

    const tablist = page.getByRole('tablist', { name: 'IPO Center sections' });
    await expect(tablist).toBeVisible({ timeout: 20_000 });
    const tabs = page.getByRole('tab');
    const count = await tabs.count();
    expect(count, 'IPO Center should present more than one section').toBeGreaterThan(1);

    const audit = async (stage: string) => {
      const state = await page.evaluate(() => {
        const list = document.querySelector('[role="tablist"][aria-label="IPO Center sections"]');
        return Array.from(list?.querySelectorAll('[role="tab"]') ?? []).map(t => {
          const controls = t.getAttribute('aria-controls');
          const panel = controls ? document.getElementById(controls) : null;
          return {
            name: (t.textContent || '').replace(/\s+/g, ' ').trim(),
            selected: t.getAttribute('aria-selected') === 'true',
            tabindex: t.getAttribute('tabindex'),
            controls,
            panelRole: panel?.getAttribute('role') ?? null,
          };
        });
      });

      expect(state.filter(t => t.selected).length, `${stage}: exactly one tab may be selected`).toBe(1);
      for (const t of state) {
        // Roving tabindex: the selected tab is the single tab stop.
        expect(t.tabindex, `${stage}: "${t.name}" tabindex`).toBe(t.selected ? '0' : '-1');
        // No dangling references — an aria-controls that resolves to nothing
        // is worse than none at all.
        if (t.controls) {
          expect(t.panelRole, `${stage}: "${t.name}" aria-controls="${t.controls}" resolves to no tabpanel`).toBe('tabpanel');
        }
      }
      return state;
    };

    await audit('initial');

    // Pointer activation moves the selection and the single tab stop with it.
    const last = tabs.nth(count - 1);
    await last.click();
    const afterClick = await audit('after pointer activation');
    expect(afterClick[count - 1].selected, 'the clicked tab should be the selected one').toBe(true);

    // The panel a tab controls must name that tab back, so assistive tech can
    // state which section the content belongs to.
    const labelledBy = await page.getByRole('tabpanel').first().getAttribute('aria-labelledby');
    expect(labelledBy, 'the active tabpanel must be labelled by its tab').toBeTruthy();
    await expect(page.locator(`#${labelledBy}`)).toHaveAttribute('role', 'tab');
  });
});

/**
 * DEFERRED, with reasons — not silently dropped:
 * - benchmarking.switch-view: /compare renders no switch controls until
 *   companies are added, so the strip needs a setup fixture first.
 * - company-dossier.switch-view: needs resolved SEC issuer data.
 * - board-profiles.switch-view: its views render no stable content marker
 *   (headings are data-dependent), so a test here could only prove the button
 *   toggled itself, which is not the contract.
 * - ipo-center.switch-section: the tablist's SEMANTICS are proven above, but
 *   that is global.tabs, not this contract. This one promises the workflow
 *   activates "without corrupting loaded pipeline or analyzer state", and
 *   /ipo has no typed input to round-trip — proving it needs a loaded-pipeline
 *   fixture so the rows themselves can be checked across a switch.
 * - research-workbench.toggle-panels: panel collapse, not surface switching;
 *   belongs with the query-panel journeys.
 */
