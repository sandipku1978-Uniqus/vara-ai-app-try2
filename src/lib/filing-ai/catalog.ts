/**
 * Rule catalog — rules are data, not code (build spec §5.1).
 *
 * The catalog JSON is loaded once and frozen. Adding or amending a rule is a
 * catalog change reviewed by the rule board; only the predicate implementations
 * in `predicates.ts` are code. Nothing here may mutate a rule: historical runs
 * must be re-executable against the rule versions they originally used (GR-7).
 */

import rawCatalog from './rule-catalog.json';
import { RULE_BINDINGS } from './bindings';
import type {
  BuildWave,
  CatalogSeverity,
  InputRef,
  Rule,
  RuleCatalog,
  RuleStatus,
  Severity,
} from './types';

/**
 * Effective dates the seed catalog left null. Rule selection is by filing
 * period, never run date (G8) — without these, a FY2022 10-K would be measured
 * against FY2025 requirements. Dates are the first period end to which the
 * requirement applies.
 */
const EFFECTIVE_FROM_OVERRIDES: Record<string, string> = {
  // Item 601(b)(19) insider trading policy exhibit — annual reports for fiscal
  // years beginning on or after 1 Apr 2023, i.e. FY2024 calendar-year filers.
  'R-MECH-EXH-005': '2024-01-01',
  // Item 601(b)(97) clawback policy — listing standards effective 2 Oct 2023.
  'R-MECH-EXH-014': '2023-10-02',
  // Item 106 cybersecurity risk management — annual reports for fiscal years
  // ending on or after 15 Dec 2023.
  'R-DISC-011': '2023-12-15',
  // Item 408(b) insider trading policies statement.
  'R-DISC-013': '2024-01-01',
  // Item 408(a) Rule 10b5-1 trading arrangements.
  'R-DISC-014': '2023-06-15',
  // ASU 2023-07 segment expenses — fiscal years beginning after 15 Dec 2023.
  'R-DISC-023': '2024-12-15',
  // ASU 2023-09 income tax disclosures — fiscal years beginning after 15 Dec 2024.
  'R-DISC-024': '2025-12-15',
  'R-DISC-025': '2025-12-15',
  // Error-correction and recovery-analysis cover checkboxes arrived with the
  // Dec 2023 cover-page amendments.
  'R-MECH-COV-011': '2023-12-01',
  'R-MECH-COV-012': '2023-12-01',
};

const SEVERITY_MAP: Record<CatalogSeverity, Severity> = {
  Critical: 'critical',
  High: 'high',
  Medium: 'medium',
  Low: 'low',
};

export function normaliseSeverity(severity: CatalogSeverity): Severity {
  return SEVERITY_MAP[severity];
}

/**
 * Rule board status ladder (G1). A rule may only be promoted one step at a
 * time, and `Live` additionally requires a named reviewer and a back-test
 * record — enforced in `canPromote` below, not in a runbook.
 */
export const RULE_STATUS_LADDER: RuleStatus[] = [
  'Draft',
  'Back-tested',
  'Reviewed',
  'Approved',
  'Live',
  'Retired',
];

export interface PromotionCheck {
  allowed: boolean;
  reason: string;
}

export function canPromote(rule: Rule, target: RuleStatus): PromotionCheck {
  const from = RULE_STATUS_LADDER.indexOf(rule.status);
  const to = RULE_STATUS_LADDER.indexOf(target);
  if (to < 0 || from < 0) return { allowed: false, reason: 'Unknown rule status.' };
  if (target === 'Retired') {
    // GR-7: retirement is the only way a rule leaves service. It is never deleted.
    return { allowed: true, reason: 'Retired rules stay in the catalog for replay.' };
  }
  if (to !== from + 1) {
    return { allowed: false, reason: 'Rules advance one stage at a time through the board.' };
  }
  if (target === 'Back-tested' && !rule.backtest?.corpus_version) {
    return { allowed: false, reason: 'A back-test record against a named corpus version is required.' };
  }
  if (target === 'Reviewed' && !rule.reviewer) {
    return { allowed: false, reason: 'A named reviewer is required before review sign-off.' };
  }
  if (target === 'Live') {
    if (!rule.reviewer) return { allowed: false, reason: 'Live status requires a named reviewer (G1).' };
    if (typeof rule.backtest?.recall !== 'number' || typeof rule.backtest?.precision !== 'number') {
      return { allowed: false, reason: 'Live status requires recorded recall and precision (G1).' };
    }
  }
  return { allowed: true, reason: 'Promotion satisfies the rule board gate.' };
}

/**
 * How mature a catalog must be for a run to execute it.
 *
 * `production` is the contractual setting: only board-approved Live rules run.
 * `pilot` executes the pre-approval catalog and the run result says so in its
 * coverage block, because a pilot finding is a candidate defect, not a governed
 * exception. Silently running Draft rules under a production label is the
 * failure mode this setting exists to prevent.
 */
export type CatalogStage = 'pilot' | 'production';

const STAGE_MINIMUM: Record<CatalogStage, RuleStatus[]> = {
  pilot: ['Draft', 'Back-tested', 'Reviewed', 'Approved', 'Live'],
  production: ['Live'],
};

let cached: RuleCatalog | null = null;

/** Load, normalise and freeze the catalog. */
export function loadCatalog(): RuleCatalog {
  if (cached) return cached;
  const source = rawCatalog as unknown as RuleCatalog;
  const rules = source.rules.map<Rule>(rule => {
    const effectiveFrom = rule.effective_from ?? EFFECTIVE_FROM_OVERRIDES[rule.rule_id] ?? null;
    return Object.freeze({
      ...rule,
      effective_from: effectiveFrom,
      effective_to: rule.effective_to ?? null,
      backtest: rule.backtest ?? null,
    });
  });
  cached = Object.freeze({
    catalog_version: source.catalog_version,
    generated_from: source.generated_from,
    note: source.note,
    rule_count: rules.length,
    rules: Object.freeze(rules) as Rule[],
  }) as RuleCatalog;
  return cached;
}

export function getRule(ruleId: string): Rule | undefined {
  return loadCatalog().rules.find(rule => rule.rule_id === ruleId);
}

export interface SelectionContext {
  formType: string;
  periodOfReport: string;
  inputsAvailable: InputRef[];
  tierEffective: number;
  stage: CatalogStage;
  /** Rule ids a gate has taken out of service for this run. */
  suppressedByGates: Map<string, { reason: string; gate: string }>;
  /** Build waves this deployment ships. P0 only, until P1/P2 land. */
  waves: BuildWave[];
}

export interface SelectionOutcome {
  executable: Rule[];
  applicable: Rule[];
  suppressed: Array<{ rule: Rule; reason: string; gate: string }>;
  coverageFactor: number;
}

function formMatches(formScope: string[], formType: string): boolean {
  if (formScope.includes('*')) return true;
  // A 10-K/A is still a 10-K for rule-scope purposes.
  const base = formType.replace(/\/A$/, '').toUpperCase();
  return formScope.some(scope => scope.toUpperCase() === base);
}

function withinEffectivePeriod(rule: Rule, periodOfReport: string): boolean {
  if (rule.effective_from && periodOfReport < rule.effective_from) return false;
  if (rule.effective_to && periodOfReport >= rule.effective_to) return false;
  return true;
}

/**
 * Rule selection is the coverage mechanism (build spec §5.3).
 *
 * `applicable` is everything this filing's form and period could ever be tested
 * against; `executable` is what the supplied inputs actually permit. The ratio
 * is the coverage factor, and it multiplies the readiness score — which is what
 * makes a partial run arithmetically incapable of presenting as a clean bill of
 * health (GR-2).
 */
export function selectRules(context: SelectionContext): SelectionOutcome {
  const catalog = loadCatalog();
  const allowedStatuses = new Set(STAGE_MINIMUM[context.stage]);
  const inputs = new Set(context.inputsAvailable);
  const waves = new Set(context.waves);

  const applicable = catalog.rules.filter(
    rule =>
      rule.status !== 'Retired'
      && formMatches(rule.form_scope, context.formType)
      && withinEffectivePeriod(rule, context.periodOfReport),
  );

  const executable: Rule[] = [];
  const suppressed: Array<{ rule: Rule; reason: string; gate: string }> = [];

  for (const rule of applicable) {
    const gateSuppression = context.suppressedByGates.get(rule.rule_id);
    if (gateSuppression) {
      suppressed.push({ rule, ...gateSuppression });
      continue;
    }
    if (!allowedStatuses.has(rule.status)) {
      suppressed.push({
        rule,
        reason: `Rule is at status ${rule.status}; this run executes ${context.stage} catalog rules only.`,
        gate: 'G1',
      });
      continue;
    }
    if (!waves.has(rule.build_wave)) {
      suppressed.push({
        rule,
        reason: `Rule belongs to build wave ${rule.build_wave}, which is not deployed.`,
        gate: 'G6',
      });
      continue;
    }
    if (rule.min_tier > context.tierEffective) {
      suppressed.push({
        rule,
        reason: `Rule needs tier ${rule.min_tier}; this run reached tier ${context.tierEffective}.`,
        gate: 'G6',
      });
      continue;
    }
    const missingInputs = rule.inputs_required.filter(input => !inputs.has(input));
    if (missingInputs.length > 0) {
      suppressed.push({
        rule,
        reason: `Missing required input${missingInputs.length > 1 ? 's' : ''} ${missingInputs.join(', ')}.`,
        gate: 'G6',
      });
      continue;
    }
    const binding = RULE_BINDINGS[rule.rule_id];
    if (!binding || binding.predicate === 'unbound') {
      suppressed.push({
        rule,
        reason: binding?.predicate === 'unbound'
          ? binding.reason
          : 'No predicate binding is deployed for this rule.',
        gate: 'G6',
      });
      continue;
    }
    executable.push(rule);
  }

  return {
    executable,
    applicable,
    suppressed,
    coverageFactor: applicable.length === 0 ? 0 : executable.length / applicable.length,
  };
}

/** Catalog roll-up for the rule-board screen. */
export function catalogSummary() {
  const catalog = loadCatalog();
  const byLayer = new Map<string, number>();
  const byStatus = new Map<string, number>();
  const byWave = new Map<string, number>();
  let bound = 0;
  for (const rule of catalog.rules) {
    byLayer.set(rule.layer, (byLayer.get(rule.layer) ?? 0) + 1);
    byStatus.set(rule.status, (byStatus.get(rule.status) ?? 0) + 1);
    byWave.set(rule.build_wave, (byWave.get(rule.build_wave) ?? 0) + 1);
    const binding = RULE_BINDINGS[rule.rule_id];
    if (binding && binding.predicate !== 'unbound') bound += 1;
  }
  return {
    catalog_version: catalog.catalog_version,
    rule_count: catalog.rule_count,
    bound_rule_count: bound,
    by_layer: Object.fromEntries(byLayer),
    by_status: Object.fromEntries(byStatus),
    by_wave: Object.fromEntries(byWave),
  };
}
