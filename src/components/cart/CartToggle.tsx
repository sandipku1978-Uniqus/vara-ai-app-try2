'use client';

import { useId } from 'react';
import { useDocumentCart } from './useDocumentCart';
import {
  CART_LIMIT,
  cartContains,
  toggleInDocumentCart,
  type CartFilingInput,
} from '../../services/documentCart';
import './DocumentCart.css';

interface CartToggleProps {
  filing: CartFilingInput;
  /** Visible text beside the box; omit for a bare checkbox (the accessible name always names the filing). */
  label?: string;
  className?: string;
  /** Why this row cannot be selected yet (for example its SEC document is still being located). */
  disabledReason?: string;
}

/**
 * The one select control every filing surface uses, so a filing chosen in
 * search shows as chosen in the dossier, the matrices and exhibit rows too.
 */
export default function CartToggle({ filing, label, className = '', disabledReason }: CartToggleProps) {
  const items = useDocumentCart();
  const inputId = useId();
  const selected = cartContains(items, filing.cik, filing.accessionNumber);
  const full = !selected && items.length >= CART_LIMIT;
  const disabled = !selected && (Boolean(disabledReason) || full);
  const subject = [filing.company, filing.form ? `Form ${filing.form}` : '', filing.fileDate ? `filed ${filing.fileDate}` : '']
    .filter(Boolean)
    .join(' ');
  const title = disabledReason && !selected
    ? disabledReason
    : full
      ? `The document cart holds up to ${CART_LIMIT} filings — remove one to add another`
      : selected ? 'Remove from the document cart' : 'Add to the document cart';

  return (
    <span
      className={`cart-toggle ${selected ? 'is-selected' : ''} ${className}`.trim()}
      title={title}
      // Rows that are themselves clickable must not also act on this control.
      onClick={event => event.stopPropagation()}
    >
      <input
        id={inputId}
        type="checkbox"
        checked={selected}
        disabled={disabled}
        aria-label={`Select ${subject || 'this filing'} for the document cart`}
        onChange={() => { toggleInDocumentCart(filing); }}
      />
      {label && <label htmlFor={inputId} aria-hidden="true">{label}</label>}
    </span>
  );
}
