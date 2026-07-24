import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';
import { ALL_ROUTE_CONTRACTS, type RouteContract } from './route-contracts';

interface ControlRecord {
  selector: string;
  tag: string;
  name: string;
  type: string | null;
  href: string | null;
  title: string | null;
  disabled: boolean;
  ariaControls: string | null;
  ariaExpanded: string | null;
  ariaPressed: string | null;
}

interface RouteAudit {
  path: string;
  url: string;
  title: string;
  viewport: { width: number; height: number };
  mainCount: number;
  h1Count: number;
  controls: ControlRecord[];
  unnamedControls: ControlRecord[];
  duplicateIds: string[];
  invalidAriaReferences: Array<{ selector: string; attribute: string; target: string }>;
  horizontalOverflowPixels: number;
  overflowCandidates: Array<{ selector: string; left: number; right: number; width: number }>;
  consoleErrors: string[];
  pageErrors: string[];
  failedFirstPartyRequests: string[];
  issues: string[];
}

const strictAudit = process.env.QA_STRICT_AUDIT === '1';
const publicOnly = process.env.QA_PUBLIC_ONLY === '1';

function listenForRuntimeProblems(page: Page) {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedFirstPartyRequests: string[] = [];

  page.on('console', (message: ConsoleMessage) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => {
    try {
      const requestUrl = new URL(request.url());
      const pageUrl = new URL(page.url());
      if (requestUrl.origin === pageUrl.origin) {
        failedFirstPartyRequests.push(`${request.method()} ${requestUrl.pathname}: ${request.failure()?.errorText || 'failed'}`);
      }
    } catch {
      // Ignore malformed third-party URLs; the browser has already rejected them.
    }
  });

  return { consoleErrors, pageErrors, failedFirstPartyRequests };
}

async function auditRoute(page: Page, contract: RouteContract): Promise<RouteAudit> {
  const runtime = listenForRuntimeProblems(page);
  const response = await page.goto(contract.path, {
    waitUntil: 'domcontentloaded',
    timeout: contract.note ? 60_000 : 30_000,
  });
  expect(response, `${contract.path} should produce a response before it is audited`).not.toBeNull();

  await expect(page.getByRole('heading', {
    level: contract.headingLevel,
    name: contract.heading,
  })).toBeVisible();

  // Let hydration-driven controls and short client fetches settle without
  // waiting for third-party sources that may intentionally remain active.
  await page.waitForTimeout(300);

  const dom = await page.evaluate(() => {
    const visible = (element: Element) => {
      const htmlElement = element as HTMLElement;
      const style = getComputedStyle(htmlElement);
      const rect = htmlElement.getBoundingClientRect();
      return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
    };

    const selectorFor = (element: Element) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const parts: string[] = [];
      let current: Element | null = element;
      while (current && current !== document.body && parts.length < 4) {
        const parent = current.parentElement;
        const siblings = parent ? Array.from(parent.children).filter(child => child.tagName === current!.tagName) : [];
        const suffix = siblings.length > 1 ? `:nth-of-type(${siblings.indexOf(current) + 1})` : '';
        parts.unshift(`${current.tagName.toLowerCase()}${suffix}`);
        current = parent;
      }
      return parts.join(' > ');
    };

    const normalizedText = (value: string | null | undefined) => (value || '').replace(/\s+/g, ' ').trim();
    const accessibleName = (element: Element) => {
      const labelledBy = element.getAttribute('aria-labelledby');
      if (labelledBy) {
        const value = labelledBy
          .split(/\s+/)
          .map(id => document.getElementById(id)?.textContent || '')
          .join(' ');
        if (normalizedText(value)) return normalizedText(value);
      }
      const ariaLabel = element.getAttribute('aria-label');
      if (normalizedText(ariaLabel)) return normalizedText(ariaLabel);

      if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
        const labels = Array.from(element.labels || []).map(label => label.textContent || '').join(' ');
        if (normalizedText(labels)) return normalizedText(labels);
        if (element instanceof HTMLInputElement && ['button', 'submit', 'reset'].includes(element.type)) {
          if (normalizedText(element.value)) return normalizedText(element.value);
        }
      }

      if (element instanceof HTMLImageElement && normalizedText(element.alt)) return normalizedText(element.alt);
      const ownText = normalizedText(element.textContent);
      if (ownText) return ownText;
      return normalizedText(element.getAttribute('title'));
    };

    const controls = Array.from(document.querySelectorAll('a[href], button, input:not([type="hidden"]), select, textarea, [role="button"], [role="link"]'))
      .filter(visible)
      .map(element => ({
        selector: selectorFor(element),
        tag: element.tagName.toLowerCase(),
        name: accessibleName(element),
        type: element.getAttribute('type'),
        href: element instanceof HTMLAnchorElement ? element.getAttribute('href') : null,
        title: element.getAttribute('title'),
        disabled: element.matches(':disabled') || element.getAttribute('aria-disabled') === 'true',
        ariaControls: element.getAttribute('aria-controls'),
        ariaExpanded: element.getAttribute('aria-expanded'),
        ariaPressed: element.getAttribute('aria-pressed'),
      }));

    const ids = Array.from(document.querySelectorAll('[id]')).map(element => element.id).filter(Boolean);
    const idCounts = new Map<string, number>();
    ids.forEach(id => idCounts.set(id, (idCounts.get(id) || 0) + 1));
    const duplicateIds = Array.from(idCounts.entries()).filter(([, count]) => count > 1).map(([id]) => id);

    const referenceAttributes = [
      'aria-controls',
      'aria-describedby',
      'aria-labelledby',
      'aria-owns',
      'aria-activedescendant',
      'aria-details',
      'aria-errormessage',
    ];
    const invalidAriaReferences: Array<{ selector: string; attribute: string; target: string }> = [];
    for (const element of Array.from(document.querySelectorAll(referenceAttributes.map(attribute => `[${attribute}]`).join(',')))) {
      for (const attribute of referenceAttributes) {
        const value = element.getAttribute(attribute)?.trim();
        if (!value) continue;
        for (const target of value.split(/\s+/)) {
          if (!document.getElementById(target)) {
            invalidAriaReferences.push({ selector: selectorFor(element), attribute, target });
          }
        }
      }
    }

    const viewportWidth = document.documentElement.clientWidth;
    const overflowCandidates = Array.from(document.body.querySelectorAll('*'))
      .filter(visible)
      .map(element => {
        const rect = element.getBoundingClientRect();
        return { selector: selectorFor(element), left: rect.left, right: rect.right, width: rect.width };
      })
      .filter(rect => rect.left < -2 || rect.right > viewportWidth + 2)
      .sort((a, b) => Math.max(b.right - viewportWidth, -b.left) - Math.max(a.right - viewportWidth, -a.left))
      .slice(0, 20);

    return {
      title: document.title,
      viewport: { width: viewportWidth, height: document.documentElement.clientHeight },
      mainCount: document.querySelectorAll('main').length,
      h1Count: document.querySelectorAll('h1').length,
      controls,
      unnamedControls: controls.filter(control => !control.name),
      duplicateIds,
      invalidAriaReferences,
      horizontalOverflowPixels: Math.max(0, document.documentElement.scrollWidth - viewportWidth),
      overflowCandidates,
    };
  });

  const issues: string[] = [];
  if (dom.mainCount !== 1) issues.push(`Expected one main landmark; found ${dom.mainCount}.`);
  if (dom.h1Count !== 1) issues.push(`Expected one H1; found ${dom.h1Count}.`);
  if (dom.unnamedControls.length) issues.push(`${dom.unnamedControls.length} visible interactive control(s) have no accessible name: ${JSON.stringify(dom.unnamedControls.slice(0, 4))}`);
  if (dom.duplicateIds.length) issues.push(`${dom.duplicateIds.length} duplicate DOM id(s) found.`);
  if (dom.invalidAriaReferences.length) issues.push(`${dom.invalidAriaReferences.length} ARIA ID reference(s) do not resolve: ${JSON.stringify(dom.invalidAriaReferences.slice(0, 6))}`);
  if (dom.horizontalOverflowPixels > 2) issues.push(`Document overflows horizontally by ${dom.horizontalOverflowPixels}px.`);
  if (runtime.consoleErrors.length) issues.push(`${runtime.consoleErrors.length} console error(s) observed.`);
  if (runtime.pageErrors.length) issues.push(`${runtime.pageErrors.length} uncaught page error(s) observed.`);
  if (runtime.failedFirstPartyRequests.length) issues.push(`${runtime.failedFirstPartyRequests.length} first-party request(s) failed.`);

  return {
    path: contract.path,
    url: page.url(),
    ...dom,
    ...runtime,
    issues,
  };
}

test.describe('semantic and interaction census', () => {
  test.describe.configure({ timeout: 75_000 });

  for (const contract of ALL_ROUTE_CONTRACTS) {
    test(`${contract.path} produces an actionable accessibility and UI audit`, async ({ page }, testInfo) => {
      test.skip(publicOnly && !contract.public, 'QA_PUBLIC_ONLY excludes authenticated product routes.');
      const audit = await auditRoute(page, contract);
      await testInfo.attach(`semantic-audit-${contract.path.replace(/[^a-z0-9]+/gi, '-') || 'home'}.json`, {
        body: Buffer.from(JSON.stringify(audit, null, 2)),
        contentType: 'application/json',
      });

      testInfo.annotations.push({
        type: audit.issues.length ? 'audit-findings' : 'audit-clean',
        description: audit.issues.length ? audit.issues.join(' ') : 'No census issues detected.',
      });

      // Audit mode inventories every visible control and reports usability
      // debt without turning the basic route suite red. Teams can promote all
      // findings to release gates with QA_STRICT_AUDIT=1.
      if (strictAudit) {
        expect(audit.issues, audit.issues.join('\n')).toEqual([]);
      }
    });
  }
});
