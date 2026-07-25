'use client';

import { splitIntoParagraphs } from '../../lib/filingText';
import type { TopicPassage as TopicPassageData } from '../../services/disclosureTopics';

/**
 * One peer's disclosure on a topic.
 *
 * The previous comparison rendered raw extracted text in a monospace column —
 * unreadable as prose, and it gave the reader no way to tell WHY a passage was
 * shown or where it came from. This presents the same evidence as a document:
 * the reading voice for the disclosure itself, the provenance above it, and the
 * topic vocabulary highlighted so divergence is visible at a glance rather than
 * found by re-reading both columns.
 */

interface Props {
  passage: TopicPassageData;
  /** Terms unique to this peer — where this disclosure actually diverges. */
  distinctive?: string[];
  onCite?: () => void;
}

/** Longest-first so "performance obligation" wins over "obligation". */
function highlightTerms(text: string, terms: string[]): React.ReactNode {
  if (terms.length === 0 || !text) return text;

  const ordered = [...new Set(terms)].sort((a, b) => b.length - a.length);
  const escaped = ordered.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const pattern = new RegExp(`(${escaped.join('|')})`, 'gi');

  return text.split(pattern).map((part, index) =>
    pattern.test(part) && ordered.some(term => term.toLowerCase() === part.toLowerCase()) ? (
      <mark key={index} className="topic-term">{part}</mark>
    ) : (
      part
    ),
  );
}

export default function TopicPassage({ passage, distinctive = [], onCite }: Props) {
  if (passage.matchKind === 'none') {
    return (
      <div className="topic-passage topic-passage--absent" role="note">
        <p className="topic-passage__reason">{passage.matchReason}</p>
        <p className="topic-passage__absent-help">
          Absence here means the topic was not located in the retrieved document — not that the company has no such
          policy. Open the filing to confirm.
        </p>
      </div>
    );
  }

  return (
    <div className="topic-passage">
      <div className="topic-passage__provenance">
        <span className={`topic-passage__badge topic-passage__badge--${passage.matchKind}`}>
          {passage.matchKind === 'heading' ? 'Matched heading' : 'Matched by term density'}
        </span>
        <span className="topic-passage__reason">{passage.matchReason}</span>
      </div>

      {distinctive.length > 0 && (
        <div className="topic-passage__distinctive">
          <span className="topic-passage__distinctive-label">Only this peer uses</span>
          {distinctive.map(term => (
            <span key={term} className="topic-passage__chip">{term}</span>
          ))}
        </div>
      )}

      {/* Serif reading voice: this is source document text, not UI chrome.
          Paragraphed, because filings often carry no structural breaks and a
          single block is unreadable. */}
      <blockquote className="topic-passage__text">
        {splitIntoParagraphs(passage.text).map((para, index) => (
          <p key={index}>{highlightTerms(para, passage.matchedTerms)}</p>
        ))}
      </blockquote>

      {onCite && (
        <button type="button" className="secondary-btn topic-passage__cite" onClick={onCite}>
          Add to memo
        </button>
      )}
    </div>
  );
}
