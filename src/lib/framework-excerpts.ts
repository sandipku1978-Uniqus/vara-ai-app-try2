import ifrsKnowledgeBase from '../data/standards/ifrs-kb.json';
import indAsKnowledgeBase from '../data/standards/ind-as-kb.json';

/**
 * Relevance-selected excerpts from the curated framework knowledge base.
 *
 * The Accounting Hub's "Ask AI" path used to send the question alone, so the
 * model answered from memory and invented paragraph citations. This module
 * picks the knowledge base entries that actually bear on the question (topic
 * identifiers first, then keyword overlap), numbers them, and caps the total
 * so a prompt never carries the whole knowledge base. The numbered excerpts
 * are the ONLY material the grounded prompt lets the model cite.
 *
 * Coverage is deliberately narrow: when nothing matches, the caller gets
 * `coverage: 'none'` and must label the reply as model recall rather than
 * pretend the answer was grounded.
 */

export type FrameworkName = 'IFRS' | 'Ind AS';

export interface FrameworkKbEntry {
  framework: FrameworkName;
  /** Standard identifier, e.g. "IFRS 16". */
  id: string;
  title: string;
  /** Equivalent references in other frameworks, e.g. "IFRS 16 / ASC 842". */
  equivalentTo: string;
  keyDifferences: string[];
  disclosureRequirements?: string;
}

export interface FrameworkExcerpt {
  /** 1-based citation number used as `[n]` in the prompt and the reply. */
  n: number;
  id: string;
  framework: FrameworkName;
  title: string;
  /** The equivalent-standard reference the excerpt resolves to (ASC topic and peers). */
  reference: string;
  text: string;
}

export interface FrameworkExcerptSelection {
  coverage: 'grounded' | 'none';
  excerpts: FrameworkExcerpt[];
  /** Standard identifiers detected in the topic and question, normalized ("ASC 842"). */
  matchedTopics: string[];
}

/** Upper bound on excerpt text sent in one prompt; the whole KB is never sent. */
export const MAX_EXCERPT_CHARS = 12_000;
export const MAX_EXCERPT_COUNT = 8;

const TITLE_HIT_WEIGHT = 3;
const BODY_HIT_WEIGHT = 1;
const TOPIC_HIT_WEIGHT = 10;
/** A title-word hit alone qualifies; body-only overlap needs two distinct terms. */
const MIN_SCORE = 2;

// Words that appear in almost every entry or every question and therefore say
// nothing about which entry is relevant. Standard-family names are handled by
// the identifier match, not by keyword overlap.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'are', 'was', 'were', 'has', 'have', 'been',
  'its', 'per', 'when', 'which', 'where', 'will', 'can', 'may', 'not', 'any', 'all', 'our', 'their', 'there',
  'about', 'between', 'versus', 'than', 'does', 'should', 'would', 'could', 'how', 'what', 'why', 'who',
  'more', 'most', 'some', 'such', 'also', 'both', 'each', 'other', 'only', 'over', 'very', 'while',
  'asc', 'ifrs', 'ias', 'ind', 'gaap', 'fasb', 'iasb', 'standard', 'standards', 'accounting', 'account',
  'accounted', 'under', 'guidance', 'treatment', 'treat', 'question', 'difference', 'differences', 'differ',
  'differs', 'different', 'entity', 'entities', 'company', 'companies', 'required', 'require', 'requires',
  'requirement', 'requirements', 'specific', 'specifically', 'apply', 'applies', 'applied', 'application',
  'used', 'uses', 'use', 'using', 'basis', 'based', 'legacy', 'similar', 'approach', 'model', 'models',
  'principles', 'principle', 'core', 'single', 'directly', 'immediately', 'closely', 'slightly', 'largely',
  'especially', 'regarding', 'specific', 'market', 'indian', 'india', 'mca',
]);

interface ScoredEntry {
  entry: FrameworkKbEntry;
  score: number;
  order: number;
}

function loadEntries(
  framework: FrameworkName,
  knowledgeBase: { standards: Array<Omit<FrameworkKbEntry, 'framework'>> }
): FrameworkKbEntry[] {
  return knowledgeBase.standards.map(standard => ({
    framework,
    id: standard.id,
    title: standard.title,
    equivalentTo: standard.equivalentTo,
    keyDifferences: standard.keyDifferences,
    disclosureRequirements: standard.disclosureRequirements,
  }));
}

export const DEFAULT_FRAMEWORK_KB_ENTRIES: readonly FrameworkKbEntry[] = [
  ...loadEntries('IFRS', ifrsKnowledgeBase),
  ...loadEntries('Ind AS', indAsKnowledgeBase),
];

const STANDARD_ID_PATTERN = /\b(ASC|IFRS|IAS|Ind\s*AS)\s*-?\s*(\d{1,3})\b/gi;

function normalizeStandardId(family: string, number: string): string {
  const normalizedFamily = family.replace(/\s+/g, '').toLowerCase() === 'indas' ? 'Ind AS' : family.toUpperCase();
  return `${normalizedFamily} ${Number(number)}`;
}

/** Every standard identifier ("ASC 842", "IFRS 16") mentioned in a string. */
export function extractStandardIds(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(STANDARD_ID_PATTERN)) {
    found.add(normalizeStandardId(match[1], match[2]));
  }
  return [...found];
}

function entryStandardIds(entry: FrameworkKbEntry): Set<string> {
  return new Set(extractStandardIds(`${entry.id} / ${entry.equivalentTo}`));
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(token => token.length >= 3 && !/^\d+$/.test(token) && !STOPWORDS.has(token));
}

function stemMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= 4 && longer.startsWith(shorter);
}

function countHits(queryTokens: Set<string>, entryTokens: Set<string>): number {
  let hits = 0;
  for (const query of queryTokens) {
    for (const candidate of entryTokens) {
      if (stemMatch(query, candidate)) {
        hits += 1;
        break;
      }
    }
  }
  return hits;
}

function excerptText(entry: FrameworkKbEntry): string {
  const lines = entry.keyDifferences.map(item => `- ${item.trim()}`);
  if (entry.disclosureRequirements?.trim()) {
    lines.push(`Disclosure requirements: ${entry.disclosureRequirements.trim()}`);
  }
  return lines.join('\n');
}

function scoreEntry(
  entry: FrameworkKbEntry,
  order: number,
  detectedTopics: string[],
  queryTokens: Set<string>
): ScoredEntry {
  const ids = entryStandardIds(entry);
  const topicHits = detectedTopics.filter(topic => ids.has(topic)).length;
  const titleTokens = new Set(tokenize(entry.title));
  const bodyTokens = new Set(tokenize([...entry.keyDifferences, entry.disclosureRequirements || ''].join(' ')));
  const score = topicHits * TOPIC_HIT_WEIGHT
    + countHits(queryTokens, titleTokens) * TITLE_HIT_WEIGHT
    + countHits(queryTokens, bodyTokens) * BODY_HIT_WEIGHT;
  return { entry, score, order };
}

/**
 * Choose and number the knowledge base excerpts relevant to a question.
 *
 * @param question  The user's question (free text).
 * @param topic     Optional curated ASC topic number chosen in the UI ("842").
 * @param entries   Knowledge base entries; injectable so the cap is testable.
 */
export function selectFrameworkExcerpts(
  question: string,
  topic: string | null = null,
  entries: readonly FrameworkKbEntry[] = DEFAULT_FRAMEWORK_KB_ENTRIES
): FrameworkExcerptSelection {
  const detectedTopics = new Set(extractStandardIds(question));
  if (topic && /^\d{3}$/.test(topic)) detectedTopics.add(`ASC ${Number(topic)}`);
  const matchedTopics = [...detectedTopics];
  const queryTokens = new Set(tokenize(question));

  const ranked = entries
    .map((entry, order) => scoreEntry(entry, order, matchedTopics, queryTokens))
    .filter(candidate => candidate.score >= MIN_SCORE)
    .sort((a, b) => b.score - a.score || a.order - b.order);

  const excerpts: FrameworkExcerpt[] = [];
  let totalChars = 0;
  for (const candidate of ranked) {
    if (excerpts.length >= MAX_EXCERPT_COUNT) break;
    let text = excerptText(candidate.entry);
    if (totalChars + text.length > MAX_EXCERPT_CHARS) {
      // Only the top-ranked excerpt is ever truncated (an entry larger than the
      // whole budget); anything else that does not fit is left out entirely.
      if (excerpts.length > 0) break;
      text = `${text.slice(0, MAX_EXCERPT_CHARS - 24).trimEnd()}\n[excerpt truncated]`;
    }
    totalChars += text.length;
    excerpts.push({
      n: excerpts.length + 1,
      id: candidate.entry.id,
      framework: candidate.entry.framework,
      title: candidate.entry.title,
      reference: candidate.entry.equivalentTo,
      text,
    });
  }

  return {
    coverage: excerpts.length > 0 ? 'grounded' : 'none',
    excerpts,
    matchedTopics,
  };
}
