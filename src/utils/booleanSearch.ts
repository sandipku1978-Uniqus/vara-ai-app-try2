/**
 * Boolean engine version. Bump when matching or retrieval semantics change in a
 * way that legitimately changes which filings a saved search recalls. Persisted
 * (optionally) on saved alerts and research sessions so a migrated run can be
 * re-baselined instead of reporting long-known filings as brand new.
 *
 * v2 — token-bounded phrases, symmetric punctuation, singular/plural
 *      equivalence, independent OR-branch retrieval, per-run request budgets.
 * v3 — numeric operators (#, $#, %#) and number-aware tokenization: currency
 *      amounts ($206.6), percentages (5.2%) and decimals survive as single
 *      tokens instead of splitting at the symbol.
 * v4 — ordered proximity (P/n, PRE/n) and wildcard terms (crypto*, wom?n).
 *      "P/3" and terms containing * or ? previously matched as literal text.
 */
export const BOOLEAN_ENGINE_VERSION = 4;

/** Which class of numeric token a # operator matches. */
export type NumberUnit = 'any' | 'currency' | 'percent';

type Token =
  | { type: 'LPAREN' }
  | { type: 'RPAREN' }
  | { type: 'AND' }
  | { type: 'OR' }
  | { type: 'NOT' }
  | { type: 'PROX'; distance: number; ordered: boolean }
  | { type: 'NUMBER'; unit: NumberUnit }
  | { type: 'TERM'; value: string }
  | { type: 'PHRASE'; value: string };

export type BooleanSearchNode =
  | { type: 'TERM'; value: string }
  | { type: 'PHRASE'; value: string }
  | { type: 'NUMBER'; unit: NumberUnit }
  /** Single-word pattern: * = any run of characters, ? = exactly one. */
  | { type: 'WILDCARD'; pattern: string }
  | { type: 'PROX'; distance: number; ordered?: boolean; left: BooleanSearchNode; right: BooleanSearchNode }
  | { type: 'NOT'; child: BooleanSearchNode }
  | { type: 'AND'; left: BooleanSearchNode; right: BooleanSearchNode }
  | { type: 'OR'; left: BooleanSearchNode; right: BooleanSearchNode };

export interface ParsedBooleanQuery {
  expression: BooleanSearchNode | null;
  error?: string;
}

/**
 * The phrase safe to delegate to EDGAR full-text search, when the WHOLE query
 * is a single quoted phrase — otherwise null.
 *
 * EFTS indexes every filing. We can only open a bounded number per run within
 * the wall-clock budget, so re-checking each candidate locally converts an
 * exhaustive upstream match into a ~45-second sample of it: `"material
 * weakness"` has hundreds of thousands of hits and returned 11.
 *
 * Verified against the live index before trusting it: `"material weakness"`
 * reports ≥10,000 hits while the reversed `"weakness material"` reports 414,
 * so EFTS quoted phrases really are exact adjacent-phrase matches rather than
 * bags of words.
 *
 * Deliberately narrow. AND/OR/NOT/proximity keep local validation, because
 * delegating correctness to an index we do not control is only defensible
 * where the semantics have actually been demonstrated.
 *
 * Known narrowing: our matcher treats singular and plural as equivalent and
 * EFTS does not, so delegating can miss plural variants. It returns fewer
 * filings than local validation would, never different ones.
 */
export function eftsDelegablePhrase(expression: BooleanSearchNode | null): string | null {
  if (!expression || expression.type !== 'PHRASE') return null;
  const phrase = expression.value.trim();
  // A single quoted word gains nothing from phrase semantics, and is more
  // often a stray quote than an intent to search a phrase.
  return phrase.includes(' ') ? phrase : null;
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

// Intelligize-style field token: audit firm as part of the Boolean query, e.g.
//   "material weakness" AND auditor:Deloitte      auditor:"Ernst & Young"
// Multi-word firm names must be quoted; short forms (Deloitte, KPMG, PwC, EY,
// BDO) can be bare. Aliases: auditor:, accountant:, auditfirm:, audited_by:.
const AUDITOR_FIELD_RE = /\b(?:auditor|accountant|auditfirm|audited[_-]?by)\s*:\s*(?:"([^"]*)"|(\S+))/i;
const TERM_EQUIVALENTS: Record<string, string[]> = {
  asr: ['accelerated share repurchase', 'accelerated stock repurchase'],
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

// Shared, symmetric normalization for both query terms and filing text. Dotted
// initialisms collapse ("U.S." → "us", "e.g." → "eg") so periods don't split an
// acronym into single-letter tokens; everything else non-alphanumeric becomes a
// token boundary. Applying the SAME transform to both sides is what makes
// punctuation match symmetrically ("U.S. GAAP" ≡ "US GAAP").
//
// Numbers are the exception to "symbols split": a currency prefix ($ £ ¥ €),
// a percent suffix, and a decimal point INSIDE a number stay attached, so
// "$206.6" and "5.2%" survive as single tokens the numeric operators can
// classify. Thousands separators are removed ("1,234" ≡ "1234"). Mixed
// alphanumerics ("3m", "10k") tokenize exactly as before.
const MATCH_TOKEN_RE = /[$£¥€]\d+(?:\.\d+)?%?|(?<![a-z0-9])\d+(?:\.\d+)?%?(?![a-z0-9])|[a-z0-9]+/g;

function normalizeMatchText(value: string): string {
  const lowered = value
    .toLowerCase()
    .replace(/\b([a-z])\./g, '$1')
    .replace(/(\d),(?=\d)/g, '$1');
  return (lowered.match(MATCH_TOKEN_RE) || []).join(' ');
}

/**
 * The engine's own text normalization, exported for consumers that need to
 * locate engine-produced artifacts (match snippets are joins of normalized
 * tokens) inside the filing text. Using anything else drifts the moment
 * tokenization changes.
 */
export function normalizeForMatch(value: string): string {
  return normalizeMatchText(value);
}

// Numeric-token classes for the # operators. `any` accepts decorated numbers
// too: a filing that writes "$206.6" has still disclosed *a number*.
const CURRENCY_TOKEN_RE = /^[$£¥€]\d+(?:\.\d+)?$/;
const PERCENT_TOKEN_RE = /^\d+(?:\.\d+)?%$/;
const ANY_NUMBER_TOKEN_RE = /^[$£¥€]?\d+(?:\.\d+)?%?$/;

// Comparison form for term/phrase matching: the currency/percent decoration
// belongs to the numeric operators, not to term equality — a query for "5"
// must keep matching a filing's "5%" exactly as it did when symbols were
// token boundaries.
function stripNumericDecoration(token: string): string {
  return token.replace(/^[$£¥€]/, '').replace(/%$/, '');
}

function tokensEquivalent(a: string, b: string): boolean {
  return (
    a === b ||
    singularStem(a) === singularStem(b) ||
    stripNumericDecoration(a) === stripNumericDecoration(b)
  );
}

function normalizeTokenValue(value: string): string {
  return normalizeMatchText(value);
}

// Documented, symmetric singular/plural stem. Applied to BOTH the query term and
// the filing token, so "lease"≡"leases", "filing"≡"filings", "weakness"≡
// "weaknesses", "company"≡"companies". It deliberately does NOT do broad
// prefix/suffix stemming, so "audit"≠"auditory" and "risk"≠"brisk" still hold.
// Known limitation: x/z/ch/sh plurals (tax→taxes, box→boxes) are not linked.
function singularStem(token: string): string {
  if (token.length <= 3) return token;
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  if (token.endsWith('sses')) return token.slice(0, -2); // weaknesses→weakness, classes→class
  if (token.endsWith('ss')) return token;                // weakness, class (already singular)
  if (token.endsWith('s')) return token.slice(0, -1);    // filings→filing, leases→lease
  return token;
}

// Bare terms match complete normalized tokens (with singular/plural equivalence).
// Documented equivalents live in TERM_EQUIVALENTS; there is no broad prefix
// stemming.
function buildTermMatchVariants(value: string): string[] {
  const normalized = normalizeTokenValue(value);
  return normalized ? [normalized] : [];
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
  return buildTermMatchVariants(value).some(variant => tokensEquivalent(actualToken, variant));
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
    // Ordered proximity: "convertible P/3 notes" — convertible must PRECEDE
    // notes by at most 3 words. W/n remains order-agnostic.
    const orderedProxMatch = value.match(/^(?:P|PRE)\/(\d+)$/i);
    // Intelligize-style numeric operands: # any number, $# (£# ¥# €#) a
    // currency amount, %# a percentage. "goodwill impairment" W/10 $# finds
    // every filing that QUANTIFIES a goodwill impairment.
    const numberMatch = value.match(/^([$£¥€%])?#$/);

    if (upper === 'AND') {
      tokens.push({ type: 'AND' });
    } else if (upper === 'OR') {
      tokens.push({ type: 'OR' });
    } else if (upper === 'NOT') {
      tokens.push({ type: 'NOT' });
    } else if (proxMatch) {
      tokens.push({ type: 'PROX', distance: Number(proxMatch[1]), ordered: false });
    } else if (orderedProxMatch) {
      tokens.push({ type: 'PROX', distance: Number(orderedProxMatch[1]), ordered: true });
    } else if (numberMatch) {
      tokens.push({
        type: 'NUMBER',
        unit: numberMatch[1] === '%' ? 'percent' : numberMatch[1] ? 'currency' : 'any',
      });
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
        token.type === 'NUMBER' ||
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
    // Wildcards make the term a single-word pattern rather than a literal.
    // Bounded deliberately: at least two literal characters (a bare "*" would
    // match every token) and one word only (phrases keep exact semantics).
    if (/[*?]/.test(token.value)) {
      const pattern = token.value.toLowerCase().replace(/[^a-z0-9*?]/g, '');
      if ((pattern.match(/[a-z0-9]/g) || []).length < 2) {
        throw new Error('A wildcard needs at least two literal characters — e.g. crypto* or wom?n.');
      }
      return { type: 'WILDCARD', pattern };
    }
    return { type: 'TERM', value: token.value };
  }

  if (token.type === 'PHRASE') {
    return { type: 'PHRASE', value: token.value };
  }

  if (token.type === 'NUMBER') {
    return { type: 'NUMBER', unit: token.unit };
  }

  throw new Error('Expected a search term.');
}

function parseProximity(state: ParserState): BooleanSearchNode {
  let left = parsePrimary(state);
  const token = peek(state);
  if (token?.type === 'PROX') {
    consume(state);
    const right = parsePrimary(state);
    left = { type: 'PROX', distance: token.distance, ordered: token.ordered, left, right };
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

  // Reject an unmatched quote instead of letting the tokenizer auto-close it at
  // end of input — a silent auto-close turns a typo into a wrong phrase search.
  if ((trimmed.match(/"/g)?.length ?? 0) % 2 === 1) {
    return { expression: null, error: 'Unbalanced quotation mark — close the phrase with a matching ".' };
  }

  try {
    // Proximity (w/#) is a binary operator that binds its immediate single
    // left and right operands only; any additional adjacent terms fall through
    // to implicit AND. "lease w/5 modification accounting" therefore parses as
    // (lease w/5 modification) AND accounting — not a forced adjacent phrase.
    // Multi-word proximity operands are still available by quoting them.
    const state: ParserState = { tokens: tokenize(trimmed), index: 0 };
    if (state.tokens.length === 0) {
      return { expression: null };
    }

    const expression = parseOr(state);
    if (state.index < state.tokens.length) {
      throw new Error('Unexpected token in query.');
    }
    return { expression: simplifyDoubleNegation(expression) };
  } catch (error) {
    return {
      expression: null,
      error: error instanceof Error ? error.message : 'Unable to parse Boolean query.',
    };
  }
}

/**
 * Collapses NOT NOT x to x throughout the tree, so polarity is decided by
 * parity. Every downstream consumer — positive-term collection, branch
 * planning, snippet selection — assumes NOT marks a genuinely negative
 * subtree; without this, "NOT NOT cyber" reads as having no positive terms
 * and is wrongly rejected as a negative-only query.
 */
function simplifyDoubleNegation(node: BooleanSearchNode): BooleanSearchNode {
  switch (node.type) {
    case 'NOT': {
      const child = simplifyDoubleNegation(node.child);
      if (child.type === 'NOT') return child.child;
      return { type: 'NOT', child };
    }
    case 'AND':
    case 'OR':
      return { type: node.type, left: simplifyDoubleNegation(node.left), right: simplifyDoubleNegation(node.right) };
    case 'PROX':
      return { ...node, left: simplifyDoubleNegation(node.left), right: simplifyDoubleNegation(node.right) };
    default:
      return node;
  }
}

export function looksLikeBooleanQuery(query: string): boolean {
  // Auto-switch Filing Research → Boolean only on high-confidence signals:
  // UPPERCASE operators, a proximity operator, an auditor: field token, or a
  // numeric operand (#, $#, %#) — none of these occur in natural prose.
  // Lowercase prose ("increases and decreases"), quotes, or parentheses alone
  // must NOT silently change the mode the user selected.
  if (/\b(?:AND|OR|NOT)\b/.test(query)) return true;
  if (/\b(?:W|WITHIN|NEAR|P|PRE|w|within|near|p|pre)\/\d+/.test(query)) return true;
  if (/\b(?:auditor|accountant|auditfirm|audited[_-]?by)\s*:/i.test(query)) return true;
  if (/(?:^|\s)[$£¥€%]?#(?=\s|$)/.test(query)) return true;
  // Wildcards: a trailing * on a word, or ? INSIDE a word ("wom?n"). A
  // sentence-ending "?" must never flip the mode the user chose.
  if (/[a-z0-9]\*(?=\s|$)/i.test(query)) return true;
  if (/[a-z0-9]\?[a-z0-9]/i.test(query)) return true;
  return false;
}

/** True when any operand anywhere in the expression is a numeric (#) operator. */
function containsNumberOperand(node: BooleanSearchNode): boolean {
  switch (node.type) {
    case 'NUMBER':
      return true;
    case 'NOT':
      return containsNumberOperand(node.child);
    case 'PROX':
    case 'AND':
    case 'OR':
      return containsNumberOperand(node.left) || containsNumberOperand(node.right);
    default:
      return false;
  }
}

/** True when any operand anywhere in the expression is a wildcard pattern. */
function containsWildcardOperand(node: BooleanSearchNode): boolean {
  switch (node.type) {
    case 'WILDCARD':
      return true;
    case 'NOT':
      return containsWildcardOperand(node.child);
    case 'PROX':
    case 'AND':
    case 'OR':
      return containsWildcardOperand(node.left) || containsWildcardOperand(node.right);
    default:
      return false;
  }
}

/** True when any proximity node has an operand that is not a term or phrase. */
function hasUnsupportedProximity(node: BooleanSearchNode): boolean {
  switch (node.type) {
    case 'PROX': {
      const simple = (side: BooleanSearchNode) =>
        side.type === 'TERM' || side.type === 'PHRASE' || side.type === 'NUMBER' || side.type === 'WILDCARD';
      return !simple(node.left) || !simple(node.right);
    }
    case 'NOT':
      return hasUnsupportedProximity(node.child);
    case 'AND':
    case 'OR':
      return hasUnsupportedProximity(node.left) || hasUnsupportedProximity(node.right);
    default:
      return false;
  }
}

/**
 * Pulls an `auditor:` field token out of a Boolean query and returns the raw
 * firm value plus the residual query with that token (and the AND/OR connective
 * that joined it) removed. The caller canonicalizes the firm and applies it as
 * the auditor filter, so it becomes a first-class part of the Boolean search.
 */
export function extractAuditorFilterToken(query: string): { auditor: string; residual: string } {
  const match = query.match(AUDITOR_FIELD_RE);
  if (!match || match.index == null) {
    return { auditor: '', residual: normalizeWhitespace(query) };
  }
  const auditor = normalizeWhitespace(match[1] ?? match[2] ?? '');
  const residual = normalizeWhitespace(`${query.slice(0, match.index)} ${query.slice(match.index + match[0].length)}`)
    // Drop a binary connective left dangling by the removed token
    // ("weakness AND auditor:EY" → "weakness", "auditor:EY OR lease" → "lease").
    .replace(/^\s*(?:AND|OR)\b\s*/i, '')
    .replace(/\s*\b(?:AND|OR)\b\s*$/i, '');
  return { auditor, residual: normalizeWhitespace(residual) };
}

/**
 * Returns a user-facing problem with a Boolean query, or null when it is
 * well-formed and searchable. Callers surface this instead of silently falling
 * back to a literal-string EDGAR search (which quietly returns wrong results).
 */
export type BooleanIssueCode =
  | 'auditor-composition'
  | 'unbalanced-quote'
  | 'dangling-operator'
  | 'unbalanced-paren'
  | 'parse'
  | 'unsupported-proximity'
  | 'negative-only'
  | 'numeric-only'
  | 'wildcard-only'
  | 'unanchored-branch'
  | 'too-complex';

export type BooleanCompileResult =
  | {
      ok: true;
      /** Null for an auditor-only query, which is a valid firm-scoped browse. */
      ast: BooleanSearchNode | null;
      /** Positive retrieval lanes, one per OR disjunct. */
      branches: string[];
      /** Firm lifted out of an `auditor:` token, or ''. */
      auditor: string;
      /** The expression with any `auditor:` token removed. */
      residual: string;
    }
  | { ok: false; code: BooleanIssueCode; message: string };

/**
 * The single place a Boolean query is tokenized, parsed, validated and planned.
 * Views, the filing-research service, saved-alert checks and the Accounting Hub
 * all go through this, so syntax rules can never drift between call paths.
 */
export function compileBooleanQuery(raw: string): BooleanCompileResult {
  const fail = (code: BooleanIssueCode, message: string): BooleanCompileResult => ({ ok: false, code, message });

  // The auditor: token is lifted into a structured AND filter, so it only has
  // sound meaning in AND-composition. Reject only when the token itself is the
  // operand of an OR, or is directly negated — an OR/NOT elsewhere in the query
  // (e.g. "NOT goodwill AND auditor:PwC") is fine.
  const AUD = 'auditor|accountant|auditfirm|audited[_-]?by';
  if (
    new RegExp(`\\bOR\\s+(?:${AUD})\\s*:`, 'i').test(raw) ||
    new RegExp(`(?:${AUD})\\s*:\\s*(?:"[^"]*"|\\S+)\\s+OR\\b`, 'i').test(raw) ||
    new RegExp(`\\bNOT\\s+(?:${AUD})\\s*:`, 'i').test(raw)
  ) {
    return fail('auditor-composition', 'The auditor: filter can only be combined with AND. For OR/NOT logic on the audit firm, use the Advanced Filters auditor control.');
  }

  const { auditor, residual } = extractAuditorFilterToken(raw);
  const trimmed = normalizeWhitespace(residual);
  if (!trimmed) {
    // Empty query, or auditor-only: valid, nothing to evaluate against text.
    return { ok: true, ast: null, branches: [], auditor, residual: trimmed };
  }

  const parsed = parseBooleanQuery(trimmed);
  if (!parsed.expression) {
    if (/^"[^"]*$/.test(trimmed) || (trimmed.match(/"/g)?.length ?? 0) % 2 === 1) {
      return fail('unbalanced-quote', 'Unbalanced quotation mark — close the phrase with a matching ".');
    }
    if (/\b(AND|OR|NOT)$/i.test(trimmed) || /\/\d+\s*$/.test(trimmed)) {
      return fail('dangling-operator', 'The query ends with an operator — add a term after AND, OR, NOT, or w/#.');
    }
    if ((trimmed.match(/\(/g)?.length ?? 0) !== (trimmed.match(/\)/g)?.length ?? 0)) {
      return fail('unbalanced-paren', 'Unbalanced parentheses — check that every ( has a matching ).');
    }
    // Chained proximity ("a w/5 b w/5 c") fails to parse with a generic error;
    // give the same specific guidance as the grouped-operand case.
    if ((trimmed.match(/\b(?:w|within|near|p|pre)\/\d+/gi)?.length ?? 0) >= 2) {
      return fail('unsupported-proximity', 'Proximity (w/#, p/#, near/#) joins exactly two terms or quoted phrases — chain it into "a w/5 b" AND "b w/5 c", or quote a phrase.');
    }
    return fail('parse', parsed.error || 'This Boolean query could not be parsed. Check the operators and grouping.');
  }

  // Proximity operands must each be a single term or quoted phrase. A grouped
  // operand — "(a OR b) w/5 c" — parses cleanly but can never match, because
  // span lookup is only defined for terms and phrases. Left alone it returns a
  // silent, authoritative-looking zero, so reject it with a specific message.
  if (hasUnsupportedProximity(parsed.expression)) {
    return fail('unsupported-proximity', 'Proximity (w/#, p/#, near/#) works between two single terms or quoted phrases — not around a group. Try: "internal control" w/5 weakness.');
  }

  // A query made only of NOT terms has nothing to fetch from EDGAR (there is no
  // "every filing that lacks X" endpoint), so it cannot be run as-is — unless an
  // auditor token supplies the positive anchor to fetch against. The numeric
  // operators are in the same position: # matches a CLASS of token, so it can
  // validate candidates but can never retrieve them.
  if (collectPositiveTerms(parsed.expression).size === 0 && !auditor) {
    if (containsNumberOperand(parsed.expression)) {
      return fail('numeric-only', 'The numeric operator matches values, not filings — anchor it to a term or phrase, e.g. "goodwill impairment" w/10 $#.');
    }
    if (containsWildcardOperand(parsed.expression)) {
      // EDGAR full-text search has no wildcard support, so a wildcard can
      // verify candidates but cannot fetch them. Requiring a concrete anchor
      // states the limit instead of running a search that silently misses.
      return fail('wildcard-only', 'Wildcards validate against filing text but cannot retrieve from EDGAR — combine with a concrete term or phrase, e.g. crypto* AND blockchain.');
    }
    return fail('negative-only', 'Add at least one term that is not negated — a NOT-only query has nothing to match against.');
  }

  // Every OR branch must carry its own retrieval anchor — unless an auditor:
  // token is present, in which case candidates come from the auditor facet and
  // branches only validate. Mirrors the whole-query rule above, per branch.
  if (!auditor) {
    const unanchored = findUnanchoredBranch(parsed.expression);
    if (unanchored) {
      const branch = unanchored.label;
      if (unanchored.reason === 'wildcard') {
        return fail('unanchored-branch', `The OR branch “${branch}” cannot be retrieved: wildcards validate against filing text but cannot fetch from EDGAR. Anchor that branch with a concrete term, e.g. (${branch} AND blockchain).`);
      }
      if (unanchored.reason === 'numeric') {
        return fail('unanchored-branch', `The OR branch “${branch}” cannot be retrieved: the numeric operator matches values, not filings. Anchor it inside the branch, e.g. ("goodwill impairment" w/10 ${branch}).`);
      }
      return fail('unanchored-branch', `The OR branch “${branch}” cannot be retrieved: there is no way to fetch “every filing that lacks a term” from EDGAR. Use NOT with AND instead, e.g. term AND ${branch}.`);
    }
  }

  // Complexity cap: too many OR branches would force us to approximate the logic
  // rather than retrieve each disjunct honestly. Reject instead.
  const plan = planBooleanBranches(trimmed);
  if (plan.truncated) {
    return fail('too-complex', 'This query has too many OR branches to evaluate exactly — narrow it or split it into separate searches.');
  }

  return { ok: true, ast: parsed.expression, branches: plan.branches, auditor, residual: trimmed };
}

/** Message-only view of {@link compileBooleanQuery}, for inline field errors. */
export function describeBooleanQueryIssue(query: string): string | null {
  const result = compileBooleanQuery(query);
  return result.ok ? null : result.message;
}

function createTextIndex(text: string): TextIndex {
  const normalizedText = normalizeMatchText(text);
  const tokens = normalizedText.split(' ').map(token => token.trim()).filter(Boolean);
  return { normalizedText, tokens };
}

function buildSnippetFromSpan(index: TextIndex, start: number, end: number, contextWords = 14): string {
  const snippetStart = Math.max(0, start - contextWords);
  const snippetEnd = Math.min(index.tokens.length, end + contextWords + 1);
  const excerpt = index.tokens.slice(snippetStart, snippetEnd).join(' ').trim();
  if (!excerpt) return '';
  return `${snippetStart > 0 ? '... ' : ''}${excerpt}${snippetEnd < index.tokens.length ? ' ...' : ''}`;
}

function findPhraseSpans(index: TextIndex, normalizedPhrase: string): Array<{ start: number; end: number }> {
  const phraseTokens = normalizedPhrase.split(' ').filter(Boolean);
  if (phraseTokens.length === 0) return [];

  // Token-boundary phrase match with per-token singular/plural equivalence, so
  // "material weakness" matches "material weaknesses" but never spans a boundary.
  const spans: Array<{ start: number; end: number }> = [];
  for (let i = 0; i <= index.tokens.length - phraseTokens.length; i += 1) {
    let matched = true;
    for (let j = 0; j < phraseTokens.length; j += 1) {
      if (!tokensEquivalent(index.tokens[i + j], phraseTokens[j])) { matched = false; break; }
    }
    if (matched) spans.push({ start: i, end: i + phraseTokens.length - 1 });
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

  if (node.type === 'NUMBER') {
    const matcher =
      node.unit === 'currency' ? CURRENCY_TOKEN_RE
      : node.unit === 'percent' ? PERCENT_TOKEN_RE
      : ANY_NUMBER_TOKEN_RE;
    return index.tokens
      .map((token, position) => (matcher.test(token) ? { start: position, end: position } : null))
      .filter((value): value is { start: number; end: number } => value !== null);
  }

  if (node.type === 'WILDCARD') {
    const matcher = compileWildcard(node.pattern);
    return index.tokens
      .map((token, position) =>
        matcher.test(token) || matcher.test(stripNumericDecoration(token))
          ? { start: position, end: position }
          : null
      )
      .filter((value): value is { start: number; end: number } => value !== null);
  }

  return [];
}

// Wildcard patterns compile to anchored token-level regexes: * spans any run
// of token characters (including none), ? exactly one. No stemming — the
// pattern is the contract.
const wildcardCache = new Map<string, RegExp>();
function compileWildcard(pattern: string): RegExp {
  let compiled = wildcardCache.get(pattern);
  if (!compiled) {
    const source = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*/g, '[a-z0-9]*')
      .replace(/\?/g, '[a-z0-9]');
    compiled = new RegExp(`^${source}$`);
    wildcardCache.set(pattern, compiled);
  }
  return compiled;
}

function matchesProximity(node: Extract<BooleanSearchNode, { type: 'PROX' }>, index: TextIndex): boolean {
  const leftSpans = findOperandSpans(node.left, index);
  const rightSpans = findOperandSpans(node.right, index);

  if (leftSpans.length === 0 || rightSpans.length === 0) {
    return false;
  }

  for (const left of leftSpans) {
    for (const right of rightSpans) {
      // Ordered proximity (P/n): the left operand must PRECEDE the right;
      // a reversed or overlapping pair never satisfies it.
      if (node.ordered && left.end >= right.start) continue;
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
        if (node.ordered && left.end >= right.start) continue;
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
    case 'PHRASE':
    case 'NUMBER':
    case 'WILDCARD':
      // Token-boundary matching for both bare terms and quoted phrases —
      // never a raw substring. "net income" must not match "planet income",
      // and a punctuation term ("non-GAAP", "R&D") matches its token sequence.
      // NUMBER matches any token of its numeric class; alone it is nearly
      // always true and only becomes selective inside W/n. WILDCARD matches
      // whole tokens against its anchored pattern.
      return findOperandSpans(node, index).length > 0;
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
      return collectPositiveTerms(node.child, !negated, bucket);
    case 'AND':
    case 'OR':
      collectPositiveTerms(node.left, negated, bucket);
      collectPositiveTerms(node.right, negated, bucket);
      return bucket;
    default:
      return bucket;
  }
}

/**
 * Plans independent retrieval branches from the positive structure of a Boolean
 * query. Each branch is a conjunction (AND) of positive operands expressed as an
 * EDGAR full-text query; OR produces separate branches so every disjunct gets
 * its own retrieval lane. NOT operands never anchor retrieval.
 *
 *   "A OR B"          → ["A", "B"]
 *   "(A OR B) AND C"  → ["A C", "B C"]
 *   "A AND B"         → ["A B"]
 *   "A AND NOT B"     → ["A"]
 *
 * `truncated` is set when the branch count exceeds `maxBranches` (the complexity
 * cap) so the caller can reject rather than silently approximate the logic.
 */
type BranchAnchorLeaf = { anchor: boolean; reason?: 'negation' | 'wildcard' | 'numeric'; label: string };

function numberUnitLabel(unit: NumberUnit): string {
  return unit === 'currency' ? '$#' : unit === 'percent' ? '%#' : '#';
}

/** Compact source-like rendering of a node, for validation messages. */
function renderNodeLabel(node: BooleanSearchNode): string {
  switch (node.type) {
    case 'TERM':
      return node.value;
    case 'PHRASE':
      return `"${node.value}"`;
    case 'WILDCARD':
      return node.pattern;
    case 'NUMBER':
      return numberUnitLabel(node.unit);
    case 'PROX':
      return `${renderNodeLabel(node.left)} ${node.ordered ? 'p' : 'w'}/${node.distance} ${renderNodeLabel(node.right)}`;
    case 'NOT':
      return node.child.type === 'AND' || node.child.type === 'OR'
        ? `NOT (${renderNodeLabel(node.child)})`
        : `NOT ${renderNodeLabel(node.child)}`;
    case 'AND':
      return `${renderNodeLabel(node.left)} AND ${renderNodeLabel(node.right)}`;
    case 'OR':
      return `(${renderNodeLabel(node.left)} OR ${renderNodeLabel(node.right)})`;
    default:
      return '';
  }
}

/**
 * DNF-expands the expression exactly the way planBooleanBranches does and
 * returns the first OR branch with no concrete positive term or phrase.
 * Retrieval issues one EDGAR query per branch, so an unanchored branch is
 * unfetchable: a NOT-only branch means "every filing lacking x" (no such
 * endpoint), and wildcard/numeric operands validate text but cannot retrieve.
 * Before this check, planBooleanBranches silently dropped such branches and
 * the engine presented results as if the whole expression had been searched —
 * "A OR NOT B" quietly became a search for just A. Never drop; reject.
 */
export function findUnanchoredBranch(
  node: BooleanSearchNode,
  maxBranches = 256
): { label: string; reason: 'negation' | 'wildcard' | 'numeric' } | null {
  const expand = (n: BooleanSearchNode): BranchAnchorLeaf[][] | null => {
    switch (n.type) {
      case 'TERM':
      case 'PHRASE':
        return [[{ anchor: true, label: renderNodeLabel(n) }]];
      case 'WILDCARD':
        return [[{ anchor: false, reason: 'wildcard', label: n.pattern }]];
      case 'NUMBER':
        return [[{ anchor: false, reason: 'numeric', label: numberUnitLabel(n.unit) }]];
      case 'PROX': {
        const left = expand(n.left);
        const right = expand(n.right);
        if (!left || !right) return null;
        // Proximity operands are single leaves, so each side has one branch.
        return [[...left[0], ...right[0]]];
      }
      case 'NOT':
        // The whole subtree contributes nothing retrievable, whatever is inside.
        return [[{ anchor: false, reason: 'negation', label: renderNodeLabel(n) }]];
      case 'AND': {
        const left = expand(n.left);
        const right = expand(n.right);
        if (!left || !right) return null;
        const out: BranchAnchorLeaf[][] = [];
        for (const l of left) {
          for (const r of right) {
            if (out.length >= maxBranches) return null; // too-complex check reports this
            out.push([...l, ...r]);
          }
        }
        return out;
      }
      case 'OR': {
        const left = expand(n.left);
        const right = expand(n.right);
        if (!left || !right) return null;
        if (left.length + right.length > maxBranches) return null;
        return [...left, ...right];
      }
      default:
        return [[{ anchor: true, label: '' }]];
    }
  };

  const branches = expand(node);
  if (!branches) return null;
  for (const branch of branches) {
    if (branch.some(leaf => leaf.anchor)) continue;
    // Report the most actionable reason: a wildcard or numeric operand can be
    // anchored in place; pure negation needs restructuring.
    const leaf = branch.find(l => l.reason === 'wildcard') || branch.find(l => l.reason === 'numeric') || branch[0];
    return { label: branch.map(l => l.label).join(' AND '), reason: leaf.reason || 'negation' };
  }
  return null;
}

export function planBooleanBranches(query: string, maxBranches = 16): { branches: string[]; truncated: boolean } {
  const parsed = parseBooleanQuery(query);
  if (!parsed.expression) return { branches: [], truncated: false };

  const positiveTerms = (node: BooleanSearchNode): string[] => {
    switch (node.type) {
      case 'TERM':
      case 'PHRASE':
        return [node.value];
      case 'PROX':
        return [...positiveTerms(node.left), ...positiveTerms(node.right)];
      case 'NOT':
        return [];
      case 'AND':
      case 'OR':
        return [...positiveTerms(node.left), ...positiveTerms(node.right)];
      default:
        return [];
    }
  };

  const branchSets = (node: BooleanSearchNode): string[][] => {
    switch (node.type) {
      case 'TERM':
      case 'PHRASE':
        return [[node.value]];
      case 'PROX':
        return [positiveTerms(node)];
      case 'NOT':
        return [[]];
      case 'AND': {
        const out: string[][] = [];
        for (const left of branchSets(node.left)) {
          for (const right of branchSets(node.right)) {
            out.push([...left, ...right]);
          }
        }
        return out;
      }
      case 'OR':
        return [...branchSets(node.left), ...branchSets(node.right)];
      default:
        return [[]];
    }
  };

  const seen = new Set<string>();
  const branches: string[] = [];
  for (const set of branchSets(parsed.expression)) {
    const branchQuery = Array.from(new Set(set.filter(Boolean)))
      .map(formatCandidateQueryTerm)
      .filter(Boolean)
      .join(' ');
    const key = normalizeWhitespace(branchQuery).toLowerCase();
    if (!branchQuery || seen.has(key)) continue;
    if (branches.length >= maxBranches) return { branches, truncated: true };
    seen.add(key);
    branches.push(branchQuery);
  }
  return { branches, truncated: false };
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
