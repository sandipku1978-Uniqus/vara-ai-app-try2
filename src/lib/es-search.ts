/**
 * Elasticsearch query builder for the sec-filings index.
 *
 * This module was lost in the Vite → Next.js migration: the frontend kept
 * calling /api/es-search and the test suite kept asserting this contract,
 * but no implementation existed — so every ES-enabled search 404'd and the
 * ingested index was unreachable. The route handler at
 * src/app/api/es-search/route.ts consumes this builder.
 *
 * Query semantics:
 *  - mode "semantic" (default): multi_match over content + entity fields.
 *    Short queries require every term (minimum_should_match 100%); longer
 *    natural-language queries relax to 80% so one filler word doesn't zero
 *    the result set.
 *  - mode "boolean": supports AND-joined clauses, quoted phrases, and
 *    EDGAR-style proximity ("term1 W/n term2") translated to intervals
 *    queries with max_gaps = n.
 */

export interface EsSearchRequest {
  q: string;
  forms?: string;
  startdt?: string;
  enddt?: string;
  entityName?: string;
  auditor?: string;
  acceleratedStatus?: string;
  sicCode?: string;
  mode?: 'semantic' | 'boolean';
  from?: number;
  size?: number;
}

interface EsClause {
  [key: string]: unknown;
}

export interface EsQueryBody {
  query: {
    bool: {
      must: EsClause[];
      filter: EsClause[];
      must_not?: EsClause[];
    };
  };
  highlight?: {
    fields: Record<string, { fragment_size: number; number_of_fragments: number }>;
  };
  from: number;
  size: number;
}

const SEARCH_FIELDS = ['content', 'entity_name^3', 'display_names^2', 'file_description'];

const PROXIMITY_RE = /^(.+?)\s+w\/(\d+)\s+(.+)$/i;

function countTerms(raw: string): number {
  return raw
    .replace(/"/g, ' ')
    .split(/\s+/)
    .filter(Boolean).length;
}

function stripQuotes(raw: string): string {
  return raw.replace(/"/g, '').trim();
}

function semanticClause(q: string): EsClause {
  return {
    multi_match: {
      query: q,
      fields: SEARCH_FIELDS,
      type: 'best_fields',
      operator: 'or',
      minimum_should_match: countTerms(q) > 4 ? '80%' : '100%',
    },
  };
}

function phraseOrMatchClause(part: string): EsClause {
  const trimmed = part.trim();
  const isPhrase = /^".*"$/.test(trimmed) || /\s/.test(trimmed);
  if (isPhrase) {
    return { match_phrase: { content: stripQuotes(trimmed) } };
  }
  return { match: { content: { query: stripQuotes(trimmed), operator: 'and' } } };
}

function proximityClause(left: string, gaps: number, right: string): EsClause {
  const sideInterval = (side: string) => ({
    match: {
      query: stripQuotes(side),
      max_gaps: 0,
      ordered: true,
    },
  });
  return {
    intervals: {
      content: {
        all_of: {
          ordered: false,
          max_gaps: gaps,
          intervals: [sideInterval(left), sideInterval(right)],
        },
      },
    },
  };
}

function booleanClauses(q: string): { must: EsClause[]; mustNot: EsClause[] } {
  const must: EsClause[] = [];
  const mustNot: EsClause[] = [];

  const proximity = q.match(PROXIMITY_RE);
  if (proximity) {
    must.push(proximityClause(proximity[1], Number(proximity[2]), proximity[3]));
    return { must, mustNot };
  }

  // Top-level split on uppercase AND; NOT-prefixed parts become must_not.
  // OR within a part maps to a should-group.
  const parts = q.split(/\s+AND\s+/).map(part => part.trim()).filter(Boolean);
  for (const part of parts) {
    if (/^NOT\s+/i.test(part)) {
      mustNot.push(phraseOrMatchClause(part.replace(/^NOT\s+/i, '')));
      continue;
    }
    const orParts = part.split(/\s+OR\s+/).map(p => p.trim()).filter(Boolean);
    if (orParts.length > 1) {
      must.push({
        bool: {
          should: orParts.map(phraseOrMatchClause),
          minimum_should_match: 1,
        },
      });
      continue;
    }
    must.push(phraseOrMatchClause(part));
  }
  return { must, mustNot };
}

export function buildEsQuery(req: EsSearchRequest): EsQueryBody {
  const must: EsClause[] = [];
  const mustNot: EsClause[] = [];
  const filter: EsClause[] = [];

  const q = (req.q ?? '').trim();
  if (q) {
    if (req.mode === 'boolean') {
      const clauses = booleanClauses(q);
      if (clauses.must.length > 1) {
        must.push({ bool: { must: clauses.must } });
      } else if (clauses.must.length === 1) {
        must.push(clauses.must[0]);
      }
      mustNot.push(...clauses.mustNot);
    } else {
      must.push(semanticClause(q));
    }
  }

  if (req.entityName) {
    must.push({
      multi_match: {
        query: req.entityName,
        fields: ['entity_name^3', 'display_names'],
        operator: 'and',
      },
    });
  }

  if (req.forms) {
    const forms = req.forms
      .split(',')
      .map(form => form.trim().toUpperCase())
      .filter(Boolean);
    if (forms.length > 0) {
      filter.push({ terms: { root_forms: forms } });
    }
  }

  if (req.startdt || req.enddt) {
    const range: Record<string, string> = {};
    if (req.startdt) range.gte = req.startdt;
    if (req.enddt) range.lte = req.enddt;
    filter.push({ range: { file_date: range } });
  }

  if (req.auditor) filter.push({ term: { auditor: req.auditor } });
  if (req.acceleratedStatus) filter.push({ term: { accelerated_status: req.acceleratedStatus } });
  // Exact term match: substring SIC matching admits unrelated industries
  if (req.sicCode) filter.push({ term: { sic: req.sicCode } });

  const body: EsQueryBody = {
    query: {
      bool: {
        must,
        filter,
        ...(mustNot.length > 0 ? { must_not: mustNot } : {}),
      },
    },
    highlight: {
      fields: {
        content: { fragment_size: 300, number_of_fragments: 3 },
      },
    },
    from: Math.max(0, req.from ?? 0),
    size: Math.min(Math.max(req.size ?? 10, 1), 100),
  };

  return body;
}
