import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { UI_GLOBAL_ACTION_CONTRACTS, UI_PAGE_CONTRACTS } from './uiPageContracts';
import { BURN_DOWN_DATE, CRITICAL_ACTION_IDS, UI_ACTION_COVERAGE } from './uiActionCoverage';

/**
 * WP8 meta-test (acceptance T18): the control inventory is only worth
 * anything if every declared action maps to executable evidence or an owned,
 * expiring exception — and if 'automated' claims are verifiably real.
 *
 * NOTE: exceptions expire on BURN_DOWN_DATE and this suite goes red then, by
 * design. The fix is writing the archetype tests, not moving the date.
 */

const allActionIds = [
  ...UI_PAGE_CONTRACTS.flatMap(page => page.actions.map(action => action.id)),
  ...UI_GLOBAL_ACTION_CONTRACTS.map(action => action.id),
];

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

  it('automated claims reference a real spec file containing the named test', () => {
    for (const [id, evidence] of Object.entries(UI_ACTION_COVERAGE)) {
      if (evidence.kind !== 'automated') continue;
      expect(evidence.specs.length, `${id} claims automation with zero specs`).toBeGreaterThan(0);
      for (const spec of evidence.specs) {
        expect(existsSync(spec.file), `${id}: spec file ${spec.file} does not exist`).toBe(true);
        const source = readFileSync(spec.file, 'utf8');
        expect(
          source.includes(spec.title),
          `${id}: ${spec.file} does not contain a test titled "${spec.title}" — the automation claim is stale`
        ).toBe(true);
      }
    }
  });

  it('manual exceptions carry an owner, a reason, and have not expired', () => {
    const now = Date.now();
    const expired: string[] = [];
    for (const [id, evidence] of Object.entries(UI_ACTION_COVERAGE)) {
      if (evidence.kind !== 'manual-exception') continue;
      expect(evidence.owner.trim(), `${id}: exception has no owner`).not.toBe('');
      expect(evidence.reason.trim().length, `${id}: exception has no reason`).toBeGreaterThan(20);
      const expiry = Date.parse(evidence.expires);
      expect(Number.isFinite(expiry), `${id}: exception expiry "${evidence.expires}" is not a date`).toBe(true);
      if (expiry < now) expired.push(`${id} (expired ${evidence.expires}, owner ${evidence.owner})`);
    }
    expect(
      expired,
      `expired manual exceptions — write the archetype test, do not extend the date:\n${expired.join('\n')}`
    ).toEqual([]);
  });

  it('critical-action exceptions may not outlive the burn-down date', () => {
    const burnDown = Date.parse(BURN_DOWN_DATE);
    for (const id of CRITICAL_ACTION_IDS) {
      const evidence = UI_ACTION_COVERAGE[id];
      expect(evidence, `critical action ${id} has no coverage entry`).toBeDefined();
      if (evidence.kind === 'manual-exception') {
        expect(
          Date.parse(evidence.expires) <= burnDown,
          `${id} is critical; its exception may not extend past ${BURN_DOWN_DATE}`
        ).toBe(true);
      }
    }
  });

  it('records the current burn-down position so coverage can only ratchet up', () => {
    const automated = Object.values(UI_ACTION_COVERAGE).filter(evidence => evidence.kind === 'automated').length;
    // Raise this floor as archetype tests land; lowering it means coverage
    // regressed and must fail loudly.
    expect(automated).toBeGreaterThanOrEqual(12);
    expect(allActionIds.length).toBe(Object.keys(UI_ACTION_COVERAGE).length);
  });
});
