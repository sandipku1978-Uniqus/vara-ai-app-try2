'use client';

/**
 * Exception report — the OUTPUT surface.
 *
 * Reading order is deliberate and is the opposite of what a dashboard usually
 * does. The gate comes before the score, because a single blocking finding
 * matters more than any number. The coverage statement comes before the
 * findings, because a reader who sees twelve exceptions before learning that
 * 40% of the catalog never ran has already drawn the wrong conclusion.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, CheckCircle2, ChevronDown, ChevronRight, ExternalLink, Loader2, ShieldAlert,
} from 'lucide-react';

import type {
  EngagementRole, Finding, FindingStatus, GateResult, Layer, RunResult, Severity,
} from '../../lib/filing-ai/types';
import { formatDate, GatePill, ReadinessDial, ScopeNotice, SeverityTag } from './shared';
import './FilingAI.css';

const LAYER_LABELS: Record<Layer, string> = {
  mechanical: 'Mechanical',
  xbrl: 'Structured data',
  consistency: 'Internal consistency',
  continuity: 'Prior-period continuity',
  disclosure: 'Required disclosure',
  judgment: 'Judgment (cited prompts)',
};

const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low'];

const GATE_LABELS: Record<GateResult['gate'], string> = {
  G1: 'G1 · Completeness',
  G2: 'G2 · Parse',
  G3: 'G3 · Identity',
  G4: 'G4 · Authority',
  G5: 'G5 · Source reconciliation',
  G6: 'G6 · Sufficiency',
};

/** An unresolved condition is a question for a preparer, not a defect found. */
function isQuestion(finding: Finding): boolean {
  return !finding.blocking && finding.title.toLowerCase().startsWith('confirm ');
}

function DispositionForm({
  finding,
  runId,
  onDisposed,
}: {
  finding: Finding;
  runId: string;
  onDisposed: (finding: Finding) => void;
}) {
  const [status, setStatus] = useState<Exclude<FindingStatus, 'open'>>('remediated');
  const [actor, setActor] = useState('');
  const [actorRole, setActorRole] = useState<EngagementRole>('preparer');
  const [rationale, setRationale] = useState('');
  const [fourEyesBy, setFourEyesBy] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsFourEyes = status === 'accepted' && finding.severity === 'critical';
  const needsExpiry = status === 'suppressed';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/filing-ai/runs/${runId}/findings/${finding.finding_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status,
          actor,
          actor_role: actorRole,
          rationale,
          four_eyes_by: fourEyesBy || undefined,
          four_eyes_role: fourEyesBy ? 'engagement_partner' : undefined,
          expires_at: expiresAt || undefined,
        }),
      });
      const payload = await response.json();
      if (!payload.ok) {
        setError(payload.error || 'The disposition was refused.');
        return;
      }
      onDisposed(payload.finding as Finding);
    } catch {
      setError('The disposition could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="fai-disposition" onSubmit={submit}>
      <div className="fai-form-grid">
        <div className="fai-field">
          <label htmlFor={`status-${finding.finding_id}`}>Disposition</label>
          <select
            id={`status-${finding.finding_id}`}
            value={status}
            onChange={event => setStatus(event.target.value as Exclude<FindingStatus, 'open'>)}
          >
            <option value="remediated">Remediated — the draft was corrected</option>
            <option value="accepted">Accepted — no change to the draft</option>
            <option value="suppressed">Suppressed — for a stated period</option>
          </select>
        </div>
        <div className="fai-field">
          <label htmlFor={`actor-${finding.finding_id}`}>Disposed by</label>
          <input
            id={`actor-${finding.finding_id}`}
            value={actor}
            onChange={event => setActor(event.target.value)}
            placeholder="Full name"
            autoComplete="off"
          />
        </div>
        <div className="fai-field">
          <label htmlFor={`role-${finding.finding_id}`}>Role</label>
          <select
            id={`role-${finding.finding_id}`}
            value={actorRole}
            onChange={event => setActorRole(event.target.value as EngagementRole)}
          >
            <option value="preparer">Preparer</option>
            <option value="reviewer">Reviewer</option>
            <option value="engagement_partner">Engagement partner</option>
          </select>
        </div>
        {needsFourEyes && (
          <div className="fai-field">
            <label htmlFor={`four-${finding.finding_id}`}>Second approver</label>
            <input
              id={`four-${finding.finding_id}`}
              value={fourEyesBy}
              onChange={event => setFourEyesBy(event.target.value)}
              placeholder="Engagement partner"
              autoComplete="off"
            />
            <span className="fai-field-note">Accepting a critical finding needs two named people.</span>
          </div>
        )}
        {needsExpiry && (
          <div className="fai-field">
            <label htmlFor={`expiry-${finding.finding_id}`}>Expires</label>
            <input
              id={`expiry-${finding.finding_id}`}
              type="date"
              value={expiresAt}
              onChange={event => setExpiresAt(event.target.value)}
            />
            <span className="fai-field-note">A suppression without an expiry becomes permanent.</span>
          </div>
        )}
      </div>

      <div className="fai-field">
        <label htmlFor={`rationale-${finding.finding_id}`}>Rationale</label>
        <textarea
          id={`rationale-${finding.finding_id}`}
          rows={2}
          value={rationale}
          onChange={event => setRationale(event.target.value)}
          placeholder="Why this disposition is appropriate. This is the control evidence."
        />
      </div>

      {error && (
        <div className="fai-banner fai-banner-error" role="alert">
          <div>{error}</div>
        </div>
      )}

      <div>
        <button type="submit" className="fai-btn fai-btn-sm" disabled={busy}>
          {busy ? <Loader2 size={13} className="spinner" aria-hidden="true" /> : <CheckCircle2 size={13} aria-hidden="true" />}
          Record disposition
        </button>
      </div>
    </form>
  );
}

function FindingCard({
  finding,
  runId,
  onDisposed,
}: {
  finding: Finding;
  runId: string;
  onDisposed: (finding: Finding) => void;
}) {
  const [open, setOpen] = useState(false);
  const question = isQuestion(finding);

  return (
    <article
      className="fai-finding"
      data-severity={finding.severity}
      data-kind={question ? 'question' : 'defect'}
    >
      <button type="button" className="fai-finding-head" onClick={() => setOpen(value => !value)} aria-expanded={open}>
        {open ? <ChevronDown size={15} aria-hidden="true" /> : <ChevronRight size={15} aria-hidden="true" />}
        <span className="fai-finding-title">
          <strong>{finding.title}</strong>
          <span>
            {finding.rule_id} · v{finding.rule_version} · {LAYER_LABELS[finding.layer]}
            {finding.symptoms && finding.symptoms.length > 0 && ` · ${finding.symptoms.length + 1} symptoms`}
          </span>
        </span>
        {question ? <span className="fai-tag fai-tag-question">Confirm</span> : <SeverityTag severity={finding.severity} />}
        {finding.blocking && <span className="fai-tag fai-tag-blocking">Blocking</span>}
        {finding.status !== 'open' && <span className="fai-tag fai-tag-closed">{finding.status}</span>}
      </button>

      {open && (
        <div className="fai-finding-body">
          {finding.description && <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6 }}>{finding.description}</p>}

          <dl className="fai-evidence">
            <dt>Observed</dt>
            <dd>{finding.evidence.extracted}</dd>
            <dt>Expected</dt>
            <dd>{finding.evidence.expected}</dd>
            {finding.remediation && (
              <>
                <dt>Next step</dt>
                <dd><strong>{finding.remediation}</strong></dd>
              </>
            )}
            {finding.evidence.location?.artifact && (
              <>
                <dt>Provenance</dt>
                <dd className="fai-mono">
                  {finding.evidence.location.artifact}
                  {typeof finding.evidence.location.char_start === 'number'
                    && ` · characters ${finding.evidence.location.char_start.toLocaleString()}–${(finding.evidence.location.char_end ?? 0).toLocaleString()}`}
                  {finding.evidence.location.url && (
                    <>
                      {' '}
                      <a href={finding.evidence.location.url} target="_blank" rel="noopener noreferrer">
                        open document <ExternalLink size={11} aria-hidden="true" />
                      </a>
                    </>
                  )}
                </dd>
              </>
            )}
          </dl>

          {finding.authority.length > 0 && (
            <div className="fai-authority">
              {finding.authority.map(citation => (
                <span key={citation}>{citation}</span>
              ))}
            </div>
          )}

          {finding.symptoms && finding.symptoms.length > 0 && (
            <div className="fai-symptoms">
              <h4>Same root cause, other symptoms</h4>
              <ul>
                {finding.symptoms.map(symptom => (
                  <li key={symptom.rule_id}>
                    <strong style={{ color: 'var(--text-primary)' }}>{symptom.rule_id}</strong> — {symptom.title}. {symptom.evidence.extracted}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {finding.status === 'open' ? (
            <DispositionForm finding={finding} runId={runId} onDisposed={onDisposed} />
          ) : (
            finding.disposition && (
              <div className="fai-banner fai-banner-info">
                <div>
                  <strong>{finding.status}</strong> by {finding.disposition.actor} on{' '}
                  {formatDate(finding.disposition.timestamp)}
                  {finding.disposition.four_eyes_by && ` · second approval ${finding.disposition.four_eyes_by}`}
                  {finding.disposition.expires_at && ` · expires ${formatDate(finding.disposition.expires_at)}`}
                  <div style={{ marginTop: 4 }}>{finding.disposition.rationale}</div>
                </div>
              </div>
            )
          )}
        </div>
      )}
    </article>
  );
}

export default function FilingAIRunReport({ runId }: { runId: string }) {
  const [run, setRun] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [layerFilter, setLayerFilter] = useState<Layer | 'all'>('all');
  const [severityFilter, setSeverityFilter] = useState<Severity | 'all'>('all');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`/api/filing-ai/runs/${runId}`, { cache: 'no-store' });
        const payload = await response.json();
        if (cancelled) return;
        if (!payload.ok) setError(payload.error || 'The run could not be read.');
        else setRun(payload.run as RunResult);
      } catch {
        if (!cancelled) setError('The run could not be read.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [runId]);

  const onDisposed = useCallback((updated: Finding) => {
    setRun(current =>
      current
        ? {
            ...current,
            findings: current.findings.map(finding =>
              finding.finding_id === updated.finding_id ? updated : finding,
            ),
          }
        : current,
    );
  }, []);

  const layerCounts = useMemo(() => {
    const counts = new Map<Layer, number>();
    for (const finding of run?.findings ?? []) {
      counts.set(finding.layer, (counts.get(finding.layer) ?? 0) + 1);
    }
    return counts;
  }, [run]);

  const visible = useMemo(() => {
    return (run?.findings ?? []).filter(finding => {
      if (layerFilter !== 'all' && finding.layer !== layerFilter) return false;
      if (severityFilter !== 'all' && finding.severity !== severityFilter) return false;
      return true;
    });
  }, [run, layerFilter, severityFilter]);

  if (loading) {
    return <div className="fai-page"><div className="fai-empty">Loading the exception report…</div></div>;
  }
  if (error || !run) {
    return (
      <div className="fai-page">
        <div className="fai-banner fai-banner-error" role="alert">
          <div><strong>Report unavailable.</strong> {error}</div>
        </div>
        <Link href="/filing-ai" className="fai-btn fai-btn-secondary" style={{ alignSelf: 'flex-start' }}>
          <ArrowLeft size={15} aria-hidden="true" /> Back to the console
        </Link>
      </div>
    );
  }

  const openFindings = run.findings.filter(finding => finding.status === 'open');
  const blocking = openFindings.filter(finding => finding.blocking);

  return (
    <div className="fai-page">
      <Link href="/filing-ai" style={{ fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <ArrowLeft size={13} aria-hidden="true" /> Pre-flight console
      </Link>

      <section className="fai-subject">
        <div>
          <h1>{run.subject.registrant}</h1>
          <p className="fai-subject-meta">
            {run.subject.form_type} · period ended {formatDate(run.subject.period_of_report)} · filed{' '}
            {formatDate(run.subject.filing_date)} · CIK {run.subject.cik} · {run.subject.accession}
          </p>
          <p style={{ marginTop: 8 }}>
            <a href={run.subject.primary_document_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: '0.78rem' }}>
              Open the filed document on EDGAR <ExternalLink size={11} aria-hidden="true" />
            </a>
          </p>
        </div>
        <div className="fai-metric-row">
          <div className="fai-metric">
            <span className="fai-metric-label">Gate</span>
            <GatePill gate={run.gate} />
            <span className="fai-metric-sub">
              {blocking.length > 0
                ? `${blocking.length} open blocking finding(s). The gate is independent of the score.`
                : `${openFindings.length} open finding(s).`}
            </span>
          </div>
          <ReadinessDial score={run.readiness_score} coverageFactor={run.coverage.coverage_factor} />
        </div>
      </section>

      {/* Coverage before findings, on purpose. */}
      <section className="fai-card">
        <div className="fai-card-head">
          <h2>Coverage statement</h2>
          <p>
            Tier {run.coverage.tier_effective} · inputs received {run.coverage.inputs_received.join(', ')} ·{' '}
            {run.coverage.rules_executed} of {run.coverage.rules_total} applicable rules executed
          </p>
        </div>
        <div
          className="fai-coverage-bar"
          role="img"
          aria-label={`${(run.coverage.coverage_factor * 100).toFixed(0)} percent of applicable rules executed`}
        >
          <div className="fai-coverage-fill" style={{ width: `${run.coverage.coverage_factor * 100}%` }} />
        </div>
        <p className="fai-hint">
          {(run.coverage.coverage_factor * 100).toFixed(1)}% of the applicable catalog executed. The readiness
          figure is the raw score multiplied by this factor, so a partial run cannot present as a clean result.
        </p>

        <h3 style={{ fontSize: '0.8rem', marginTop: 14 }}>What this run could not see</h3>
        <ul className="fai-blindspots">
          {run.coverage.out_of_scope.map(entry => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>

        <ScopeNotice text={run.coverage.scope_language} />
      </section>

      <div className="fai-split">
        <aside className="fai-stack">
          <section className="fai-card">
            <div className="fai-card-head"><h3>Check layers</h3></div>
            <div className="fai-layer-list">
              <button
                type="button"
                className={`fai-layer ${layerFilter === 'all' ? 'is-active' : ''}`}
                onClick={() => setLayerFilter('all')}
              >
                <span>All layers</span>
                <span className="fai-layer-count">{run.findings.length}</span>
              </button>
              {(Object.keys(LAYER_LABELS) as Layer[]).map(layer => (
                <button
                  key={layer}
                  type="button"
                  className={`fai-layer ${layerFilter === layer ? 'is-active' : ''}`}
                  onClick={() => setLayerFilter(layer)}
                >
                  <span>{LAYER_LABELS[layer]}</span>
                  <span className="fai-layer-count">{layerCounts.get(layer) ?? 0}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="fai-card">
            <div className="fai-card-head"><h3>Input gates</h3></div>
            <div className="fai-layer-list">
              {run.gate_results.map(gate => (
                <div key={gate.gate} style={{ padding: '7px 0', borderTop: '1px solid var(--border-color)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.76rem', color: 'var(--text-primary)' }}>{GATE_LABELS[gate.gate]}</strong>
                    <span className={`fai-tag ${gate.passed ? 'fai-tag-closed' : 'fai-tag-high'}`}>
                      {gate.action === 'proceed' ? 'proceed' : gate.action === 'hard_stop' ? 'stop' : 'suppress'}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 3 }}>
                    {gate.detail}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {run.filer_risk && (
            <section className="fai-card">
              <div className="fai-card-head"><h3>Filer risk</h3></div>
              <span className={`fai-tag fai-tag-${run.filer_risk.band === 'high' ? 'critical' : run.filer_risk.band === 'elevated' ? 'high' : 'closed'}`}>
                {run.filer_risk.band}
              </span>
              <p className="fai-hint" style={{ marginTop: 8 }}>{run.filer_risk.rationale}</p>
            </section>
          )}

          <section className="fai-card">
            <div className="fai-card-head"><h3>Evidence pack</h3></div>
            <dl className="fai-evidence">
              <dt>Digest</dt>
              <dd className="fai-mono" style={{ fontSize: '0.68rem' }}>{run.evidence_pack.result_digest.slice(0, 32)}…</dd>
              <dt>Catalog</dt>
              <dd>v{run.catalog_version} · engine v{run.engine_version}</dd>
              <dt>Authority</dt>
              <dd>Taxonomy {run.authority.taxonomy_year}, pinned from {run.authority.resolved_from}</dd>
              <dt>Artefacts</dt>
              <dd>{run.evidence_pack.artifact_digests.length} document(s) hashed</dd>
              <dt>Duration</dt>
              <dd>{(run.duration_ms / 1000).toFixed(1)}s</dd>
            </dl>
          </section>
        </aside>

        <section className="fai-stack">
          <div className="fai-card">
            <div className="fai-card-head">
              <h2>Exception report</h2>
              <p>{visible.length} of {run.findings.length} shown</p>
            </div>
            <div className="fai-filter-row">
              <button
                type="button"
                className={`fai-chip ${severityFilter === 'all' ? 'is-active' : ''}`}
                onClick={() => setSeverityFilter('all')}
              >
                All severities
              </button>
              {SEVERITIES.map(severity => (
                <button
                  key={severity}
                  type="button"
                  className={`fai-chip ${severityFilter === severity ? 'is-active' : ''}`}
                  onClick={() => setSeverityFilter(severity)}
                >
                  {severity} ({run.findings.filter(finding => finding.severity === severity).length})
                </button>
              ))}
            </div>

            <div style={{ marginTop: 12 }}>
              {visible.length === 0 ? (
                <div className="fai-empty">
                  No findings match this filter. That is not a statement about the rest of the filing —
                  see the coverage statement above for what was not tested.
                </div>
              ) : (
                visible.map(finding => (
                  <FindingCard key={finding.finding_id} finding={finding} runId={run.run_id} onDisposed={onDisposed} />
                ))
              )}
            </div>
          </div>

          {run.rule_errors.length > 0 && (
            <div className="fai-card">
              <div className="fai-card-head">
                <h3>Rules that raised during execution</h3>
                <p>Recorded rather than skipped: a swallowed error is indistinguishable from a clean pass.</p>
              </div>
              <ul className="fai-blindspots">
                {run.rule_errors.map(entry => (
                  <li key={entry.rule_id}><strong>{entry.rule_id}</strong> — {entry.message}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="fai-card">
            <div className="fai-card-head">
              <h3><ShieldAlert size={14} aria-hidden="true" /> Rules not executed</h3>
              <p>{run.coverage.rules_suppressed.length} rule(s), with the gate that took each out of service</p>
            </div>
            <div className="fai-table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
              <table className="fai-table">
                <thead>
                  <tr>
                    <th scope="col">Rule</th>
                    <th scope="col">Gate</th>
                    <th scope="col">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {run.coverage.rules_suppressed.map(entry => (
                    <tr key={entry.rule_id}>
                      <td className="fai-mono">{entry.rule_id}</td>
                      <td>{entry.gate}</td>
                      <td>{entry.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
