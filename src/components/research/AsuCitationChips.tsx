'use client';

import Link from 'next/link';
import { asuCitationsInText, asuRowHref } from '../../services/asuIndex';

const VISIBLE_CHIPS = 2;

/**
 * Links a search hit to the ASU index rows of the Updates its matched text
 * cites ("ASU 2023-07"). Rendered beside the result card, never inside it: the
 * card is a button and cannot contain links.
 */
export default function AsuCitationChips({ text, className = '' }: { text: string | null | undefined; className?: string }) {
  const numbers = asuCitationsInText(text);
  if (numbers.length === 0) return null;
  const hidden = numbers.slice(VISIBLE_CHIPS);
  return (
    <span className={`research-hit-asu ${className}`.trim()}>
      {numbers.slice(0, VISIBLE_CHIPS).map(number => (
        <Link key={number} href={asuRowHref(number)} className="research-hit-asu-chip" aria-label={`ASU ${number} in the ASU index`}>
          ASU {number}
        </Link>
      ))}
      {hidden.length > 0 && (
        <span className="research-hit-asu-more" title={hidden.map(number => `ASU ${number}`).join(', ')}>
          +{hidden.length} more<span className="sr-only">: {hidden.map(number => `ASU ${number}`).join(', ')}</span>
        </span>
      )}
    </span>
  );
}
