'use client';

import { useEffect, useRef } from 'react';
import { HelpCircle, X } from 'lucide-react';
import './BooleanSyntaxHelp.css';

/**
 * The operator reference, one keystroke from the query field.
 *
 * Every operator below was previously advertised only inside the input's
 * placeholder, which vanishes the moment you type — so the engine's proximity,
 * grouping and auditor-field support was effectively undiscoverable unless you
 * already knew it was there.
 *
 * The table states what this engine actually does. Operators we do NOT support
 * are listed as such rather than omitted, because a researcher coming from
 * another platform will try them and deserves to know they are not silently
 * being ignored.
 */

interface Operator {
  token: string;
  example: string;
  meaning: string;
}

const SUPPORTED: Operator[] = [
  { token: 'AND', example: 'lease AND impairment', meaning: 'Both terms appear' },
  { token: 'OR', example: 'mezzanine OR "temporary equity"', meaning: 'Either appears — the union of both' },
  { token: 'NOT', example: 'goodwill NOT impairment', meaning: 'Excludes filings containing the term' },
  { token: '" "', example: '"material weakness"', meaning: 'Exact phrase, words adjacent and in order' },
  { token: '( )', example: 'lease AND (842 OR 840)', meaning: 'Groups operators' },
  { token: 'W/n', example: 'goodwill W/5 impairment', meaning: 'Within n words, either order' },
  { token: 'P/n', example: 'convertible P/3 notes', meaning: 'Within n words, first term preceding' },
  { token: '#', example: '"goodwill impairment" W/10 $#', meaning: 'Any number; $# a currency amount, %# a percentage' },
  { token: '*', example: 'crypto* AND blockchain', meaning: 'Any characters in one word — validates text; needs a concrete companion term for retrieval' },
  { token: '?', example: 'wom?n AND board', meaning: 'Exactly one character — same retrieval note as *' },
  { token: 'auditor:', example: '"material weakness" AND auditor:KPMG', meaning: 'Audit firm of record (PCAOB Form AP)' },
];

/**
 * Named so nobody assumes silence means support. Empty as of engine v4 —
 * every operator a researcher brings from Intelligize now parses — and the
 * section renders only when something lands back in this list.
 */
const UNSUPPORTED: Operator[] = [];

export interface BooleanSyntaxHelpProps {
  open: boolean;
  onClose: () => void;
}

export default function BooleanSyntaxHelp({ open, onClose }: BooleanSyntaxHelpProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    // Focus moves into the panel so keyboard users are not left behind on the
    // trigger with a dialog they cannot reach.
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const onClickAway = (event: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) onClose();
    };

    document.addEventListener('keydown', onKey);
    // Deferred: the click that opened the panel would otherwise close it.
    const timer = window.setTimeout(() => document.addEventListener('mousedown', onClickAway), 0);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClickAway);
      window.clearTimeout(timer);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="bool-help"
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-labelledby="bool-help-title"
    >
      <div className="bool-help__head">
        <h3 id="bool-help-title">Boolean syntax</h3>
        <button type="button" ref={closeRef} onClick={onClose} aria-label="Close Boolean syntax help">
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      <table className="bool-help__table">
        <caption className="sr-only">Supported Boolean operators</caption>
        <thead>
          <tr><th scope="col">Operator</th><th scope="col">Example</th><th scope="col">Meaning</th></tr>
        </thead>
        <tbody>
          {SUPPORTED.map(op => (
            <tr key={op.token}>
              <td><code>{op.token}</code></td>
              <td className="bool-help__eg">{op.example}</td>
              <td>{op.meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {UNSUPPORTED.length > 0 && (
        <>
          <p className="bool-help__note">Not supported — these are ignored rather than matched:</p>
          <table className="bool-help__table bool-help__table--muted">
            <caption className="sr-only">Operators this engine does not support</caption>
            <tbody>
              {UNSUPPORTED.map(op => (
                <tr key={op.token}>
                  <td><code>{op.token}</code></td>
                  <td className="bool-help__eg">{op.example}</td>
                  <td>{op.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      <p className="bool-help__note">
        Operators work in either case inside Boolean mode; only UPPERCASE operators auto-switch a Filing Research query into Boolean mode. A phrase in quotes is never split to look up a company.
      </p>
    </div>
  );
}

export { SUPPORTED as BOOLEAN_OPERATORS, UNSUPPORTED as BOOLEAN_UNSUPPORTED };

export function BooleanSyntaxHelpTrigger({ onClick, expanded }: { onClick: () => void; expanded: boolean }) {
  return (
    <button
      type="button"
      className="bool-help__trigger"
      onClick={onClick}
      aria-expanded={expanded}
      aria-label="Boolean syntax help"
      title="Boolean syntax"
    >
      <HelpCircle size={16} aria-hidden="true" />
    </button>
  );
}
