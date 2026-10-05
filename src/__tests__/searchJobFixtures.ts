import { filingResearchStages, type FilingResearchResult } from '../services/filingResearch';
import type {
  WaveCandidateSearchInput,
  WaveExecutionClients,
  WaveFilingSignal,
} from '../services/filingResearchExecution';
import type { EdgarSearchHit } from '../services/secApi';
import { booleanQueryMatches } from '../utils/booleanSearch';

/**
 * Deterministic stand-ins for the worker's network clients: an EDGAR
 * full-text index that pages ten hits at a time from any offset, and a
 * document store keyed by primary document. Everything else is the
 * executor's real filing-domain code (filingResearchStages).
 */

export function fixtureHit(index: number, options: { form?: string; date?: string; cik?: string } = {}): EdgarSearchHit {
  const cik = options.cik ?? String(1_000_000 + index);
  const accession = `${cik.padStart(10, '0')}-24-${String(index).padStart(6, '0')}`;
  const document = `doc-${index}.htm`;
  return {
    _id: `${accession}:${document}`,
    _score: 1,
    _source: {
      display_names: [`Issuer ${index} (CIK ${cik.padStart(10, '0')})`],
      form: options.form ?? '10-K',
      root_forms: [options.form ?? '10-K'],
      file_type: options.form ?? '10-K',
      file_date: options.date ?? `2024-${String((index % 12) + 1).padStart(2, '0')}-15`,
      adsh: accession,
      ciks: [cik.padStart(10, '0')],
      primary_document: document,
    },
  };
}

export interface FixtureIndex {
  /** Hits returned for each lane query, in index order. */
  lanes: Record<string, EdgarSearchHit[]>;
  /** Filing text by primary document; absent means "fetch failed". */
  texts: Record<string, string>;
  /** Documents whose first fetch fails transiently (then succeeds). */
  flaky?: Set<string>;
}

export interface FixtureCalls {
  pages: Array<{ query: string; offset: number }>;
  documents: string[];
}

export function fixtureClients(index: FixtureIndex, calls: FixtureCalls = { pages: [], documents: [] }) {
  const failedOnce = new Set<string>();
  const clients: WaveExecutionClients<FilingResearchResult, WaveFilingSignal> = {
    searchCandidates: async (input: WaveCandidateSearchInput) => {
      const all = index.lanes[input.candidateQuery] ?? [];
      let offset = input.startOffset ?? 0;
      const hits: EdgarSearchHit[] = [];
      let exhausted = false;
      while (hits.length < input.resultLimit && offset < all.length) {
        if (input.onUpstreamPage(1) === false) break;
        calls.pages.push({ query: input.candidateQuery, offset });
        const page = all.slice(offset, offset + 10);
        hits.push(...page);
        offset += page.length;
      }
      if (offset >= all.length) exhausted = true;
      input.onWindow?.({
        nextOffset: offset,
        exhausted,
        windowCapped: false,
        upstreamTotal: all.length,
        upstreamTotalIsFloor: false,
      });
      input.onCoverage({ examined: offset, upstreamTotal: all.length, complete: exhausted });
      return hits;
    },
    mapSearchHit: filingResearchStages.mapSearchHit,
    uniqueById: filingResearchStages.uniqueById,
    hydrateCompanyMetadataBatch: async results => results,
    matchesBaseFilters: filingResearchStages.matchesBaseFilters,
    delay: async () => undefined,
    prescreenBooleanCandidates: async () => null,
    hydrateRegisteredAuditors: async () => undefined,
    getSignalCacheKey: filingResearchStages.getSignalCacheKey,
    hydrateResultSignals: async (result, _signal, onUpstreamAttempts) => {
      calls.documents.push(result.primaryDocument);
      onUpstreamAttempts?.(1);
      if (index.flaky?.has(result.primaryDocument) && !failedOnce.has(result.primaryDocument)) {
        failedOnce.add(result.primaryDocument);
        return { text: '', failure: 'rate-limit' };
      }
      const text = index.texts[result.primaryDocument];
      return text === undefined ? { text: '', failure: 'not-found' } : { text };
    },
    resolveScopedText: (text: string) => text,
    matchesBooleanQuery: booleanQueryMatches,
    matchesSignalFilters: filingResearchStages.matchesSignalFilters,
    annotateResultMatchContext: filingResearchStages.annotateResultMatchContext,
    sortResearchResults: filingResearchStages.sortResearchResults,
  };
  return { clients, calls };
}
