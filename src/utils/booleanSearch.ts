type Token =
  | { type: 'LPAREN' }
  | { type: 'RPAREN' }
  | { type: 'AND' }
  | { type: 'OR' }
  | { type: 'NOT' }
  | { type: 'PROX'; distance: number }
  | { type: 'TERM'; value: string }
  | { type: 'PHRASE'; value: string };

export type BooleanSearchNode =
  | { type: 'TERM'; value: string }
  | { type: 'PHRASE'; value: string }
  | { type: 'PROX'; distance: number; left: BooleanSearchNode; right: BooleanSearchNode }
  | { type: 'NOT'; child: BooleanSearchNode }
  | { type: 'AND'; left: BooleanSearchNode; right: BooleanSearchNode }
  | { type: 'OR'; left: BooleanSearchNode; right: BooleanSearchNode };

export interface ParsedBooleanQuery {
  expression: BooleanSearchNode | null;
  error?: string;
}

interface ParserState {
  tokens: Token[];
  index: number;
}

interface TextIndex {
  normalizedText: string;
  tokens: string[];
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeTokenValue(value: string): string {
  return normalizeWhitespace(
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/gi, ' ')
  );
}

function tokenize(query: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < query.length) {
    const ch = query[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'LPAREN' });
      i += 1;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'RPAREN' });
      i += 1;
      continue;
    }

    if (ch === '"') {
      let j = i + 1;
      let value = '';
      while (j < query.length && query[j] !== '"') {
        value += query[j];
        j += 1;
      }
      tokens.push({ type: 'PHRASE', value: normalizeWhitespace(value) });
      i = j < query.length ? j + 1 : j;
      continue;
    }

    let j = i;
    let value = '';
    while (j < query.length && !/\s|\(|\)/.test(query[j])) {
      value += query[j];
      j += 1;
    }

    const upper = value.toUpperCase();
    const proxMatch = value.match(/^(?:W|WITHIN|NEAR)\/(\d+)$/i);

    if (upper === 'AND') {
      tokens.push({ type: 'AND' });
    } else if (upper === 'OR') {
      tokens.push({ type: 'OR' });
    } else if (upper === 'NOT') {
      tokens.push({ type: 'NOT' });
    } else if (proxMatch) {
      tokens.push({ type: 'PROX', distance: Number(proxMatch[1]) });
    } else {
      tokens.push({ type: 'TERM', value: normalizeWhitespace(value) });
    }

    i = j;
  }

  return tokens;
}

function peek(state: ParserState): Token | undefined {
  return state.tokens[state.index];
}

function consume(state: ParserState): Token | undefined {
  const token = state.tokens[state.index];
  state.index += 1;
  return token;
}

function isPrimaryStart(token?: Token): boolean {
  return Boolean(
    token &&
      (token.type === 'LPAREN' ||
        token.type === 'TERM' ||
        token.type === 'PHRASE' ||
        token.type === 'NOT')
  );
}

function parsePrimary(state: ParserState): BooleanSearchNode {
  const token = consume(state);
  if (!token) {
    throw new Error('Unexpected end of query.');
  }

  if (token.type === 'LPAREN') {
    const expr = parseOr(state);
    const close = consume(state);
    if (!close || close.type !== 'RPAREN') {
      throw new Error('Missing closing parenthesis.');
    }
    return expr;
  }

  if (token.type === 'TERM') {
    return { type: 'TERM', value: token.value };
  }

  if (token.type === 'PHRASE') {
    return { type: 'PHRASE', value: token.value };
  }

  throw new Error('Expected a search term.');
}

function parseProximity(state: ParserState): BooleanSearchNode {
  let left = parsePrimary(state);
  const token = peek(state);
  if (token?.type === 'PROX') {
    consume(state);
    const right = parsePrimary(state);
    left = { type: 'PROX', distance: token.distance, left, right };
  }
  return left;
}

function parseNot(state: ParserState): BooleanSearchNode {
  const token = peek(state);
  if (token?.type === 'NOT') {
    consume(state);
    return { type: 'NOT', child: parseNot(state) };
  }
  return parseProximity(state);
}

function parseAnd(state: ParserState): BooleanSearchNode {
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

function parseOr(state: ParserState): BooleanSearchNode {
  let node = parseAnd(state);
  while (peek(state)?.type === 'OR') {
    consume(state);
    node = { type: 'OR', left: node, right: parseAnd(state) };
  }
  return node;
}

export function parseBooleanQuery(query: string): ParsedBooleanQuery {
  const trimmed = normalizeWhitespace(query);
  if (!trimmed) {
    return { expression: null };
  }

  try {
    const state: ParserState = { tokens: tokenize(trimmed), index: 0 };
    if (state.tokens.length === 0) {
      return { expression: null };
    }

    const expression = parseOr(state);
    if (state.index < state.tokens.length) {
      throw new Error('Unexpected token in query.');
    }
    return { expression };
  } catch (error) {
    return {
      expression: null,
      error: error instanceof Error ? error.message : 'Unable to parse Boolean query.',
    };
  }
}

function createTextIndex(text: string): TextIndex {
  const normalizedText = normalizeWhitespace(text.toLowerCase());
  const tokens = normalizedText
    .replace(/[^a-z0-9]+/gi, ' ')
    .split(' ')
    .map(token => token.trim())
    .filter(Boolean);

  return { normalizedText, tokens };
}

function includesToken(tokens: string[], value: string): boolean {
  const normalized = normalizeTokenValue(value);
  if (!normalized) return false;
  return tokens.includes(normalized);
}

function includesPhrase(normalizedText: string, value: string): boolean {
  const normalized = normalizeTokenValue(value);
  if (!normalized) return false;
  return normalizedText.includes(normalized);
}

function findOperandSpans(node: BooleanSearchNode, index: TextIndex): Array<{ start: number; end: number }> {
  if (node.type === 'TERM') {
    const normalized = normalizeTokenValue(node.value);
    if (!normalized) return [];
    return index.tokens
      .map((token, position) => (token === normalized ? { start: position, end: position } : null))
      .filter((value): value is { start: number; end: number } => value !== null);
  }

  if (node.type === 'PHRASE') {
    const normalized = normalizeTokenValue(node.value);
    const phraseTokens = normalized.split(' ').filter(Boolean);
    if (phraseTokens.length === 0) return [];

    const spans: Array<{ start: number; end: number }> = [];
    for (let i = 0; i <= index.tokens.length - phraseTokens.length; i += 1) {
      const slice = index.tokens.slice(i, i + phraseTokens.length);
      if (slice.join(' ') === normalized) {
        spans.push({ start: i, end: i + phraseTokens.length - 1 });
      }
    }
    return spans;
  }

  return [];
}

function matchesProximity(node: Extract<BooleanSearchNode, { type: 'PROX' }>, index: TextIndex): boolean {
  const leftSpans = findOperandSpans(node.left, index);
  const rightSpans = findOperandSpans(node.right, index);

  if (leftSpans.length === 0 || rightSpans.length === 0) {
    return false;
  }

  for (const left of leftSpans) {
    for (const right of rightSpans) {
      const gap =
        left.end < right.start
          ? right.start - left.end - 1
          : left.start > right.end
            ? left.start - right.end - 1
            : 0;
      if (gap <= node.distance) {
        return true;
      }
    }
  }

  return false;
}

function evaluate(node: BooleanSearchNode, index: TextIndex): boolean {
  switch (node.type) {
    case 'TERM':
      return includesToken(index.tokens, node.value);
    case 'PHRASE':
      return includesPhrase(index.normalizedText, node.value);
    case 'PROX':
      return matchesProximity(node, index);
    case 'NOT':
      return !evaluate(node.child, index);
    case 'AND':
      return evaluate(node.left, index) && evaluate(node.right, index);
    case 'OR':
      return evaluate(node.left, index) || evaluate(node.right, index);
    default:
      return false;
  }
}

export function booleanQueryMatches(query: string, text: string): boolean {
  const parsed = parseBooleanQuery(query);
  if (!parsed.expression) {
    return false;
  }
  return evaluate(parsed.expression, createTextIndex(text));
}

function collectPositiveTerms(node: BooleanSearchNode, negated = false, bucket = new Set<string>()): Set<string> {
  switch (node.type) {
    case 'TERM':
    case 'PHRASE':
      if (!negated) {
        bucket.add(node.value);
      }
      return bucket;
    case 'PROX':
      if (!negated) {
        collectPositiveTerms(node.left, false, bucket);
        collectPositiveTerms(node.right, false, bucket);
      }
      return bucket;
    case 'NOT':
      return collectPositiveTerms(node.child, true, bucket);
    case 'AND':
    case 'OR':
      collectPositiveTerms(node.left, negated, bucket);
      collectPositiveTerms(node.right, negated, bucket);
      return bucket;
    default:
      return bucket;
  }
}

export function buildCandidateQueryFromBoolean(query: string): string {
  const parsed = parseBooleanQuery(query);
  if (!parsed.expression) {
    return normalizeWhitespace(query);
  }

  const terms = Array.from(collectPositiveTerms(parsed.expression))
    .map(term => normalizeWhitespace(term))
    .filter(Boolean);

  return terms.length > 0 ? terms.join(' ') : normalizeWhitespace(query);
}
