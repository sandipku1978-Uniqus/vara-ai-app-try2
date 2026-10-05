import { AlertTriangle, Globe } from 'lucide-react';

import { findAiModel } from '../../lib/ai-models';
import { answeredByFallback, type AiAnswerMeta, type AiWebSource } from '../../services/aiApi';
import { effortPhrase } from './modelFormat';

function modelName(id: string): string {
  return findAiModel(id)?.label ?? id;
}

/**
 * "Answered by GPT-6.1 Sol · high effort", exactly as the server reported it.
 * Renders nothing when the server did not name the model — the request alone
 * is not evidence of what answered.
 */
export function AnswerModelLine({ meta }: { meta: AiAnswerMeta }) {
  if (!meta.model) return null;
  const fellBack = answeredByFallback(meta);
  return (
    <div className="answer-model-meta">
      <div className="answer-model-line">
        Answered by {modelName(meta.model)}
        {meta.reasoningEffort ? ` · ${effortPhrase(meta.reasoningEffort)}` : ''}
      </div>
      {fellBack && meta.requestedModel && (
        <div className="answer-model-fallback" role="note">
          <AlertTriangle size={12} aria-hidden="true" />
          <span>
            You chose {modelName(meta.requestedModel)}; the gateway answered with {modelName(meta.model)} instead.
          </span>
        </div>
      )}
    </div>
  );
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Pages the model read on the open web — kept apart from SEC filing citations. */
export function WebSourcesList({ sources }: { sources: AiWebSource[] }) {
  if (sources.length === 0) return null;
  return (
    <section className="web-sources" aria-label="Web sources">
      <div className="web-sources-header">
        <Globe size={13} aria-hidden="true" />
        <span className="section-label">Web sources</span>
        <span className="web-sources-note">Open web, not SEC filings</span>
      </div>
      <ol className="web-sources-list">
        {sources.map(source => (
          <li key={source.url}>
            <a href={source.url} target="_blank" rel="noopener noreferrer">
              {source.title || hostname(source.url)}
            </a>
            {source.title && <span className="web-sources-host">{hostname(source.url)}</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}
