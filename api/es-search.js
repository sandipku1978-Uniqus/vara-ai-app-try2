/**
 * Elasticsearch search endpoint — drop-in replacement for SEC EDGAR EFTS.
 *
 * Accepts the same query params as EDGAR EFTS and returns the same response
 * shape (EdgarSearchResult), so the frontend searchEdgarFilings() function
 * can switch to this endpoint without changes.
 */

export const config = { runtime: 'edge' };

const BOOLEAN_SYNTAX_RE = /\b(?:AND|OR|NOT)\b|(?:W|WITHIN|NEAR)\/\d+|["()]/i;
const SEARCH_FIELDS = ['content', 'entity_name^3', 'display_names^2', 'file_description^2'];

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim();
}

function tokenizeBooleanQuery(query) {
  const tokens = [];
  let index = 0;

  while (index < query.length) {
    const ch = query[index];

    if (/\s/.test(ch)) {
      index += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'LPAREN' });
      index += 1;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'RPAREN' });
      index += 1;
      continue;
    }

    if (ch === '"') {
      let cursor = index + 1;
      let value = '';
      while (cursor < query.length && query[cursor] !== '"') {
        value += query[cursor];
        cursor += 1;
      }
      tokens.push({ type: 'PHRASE', value: normalizeWhitespace(value) });
      index = cursor < query.length ? cursor + 1 : cursor;
      continue;
    }

    let cursor = index;
    let value = '';
    while (cursor < query.length && !/\s|\(|\)/.test(query[cursor])) {
      value += query[cursor];
      cursor += 1;
    }

    const upper = value.toUpperCase();
    const proximityMatch = value.match(/^(?:W|WITHIN|NEAR)\/(\d+)$/i);

    if (upper === 'AND') {
      tokens.push({ type: 'AND' });
    } else if (upper === 'OR') {
      tokens.push({ type: 'OR' });
    } else if (upper === 'NOT') {
      tokens.push({ type: 'NOT' });
    } else if (proximityMatch) {
      tokens.push({ type: 'PROX', distance: Number(proximityMatch[1]) });
    } else {
      tokens.push({ type: 'TERM', value: normalizeWhitespace(value) });
    }

    index = cursor;
  }

  return tokens;
}

function isTextToken(token) {
  return Boolean(token && (token.type === 'TERM' || token.type === 'PHRASE'));
}

function mergeAdjacentTermsForProximity(tokens) {
  const merged = [...tokens];
  let index = 0;

  while (index < merged.length) {
    if (merged[index].type !== 'PROX') {
      index += 1;
      continue;
    }

    let leftStart = index - 1;
    while (leftStart >= 0 && isTextToken(merged[leftStart])) {
      leftStart -= 1;
    }
    leftStart += 1;
    const leftEnd = index - 1;
    if (leftEnd - leftStart >= 1) {
      merged.splice(leftStart, leftEnd - leftStart + 1, {
        type: 'PHRASE',
        value: merged
          .slice(leftStart, leftEnd + 1)
          .map(token => token.value)
          .join(' '),
      });
      index = leftStart + 1;
    }

    let rightEnd = index + 1;
    while (rightEnd < merged.length && isTextToken(merged[rightEnd])) {
      rightEnd += 1;
    }
    rightEnd -= 1;
    const rightStart = index + 1;
    if (rightEnd - rightStart >= 1) {
      merged.splice(rightStart, rightEnd - rightStart + 1, {
        type: 'PHRASE',
        value: merged
          .slice(rightStart, rightEnd + 1)
          .map(token => token.value)
          .join(' '),
      });
    }

    index += 1;
  }

  return merged;
}

function peek(state) {
  return state.tokens[state.index];
}

function consume(state) {
  const token = state.tokens[state.index];
  state.index += 1;
  return token;
}

function isPrimaryStart(token) {
  return Boolean(
    token &&
      (token.type === 'LPAREN' ||
        token.type === 'TERM' ||
        token.type === 'PHRASE' ||
        token.type === 'NOT')
  );
}

function parsePrimary(state) {
  const token = consume(state);
  if (!token) {
    throw new Error('Unexpected end of Boolean query.');
  }

  if (token.type === 'LPAREN') {
    const expression = parseOr(state);
    const close = consume(state);
    if (!close || close.type !== 'RPAREN') {
      throw new Error('Missing closing parenthesis.');
    }
    return expression;
  }

  if (token.type === 'TERM') {
    return { type: 'TERM', value: token.value };
  }

  if (token.type === 'PHRASE') {
    return { type: 'PHRASE', value: token.value };
  }

  throw new Error('Expected a search term.');
}

function parseProximity(state) {
  let left = parsePrimary(state);
  const token = peek(state);
  if (token?.type === 'PROX') {
    consume(state);
    const right = parsePrimary(state);
    left = { type: 'PROX', distance: token.distance, left, right };
  }
  return left;
}

function parseNot(state) {
  const token = peek(state);
  if (token?.type === 'NOT') {
    consume(state);
    return { type: 'NOT', child: parseNot(state) };
  }
  return parseProximity(state);
}

function parseAnd(state) {
  let node = parseNot(state);

  while (true) {
    const token = peek(state);

    if (token?.type === 'AND') {
      consume(state);
      node = { type: 'AND', left: node, right: parseNot(state) };
      continue;
    }

    if (token?.type === 'OR' || token?.type === 'RPAREN' || token == null) {
      break;
    }

    if (isPrimaryStart(token)) {
      node = { type: 'AND', left: node, right: parseNot(state) };
      continue;
    }

    break;
  }

  return node;
}

function parseOr(state) {
  let node = parseAnd(state);
  while (peek(state)?.type === 'OR') {
    consume(state);
    node = { type: 'OR', left: node, right: parseAnd(state) };
  }
  return node;
}

function parseBooleanQuery(query) {
  const trimmed = normalizeWhitespace(query);
  if (!trimmed) {
    return null;
  }

  try {
    const state = { tokens: mergeAdjacentTermsForProximity(tokenizeBooleanQuery(trimmed)), index: 0 };
    if (state.tokens.length === 0) {
      return null;
    }

    const expression = parseOr(state);
    if (state.index < state.tokens.length) {
      throw new Error('Unexpected Boolean token.');
    }
    return expression;
  } catch {
    return null;
  }
}

function buildFieldClause(field, value, phrase, boost = 1) {
  const payload = phrase
    ? { query: value }
    : { query: value, operator: 'and' };

  if (boost !== 1) {
    payload.boost = boost;
  }

  return phrase
    ? { match_phrase: { [field]: payload } }
    : { match: { [field]: payload } };
}

function buildLeafClause(value, { phrase = false } = {}) {
  const trimmed = normalizeWhitespace(value);
  if (!trimmed) {
    return { match_none: {} };
  }

  const should = [
    buildFieldClause('content', trimmed, phrase),
    buildFieldClause('entity_name', trimmed, phrase, 3),
    buildFieldClause('display_names', trimmed, phrase, 2),
    buildFieldClause('file_description', trimmed, phrase, 2),
  ];

  if (!phrase && /^[A-Za-z]{1,5}$/.test(trimmed)) {
    should.push({ term: { tickers: trimmed.toUpperCase() } });
  }

  return {
    bool: {
      should,
      minimum_should_match: 1,
    },
  };
}

function buildIntervalsRule(node) {
  if (!node) return null;

  if (node.type === 'TERM' || node.type === 'PHRASE') {
    return {
      match: {
        query: node.value,
        ordered: true,
        max_gaps: 0,
      },
    };
  }

  if (node.type === 'OR') {
    const left = buildIntervalsRule(node.left);
    const right = buildIntervalsRule(node.right);
    const intervals = [left, right].filter(Boolean);
    if (intervals.length === 0) return null;
    if (intervals.length === 1) return intervals[0];
    return {
      any_of: {
        intervals,
      },
    };
  }

  if (node.type === 'AND') {
    const left = buildIntervalsRule(node.left);
    const right = buildIntervalsRule(node.right);
    const intervals = [left, right].filter(Boolean);
    if (intervals.length === 0) return null;
    if (intervals.length === 1) return intervals[0];
    return {
      all_of: {
        ordered: false,
        intervals,
      },
    };
  }

  return null;
}

function buildBooleanClause(node) {
  if (!node) {
    return null;
  }

  switch (node.type) {
    case 'TERM':
      return buildLeafClause(node.value);
    case 'PHRASE':
      return buildLeafClause(node.value, { phrase: true });
    case 'AND': {
      const left = buildBooleanClause(node.left);
      const right = buildBooleanClause(node.right);
      return {
        bool: {
          must: [left, right].filter(Boolean),
        },
      };
    }
    case 'OR': {
      const left = buildBooleanClause(node.left);
      const right = buildBooleanClause(node.right);
      return {
        bool: {
          should: [left, right].filter(Boolean),
          minimum_should_match: 1,
        },
      };
    }
    case 'NOT': {
      const child = buildBooleanClause(node.child);
      return {
        bool: {
          must_not: child ? [child] : [],
        },
      };
    }
    case 'PROX': {
      const left = buildIntervalsRule(node.left);
      const right = buildIntervalsRule(node.right);

      if (left && right) {
        return {
          intervals: {
            content: {
              all_of: {
                ordered: false,
                max_gaps: node.distance,
                intervals: [left, right],
              },
            },
          },
        };
      }

      const leftClause = buildBooleanClause(node.left);
      const rightClause = buildBooleanClause(node.right);
      return {
        bool: {
          must: [leftClause, rightClause].filter(Boolean),
        },
      };
    }
    default:
      return null;
  }
}

function buildSemanticClause(query) {
  return {
    multi_match: {
      query,
      fields: SEARCH_FIELDS,
      type: 'best_fields',
      fuzziness: 'AUTO',
      minimum_should_match: '75%',
    },
  };
}

export function buildSearchClause(query) {
  const trimmed = normalizeWhitespace(query || '');
  if (!trimmed) {
    return null;
  }

  if (!BOOLEAN_SYNTAX_RE.test(trimmed)) {
    return buildSemanticClause(trimmed);
  }

  const expression = parseBooleanQuery(trimmed);
  return buildBooleanClause(expression) || buildSemanticClause(trimmed);
}

function buildHighlightConfig() {
  return {
    pre_tags: [''],
    post_tags: [''],
    fields: {
      content: {
        type: 'unified',
        fragment_size: 260,
        number_of_fragments: 1,
      },
      file_description: {
        type: 'unified',
        fragment_size: 180,
        number_of_fragments: 1,
      },
      entity_name: {
        type: 'unified',
        number_of_fragments: 0,
      },
      display_names: {
        type: 'unified',
        fragment_size: 180,
        number_of_fragments: 1,
      },
    },
  };
}

export function buildEsQuery({
  q = '',
  forms = '',
  startdt = '',
  enddt = '',
  entityName = '',
  from = 0,
  size = 100,
  auditor = '',
  acceleratedStatus = '',
  sicCode = '',
} = {}) {
  const must = [];
  const filter = [];

  const searchClause = buildSearchClause(q);
  if (searchClause) {
    must.push(searchClause);
  }

  if (forms) {
    const formList = forms.split(',').map(value => value.trim()).filter(Boolean);
    if (formList.length > 0) {
      const expanded = new Set();
      for (const form of formList) {
        expanded.add(form);
        if (!/\/A$/i.test(form)) {
          expanded.add(`${form}/A`);
        }
      }
      filter.push({ terms: { form: Array.from(expanded) } });
    }
  }

  const dateRange = {};
  if (startdt) dateRange.gte = startdt;
  if (enddt) dateRange.lte = enddt;
  if (Object.keys(dateRange).length > 0) {
    filter.push({ range: { file_date: dateRange } });
  }

  if (entityName) {
    must.push({
      bool: {
        should: [
          { match: { entity_name: { query: entityName, boost: 3 } } },
          { match: { display_names: { query: entityName, boost: 2 } } },
          { term: { tickers: entityName.toUpperCase() } },
          { term: { cik: entityName.replace(/^0+/, '') } },
          { term: { ciks: entityName.padStart(10, '0') } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  if (auditor) {
    if (auditor.toLowerCase() === 'big 4') {
      filter.push({ terms: { auditor: ['Deloitte', 'PwC', 'EY', 'KPMG'] } });
    } else {
      filter.push({ term: { auditor } });
    }
  }

  if (acceleratedStatus) {
    const statuses = acceleratedStatus.split(',').map(value => value.trim()).filter(Boolean);
    if (statuses.length > 0) {
      filter.push({ terms: { accelerated_status: statuses } });
    }
  }

  if (sicCode) {
    filter.push({ term: { sics: sicCode } });
  }

  return {
    query: {
      bool: {
        ...(must.length > 0 ? { must } : { must: [{ match_all: {} }] }),
        ...(filter.length > 0 ? { filter } : {}),
      },
    },
    from,
    size,
    sort: q ? [{ _score: 'desc' }, { file_date: 'desc' }] : [{ file_date: 'desc' }],
    ...(q ? { highlight: buildHighlightConfig() } : {}),
    _source: {
      excludes: ['content'],
    },
    track_total_hits: true,
  };
}

export default async function handler(request) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const esUrl = process.env.ELASTICSEARCH_URL;
  const esApiKey = process.env.ELASTICSEARCH_API_KEY;
  const esIndex = process.env.ELASTICSEARCH_INDEX || 'sec-filings';

  if (!esUrl || !esApiKey) {
    return new Response(
      JSON.stringify({
        error: 'Elasticsearch not configured. Set ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY.',
        hits: { hits: [], total: { value: 0 } },
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const q = params.get('q') || '';
  const forms = params.get('forms') || '';
  const startdt = params.get('startdt') || '';
  const enddt = params.get('enddt') || '';
  const entityName = params.get('entityName') || '';
  const from = parseInt(params.get('from') || '0', 10);
  const size = Math.min(parseInt(params.get('size') || '100', 10), 500);
  const auditor = params.get('auditor') || '';
  const acceleratedStatus = params.get('acceleratedStatus') || '';
  const sicCode = params.get('sicCode') || '';

  const esQuery = buildEsQuery({
    q,
    forms,
    startdt,
    enddt,
    entityName,
    from,
    size,
    auditor,
    acceleratedStatus,
    sicCode,
  });

  try {
    const esResponse = await fetch(`${esUrl}/${esIndex}/_search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `ApiKey ${esApiKey}`,
      },
      body: JSON.stringify(esQuery),
    });

    if (!esResponse.ok) {
      const errorText = await esResponse.text();
      console.error('ES search error:', esResponse.status, errorText);
      return new Response(
        JSON.stringify({
          error: `Elasticsearch error: ${esResponse.status}`,
          hits: { hits: [], total: { value: 0 } },
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const esResult = await esResponse.json();
    return new Response(JSON.stringify(esResult), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (error) {
    console.error('ES search failed:', error);
    return new Response(
      JSON.stringify({
        error: 'Search service unavailable',
        hits: { hits: [], total: { value: 0 } },
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
