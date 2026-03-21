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

export interface BooleanMatchSnippet {
  excerpt: string;
  distance: number | null;
}

interface ParserState {
  tokens: Token[];
  index: number;
}

interface TextIndex {
  normalizedText: string;
  tokens: string[];
}

const BOOLEAN_SYNTAX_RE = /\b(?:AND|OR|NOT)\b|(?:W|WITHIN|NEAR)\/\d+|["()]/i;
const TERM_EQUIVALENTS: Record<string, string[]> = {
  asr: ['accelerated share repurchase', 'accelerated stock repurchase'],
};

function isTextToken(token?: Token): token is Extract<Token, { type: 'TERM' | 'PHRASE' }> {
  return Boolean(token && (token.type === 'TERM' || token.type === 'PHRASE'));
}

function mergeAdjacentTermsForProximity(tokens: Token[]): Token[] {
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
          .map(token => (token as Extract<Token, { type: 'TERM' | 'PHRASE' }>).value)
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
          .map(token => (token as Extract<Token, { type: 'TERM' | 'PHRASE' }>).value)
          .join(' '),
      });
    }

    index += 1;
  }

  return merged;
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

function buildTermMatchVariants(value: string): string[] {
  const normalized = normalizeTokenValue(value);
  if (!normalized || normalized.includes(' ')) {
    return normalized ? [normalized] : [];
  }

  const variants = new Set<string>([normalized]);

  const add = (candidate: string) => {
    const clean = normalizeTokenValue(candidate);
    if (clean) {
      variants.add(clean);
    }
  };

  if (normalized.length >= 5) {
    if (normalized.endsWith('s')) add(normalized.slice(0, -1));
    if (normalized.endsWith('es')) add(normalized.slice(0, -2));
    if (normalized.endsWith('ed')) add(normalized.slice(0, -2));
    if (normalized.endsWith('ing')) {
      add(normalized.slice(0, -3));
      add(`${normalized.slice(0, -3)}e`);
    }
    if (normalized.endsWith('ation') && normalized.length > 8) {
      const root = normalized.slice(0, -5);
      add(root);
      add(`${root}ed`);
      add(`${root}ing`);
      add(`${root}s`);
    }
  }

  return Array.from(variants).filter(Boolean);
}

function getEquivalentSearchValues(value: string): string[] {
  const normalized = normalizeTokenValue(value);
  if (!normalized) return [];

  const equivalents = TERM_EQUIVALENTS[normalized] || [];
  return Array.from(
    new Set([normalized, ...equivalents.map(candidate => normalizeTokenValue(candidate)).filter(Boolean)])
  );
}

function tokenMatchesTerm(actualToken: string, value: string): boolean {
  const variants = buildTermMatchVariants(value);
  return variants.some(variant => {
    if (actualToken === variant) {
      return true;
    }

    return variant.length >= 5 && actualToken.startsWith(variant) && actualToken.length - variant.length <= 4;
  });
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
    const state: ParserState = { tokens: mergeAdjacentTermsForProximity(tokenize(trimmed)), index: 0 };
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

export function looksLikeBooleanQuery(query: string): boolean {
  return BOOLEAN_SYNTAX_RE.test(query);
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

function buildSnippetFromSpan(index: TextIndex, start: number, end: number, contextWords = 14): string {
  const snippetStart = Math.max(0, start - contextWords);
  const snippetEnd = Math.min(index.tokens.length, end + contextWords + 1);
  const excerpt = index.tokens.slice(snippetStart, snippetEnd).join(' ').trim();
  if (!excerpt) return '';
  return `${snippetStart > 0 ? '... ' : ''}${excerpt}${snippetEnd < index.tokens.length ? ' ...' : ''}`;
}

function includesToken(tokens: string[], value: string): boolean {
  return tokens.some(token => tokenMatchesTerm(token, value));
}

function includesPhrase(normalizedText: string, value: string): boolean {
  const normalized = normalizeTokenValue(value);
  if (!normalized) return false;
  return normalizedText.includes(normalized);
}

function findPhraseSpans(index: TextIndex, normalizedPhrase: string): Array<{ start: number; end: number }> {
  const phraseTokens = normalizedPhrase.split(' ').filter(Boolean);
  if (phraseTokens.length === 0) return [];

  const spans: Array<{ start: number; end: number }> = [];
  for (let i = 0; i <= index.tokens.length - phraseTokens.length; i += 1) {
    const slice = index.tokens.slice(i, i + phraseTokens.length);
    if (slice.join(' ') === normalizedPhrase) {
      spans.push({ start: i, end: i + phraseTokens.length - 1 });
    }
  }
  return spans;
}

function findOperandSpans(node: BooleanSearchNode, index: TextIndex): Array<{ start: number; end: number }> {
  if (node.type === 'TERM') {
    const equivalents = getEquivalentSearchValues(node.value);
    if (equivalents.length === 0) return [];

    const tokenVariants = Array.from(
      new Set(
        equivalents
          .filter(value => !value.includes(' '))
          .flatMap(buildTermMatchVariants)
      )
    );

    const tokenSpans = index.tokens
      .map((token, position) => (tokenVariants.some(variant => tokenMatchesTerm(token, variant)) ? { start: position, end: position } : null))
      .filter((value): value is { start: number; end: number } => value !== null);

    const phraseSpans = equivalents
      .filter(value => value.includes(' '))
      .flatMap(value => findPhraseSpans(index, value));

    return [...tokenSpans, ...phraseSpans];
  }

  if (node.type === 'PHRASE') {
    const normalized = normalizeTokenValue(node.value);
    return normalized ? findPhraseSpans(index, normalized) : [];
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

function findBestProximitySpan(
  node: BooleanSearchNode,
  index: TextIndex
): { start: number; end: number; distance: number } | null {
  if (node.type === 'PROX') {
    const leftSpans = findOperandSpans(node.left, index);
    const rightSpans = findOperandSpans(node.right, index);
    let best: { start: number; end: number; distance: number } | null = null;

    for (const left of leftSpans) {
      for (const right of rightSpans) {
        const gap =
          left.end < right.start
            ? right.start - left.end - 1
            : left.start > right.end
              ? left.start - right.end - 1
              : 0;
        if (gap > node.distance) continue;

        const candidate = {
          start: Math.min(left.start, right.start),
          end: Math.max(left.end, right.end),
          distance: gap,
        };

        if (
          !best ||
          candidate.distance < best.distance ||
          (candidate.distance === best.distance && (candidate.end - candidate.start) < (best.end - best.start))
        ) {
          best = candidate;
        }
      }
    }

    return best;
  }

  if (node.type === 'AND' || node.type === 'OR') {
    return findBestProximitySpan(node.left, index) || findBestProximitySpan(node.right, index);
  }

  if (node.type === 'NOT') {
    return null;
  }

  return null;
}

function extractPositiveSnippet(index: TextIndex, expression: BooleanSearchNode): string | null {
  const positiveTerms = Array.from(collectPositiveTerms(expression))
    .map(term => normalizeWhitespace(term))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const term of positiveTerms) {
    const spans = findOperandSpans(
      term.includes(' ')
        ? { type: 'PHRASE', value: term }
        : { type: 'TERM', value: term },
      index
    );
    if (spans.length > 0) {
      return buildSnippetFromSpan(index, spans[0].start, spans[0].end);
    }
  }

  return null;
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

export function extractBooleanMatchSnippet(query: string, text: string): BooleanMatchSnippet | null {
  const parsed = parseBooleanQuery(query);
  if (!parsed.expression) {
    return null;
  }

  const index = createTextIndex(text);
  const proxSpan = findBestProximitySpan(parsed.expression, index);
  if (proxSpan) {
    return {
      excerpt: buildSnippetFromSpan(index, proxSpan.start, proxSpan.end),
      distance: proxSpan.distance,
    };
  }

  const excerpt = extractPositiveSnippet(index, parsed.expression);
  if (!excerpt) {
    return null;
  }

  return {
    excerpt,
    distance: null,
  };
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
  return buildBooleanCandidateQueries(query)[0] || normalizeWhitespace(query);
}

function formatCandidateQueryTerm(term: string): string {
  const trimmed = normalizeWhitespace(term);
  if (!trimmed) return '';
  return /\s/.test(trimmed) ? `"${trimmed}"` : trimmed;
}

function buildCompoundCandidateQueries(terms: string[]): string[] {
  if (terms.length < 2 || terms.length > 3) {
    return [];
  }

  const optionSets = terms.map(term => {
    const equivalents = getEquivalentSearchValues(term);
    return Array.from(
      new Set(
        [formatCandidateQueryTerm(term), ...equivalents.map(formatCandidateQueryTerm)].filter(Boolean)
      )
    ).slice(0, 3);
  });

  let combinations = [''];
  for (const options of optionSets) {
    const next: string[] = [];
    for (const prefix of combinations) {
      for (const option of options) {
        const candidate = normalizeWhitespace([prefix, option].filter(Boolean).join(' '));
        if (candidate) {
          next.push(candidate);
        }
      }
    }
    combinations = next.slice(0, 8);
  }

  return Array.from(new Set(combinations)).filter(Boolean);
}

export function buildBooleanCandidateQueries(query: string): string[] {
  const parsed = parseBooleanQuery(query);
  if (!parsed.expression) {
    const normalized = normalizeWhitespace(query);
    return normalized ? [normalized] : [];
  }

  const terms = Array.from(collectPositiveTerms(parsed.expression))
    .map(term => normalizeWhitespace(term))
    .filter(Boolean);

  if (terms.length === 0) {
    const normalized = normalizeWhitespace(query);
    return normalized ? [normalized] : [];
  }

  const formattedTerms = terms.map(formatCandidateQueryTerm).filter(Boolean);
  const compoundQueries = buildCompoundCandidateQueries(terms);
  const flatTerms = terms
    .flatMap(term => term.split(/\s+/))
    .map(term => normalizeWhitespace(term))
    .filter(Boolean);
  const expandedFlatTerms = Array.from(
    new Set(
      flatTerms.flatMap(term => {
        const equivalents = getEquivalentSearchValues(term);
        return equivalents.flatMap(value => {
          if (value.includes(' ')) {
            return [value];
          }

          const variants = buildTermMatchVariants(value);
          const base = normalizeTokenValue(value);
          return base ? [base, ...variants] : variants;
        });
      })
    )
  )
    .filter(Boolean)
    .map(formatCandidateQueryTerm);
  const phraseTerms = formattedTerms.filter(term => term.startsWith('"') && term.endsWith('"'));
  const sortedTerms = [...formattedTerms].sort((a, b) => b.replace(/"/g, '').length - a.replace(/"/g, '').length);
  const tokenOrQuery = flatTerms.join(' OR ').trim();
  const expandedTokenOrQuery = expandedFlatTerms.join(' OR ').trim();
  const phraseAndTokenQuery = Array.from(new Set([...phraseTerms, ...expandedFlatTerms])).join(' OR ').trim();
  const queries = [
    ...compoundQueries,
    formattedTerms.join(' ').trim(),
    phraseAndTokenQuery,
    expandedTokenOrQuery,
    tokenOrQuery,
    formattedTerms.join(' OR ').trim(),
    phraseTerms.join(' OR ').trim(),
    sortedTerms[0] || '',
  ].filter(Boolean);

  return Array.from(new Set(queries));
}
