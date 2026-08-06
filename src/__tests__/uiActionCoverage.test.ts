import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import {
  UI_GLOBAL_ACTION_CONTRACTS,
  UI_PAGE_CONTRACTS,
  type UiActionContract,
  type UiContentContract,
} from './uiPageContracts';
import {
  BURN_DOWN_DATE,
  CRITICAL_ACTION_IDS,
  UI_ACTION_COVERAGE,
  UI_CONTENT_COVERAGE,
} from './uiActionCoverage';

/**
 * WP8 meta-test (acceptance T18): the control inventory is only worth
 * anything if every declared action maps to executable evidence or an owned,
 * expiring exception — and if full, partial, and manual claims are kept
 * separate instead of inflating a control census into behavior coverage.
 *
 * NOTE: exceptions expire on BURN_DOWN_DATE and this suite goes red then, by
 * design. The fix is writing the archetype tests, not moving the date.
 */

const allActions: UiActionContract[] = UI_PAGE_CONTRACTS.reduce<UiActionContract[]>(
  (actions, page) => actions.concat(page.actions),
  [...UI_GLOBAL_ACTION_CONTRACTS]
);
const allActionIds = allActions.map(action => action.id);
const allContentChecks: UiContentContract[] = UI_PAGE_CONTRACTS.reduce<UiContentContract[]>(
  (checks, page) => checks.concat('contentChecks' in page ? page.contentChecks : []),
  [],
);
const allContentIds = allContentChecks.map(check => check.id);

describe('UI action coverage traceability', () => {
  it('every inventory action has exactly one coverage entry', () => {
    const missing = allActionIds.filter(id => !UI_ACTION_COVERAGE[id]);
    expect(missing, `actions without coverage entries:\n${missing.join('\n')}`).toEqual([]);
  });

  it('no coverage entry is orphaned from the inventory', () => {
    const known = new Set<string>(allActionIds);
    const orphans = Object.keys(UI_ACTION_COVERAGE).filter(id => !known.has(id));
    expect(orphans, `coverage entries for actions that no longer exist:\n${orphans.join('\n')}`).toEqual([]);
  });

  it('keeps required content checks complete and disjoint from actionable controls', () => {
    const missing = allContentIds.filter(id => !UI_CONTENT_COVERAGE[id]);
    const known = new Set(allContentIds);
    const orphans = Object.keys(UI_CONTENT_COVERAGE).filter(id => !known.has(id));
    expect(missing, `content checks without evidence:\n${missing.join('\n')}`).toEqual([]);
    expect(orphans, `orphaned content evidence:\n${orphans.join('\n')}`).toEqual([]);
    expect(allContentIds.filter(id => allActionIds.includes(id)), 'static content may not masquerade as an action').toEqual([]);
    expect(Object.keys(UI_CONTENT_COVERAGE).filter(id => id in UI_ACTION_COVERAGE), 'content evidence may not enter action execution mapping').toEqual([]);
  });

  it('every contract states a testable interaction and observable outcome', () => {
    for (const action of allActions) {
      expect(action.interaction.trim().length, `${action.id}: interaction is not testable`).toBeGreaterThan(20);
      expect(action.expectedOutcome.trim().length, `${action.id}: expected outcome is not observable`).toBeGreaterThan(20);
    }
    for (const content of allContentChecks) {
      expect(content.assertion.trim().length, `${content.id}: content assertion is not testable`).toBeGreaterThan(20);
      expect(content.expectedContent.trim().length, `${content.id}: content outcome is not observable`).toBeGreaterThan(20);
    }
  });

  it('full and partial automation reference bounded Playwright spec identities', () => {
    for (const [id, evidence] of Object.entries({ ...UI_ACTION_COVERAGE, ...UI_CONTENT_COVERAGE })) {
      if (evidence.kind === 'manual-exception') continue;
      expect(evidence.specs.length, `${id} claims automation with zero specs`).toBeGreaterThan(0);
      for (const spec of evidence.specs) {
        expect(existsSync(spec.file), `${id}: spec file ${spec.file} does not exist`).toBe(true);
        expect(spec.file, `${id}: test evidence must stay in a Playwright suite`)
          .toMatch(/^tests\/e2e(?:-auth)?\/[A-Za-z0-9._/-]+\.spec\.ts$/);
        expect(spec.title.trim().length, `${id}: test evidence needs an exact runtime title`).toBeGreaterThan(10);
      }
    }
  });

  it('evidence categories cannot disguise partial or manual debt as full automation', () => {
    for (const [id, evidence] of Object.entries(UI_ACTION_COVERAGE)) {
      if (evidence.kind === 'automated-full') {
        expect('gap' in evidence, `${id}: full automation carries an unresolved gap`).toBe(false);
        expect('reason' in evidence, `${id}: full automation carries a manual exception`).toBe(false);
      } else if (evidence.kind === 'automated-partial') {
        expect(evidence.covered.trim().length, `${id}: partial automation does not say what is proved`).toBeGreaterThan(20);
        expect(evidence.gap.trim().length, `${id}: partial automation does not name its remaining outcome gap`).toBeGreaterThan(20);
        expect(evidence.covered).not.toBe(evidence.gap);
      } else {
        expect('specs' in evidence, `${id}: a manual exception may not cite executable evidence`).toBe(false);
      }
    }
  });

  it('partial and manual debt carry an owner, an explanation, and have not expired', () => {
    const now = Date.now();
    const expired: string[] = [];
    for (const [id, evidence] of Object.entries(UI_ACTION_COVERAGE)) {
      if (evidence.kind === 'automated-full') continue;
      expect(evidence.owner.trim(), `${id}: exception has no owner`).not.toBe('');
      const explanation = evidence.kind === 'automated-partial' ? evidence.gap : evidence.reason;
      expect(explanation.trim().length, `${id}: debt entry has no explanation`).toBeGreaterThan(20);
      const expiry = Date.parse(evidence.expires);
      expect(Number.isFinite(expiry), `${id}: exception expiry "${evidence.expires}" is not a date`).toBe(true);
      if (expiry < now) expired.push(`${id} (expired ${evidence.expires}, owner ${evidence.owner})`);
    }
    expect(
      expired,
      `expired partial/manual debt — finish the archetype test, do not extend the date:\n${expired.join('\n')}`
    ).toEqual([]);
  });

  it('critical actions require full interaction evidence', () => {
    expect(Date.parse(BURN_DOWN_DATE)).not.toBeNaN();
    for (const id of CRITICAL_ACTION_IDS) {
      const evidence = UI_ACTION_COVERAGE[id];
      expect(evidence, `critical action ${id} has no coverage entry`).toBeDefined();
      expect(evidence.kind, `${id} is critical and cannot be partial or manual`).toBe('automated-full');
    }
  });

  it('records the current burn-down position so coverage can only ratchet up', () => {
    const evidence = Object.values(UI_ACTION_COVERAGE);
    const full = evidence.filter(item => item.kind === 'automated-full').length;
    const partial = evidence.filter(item => item.kind === 'automated-partial').length;
    const manual = evidence.filter(item => item.kind === 'manual-exception').length;
    // Raise this floor as archetype tests land; lowering it means coverage
    // regressed and must fail loudly.
    const content = Object.keys(UI_CONTENT_COVERAGE).length;
    expect(full).toBeGreaterThanOrEqual(154);
    expect(full + partial).toBeGreaterThanOrEqual(154);
    expect(partial).toBe(0);
    expect(manual).toBe(0);
    expect(allActionIds.length).toBe(Object.keys(UI_ACTION_COVERAGE).length);
    expect(allContentIds.length).toBe(content);
    expect(allActionIds.length + allContentIds.length).toBe(164);
  });
});
