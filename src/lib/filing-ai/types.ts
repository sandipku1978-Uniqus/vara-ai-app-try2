/**
 * Filing AI data contracts.
 *
 * These types are the TypeScript projection of the JSON Schemas held in
 * `docs/filing-ai/schemas/`. The schemas remain the single source of truth for
 * external callers; these types are what the engine reads and writes. Where the
 * two could drift, `contracts.ts` re-validates at the boundary — internal
 * callers are not trusted (build spec §4).
 */

export type Layer =
  | 'mechanical'
  | 'xbrl'
  | 'consistency'
  | 'continuity'
  | 'disclosure'
  | 'judgment';

export type Determinism = 'deterministic' | 'judgment';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type CatalogSeverity = 'Critical' | 'High' | 'Medium' | 'Low';
export type BuildWave = 'P0' | 'P1' | 'P2';
export type RuleStatus = 'Draft' | 'Back-tested' | 'Reviewed' | 'Approved' | 'Live' | 'Retired';
export type FindingStatus = 'open' | 'remediated' | 'accepted' | 'suppressed';
export type GateDecision = 'NOT_READY' | 'READY_WITH_EXCEPTIONS' | 'READY';
export type GateId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6';
export type GateAction = 'proceed' | 'suppress_dependent_rules' | 'hard_stop';

/** I1 filing package, I2 filing history, I3 entity reference, I4 authority, I5 client source data. */
export type InputRef = 'I1' | 'I2' | 'I3' | 'I4' | 'I5';

export interface Rule {
  rule_id: string;
  layer: Layer;
  family: string;
  name: string;
  detection_logic: string;
  authority: string[];
  inputs_required: InputRef[];
  min_tier: number;
  severity: CatalogSeverity;
  blocking: boolean;
  determinism: Determinism;
  form_scope: string[];
  /** Regulation effective date. Selection is by filing period, never run date (G8). */
  effective_from: string | null;
  effective_to: string | null;
  evidence_captured: string;
  evidence_base?: string;
  build_wave: BuildWave;
  status: RuleStatus;
  reviewer: string | null;
  rule_version: string;
  backtest?: {
    recall?: number;
    precision?: number;
    corpus_version?: string;
    last_run?: string;
  } | null;
}

export interface RuleCatalog {
  catalog_version: string;
  generated_from?: string;
  note?: string;
  rule_count: number;
  rules: Rule[];
}

// ---------------------------------------------------------------------------
// Canonical Filing Model (P1 output)
// ---------------------------------------------------------------------------

export interface Provenance {
  /** Filename of the artefact inside the submission, e.g. `abc-20251231.htm`. */
  artifact: string;
  /**
   * Which stream the offsets index. `html` offsets address the raw filed
   * document; `text` offsets address the extracted reading text. Without this
   * a preparer opening a flag lands in the wrong place in a 4 MB document.
   */
  basis: 'html' | 'text';
  char_start: number;
  char_end: number;
  /** Absolute EDGAR URL, so a preparer can open the exact document. */
  url?: string;
}

export interface CfmSection {
  item_ref: string;
  heading: string;
  text: string;
  char_start: number;
  char_end: number;
}

export interface CfmFact {
  concept: string;
  value: number | string;
  unit?: string;
  sign?: number;
  period_start?: string;
  period_end?: string;
  context_ref?: string;
  decimals?: number | string;
  scale?: number;
  source: 'ixbrl' | 'table' | 'narrative' | 'companyfacts';
  provenance: Provenance;
}

export interface CfmTable {
  caption: string;
  grid: string[][];
  row_labels: string[];
  col_periods: string[];
  footnote_refs: string[];
  provenance: Provenance;
}

export interface CfmNarrativeNumber {
  literal: string;
  normalized: number;
  section: string;
  char_offset: number;
}

export interface CfmExhibit {
  number: string;
  type: string;
  description?: string;
  attached: boolean;
  filed_or_furnished: 'filed' | 'furnished' | 'unknown';
  ibr_target?: string;
  resolved: boolean;
  provenance?: Provenance;
}

export interface CfmSignature {
  name: string;
  title: string;
  conformed: boolean;
  date?: string;
  block_ref: string;
  char_offset: number;
}

export interface CanonicalFilingModel {
  run_id: string;
  /** Item-keyed sections of the primary document. */
  sections: CfmSection[];
  facts: CfmFact[];
  tables: CfmTable[];
  narrative_numbers: CfmNarrativeNumber[];
  exhibits: CfmExhibit[];
  /** dei:* inline tags keyed by local name, e.g. `DocumentType`. */
  dei_tags: Record<string, string>;
  signatures: CfmSignature[];
  /** Regions the normalizer could not parse — these become coverage disclosures. */
  unparsed_regions: string[];
  primary_document: {
    name: string;
    url: string;
    length: number;
    text_length: number;
    sha256: string;
  };
  submission: SubmissionHeader;
}

export interface SubmissionHeader {
  form_type: string;
  period_of_report: string;
  filer_cik: string;
  file_number: string;
  accession: string;
  filing_date: string;
  acceptance_datetime?: string;
  is_xbrl: boolean;
  is_inline_xbrl: boolean;
  document_names: string[];
  /** Every document in the submission, from the EDGAR filing index. */
  documents: SubmissionDocument[];
}

export interface SubmissionDocument {
  name: string;
  type: string;
  description: string;
  size: number;
  url: string;
}

export interface EntityReference {
  cik: string;
  legal_name: string;
  fiscal_year_end: string | null;
  filer_status: 'large_accelerated' | 'accelerated' | 'non_accelerated' | 'unknown';
  is_src: boolean | null;
  is_shell: boolean | null;
  state_of_incorporation: string | null;
  ein: string | null;
  sic: string | null;
  sic_description: string | null;
  tickers: string[];
  exchanges: string[];
  file_number: string | null;
  entity_type: string | null;
}

export interface FilingHistoryEntry {
  accession: string;
  form: string;
  filing_date: string;
  period_of_report: string;
  primary_document: string;
  is_amendment: boolean;
}

// ---------------------------------------------------------------------------
// Findings and results (O1, O2)
// ---------------------------------------------------------------------------

export interface FindingEvidence {
  extracted: string;
  expected: string;
  location?: {
    section?: string;
    page?: number;
    char_start?: number;
    char_end?: number;
    artifact?: string;
    url?: string;
  };
}

export interface Disposition {
  actor: string;
  timestamp: string;
  rationale: string;
  four_eyes_by?: string;
  expires_at?: string;
}

export interface ModelProvenance {
  model: string;
  prompt_version: string;
  retrieval_index_version: string;
  retrieved_passages: string[];
}

export interface Finding {
  finding_id: string;
  run_id: string;
  rule_id: string;
  rule_version: string;
  layer: Layer;
  determinism: Determinism;
  severity: Severity;
  blocking: boolean;
  title: string;
  description: string;
  evidence: FindingEvidence;
  authority: string[];
  remediation: string;
  /** Deterministic findings are exactly 1.0 (GR-3). */
  confidence: number;
  root_cause_group?: string;
  /** Symptom count after root-cause de-duplication (§7.2). */
  symptoms?: FindingSymptom[];
  status: FindingStatus;
  disposition?: Disposition;
  model_provenance?: ModelProvenance;
}

export interface FindingSymptom {
  rule_id: string;
  title: string;
  evidence: FindingEvidence;
}

export interface SuppressedRule {
  rule_id: string;
  reason: string;
  gate: string;
}

export interface Coverage {
  tier_effective: number;
  rules_executed: number;
  rules_total: number;
  coverage_factor: number;
  rules_suppressed: SuppressedRule[];
  /** Defect classes explicitly out of scope at this tier. Never empty (GR-2). */
  out_of_scope: string[];
  scope_language: string;
  inputs_received: InputRef[];
}

export interface GateResult {
  gate: GateId;
  passed: boolean;
  action: GateAction;
  detail: string;
}

export interface FilerRisk {
  band: 'low' | 'moderate' | 'elevated' | 'high';
  prior_amendments_8q: number;
  rationale: string;
}

export interface RunResult {
  run_id: string;
  completed_at: string;
  gate: GateDecision;
  readiness_score: number;
  coverage: Coverage;
  gate_results: GateResult[];
  findings: Finding[];
  filer_risk?: FilerRisk;
  /** Rules that raised at run time. Never silently skipped (build spec §3.1). */
  rule_errors: RuleError[];
  subject: RunSubject;
  authority: AuthorityPin;
  catalog_version: string;
  engine_version: string;
  /** Wall-clock duration of the run, milliseconds. */
  duration_ms: number;
  evidence_pack: EvidencePack;
}

export interface RuleError {
  rule_id: string;
  message: string;
}

export interface RunSubject {
  cik: string;
  registrant: string;
  form_type: string;
  period_of_report: string;
  accession: string;
  filing_date: string;
  primary_document_url: string;
  /** Engagement this run belongs to; governs who may dispose of findings. */
  engagement_id?: string;
}

/** Authority versions pinned from the filing period, never from now() (GR-6). */
export interface AuthorityPin {
  regsk_version: string;
  regsx_version: string;
  asc_asof: string;
  taxonomy_year: number;
  dqc_ruleset_version: string;
  efm_version: string;
  resolved_from: string;
}

export interface EvidencePack {
  /** Digest over the ordered, timestamp-free finding set — the reproducibility key. */
  result_digest: string;
  artifact_digests: Array<{ name: string; sha256: string; bytes: number }>;
  catalog_version: string;
  rule_versions: Array<{ rule_id: string; rule_version: string }>;
  authority: AuthorityPin;
  sealed_at: string;
}

// ---------------------------------------------------------------------------
// Run request (I-layer contract)
// ---------------------------------------------------------------------------

export interface FilingRunRequest {
  run_id: string;
  /** Declared tier. Effective tier is derived from what actually arrived (§5.3). */
  tier: number;
  cik: string;
  /** Optional; when absent the latest matching filing is used. */
  accession?: string;
  form_type: string;
  engagement_id?: string;
  attestation: {
    submitted_by: string;
    submitted_at: string;
    is_final_draft: boolean;
  };
  /** I5 client source data. Absent for Tier 0/1 runs. */
  source_data?: {
    trial_balance?: boolean;
    mapping?: boolean;
    consolidation?: boolean;
    cap_table?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Governance (G1-G8)
// ---------------------------------------------------------------------------

export type EngagementRole =
  | 'preparer'
  | 'reviewer'
  | 'engagement_partner'
  | 'rule_board'
  | 'observer';

export interface EngagementMember {
  member_id: string;
  name: string;
  email: string;
  role: EngagementRole;
  added_at: string;
  added_by: string;
  /** Independence and access acknowledgements captured at onboarding (G7). */
  acknowledged_at?: string;
}

export type OnboardingStepId =
  | 'entity'
  | 'scope'
  | 'authority'
  | 'team'
  | 'access'
  | 'activation';

export interface OnboardingStep {
  id: OnboardingStepId;
  label: string;
  description: string;
  complete: boolean;
  completed_by?: string;
  completed_at?: string;
  blocking: boolean;
}

export interface Engagement {
  engagement_id: string;
  client_name: string;
  cik: string;
  forms_in_scope: string[];
  tier_authorised: number;
  status: 'onboarding' | 'active' | 'suspended' | 'closed';
  created_at: string;
  created_by: string;
  members: EngagementMember[];
  onboarding: OnboardingStep[];
  /** Dispositions above this severity need a second named approver (G3). */
  four_eyes_threshold: Severity;
  data_residency: string;
  retention_years: number;
}
