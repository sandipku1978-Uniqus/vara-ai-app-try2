'use client';

/**
 * Rule catalog — the PROCESS surface and the rule board's working screen.
 *
 * Two columns carry most of the value and are deliberately adjacent: a rule's
 * governance status, and whether a predicate for it is actually deployed. A
 * rule that is Live but unbound looks governed and executes nothing; a rule
 * that is bound but Draft executes only in pilot. Showing them apart is how
 * that gap survives.
 */

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, BookOpen } from 'lucide-react';

import type { Layer, Rule, RuleStatus } from '../../lib/filing-ai/types';
import './FilingAI.css';

interface CatalogRule extends Rule {
  predicate: string;
  unbound_reason: string | null;
}

interface CatalogPayload {
  ok: boolean;
  summary: {
    catalog_version: string;
    rule_count: number;
    bound_rule_count: number;
    by_layer: Record<string, number>;
    by_status: Record<string, number>;
    by_wave: Record<string, number>;
  };
  status_ladder: RuleStatus[];
  rules: CatalogRule[];
}

const LAYER_LABELS: Record<Layer, string> = {
  mechanical: 'Mechanical',
  xbrl: 'Structured data',
  consistency: 'Internal consistency',
  continuity: 'Prior-period continuity',
  disclosure: 'Required disclosure',
  judgment: 'Judgment',
};

export default function FilingAICatalog() {
  const [payload, setPayload] = useState<CatalogPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [layer, setLayer] = useState<Layer | 'all'>('all');
  const [wave, setWave] = useState<'all' | 'P0' | 'P1' | 'P2'>('all');
  const [boundOnly, setBoundOnly] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/filing-ai/catalog');
        const body = (await response.json()) as CatalogPayload;
        if (!cancelled && body.ok) setPayload(body);
      } catch {
        // The screen degrades to an empty state rather than an error wall.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const rules = useMemo(() => {
    if (!payload) return [];
    const needle = query.trim().toLowerCase();
    return payload.rules.filter(rule => {
      if (layer !== 'all' && rule.layer !== layer) return false;
      if (wave !== 'all' && rule.build_wave !== wave) return false;
      if (boundOnly && rule.predicate === 'unbound') return false;
      if (!needle) return true;
      return (
        rule.rule_id.toLowerCase().includes(needle)
        || rule.name.toLowerCase().includes(needle)
        || rule.family.toLowerCase().includes(needle)
        || rule.authority.join(' ').toLowerCase().includes(needle)
      );
    });
  }, [payload, layer, wave, boundOnly, query]);

  return (
    <div className="fai-page">
      <Link href="/filing-ai" style={{ fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <ArrowLeft size={13} aria-hidden="true" /> Pre-flight console
      </Link>

      <header className="fai-header">
        <div className="fai-title">
          <span className="fai-eyebrow"><BookOpen size={13} aria-hidden="true" /> Rule board</span>
          <h1>Rule catalog</h1>
          <p>
            Rules are data, not code. A rule’s scope, severity and effective date change by catalog
            amendment under rule board review; only the predicate that evaluates it is a deploy.
            Retired rules stay in the catalog so a historical run can be re-executed against the
            versions it originally used.
          </p>
        </div>
      </header>

      {loading && <div className="fai-empty">Loading the catalog…</div>}

      {payload && (
        <>
          <section className="fai-ipog" aria-label="Catalog summary">
            <div className="fai-ipog-cell">
              <span className="fai-ipog-key">Catalog</span>
              <strong>{payload.summary.rule_count} rules · v{payload.summary.catalog_version}</strong>
              <span>Across six check layers and three build waves.</span>
            </div>
            <div className="fai-ipog-cell">
              <span className="fai-ipog-key">Deployed</span>
              <strong>{payload.summary.bound_rule_count} with a predicate</strong>
              <span>
                The remainder are declared but not evaluable in this build; each is subtracted from
                coverage and named in every run’s coverage statement.
              </span>
            </div>
            <div className="fai-ipog-cell">
              <span className="fai-ipog-key">Status</span>
              <strong>
                {payload.status_ladder
                  .filter(status => payload.summary.by_status[status])
                  .map(status => `${payload.summary.by_status[status]} ${status}`)
                  .join(' · ')}
              </strong>
              <span>Live status needs a named reviewer and a recorded back-test (G1).</span>
            </div>
            <div className="fai-ipog-cell is-governance">
              <span className="fai-ipog-key">Promotion</span>
              <strong>{payload.status_ladder.join(' → ')}</strong>
              <span>One stage at a time. Rules are never deleted, only retired.</span>
            </div>
          </section>

          <section className="fai-card">
            <div className="fai-card-head">
              <h2>Rules</h2>
              <p>{rules.length} shown</p>
            </div>

            <div className="fai-form-grid">
              <div className="fai-field">
                <label htmlFor="cat-search">Search</label>
                <input
                  id="cat-search"
                  type="search"
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Rule id, name, family or authority"
                />
              </div>
              <div className="fai-field">
                <label htmlFor="cat-layer">Layer</label>
                <select id="cat-layer" value={layer} onChange={event => setLayer(event.target.value as Layer | 'all')}>
                  <option value="all">All layers</option>
                  {(Object.keys(LAYER_LABELS) as Layer[]).map(entry => (
                    <option key={entry} value={entry}>
                      {LAYER_LABELS[entry]} ({payload.summary.by_layer[entry] ?? 0})
                    </option>
                  ))}
                </select>
              </div>
              <div className="fai-field">
                <label htmlFor="cat-wave">Build wave</label>
                <select id="cat-wave" value={wave} onChange={event => setWave(event.target.value as 'all' | 'P0' | 'P1' | 'P2')}>
                  <option value="all">All waves</option>
                  <option value="P0">P0 — Tier 0, no client data</option>
                  <option value="P1">P1 — adds filing history</option>
                  <option value="P2">P2 — needs client data or judgment</option>
                </select>
              </div>
              <div className="fai-field">
                <label htmlFor="cat-bound">Predicate</label>
                <select
                  id="cat-bound"
                  value={boundOnly ? 'bound' : 'all'}
                  onChange={event => setBoundOnly(event.target.value === 'bound')}
                >
                  <option value="all">All rules</option>
                  <option value="bound">Deployed predicates only</option>
                </select>
              </div>
            </div>

            <div className="fai-table-wrap" style={{ marginTop: 14 }}>
              <table className="fai-table">
                <thead>
                  <tr>
                    <th scope="col">Rule</th>
                    <th scope="col">Layer / family</th>
                    <th scope="col">Severity</th>
                    <th scope="col">Wave / tier</th>
                    <th scope="col">Status</th>
                    <th scope="col">Predicate</th>
                    <th scope="col">Authority</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map(rule => (
                    <tr key={rule.rule_id}>
                      <td>
                        <strong style={{ color: 'var(--text-primary)' }}>{rule.name}</strong>
                        <div className="fai-mono" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {rule.rule_id} · v{rule.rule_version}
                          {rule.effective_from && ` · from ${rule.effective_from}`}
                        </div>
                      </td>
                      <td>
                        {LAYER_LABELS[rule.layer]}
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>{rule.family}</div>
                      </td>
                      <td>
                        <span className={`fai-tag fai-tag-${rule.severity.toLowerCase()}`}>{rule.severity}</span>
                        {rule.blocking && <div style={{ fontSize: '0.68rem', color: 'var(--status-error)', marginTop: 3 }}>blocking</div>}
                      </td>
                      <td>
                        {rule.build_wave}
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>tier {rule.min_tier}+</div>
                      </td>
                      <td>{rule.status}</td>
                      <td>
                        {rule.predicate === 'unbound' ? (
                          <>
                            <span style={{ color: 'var(--text-muted)' }}>not deployed</span>
                            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: 1.45, marginTop: 3 }}>
                              {rule.unbound_reason}
                            </div>
                          </>
                        ) : (
                          <span className="fai-mono" style={{ fontSize: '0.72rem' }}>{rule.predicate}</span>
                        )}
                      </td>
                      <td style={{ fontSize: '0.72rem' }}>{rule.authority.join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
