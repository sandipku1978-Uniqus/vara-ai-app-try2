'use client';

import type { ReactNode } from 'react';
import { ListTree } from 'lucide-react';

import type { FilingResearchResult } from '../../services/filingResearch';
import './ResultEvidenceDetails.css';

/** How the filing viewer should open for a result row. */
export interface OpenFilingOptions {
  /** A different document of the same accession (a matched exhibit). */
  document?: string;
  /** Open with the "All hits in this filing" list showing. */
  panel?: 'hits';
}

interface ResultEvidenceDetailsProps {
  result: FilingResearchResult;
  renderSnippet: (text: string) => ReactNode;
  onOpenFiling: (result: FilingResearchResult, options?: OpenFilingOptions) => void;
}

/**
 * The evidence below a result card: further passages behind a disclosure,
 * "View all N hits", and the matched exhibits nested under the parent
 * filing. Lives beside the card (not inside it) because the card is itself
 * a button. Renders nothing when validation recorded nothing more.
 */
export default function ResultEvidenceDetails({ result, renderSnippet, onOpenFiling }: ResultEvidenceDetailsProps) {
  const morePassages = (result.matchSnippets || []).slice(1).filter(passage => passage.excerpt.trim());
  const hitCount = result.matchHitCount ?? 0;
  const exhibits = result.matchedExhibits || [];
  if (morePassages.length === 0 && hitCount < 2 && exhibits.length === 0) return null;

  return (
    <div className="result-evidence-details">
      {morePassages.length > 0 && (
        <details className="result-evidence-disclosure">
          <summary>
            {morePassages.length} more passage{morePassages.length === 1 ? '' : 's'}
          </summary>
          <ol className="result-evidence-passages">
            {morePassages.map((passage, index) => (
              <li key={`${index}-${passage.excerpt.slice(0, 24)}`}>
                {passage.sectionPath && (
                  <div className="result-evidence-path" title="Section derived from the validated filing text">
                    {passage.sectionPath}
                  </div>
                )}
                <div className="result-evidence-snippet">{renderSnippet(passage.excerpt)}</div>
              </li>
            ))}
          </ol>
        </details>
      )}

      {hitCount >= 2 && (
        <button
          type="button"
          className="result-evidence-link"
          onClick={() => onOpenFiling(result, { panel: 'hits' })}
          title="Open the filing with every hit listed beside it"
        >
          <ListTree size={12} aria-hidden="true" /> View all {hitCount.toLocaleString()} hits
        </button>
      )}

      {exhibits.length > 0 && (
        <details className="result-evidence-disclosure">
          <summary>
            Matched in {exhibits.length} exhibit{exhibits.length === 1 ? '' : 's'}
          </summary>
          <ul className="result-evidence-exhibits">
            {exhibits.map(exhibit => (
              <li key={exhibit.documentName}>
                <button
                  type="button"
                  className="result-evidence-exhibit"
                  onClick={() => onOpenFiling(result, { document: exhibit.documentName, panel: 'hits' })}
                  aria-label={`Open ${exhibit.documentType} (${exhibit.documentName}) in the filing viewer`}
                >
                  <span className="result-evidence-exhibit-type">{exhibit.documentType}</span>
                  <span className="result-evidence-exhibit-name">{exhibit.documentName}</span>
                  {exhibit.matchHitCount ? (
                    <span className="result-evidence-exhibit-hits">
                      {exhibit.matchHitCount.toLocaleString()} hit{exhibit.matchHitCount === 1 ? '' : 's'}
                    </span>
                  ) : null}
                </button>
                {exhibit.matchSectionPath && <div className="result-evidence-path">{exhibit.matchSectionPath}</div>}
                {exhibit.matchSnippet && <div className="result-evidence-snippet">{renderSnippet(exhibit.matchSnippet)}</div>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
