'use client';

import Link from 'next/link';
import { Check, ExternalLink, FileText } from 'lucide-react';
import CiteButton from '../memo/CiteButton';
import CartToggle from '../cart/CartToggle';
import {
  hitToCartFiling,
  hitToCitation,
  secUrlForHit,
  viewerPathForHit,
  type AlertHit,
} from '../../services/alertHits';
import './Alerts.css';

interface AlertHitCardProps {
  hit: AlertHit;
  /** Mark this hit seen; omitted where marking is not offered. */
  onMarkSeen?: (hit: AlertHit) => void;
  /** Called when the viewer link is followed (the bell closes its panel). */
  onNavigate?: () => void;
  /** Show which alert found the hit (the digest's flat lists). */
  showAlertName?: boolean;
}

/**
 * One filing an alert found: who filed what and when, where in the filing
 * the match sits, and the passage the validator read — with the same
 * open / cite / cart controls every other filing surface uses.
 */
export default function AlertHitCard({ hit, onMarkSeen, onNavigate, showAlertName = false }: AlertHitCardProps) {
  const viewerPath = viewerPathForHit(hit);
  const unseen = !hit.seenAt;
  return (
    <article className={`alert-hit ${unseen ? 'is-unseen' : ''}`} aria-label={`${hit.company || 'Filing'} ${hit.form} filed ${hit.filedAt || 'date unknown'}`}>
      <header className="alert-hit-head">
        <span className="alert-hit-form">{hit.form || 'Filing'}</span>
        <strong className="alert-hit-company" title={hit.company}>{hit.company || `CIK ${hit.cik}`}</strong>
        <time className="alert-hit-date" dateTime={hit.filedAt || undefined}>{hit.filedAt ? `Filed ${hit.filedAt}` : 'Filing date not reported'}</time>
        {unseen && <span className="alert-hit-new">New</span>}
      </header>
      {showAlertName && <div className="alert-hit-alert">Alert: {hit.alertName || 'Saved alert'}</div>}
      {hit.isAmendment && (
        <div className="alert-hit-amendment">
          Amendment of {hit.amendsAccession ? `accession ${hit.amendsAccession}` : 'a filing'} this alert already surfaced for the same period — not counted as a new hit.
        </div>
      )}
      <div className="alert-hit-section">
        {hit.sectionPath
          ? <span>{hit.sectionPath}</span>
          : <span className="alert-hit-muted">{hit.passageBasis === 'validated-text' ? 'Section heading not identified' : 'Section not determined'}</span>}
      </div>
      {hit.passageBasis === 'validated-text' && hit.passage ? (
        <blockquote className="alert-hit-passage">{hit.passage}</blockquote>
      ) : (
        <p className="alert-hit-muted alert-hit-passage-missing">
          {hit.passageBasis === 'validated-text'
            ? 'The filing text matched, but no passage could be quoted from it.'
            : 'EDGAR full-text search matched this filing on its own; its text was not read, so no passage is quoted. Open the filing to see the match.'}
        </p>
      )}
      <div className="alert-hit-actions">
        {viewerPath ? (
          <Link className="alert-hit-btn" href={viewerPath} onClick={onNavigate}>
            <FileText size={13} aria-hidden="true" /> Open in viewer
          </Link>
        ) : (
          <a className="alert-hit-btn" href={secUrlForHit(hit)} target="_blank" rel="noreferrer">
            <ExternalLink size={13} aria-hidden="true" /> Open on SEC.gov
          </a>
        )}
        <CiteButton compact citation={hitToCitation(hit)} />
        <CartToggle filing={hitToCartFiling(hit)} label="Cart" />
        {onMarkSeen && unseen && (
          <button type="button" className="alert-hit-btn" onClick={() => onMarkSeen(hit)} aria-label={`Mark ${hit.company || 'this filing'} ${hit.form} as seen`}>
            <Check size={13} aria-hidden="true" /> Mark seen
          </button>
        )}
      </div>
    </article>
  );
}
