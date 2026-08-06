'use client';

/**
 * Engagements — the GOVERNANCE surface.
 *
 * Onboarding is a gate, not a wizard. Every step here exists because skipping
 * it produces a specific failure later: an unconfirmed registrant makes the
 * cover-page rules test against the wrong reference data, an unpinned authority
 * corpus measures a FY2022 filing against FY2025 requirements, and a team of
 * one cannot obtain the second approval a critical acceptance requires. The
 * screen says which failure each step prevents rather than asking for a tick.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, Loader2, Plus, Users } from 'lucide-react';

import { ENGAGEMENT_ROLES } from '../../lib/filing-ai/governance';
import type { Engagement, EngagementRole, OnboardingStepId, Severity } from '../../lib/filing-ai/types';
import { formatDate } from './shared';
import './FilingAI.css';

interface DecoratedEngagement extends Engagement {
  onboarding_state: { ready: boolean; completed: number; total: number };
  team_check: { satisfied: boolean; problems: string[] };
}

export default function FilingAIGovernance() {
  const [engagements, setEngagements] = useState<DecoratedEngagement[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [clientName, setClientName] = useState('');
  const [cik, setCik] = useState('');
  const [tier, setTier] = useState(1);
  const [threshold, setThreshold] = useState<Severity>('critical');
  const [retention, setRetention] = useState(7);

  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [memberRole, setMemberRole] = useState<EngagementRole>('preparer');
  const [acknowledged, setAcknowledged] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/filing-ai/engagements', { cache: 'no-store' });
      const payload = await response.json();
      if (payload.ok) {
        const list = payload.engagements as DecoratedEngagement[];
        setEngagements(list);
        setSelectedId(current => current ?? list[0]?.engagement_id ?? null);
      }
    } catch {
      setError('Engagements could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/filing-ai/engagements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!payload.ok) {
        setError([payload.error, ...(payload.problems ?? [])].filter(Boolean).join(' '));
        return null;
      }
      await load();
      return payload.engagement as DecoratedEngagement;
    } catch {
      setError('The request could not be completed.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  const selected = engagements.find(engagement => engagement.engagement_id === selectedId) ?? null;

  return (
    <div className="fai-page">
      <Link href="/filing-ai" style={{ fontSize: '0.78rem', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <ArrowLeft size={13} aria-hidden="true" /> Pre-flight console
      </Link>

      <header className="fai-header">
        <div className="fai-title">
          <span className="fai-eyebrow"><Users size={13} aria-hidden="true" /> Governance</span>
          <h1>Engagements and team onboarding</h1>
          <p>
            An engagement is the unit of governance: it fixes the registrant, the forms and tier in
            scope, who may dispose of a finding, and how long the evidence is retained. Findings can
            only be disposed of inside one, because a disposition without a named accountable person
            is not control evidence.
          </p>
        </div>
      </header>

      {error && (
        <div className="fai-banner fai-banner-error" role="alert">
          <div>{error}</div>
        </div>
      )}

      <section className="fai-card">
        <div className="fai-card-head">
          <h2>Roles and what each may do</h2>
          <p>Authority is cumulative up to engagement partner; the rule board sits outside the engagement.</p>
        </div>
        <div className="fai-role-grid">
          {ENGAGEMENT_ROLES.map(role => (
            <div key={role.role} className="fai-role">
              <h3>{role.label}</h3>
              <p>{role.summary}</p>
              <ul>
                {role.capabilities.map(capability => (
                  <li key={capability}>{capability}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <div className="fai-split">
        <aside className="fai-stack">
          <section className="fai-card">
            <div className="fai-card-head"><h3>Engagements</h3></div>
            {loading ? (
              <div className="fai-empty">Loading…</div>
            ) : engagements.length === 0 ? (
              <div className="fai-empty">None yet.</div>
            ) : (
              <div className="fai-layer-list">
                {engagements.map(engagement => (
                  <button
                    key={engagement.engagement_id}
                    type="button"
                    className={`fai-layer ${selectedId === engagement.engagement_id ? 'is-active' : ''}`}
                    onClick={() => setSelectedId(engagement.engagement_id)}
                  >
                    <span>
                      {engagement.client_name}
                      <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        CIK {engagement.cik} · {engagement.status}
                      </span>
                    </span>
                    <span className="fai-layer-count">
                      {engagement.onboarding_state.completed}/{engagement.onboarding_state.total}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <section className="fai-card">
            <div className="fai-card-head"><h3>New engagement</h3></div>
            <form
              onSubmit={async event => {
                event.preventDefault();
                const created = await post({
                  action: 'create',
                  client_name: clientName,
                  cik,
                  forms_in_scope: ['10-K'],
                  tier_authorised: tier,
                  four_eyes_threshold: threshold,
                  retention_years: retention,
                });
                if (created) {
                  setSelectedId(created.engagement_id);
                  setClientName('');
                  setCik('');
                }
              }}
            >
              <div className="fai-field">
                <label htmlFor="eng-name">Client</label>
                <input id="eng-name" value={clientName} onChange={event => setClientName(event.target.value)} autoComplete="off" />
              </div>
              <div className="fai-field" style={{ marginTop: 10 }}>
                <label htmlFor="eng-cik">Registrant CIK</label>
                <input id="eng-cik" value={cik} onChange={event => setCik(event.target.value)} inputMode="numeric" autoComplete="off" />
              </div>
              <div className="fai-field" style={{ marginTop: 10 }}>
                <label htmlFor="eng-tier">Tier authorised</label>
                <select id="eng-tier" value={tier} onChange={event => setTier(Number(event.target.value))}>
                  <option value={0}>Tier 0 — filing only</option>
                  <option value={1}>Tier 1 — plus filing history</option>
                  <option value={2}>Tier 2 — plus trial balance</option>
                </select>
              </div>
              <div className="fai-field" style={{ marginTop: 10 }}>
                <label htmlFor="eng-threshold">Four-eyes from</label>
                <select id="eng-threshold" value={threshold} onChange={event => setThreshold(event.target.value as Severity)}>
                  <option value="critical">Critical acceptances</option>
                  <option value="high">High and above</option>
                  <option value="medium">Medium and above</option>
                </select>
                <span className="fai-field-note">Accepting a finding at or above this severity needs a second named approver.</span>
              </div>
              <div className="fai-field" style={{ marginTop: 10 }}>
                <label htmlFor="eng-retention">Evidence retention (years)</label>
                <input
                  id="eng-retention"
                  type="number"
                  min={1}
                  max={25}
                  value={retention}
                  onChange={event => setRetention(Number(event.target.value))}
                />
              </div>
              <div className="fai-actions">
                <button type="submit" className="fai-btn fai-btn-sm" disabled={busy}>
                  {busy ? <Loader2 size={13} className="spinner" aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
                  Create
                </button>
              </div>
            </form>
          </section>
        </aside>

        <section className="fai-stack">
          {!selected ? (
            <div className="fai-empty">Select or create an engagement to work through its onboarding gate.</div>
          ) : (
            <>
              <div className="fai-card">
                <div className="fai-card-head">
                  <h2>{selected.client_name}</h2>
                  <p>
                    CIK {selected.cik} · {selected.forms_in_scope.join(', ')} · tier {selected.tier_authorised} ·
                    {' '}retention {selected.retention_years}y · created {formatDate(selected.created_at)}
                  </p>
                </div>
                <div className={`fai-banner ${selected.status === 'active' ? 'fai-banner-info' : 'fai-banner-warn'}`}>
                  <div>
                    <strong>{selected.status === 'active' ? 'Active.' : 'Onboarding.'}</strong>{' '}
                    {selected.status === 'active'
                      ? 'Runs against this engagement carry its roles and four-eyes threshold.'
                      : 'Runs started before activation are marked as pilot and cannot be relied on as control evidence.'}
                  </div>
                </div>
              </div>

              <div className="fai-card">
                <div className="fai-card-head">
                  <h3>Onboarding gate</h3>
                  <p>{selected.onboarding_state.completed} of {selected.onboarding_state.total} complete</p>
                </div>
                <div className="fai-steps">
                  {selected.onboarding.map(step => (
                    <div key={step.id} className={`fai-step ${step.complete ? 'is-complete' : ''}`}>
                      <span className="fai-step-mark">{step.complete && <Check size={12} aria-hidden="true" />}</span>
                      <span className="fai-step-copy">
                        <strong>{step.label}</strong>
                        <span>{step.description}</span>
                        {step.complete && step.completed_at && (
                          <span style={{ display: 'block', marginTop: 4, fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                            Completed {formatDate(step.completed_at)}
                          </span>
                        )}
                      </span>
                      {!step.complete && (
                        <button
                          type="button"
                          className="fai-btn fai-btn-secondary fai-btn-sm"
                          disabled={busy}
                          onClick={() =>
                            post({
                              action: 'complete_step',
                              engagement_id: selected.engagement_id,
                              step_id: step.id as OnboardingStepId,
                            })
                          }
                        >
                          Sign off
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="fai-card">
                <div className="fai-card-head">
                  <h3>Team</h3>
                  <p>{selected.members.length} member(s)</p>
                </div>

                {!selected.team_check.satisfied && (
                  <div className="fai-banner fai-banner-warn" style={{ marginBottom: 12 }}>
                    <div>
                      <strong>The team cannot yet dispose of what the engine will find.</strong>
                      <ul style={{ marginTop: 6, paddingLeft: 16 }}>
                        {selected.team_check.problems.map(problem => (
                          <li key={problem} style={{ fontSize: '0.78rem', lineHeight: 1.5 }}>{problem}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {selected.members.length > 0 && (
                  <div className="fai-table-wrap" style={{ marginBottom: 12 }}>
                    <table className="fai-table">
                      <thead>
                        <tr>
                          <th scope="col">Name</th>
                          <th scope="col">Email</th>
                          <th scope="col">Role</th>
                          <th scope="col">Acknowledged</th>
                          <th scope="col" />
                        </tr>
                      </thead>
                      <tbody>
                        {selected.members.map(member => (
                          <tr key={member.member_id}>
                            <td style={{ color: 'var(--text-primary)' }}>{member.name}</td>
                            <td className="fai-mono" style={{ fontSize: '0.74rem' }}>{member.email}</td>
                            <td>{ENGAGEMENT_ROLES.find(role => role.role === member.role)?.label ?? member.role}</td>
                            <td>{member.acknowledged_at ? formatDate(member.acknowledged_at) : '—'}</td>
                            <td>
                              <button
                                type="button"
                                className="fai-btn fai-btn-secondary fai-btn-sm"
                                disabled={busy}
                                onClick={() =>
                                  post({
                                    action: 'remove_member',
                                    engagement_id: selected.engagement_id,
                                    member_id: member.member_id,
                                  })
                                }
                              >
                                Remove
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <form
                  onSubmit={async event => {
                    event.preventDefault();
                    const updated = await post({
                      action: 'add_member',
                      engagement_id: selected.engagement_id,
                      member: { name: memberName, email: memberEmail, role: memberRole, acknowledged },
                    });
                    if (updated) {
                      setMemberName('');
                      setMemberEmail('');
                    }
                  }}
                >
                  <div className="fai-form-grid">
                    <div className="fai-field">
                      <label htmlFor="mem-name">Name</label>
                      <input id="mem-name" value={memberName} onChange={event => setMemberName(event.target.value)} autoComplete="off" />
                    </div>
                    <div className="fai-field">
                      <label htmlFor="mem-email">Email</label>
                      <input id="mem-email" type="email" value={memberEmail} onChange={event => setMemberEmail(event.target.value)} autoComplete="off" />
                    </div>
                    <div className="fai-field">
                      <label htmlFor="mem-role">Role</label>
                      <select id="mem-role" value={memberRole} onChange={event => setMemberRole(event.target.value as EngagementRole)}>
                        {ENGAGEMENT_ROLES.map(role => (
                          <option key={role.role} value={role.role}>{role.label}</option>
                        ))}
                      </select>
                    </div>
                    <div className="fai-field">
                      <label htmlFor="mem-ack">Access terms</label>
                      <select id="mem-ack" value={acknowledged ? 'yes' : 'no'} onChange={event => setAcknowledged(event.target.value === 'yes')}>
                        <option value="yes">Acknowledged at onboarding</option>
                        <option value="no">Not yet acknowledged</option>
                      </select>
                      <span className="fai-field-note">Tenant isolation, confidentiality and access logging (G7).</span>
                    </div>
                  </div>
                  <div className="fai-actions">
                    <button type="submit" className="fai-btn fai-btn-sm" disabled={busy}>
                      <Plus size={13} aria-hidden="true" /> Add member
                    </button>
                  </div>
                </form>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
