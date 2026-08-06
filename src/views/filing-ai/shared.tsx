'use client';

/**
 * Presentation pieces shared across the Filing AI screens.
 *
 * The readiness dial and the gate pill appear on both the console and the
 * exception report and must read identically in each — a score that looks like
 * two different numbers in two places is a score nobody trusts.
 */

import type { ReactNode } from 'react';
import { AlertTriangle, CircleCheck, CircleSlash } from 'lucide-react';

import type { GateDecision, Severity } from '../../lib/filing-ai/types';

export const GATE_COPY: Record<GateDecision, { label: string; icon: ReactNode }> = {
  NOT_READY: { label: 'Not ready to file', icon: <CircleSlash size={15} aria-hidden="true" /> },
  READY_WITH_EXCEPTIONS: { label: 'Open exceptions', icon: <AlertTriangle size={15} aria-hidden="true" /> },
  READY: { label: 'No open exceptions', icon: <CircleCheck size={15} aria-hidden="true" /> },
};

export function GatePill({ gate }: { gate: GateDecision }) {
  const copy = GATE_COPY[gate];
  return (
    <span className={`fai-gate fai-gate-${gate.toLowerCase()}`}>
      {copy.icon}
      {copy.label}
    </span>
  );
}

/**
 * The readiness figure.
 *
 * The arc is drawn against the coverage-adjusted score, never the raw one, so
 * the visual and the number cannot tell different stories. Coverage is printed
 * underneath because a high score at 40% coverage means something very
 * different from the same score at 95%.
 */
export function ReadinessDial({
  score,
  coverageFactor,
  size = 108,
}: {
  score: number;
  coverageFactor: number;
  size?: number;
}) {
  const radius = size / 2 - 9;
  const circumference = 2 * Math.PI * radius;
  const bounded = Math.max(0, Math.min(100, score));
  const stroke = bounded >= 75 ? 'var(--status-success)' : bounded >= 45 ? 'var(--status-warning)' : 'var(--status-error)';

  return (
    <div className="fai-dial">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        role="img"
        aria-label={`Readiness ${bounded.toFixed(1)} out of 100, at ${(coverageFactor * 100).toFixed(0)} percent rule coverage`}
      >
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border-color)" strokeWidth={7} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth={7}
          strokeLinecap="round"
          strokeDasharray={`${(circumference * bounded) / 100} ${circumference}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
        <text x="50%" y="47%" textAnchor="middle" dominantBaseline="middle" className="fai-dial-figure">
          {bounded.toFixed(0)}
        </text>
        <text x="50%" y="65%" textAnchor="middle" className="fai-dial-caption">
          Readiness
        </text>
      </svg>
      <div className="fai-metric">
        <span className="fai-metric-label">Rule coverage</span>
        <span className="fai-metric-value">{(coverageFactor * 100).toFixed(0)}%</span>
        <span className="fai-metric-sub">Score is the raw figure multiplied by coverage.</span>
      </div>
    </div>
  );
}

export function SeverityTag({ severity }: { severity: Severity }) {
  return <span className={`fai-tag fai-tag-${severity}`}>{severity}</span>;
}

export function formatDate(value: string): string {
  if (!value) return '—';
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * The module's standing disclaimer.
 *
 * Rendered on every screen, never collapsible, never behind a toggle. It is the
 * sentence that separates a control-evidence artefact from an opinion, and a
 * reader who has to open something to find it has already formed one.
 */
export function ScopeNotice({ text }: { text: string }) {
  return <p className="fai-scope-language">{text}</p>;
}
