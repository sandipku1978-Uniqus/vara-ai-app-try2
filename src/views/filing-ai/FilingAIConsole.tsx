'use client';

/**
 * Pre-flight console — the INPUT surface.
 *
 * The screen is arranged around the product's central claim: what you supply
 * fixes what the output may say. The tier selector therefore sits next to a
 * plain statement of what each tier can and cannot see, rather than in a
 * settings panel a user finds after their first misleading report.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Database, FileSearch, Loader2, PlayCircle, ShieldCheck } from 'lucide-react';

import { SCOPE_LANGUAGE } from '../../lib/filing-ai/guardrails';
import type { Engagement, RunResult } from '../../lib/filing-ai/types';
import { formatDate, GatePill, ScopeNotice } from './shared';
import './FilingAI.css';

interface RunSummary {
  run_id: string;
  cik: string;
  registrant: string;
  form_type: string;
  period_of_report: string;
  accession: string;
  gate: RunResult['gate'];
  readiness_score: number;
  coverage_factor: number;
  created_at: string;
  open_findings: number;
  blocking_findings: number;
}

const TIERS = [
  {
    value: 0,
    label: 'Tier 0 — filing only',
    detail: 'Mechanical, XBRL and internal consistency. Needs nothing from the client, so it runs on any public filing today.',
  },
  {
    value: 1,
    label: 'Tier 1 — plus filing history',
    detail: 'Adds continuity against amounts as originally reported. Still needs nothing from the client.',
  },
  {
    value: 2,
    label: 'Tier 2 — plus trial balance',
    detail: 'Ties the filing back to the books. Requires client source data, which this build does not yet ingest.',
  },
];

export default function FilingAIConsole() {
  const router = useRouter();
  const [cik, setCik] = useState('');
  const [accession, setAccession] = useState('');
  const [tier, setTier] = useState(1);
  const [engagementId, setEngagementId] = useState('');
  const [engagements, setEngagements] = useState<Engagement[]>([]);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [storage, setStorage] = useState<'durable' | 'memory' | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(true);

  const loadRuns = useCallback(async () => {
    try {
      const response = await fetch('/api/filing-ai/runs', { cache: 'no-store' });
      const payload = await response.json();
      if (payload.ok) {
        setRuns(payload.runs as RunSummary[]);
        setStorage(payload.storage as 'durable' | 'memory');
      }
    } catch {
      // A failed history read must not block starting a new run.
    } finally {
      setLoadingRuns(false);
    }
  }, []);

  useEffect(() => {
    void loadRuns();
    void (async () => {
      try {
        const response = await fetch('/api/filing-ai/engagements', { cache: 'no-store' });
        const payload = await response.json();
        if (payload.ok) setEngagements(payload.engagements as Engagement[]);
      } catch {
        // Engagements are optional; a run can be started without one.
      }
    })();
  }, [loadRuns]);

  const activeEngagements = engagements.filter(engagement => engagement.status === 'active');

  async function startRun(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const digits = cik.replace(/\D/g, '');
    if (!digits) {
      setError('Enter the registrant’s CIK — ten digits, leading zeros optional.');
      return;
    }

    setRunning(true);
    try {
      const response = await fetch('/api/filing-ai/runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cik: digits,
          form_type: '10-K',
          accession: accession.trim() || undefined,
          tier,
          engagement_id: engagementId || undefined,
        }),
      });
      const payload = await response.json();
      if (!payload.ok) {
        setError(payload.error || 'The run could not be completed.');
        return;
      }
      router.push(`/filing-ai/runs/${(payload.run as RunResult).run_id}`);
    } catch {
      setError('The run could not be reached. Check the connection and try again.');
    } finally {
      setRunning(false);
    }
  }

  const selectedTier = TIERS.find(entry => entry.value === tier) ?? TIERS[0];

  return (
    <div className="fai-page">
      <header className="fai-header">
        <div className="fai-title">
          <span className="fai-eyebrow"><ShieldCheck size={13} aria-hidden="true" /> Filing AI</span>
          <h1>Pre-flight integrity check</h1>
          <p>
            A check that runs between “draft complete” and “hit submit”. It executes a governed rule
            catalog against a filing package and returns an exception report with evidence, cited
            authority and a readiness gate — plus an evidence pack the engagement can retain as
            management review control evidence.
          </p>
        </div>
        <Link href="/filing-ai/catalog" className="fai-btn fai-btn-secondary">
          <FileSearch size={15} aria-hidden="true" /> Rule catalog
        </Link>
      </header>

      {/* Input → Process → Output → Governance, stated where the work starts
          rather than in documentation nobody opens. */}
      <section className="fai-ipog" aria-label="How a run works">
        <div className="fai-ipog-cell">
          <span className="fai-ipog-key">Input</span>
          <strong>A contract, not an upload</strong>
          <span>
            Filing package, filing history, entity reference data and a period-pinned authority
            corpus. Six gates decide what may run.
          </span>
        </div>
        <div className="fai-ipog-cell">
          <span className="fai-ipog-key">Process</span>
          <strong>Deterministic, then cited</strong>
          <span>
            Rules and arithmetic across mechanical, XBRL, consistency, continuity and disclosure
            layers. The judgment layer produces cited questions, never conclusions.
          </span>
        </div>
        <div className="fai-ipog-cell">
          <span className="fai-ipog-key">Output</span>
          <strong>States its own blind spots</strong>
          <span>
            Exception report, readiness gate, remediation worklist — and a coverage statement that
            cannot be switched off.
          </span>
        </div>
        <div className="fai-ipog-cell is-governance">
          <span className="fai-ipog-key">Governance</span>
          <strong>Spans all three</strong>
          <span>
            Rule board sign-off, named dispositions with a rationale, four eyes on critical
            acceptances, and a write-once evidence store.
          </span>
        </div>
      </section>

      <section className="fai-card">
        <div className="fai-card-head">
          <h2>Start a check</h2>
          <p>Tier 0 needs nothing from the client, so a prospect’s last filing can be scored before the first meeting.</p>
        </div>

        <form onSubmit={startRun}>
          <div className="fai-form-grid">
            <div className="fai-field">
              <label htmlFor="fai-cik">Registrant CIK</label>
              <input
                id="fai-cik"
                type="text"
                inputMode="numeric"
                value={cik}
                onChange={event => setCik(event.target.value)}
                placeholder="0000320193"
                autoComplete="off"
              />
              <span className="fai-field-note">Ten digits. Leading zeros are optional.</span>
            </div>

            <div className="fai-field">
              <label htmlFor="fai-form">Form</label>
              <select id="fai-form" value="10-K" disabled>
                <option value="10-K">10-K — annual report</option>
              </select>
              <span className="fai-field-note">10-Q and other forms follow the 10-K rule set.</span>
            </div>

            <div className="fai-field">
              <label htmlFor="fai-accession">Accession (optional)</label>
              <input
                id="fai-accession"
                type="text"
                value={accession}
                onChange={event => setAccession(event.target.value)}
                placeholder="0000320193-24-000123"
                autoComplete="off"
              />
              <span className="fai-field-note">Leave blank to check the most recent 10-K.</span>
            </div>

            <div className="fai-field">
              <label htmlFor="fai-tier">Input tier</label>
              <select id="fai-tier" value={tier} onChange={event => setTier(Number(event.target.value))}>
                {TIERS.map(entry => (
                  <option key={entry.value} value={entry.value}>{entry.label}</option>
                ))}
              </select>
              <span className="fai-field-note">{selectedTier.detail}</span>
            </div>

            <div className="fai-field">
              <label htmlFor="fai-engagement">Engagement (optional)</label>
              <select id="fai-engagement" value={engagementId} onChange={event => setEngagementId(event.target.value)}>
                <option value="">No engagement — exploratory run</option>
                {activeEngagements.map(engagement => (
                  <option key={engagement.engagement_id} value={engagement.engagement_id}>
                    {engagement.client_name}
                  </option>
                ))}
              </select>
              <span className="fai-field-note">
                {activeEngagements.length === 0
                  ? 'No active engagement yet. Findings can only be disposed of within one.'
                  : 'Findings are disposed of under the engagement’s roles and four-eyes threshold.'}
              </span>
            </div>
          </div>

          <div className="fai-actions">
            <button type="submit" className="fai-btn" disabled={running}>
              {running ? <Loader2 size={15} className="spinner" aria-hidden="true" /> : <PlayCircle size={15} aria-hidden="true" />}
              {running ? 'Running the check…' : 'Run pre-flight check'}
            </button>
            <span className="fai-hint">
              A run makes several paced EDGAR requests and parses the full primary document. Expect
              up to a few minutes on a large filing.
            </span>
          </div>
        </form>

        {error && (
          <div className="fai-banner fai-banner-error" role="alert" style={{ marginTop: 14 }}>
            <div><strong>The run did not complete.</strong> {error}</div>
          </div>
        )}

        <ScopeNotice text={SCOPE_LANGUAGE} />
      </section>

      <section className="fai-card">
        <div className="fai-card-head">
          <h2>Recent checks</h2>
          {storage === 'memory' && (
            <p>
              <Database size={12} aria-hidden="true" /> No evidence store is configured, so runs are
              held in process memory for this session only.
            </p>
          )}
        </div>

        {loadingRuns ? (
          <div className="fai-empty">Loading recent checks…</div>
        ) : runs.length === 0 ? (
          <div className="fai-empty">No checks have been run yet.</div>
        ) : (
          <div className="fai-table-wrap">
            <table className="fai-table">
              <thead>
                <tr>
                  <th scope="col">Registrant</th>
                  <th scope="col">Form / period</th>
                  <th scope="col">Gate</th>
                  <th scope="col" className="fai-num">Readiness</th>
                  <th scope="col" className="fai-num">Coverage</th>
                  <th scope="col" className="fai-num">Open</th>
                  <th scope="col">Run</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(run => (
                  <tr key={run.run_id}>
                    <td>
                      <strong style={{ color: 'var(--text-primary)' }}>{run.registrant}</strong>
                      <div className="fai-mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        CIK {run.cik}
                      </div>
                    </td>
                    <td>
                      {run.form_type}
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {formatDate(run.period_of_report)}
                      </div>
                    </td>
                    <td><GatePill gate={run.gate} /></td>
                    <td className="fai-num">{run.readiness_score.toFixed(1)}</td>
                    <td className="fai-num">{(run.coverage_factor * 100).toFixed(0)}%</td>
                    <td className="fai-num">
                      {run.open_findings}
                      {run.blocking_findings > 0 && (
                        <div style={{ fontSize: '0.7rem', color: 'var(--status-error)' }}>
                          {run.blocking_findings} blocking
                        </div>
                      )}
                    </td>
                    <td>
                      <Link href={`/filing-ai/runs/${run.run_id}`}>
                        Open <ArrowRight size={12} aria-hidden="true" />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
