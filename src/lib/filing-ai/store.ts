/**
 * Persistence for runs, dispositions and engagements.
 *
 * Two storage shapes on purpose. A sealed run is written once and never
 * amended; a finding's status is the fold of its append-only disposition log
 * over that sealed result. This is what makes the evidence pack meaningful —
 * the artefact a reviewer relied on is still the artefact in the row.
 *
 * When Supabase is not configured the same contract is served from process
 * memory, so a demo or a local run behaves identically and no route has to
 * branch on whether a database exists. Memory storage is explicitly not
 * durable, and `storageMode()` reports which one is live so the UI can say so.
 *
 * Server-only.
 */

import { getCacheWriterSupabase } from '../supabase-web';
import { applyDisposition, checkDisposition, type DispositionRequest } from './governance';
import type { Engagement, Finding, RunResult, Severity } from './types';

export interface StoredRunSummary {
  run_id: string;
  engagement_id?: string;
  cik: string;
  registrant: string;
  form_type: string;
  period_of_report: string;
  accession: string;
  gate: RunResult['gate'];
  readiness_score: number;
  coverage_factor: number;
  created_at: string;
  started_by: string;
  open_findings: number;
  blocking_findings: number;
}

export interface DispositionRecord {
  run_id: string;
  finding_id: string;
  rule_id: string;
  status: 'remediated' | 'accepted' | 'suppressed';
  actor: string;
  actor_role: string;
  rationale: string;
  four_eyes_by?: string;
  expires_at?: string;
  created_at: string;
}

const RUN_TABLE = 'urc_filing_ai_runs';
const DISPOSITION_TABLE = 'urc_filing_ai_dispositions';
const ENGAGEMENT_TABLE = 'urc_filing_ai_engagements';

interface MemoryStore {
  runs: Map<string, { scope: string; startedBy: string; createdAt: string; result: RunResult }>;
  dispositions: DispositionRecord[];
  engagements: Map<string, { scope: string; engagement: Engagement }>;
}

/**
 * Survives module reload in dev. A run costs several SEC round trips, so
 * losing the store on every hot reload would make the product untestable.
 */
const globalStore = globalThis as unknown as { __filingAiStore?: MemoryStore };
const memory: MemoryStore = globalStore.__filingAiStore ?? {
  runs: new Map(),
  dispositions: [],
  engagements: new Map(),
};
globalStore.__filingAiStore = memory;

export function storageMode(): 'durable' | 'memory' {
  return getCacheWriterSupabase() ? 'durable' : 'memory';
}

function summarise(
  result: RunResult,
  meta: { createdAt: string; startedBy: string },
): StoredRunSummary {
  return {
    run_id: result.run_id,
    engagement_id: result.subject.engagement_id,
    cik: result.subject.cik,
    registrant: result.subject.registrant,
    form_type: result.subject.form_type,
    period_of_report: result.subject.period_of_report,
    accession: result.subject.accession,
    gate: result.gate,
    readiness_score: result.readiness_score,
    coverage_factor: result.coverage.coverage_factor,
    created_at: meta.createdAt,
    started_by: meta.startedBy,
    open_findings: result.findings.filter(finding => finding.status === 'open').length,
    blocking_findings: result.findings.filter(finding => finding.status === 'open' && finding.blocking).length,
  };
}

export async function saveRun(
  result: RunResult,
  meta: { scope: string; startedBy: string },
): Promise<void> {
  const createdAt = new Date().toISOString();
  const supabase = getCacheWriterSupabase();
  if (!supabase) {
    memory.runs.set(result.run_id, { scope: meta.scope, startedBy: meta.startedBy, createdAt, result });
    return;
  }
  const { error } = await supabase.from(RUN_TABLE).insert({
    run_id: result.run_id,
    org_scope: meta.scope,
    engagement_id: result.subject.engagement_id ?? null,
    cik: result.subject.cik,
    registrant: result.subject.registrant,
    form_type: result.subject.form_type,
    period_of_report: result.subject.period_of_report || null,
    accession: result.subject.accession,
    gate: result.gate,
    readiness_score: result.readiness_score,
    coverage_factor: result.coverage.coverage_factor,
    catalog_version: result.catalog_version,
    engine_version: result.engine_version,
    result,
    result_digest: result.evidence_pack.result_digest,
    started_by: meta.startedBy,
    created_at: createdAt,
  });
  if (error) throw new Error(`Failed to persist run: ${error.message}`);
}

/** Fold the append-only disposition log over the sealed findings. */
function applyDispositions(result: RunResult, log: DispositionRecord[]): RunResult {
  if (log.length === 0) return result;
  const latest = new Map<string, DispositionRecord>();
  for (const record of [...log].sort((left, right) => left.created_at.localeCompare(right.created_at))) {
    latest.set(record.finding_id, record);
  }
  return {
    ...result,
    findings: result.findings.map(finding => {
      const record = latest.get(finding.finding_id);
      if (!record) return finding;
      return {
        ...finding,
        status: record.status,
        disposition: {
          actor: record.actor,
          timestamp: record.created_at,
          rationale: record.rationale,
          four_eyes_by: record.four_eyes_by,
          expires_at: record.expires_at,
        },
      };
    }),
  };
}

export async function loadRun(runId: string, scope: string): Promise<RunResult | null> {
  const supabase = getCacheWriterSupabase();
  if (!supabase) {
    const entry = memory.runs.get(runId);
    if (!entry || entry.scope !== scope) return null;
    return applyDispositions(
      entry.result,
      memory.dispositions.filter(record => record.run_id === runId),
    );
  }

  const { data, error } = await supabase
    .from(RUN_TABLE)
    .select('result')
    .eq('run_id', runId)
    .eq('org_scope', scope)
    .maybeSingle();
  if (error) throw new Error(`Failed to read run: ${error.message}`);
  if (!data?.result) return null;

  const { data: log, error: logError } = await supabase
    .from(DISPOSITION_TABLE)
    .select('*')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  if (logError) throw new Error(`Failed to read the disposition log: ${logError.message}`);

  return applyDispositions(data.result as RunResult, (log ?? []) as DispositionRecord[]);
}

export async function listRuns(scope: string, limit = 25): Promise<StoredRunSummary[]> {
  const supabase = getCacheWriterSupabase();
  if (!supabase) {
    return [...memory.runs.values()]
      .filter(entry => entry.scope === scope)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .map(entry =>
        summarise(
          applyDispositions(entry.result, memory.dispositions.filter(record => record.run_id === entry.result.run_id)),
          { createdAt: entry.createdAt, startedBy: entry.startedBy },
        ),
      );
  }

  const { data, error } = await supabase
    .from(RUN_TABLE)
    .select('result, created_at, started_by')
    .eq('org_scope', scope)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to list runs: ${error.message}`);
  return (data ?? []).map(row =>
    summarise(row.result as RunResult, {
      createdAt: String(row.created_at),
      startedBy: String(row.started_by),
    }),
  );
}

export interface RecordDispositionResult {
  ok: boolean;
  reason: string;
  finding?: Finding;
}

/**
 * Record a human decision on a finding.
 *
 * The governance check runs before the write, not after, so a disposition that
 * would fail G3 never reaches the append-only log — an audit trail full of
 * rejected attempts is worse than useless.
 */
export async function recordDisposition(
  runId: string,
  findingId: string,
  request: DispositionRequest,
  scope: string,
  fourEyesThreshold: Severity = 'critical',
): Promise<RecordDispositionResult> {
  const run = await loadRun(runId, scope);
  if (!run) return { ok: false, reason: 'Run not found.' };
  const finding = run.findings.find(entry => entry.finding_id === findingId);
  if (!finding) return { ok: false, reason: 'Finding not found in this run.' };

  const check = checkDisposition(finding, request, fourEyesThreshold);
  if (!check.allowed) return { ok: false, reason: check.reason };

  const createdAt = new Date().toISOString();
  const record: DispositionRecord = {
    run_id: runId,
    finding_id: findingId,
    rule_id: finding.rule_id,
    status: request.status,
    actor: request.actor.trim(),
    actor_role: request.actor_role,
    rationale: request.rationale.trim(),
    four_eyes_by: request.four_eyes_by?.trim() || undefined,
    expires_at: request.expires_at,
    created_at: createdAt,
  };

  const supabase = getCacheWriterSupabase();
  if (!supabase) {
    memory.dispositions.push(record);
  } else {
    const { error } = await supabase.from(DISPOSITION_TABLE).insert({
      run_id: record.run_id,
      finding_id: record.finding_id,
      rule_id: record.rule_id,
      status: record.status,
      actor: record.actor,
      actor_role: record.actor_role,
      rationale: record.rationale,
      four_eyes_by: record.four_eyes_by ?? null,
      expires_at: record.expires_at ?? null,
      created_at: createdAt,
    });
    if (error) return { ok: false, reason: `Failed to record the disposition: ${error.message}` };
  }

  return { ok: true, reason: check.reason, finding: applyDisposition(finding, request, createdAt) };
}

// ---------------------------------------------------------------------------
// Engagements
// ---------------------------------------------------------------------------

export async function saveEngagement(engagement: Engagement, scope: string): Promise<void> {
  const supabase = getCacheWriterSupabase();
  if (!supabase) {
    memory.engagements.set(engagement.engagement_id, { scope, engagement });
    return;
  }
  const { error } = await supabase.from(ENGAGEMENT_TABLE).upsert(
    {
      engagement_id: engagement.engagement_id,
      org_scope: scope,
      client_name: engagement.client_name,
      cik: engagement.cik,
      forms_in_scope: engagement.forms_in_scope,
      tier_authorised: engagement.tier_authorised,
      status: engagement.status,
      members: engagement.members,
      onboarding: engagement.onboarding,
      four_eyes_threshold: engagement.four_eyes_threshold,
      data_residency: engagement.data_residency,
      retention_years: engagement.retention_years,
      created_by: engagement.created_by,
      created_at: engagement.created_at,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'engagement_id' },
  );
  if (error) throw new Error(`Failed to persist the engagement: ${error.message}`);
}

function rowToEngagement(row: Record<string, unknown>): Engagement {
  return {
    engagement_id: String(row.engagement_id),
    client_name: String(row.client_name),
    cik: String(row.cik),
    forms_in_scope: (row.forms_in_scope as string[]) ?? [],
    tier_authorised: Number(row.tier_authorised) || 0,
    status: row.status as Engagement['status'],
    created_at: String(row.created_at),
    created_by: String(row.created_by),
    members: (row.members as Engagement['members']) ?? [],
    onboarding: (row.onboarding as Engagement['onboarding']) ?? [],
    four_eyes_threshold: (row.four_eyes_threshold as Severity) ?? 'critical',
    data_residency: String(row.data_residency ?? 'us'),
    retention_years: Number(row.retention_years) || 7,
  };
}

export async function listEngagements(scope: string): Promise<Engagement[]> {
  const supabase = getCacheWriterSupabase();
  if (!supabase) {
    return [...memory.engagements.values()]
      .filter(entry => entry.scope === scope)
      .map(entry => entry.engagement)
      .sort((left, right) => right.created_at.localeCompare(left.created_at));
  }
  const { data, error } = await supabase
    .from(ENGAGEMENT_TABLE)
    .select('*')
    .eq('org_scope', scope)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw new Error(`Failed to list engagements: ${error.message}`);
  return (data ?? []).map(row => rowToEngagement(row as Record<string, unknown>));
}

export async function loadEngagement(engagementId: string, scope: string): Promise<Engagement | null> {
  const supabase = getCacheWriterSupabase();
  if (!supabase) {
    const entry = memory.engagements.get(engagementId);
    return entry && entry.scope === scope ? entry.engagement : null;
  }
  const { data, error } = await supabase
    .from(ENGAGEMENT_TABLE)
    .select('*')
    .eq('engagement_id', engagementId)
    .eq('org_scope', scope)
    .maybeSingle();
  if (error) throw new Error(`Failed to read the engagement: ${error.message}`);
  return data ? rowToEngagement(data as Record<string, unknown>) : null;
}
