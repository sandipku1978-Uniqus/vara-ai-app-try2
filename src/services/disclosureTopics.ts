/**
 * Topic-first disclosure comparison.
 *
 * Peer comparison used to be Item-scoped: pick "Item 1A. Risk Factors", get two
 * 20,000-character walls side by side. That cannot answer the question an
 * accountant actually asks — "how does each peer treat revenue recognition?" —
 * because revenue recognition is not an Item. It lives in the significant
 * accounting policies note, and stock compensation lives in another note again.
 * Item-level extraction structurally cannot reach either.
 *
 * So the unit of retrieval here is the TOPIC, not the Item: find the passage in
 * each filing that actually discusses the topic, wherever it sits, and say how
 * it was found so the reader can judge the match rather than trust it.
 */

export interface DisclosureTopic {
  id: string;
  label: string;
  /** ASC topic this maps to, shown as provenance. */
  asc?: string;
  /**
   * Heading text that reliably titles this disclosure. Matched first, because a
   * real heading is far stronger evidence than scattered term mentions.
   */
  headings: string[];
  /**
   * Vocabulary that signals the topic in running prose. Curated rather than
   * derived: "performance obligation" identifies ASC 606 discussion far more
   * precisely than the word "revenue", which appears on nearly every page.
   */
  terms: string[];
}

export const DISCLOSURE_TOPICS: DisclosureTopic[] = [
  {
    id: 'revenue-recognition',
    label: 'Revenue recognition policy',
    asc: 'ASC 606',
    // Most specific first. A bare 'revenue' is kept LAST because some issuers
    // (Apple) title the policy note exactly that — the confirmation step below
    // is what rejects the identically-titled income-statement line item.
    headings: ['revenue recognition', 'revenue from contracts with customers', 'revenue recognition policy', 'revenue'],
    terms: [
      'performance obligation', 'transaction price', 'contract with customer', 'variable consideration',
      'standalone selling price', 'over time', 'point in time', 'contract asset', 'contract liability',
      'deferred revenue', 'asc 606', 'topic 606',
    ],
  },
  {
    id: 'stock-compensation',
    label: 'Stock-based compensation policy',
    asc: 'ASC 718',
    headings: ['stock-based compensation', 'share-based compensation', 'share-based payment', 'stock based compensation'],
    terms: [
      'restricted stock unit', 'stock option', 'grant date fair value', 'vesting period', 'forfeiture',
      'black-scholes', 'performance share', 'employee stock purchase', 'asc 718', 'topic 718',
    ],
  },
  {
    id: 'leases',
    label: 'Lease accounting policy',
    asc: 'ASC 842',
    headings: ['leases', 'lease accounting', 'right-of-use'],
    terms: [
      'right-of-use asset', 'lease liability', 'operating lease', 'finance lease', 'incremental borrowing rate',
      'lease term', 'short-term lease', 'asc 842', 'topic 842',
    ],
  },
  {
    id: 'goodwill-impairment',
    label: 'Goodwill & intangibles impairment',
    asc: 'ASC 350',
    headings: ['goodwill', 'goodwill and intangible assets', 'impairment of goodwill', 'intangible assets'],
    terms: [
      'reporting unit', 'impairment test', 'carrying amount', 'quantitative assessment', 'qualitative assessment',
      'indefinite-lived', 'triggering event', 'asc 350', 'topic 350',
    ],
  },
  {
    id: 'income-taxes',
    label: 'Income taxes policy',
    asc: 'ASC 740',
    headings: ['income taxes', 'income tax'],
    terms: [
      'deferred tax asset', 'deferred tax liability', 'valuation allowance', 'unrecognized tax benefit',
      'effective tax rate', 'uncertain tax position', 'asc 740', 'topic 740',
    ],
  },
  {
    id: 'business-combinations',
    label: 'Business combinations',
    asc: 'ASC 805',
    headings: ['business combinations', 'acquisitions', 'business combination'],
    terms: [
      'purchase price allocation', 'acquisition date fair value', 'contingent consideration', 'measurement period',
      'identifiable intangible', 'asc 805', 'topic 805',
    ],
  },
  {
    id: 'segment-reporting',
    label: 'Segment reporting',
    asc: 'ASC 280',
    headings: ['segment information', 'segment reporting', 'reportable segments', 'segments'],
    terms: [
      'chief operating decision maker', 'reportable segment', 'operating segment', 'segment profit',
      'significant segment expense', 'asc 280', 'topic 280',
    ],
  },
  {
    id: 'credit-losses',
    label: 'Credit losses / allowance',
    asc: 'ASC 326',
    headings: ['credit losses', 'allowance for credit losses', 'allowance for doubtful accounts'],
    terms: [
      'expected credit loss', 'current expected credit loss', 'cecl', 'allowance for doubtful', 'charge-off',
      'asc 326', 'topic 326',
    ],
  },
  {
    id: 'fair-value',
    label: 'Fair value measurement',
    asc: 'ASC 820',
    headings: ['fair value measurements', 'fair value', 'fair value measurement'],
    terms: ['level 1', 'level 2', 'level 3', 'observable input', 'unobservable input', 'asc 820', 'topic 820'],
  },
  {
    id: 'going-concern',
    label: 'Going concern',
    asc: 'ASC 205-40',
    headings: ['going concern', 'liquidity and going concern'],
    terms: ['substantial doubt', 'ability to continue as a going concern', 'management’s plans', 'liquidity'],
  },
  {
    id: 'material-weakness',
    label: 'Material weakness / ICFR',
    headings: ['controls and procedures', 'internal control over financial reporting', 'material weakness'],
    terms: [
      'material weakness', 'internal control over financial reporting', 'disclosure controls', 'remediation plan',
      'not effective', 'significant deficiency',
    ],
  },
  {
    id: 'critical-audit-matters',
    label: 'Critical audit matters',
    headings: ['critical audit matters', 'critical audit matter'],
    terms: ['critical audit matter', 'especially challenging', 'subjective', 'complex judgment'],
  },
  {
    id: 'use-of-estimates',
    label: 'Use of estimates',
    headings: ['use of estimates', 'critical accounting estimates', 'critical accounting policies'],
    terms: ['significant estimate', 'actual results could differ', 'judgment', 'assumption'],
  },
];

export function findDisclosureTopic(id: string): DisclosureTopic | undefined {
  return DISCLOSURE_TOPICS.find(topic => topic.id === id);
}

/**
 * Free text becomes an ad-hoc topic so the feature is not limited to the
 * curated list — "climate transition risk" should work as typed.
 */
export function topicFromFreeText(input: string): DisclosureTopic | null {
  const label = input.trim();
  if (label.length < 3) return null;

  const curated = DISCLOSURE_TOPICS.find(
    topic =>
      topic.label.toLowerCase() === label.toLowerCase() ||
      topic.headings.some(heading => heading === label.toLowerCase()),
  );
  if (curated) return curated;

  return { id: `custom:${label.toLowerCase()}`, label, headings: [label.toLowerCase()], terms: [label.toLowerCase()] };
}

export interface TopicPassage {
  text: string;
  /** Plain-language account of WHY this passage was selected. */
  matchReason: string;
  /** 'heading' is materially stronger evidence than 'density'. */
  matchKind: 'heading' | 'density' | 'none';
  /** Heading the passage was found under, when one was identified. */
  heading?: string;
  /** Topic terms actually present — the basis of the score, shown to the user. */
  matchedTerms: string[];
  /** Character offset in the source text, so callers can deep-link. */
  offset: number;
}

const NORMALIZE_RE = /[^a-z0-9]+/g;

function normalize(value: string): string {
  return value.toLowerCase().replace(NORMALIZE_RE, ' ').replace(/\s+/g, ' ').trim();
}

/** A heading is short, title-ish, and not a sentence. */
function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 90) return false;
  if (/[.;]$/.test(trimmed) && !/\b(policy|policies)\b/i.test(trimmed)) return false;
  return true;
}

/**
 * Locate the passage in `text` that discusses `topic`.
 *
 * Heading match first: a line that titles the disclosure is strong, cheap
 * evidence, and the passage that follows it is the disclosure itself. Only when
 * no heading exists does this fall back to scoring windows by term density,
 * which is weaker and is labelled as such so the reader can tell the difference.
 */
export function locateTopicPassage(text: string, topic: DisclosureTopic, passageChars = 2600): TopicPassage {
  if (!text.trim()) {
    return { text: '', matchReason: 'No filing text was available to search.', matchKind: 'none', matchedTerms: [], offset: 0 };
  }

  const lines = text.split('\n');
  const normalizedTerms = topic.terms.map(normalize).filter(Boolean);

  // ── Heading pass ──
  // Skip the table of contents: an early "Revenue Recognition" line is a TOC
  // entry pointing at the real disclosure much further down.
  let charCursor = 0;
  const headingCandidates: Array<{ offset: number; heading: string; score: number }> = [];

  for (const line of lines) {
    const lineStart = charCursor;
    charCursor += line.length + 1;
    if (lineStart < 4000 || !looksLikeHeading(line)) continue;

    const normalizedLine = normalize(line);
    if (!normalizedLine) continue;

    for (const [rank, heading] of topic.headings.entries()) {
      const normalizedHeading = normalize(heading);
      if (!normalizedHeading || !normalizedLine.includes(normalizedHeading)) continue;
      // An exact heading beats one that merely contains the phrase, and an
      // earlier (more specific) heading beats a later generic one — so
      // "Revenue Recognition" is tried before a bare "Revenue".
      const exactness = normalizedLine === normalizedHeading ? 100 : 60 - Math.min(normalizedLine.length, 50);
      headingCandidates.push({ offset: lineStart, heading: line.trim(), score: exactness + (topic.headings.length - rank) * 10 });
      break;
    }
  }

  // A heading alone is not proof. "Revenue" titles both the accounting policy
  // and the income-statement line item, and the line item returns a column of
  // numbers. So each candidate is CONFIRMED by reading what follows it: the
  // passage must actually use the topic's vocabulary. Candidates are tried
  // strongest-first and the first confirmed one wins.
  if (headingCandidates.length > 0) {
    headingCandidates.sort((a, b) => b.score - a.score || b.offset - a.offset);

    for (const candidate of headingCandidates) {
      const passage = text.slice(candidate.offset, candidate.offset + passageChars).trim();
      const matchedTerms = presentTerms(passage, normalizedTerms, topic.terms);
      // Prose, not a table: a numeric block under a matching heading is the
      // financial statement, not the policy.
      const digitRatio = (passage.match(/\d/g)?.length ?? 0) / Math.max(passage.length, 1);
      const readsLikePolicy = matchedTerms.length > 0 && digitRatio < 0.12;

      if (readsLikePolicy) {
        return {
          text: passage,
          matchKind: 'heading',
          heading: candidate.heading,
          matchReason: `Found under the heading “${candidate.heading}”.`,
          matchedTerms,
          offset: candidate.offset,
        };
      }
    }
    // Every heading was a false positive (a table or an index entry); fall
    // through to density rather than returning something that merely looked right.
  }

  // ── Density pass ──
  if (normalizedTerms.length === 0) {
    return { text: '', matchReason: 'No searchable terms for this topic.', matchKind: 'none', matchedTerms: [], offset: 0 };
  }

  const windowSize = passageChars;
  const step = Math.floor(windowSize / 3);
  let bestOffset = -1;
  let bestScore = 0;
  let bestTerms: string[] = [];

  for (let start = 0; start < text.length; start += step) {
    const window = normalize(text.slice(start, start + windowSize));
    if (!window) continue;

    let score = 0;
    const found: string[] = [];
    for (let i = 0; i < normalizedTerms.length; i += 1) {
      const term = normalizedTerms[i];
      if (!window.includes(term)) continue;
      // Multi-word terms are far more diagnostic than single words.
      score += term.includes(' ') ? 3 : 1;
      found.push(topic.terms[i]);
    }
    if (score > bestScore) {
      bestScore = score;
      bestOffset = start;
      bestTerms = found;
    }
  }

  if (bestOffset === -1 || bestScore === 0) {
    return {
      text: '',
      matchKind: 'none',
      matchReason: `No passage discussing ${topic.label.toLowerCase()} was found in this filing.`,
      matchedTerms: [],
      offset: 0,
    };
  }

  // Snap to a line/sentence boundary: a raw offset starts the passage
  // mid-word, which reads as broken.
  const snapWindow = text.slice(bestOffset, bestOffset + 400);
  const snapAt = Math.max(snapWindow.indexOf('\n'), snapWindow.search(/(?<=[.!?])\s+(?=[A-Z])/));
  const snappedOffset = snapAt > 0 && snapAt < 300 ? bestOffset + snapAt : bestOffset;

  return {
    text: text.slice(snappedOffset, snappedOffset + windowSize).trim(),
    matchKind: 'density',
    matchReason: `No matching heading; selected the passage with the highest concentration of ${topic.label.toLowerCase()} terms.`,
    matchedTerms: bestTerms,
    offset: bestOffset,
  };
}

function presentTerms(passage: string, normalizedTerms: string[], original: string[]): string[] {
  const normalizedPassage = normalize(passage);
  const present: string[] = [];
  normalizedTerms.forEach((term, index) => {
    if (term && normalizedPassage.includes(term)) present.push(original[index]);
  });
  return present;
}

/**
 * Terms a peer uses that the others do not.
 *
 * Reading two passages side by side tells you what each says; this tells you
 * where they actually diverge, which is the point of benchmarking.
 */
export function distinctiveTerms(passages: Record<string, TopicPassage>): Record<string, string[]> {
  const keys = Object.keys(passages);
  const result: Record<string, string[]> = {};

  for (const key of keys) {
    const mine = new Set(passages[key].matchedTerms);
    const others = new Set(keys.filter(other => other !== key).flatMap(other => passages[other].matchedTerms));
    result[key] = [...mine].filter(term => !others.has(term));
  }
  return result;
}
