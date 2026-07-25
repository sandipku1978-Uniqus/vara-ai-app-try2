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
    // Revenue recognition is not only ASC 606. An insurer earns premiums under
    // ASC 944 and a REIT recognises rents as lessor under ASC 842, and those
    // notes are titled accordingly — so an accountant benchmarking revenue
    // policy across an insurance or property peer group got MD&A noise instead
    // of the policy that governs them.
    headings: [
      'revenue recognition', 'revenue from contracts with customers', 'revenue recognition policy',
      // Only headings that unambiguously title a revenue policy. A generic
      // "lease income" belongs to the lease topic and collided here: Target's
      // "Sublease income (c)" table row was matched as its revenue note.
      'insurance premiums and receivables', 'insurance premiums', 'premiums earned',
      'revenue',
    ],
    terms: [
      'performance obligation', 'transaction price', 'contract with customer', 'variable consideration',
      'standalone selling price', 'over time', 'point in time', 'contract asset', 'contract liability',
      'deferred revenue', 'asc 606', 'topic 606',
      // How filings outside software and industrials actually word the policy.
      // The list above is ASC 606 jargon, and a plainly-written retail note
      // ("revenue is recognized at the point of sale, net of returns") matched
      // none of it — so Walmart, Costco and Target failed confirmation on a
      // correctly-located "Revenue Recognition" heading and fell through to a
      // density match somewhere in the MD&A.
      'revenue is recognized', 'recognizes revenue', 'recognize revenue',
      'control of the promised', 'point of sale', 'sales returns', 'net of returns',
      'when control', 'revenue recognition',
      // ASC 944 (insurers) and ASC 842 lessors state the same policy in their
      // own terms: "premiums written are earned into income on a pro rata
      // basis", "we accrue fixed lease income on a straight-line basis".
      'premiums are earned', 'premiums written are earned', 'earned into income',
      'unearned premium', 'pro rata basis over the period',
      'as a lessor', 'lease income', 'straight-line basis', 'minimum rent',
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

/** What a single comparison-target value means to every consumer of it. */
export interface ResolvedComparisonTarget {
  /** Set when the target names a curated policy topic. */
  topic?: DisclosureTopic;
  /** Item-scoped extraction still needs a section, topic or not. */
  section: string;
  /** What the reader is comparing — the string to put on screen. */
  label: string;
}

/**
 * Resolve the comparison selector's value into everything derived from it.
 *
 * Exists so the selector cannot disagree with what is extracted and labelled:
 * these were once two independent states, and the dropdown wrote only one of
 * them, which pinned extraction and headings to whatever the other happened to
 * be initialised with.
 *
 * Accepts `topic:<id>`, `section:<label>`, and — for older persisted values — a
 * bare section label.
 */
export function resolveComparisonTarget(value: string, defaultSection: string): ResolvedComparisonTarget {
  if (value.startsWith('topic:')) {
    const topic = findDisclosureTopic(value.slice('topic:'.length));
    // An unknown id must not silently become an unrelated Item comparison.
    if (topic) return { topic, section: defaultSection, label: topic.label };
    return { section: defaultSection, label: defaultSection };
  }

  const section = value.startsWith('section:') ? value.slice('section:'.length) : value;
  const resolved = section.trim() || defaultSection;
  return { section: resolved, label: resolved };
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

/** How far into a note to look for its policy prose before giving up. */
const NOTE_SCAN_CHARS = 14_000;

/**
 * Highest-scoring window of `windowSize` in `region`, by topic vocabulary.
 * Multi-word terms count for more because they are far more diagnostic than
 * a single word like "revenue". Ties keep the earliest window, so a passage
 * never drifts later than it needs to.
 */
function densestWindow(
  region: string,
  normalizedTerms: string[],
  originalTerms: string[],
  windowSize: number
): { offset: number; score: number; terms: string[] } {
  const step = Math.max(1, Math.floor(windowSize / 3));
  let best = { offset: -1, score: 0, terms: [] as string[] };

  for (let start = 0; start < region.length; start += step) {
    const window = normalize(region.slice(start, start + windowSize));
    if (!window) continue;

    let score = 0;
    const found: string[] = [];
    normalizedTerms.forEach((term, index) => {
      if (!term || !window.includes(term)) return;
      score += term.includes(' ') ? 3 : 1;
      found.push(originalTerms[index]);
    });

    if (score > best.score) best = { offset: start, score, terms: found };
  }
  return best;
}

/**
 * Drop a leading note or item designator so a heading compares on its subject.
 * "note 8 leases" → "leases"; "item 1a risk factors" → "risk factors".
 * Already-bare headings are returned unchanged.
 */
function stripNoteDesignator(normalized: string): string {
  return normalized.replace(/^(?:note|item)?\s*\d{1,2}[a-z]?\s+/, '').trim() || normalized;
}

/** A heading is short, title-ish, and not a sentence. */
function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 90) return false;
  // A trailing period does not disqualify a title — filings write "Revenue
  // Recognition." as a run-in note heading, and rejecting it outright sent
  // Prologis to a density match in the MD&A. Sentences are what to exclude,
  // and a sentence is longer than a heading.
  if (
    /[.;]$/.test(trimmed)
    && trimmed.split(/\s+/).length > 6
    && !/\b(policy|policies)\b/i.test(trimmed)
  ) return false;

  // A heading names a subject; a table row carries data. Statement line items
  // are short and unpunctuated too, so length alone let them through and they
  // won: American Tower matched an MD&A row "Revenue $ — $ 911.2 (100) %" over
  // its real revenue note, and Honeywell matched "Deferred revenue (175) (244)"
  // out of a deferred-tax table.
  //
  // The note designator is stripped first so "5. REVENUE RECOGNITION" and
  // "2. Revenue from Contracts with Customers" still read as headings.
  const subject = trimmed.replace(/^(?:note|item)?\s*\d{1,2}[a-z]?[.)\s–—-]+/i, '');
  if (/[$%]/.test(subject)) return false;                     // "Revenue $ — $ 911.2"
  if (/\(\s*[\d,.]+\s*\)/.test(subject)) return false;        // "(175)" — a negative figure
  if (/\d[\d,]{2,}/.test(subject)) return false;              // "605,756", "911.2"

  const digits = subject.match(/\d/g)?.length ?? 0;
  return digits === 0 || digits / subject.length <= 0.15;
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

    // "Note 8 – Leases" is the same heading as "Leases". Scoring it with the
    // note number attached made specificity a proxy for line length, and a
    // one-character difference decided real cases: Apple's "Note 8 – Leases"
    // (13 chars → 47) lost to the maturity-table header "Leases Total"
    // (12 chars → 48), so the policy note was passed over for a table.
    const headingCore = stripNoteDesignator(normalizedLine);

    for (const [rank, heading] of topic.headings.entries()) {
      const normalizedHeading = normalize(heading);
      if (!normalizedHeading || !normalizedLine.includes(normalizedHeading)) continue;
      // An exact heading beats one that merely contains the phrase, and an
      // earlier (more specific) heading beats a later generic one — so
      // "Revenue Recognition" is tried before a bare "Revenue".
      const exactness = headingCore === normalizedHeading ? 100 : 60 - Math.min(headingCore.length, 50);
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
    let bestPassage: TopicPassage | undefined;
    let bestQuality = -1;
    let bestDigits = 1;

    for (const candidate of headingCandidates) {
      const passage = text.slice(candidate.offset, candidate.offset + passageChars).trim();
      const matchedTerms = presentTerms(passage, normalizedTerms, topic.terms);
      const digitRatio = (passage.match(/\d/g)?.length ?? 0) / Math.max(passage.length, 1);

      // Vocabulary is the positive evidence; the digit ratio is only a veto
      // for weak candidates. A real policy note routinely embeds a maturity or
      // rate table, so a single hard threshold rejected the genuine article:
      // Apple's "Note 8 – Leases" scored 0.127 and lost to a bare "Leases
      // Total" table header at 0.118, which carried no lease vocabulary at all.
      //
      // Two or more distinct topic terms is prose no table produces. One term
      // still has to look like prose. Anything overwhelmingly numeric is a
      // statement or a schedule whatever it says.
      const readsLikePolicy =
        digitRatio < 0.30 &&
        (matchedTerms.length >= 2 || (matchedTerms.length === 1 && digitRatio < 0.12));

      if (readsLikePolicy) {
        // The heading locates the NOTE; the policy prose is not always at the
        // top of it. Deere, Honeywell and Simon Property all open their revenue
        // note with a disaggregation table, putting the recognition policy
        // 5,000–8,000 characters past the heading — outside the passage window,
        // so a correctly-located note still read as a table of numbers.
        const best = densestWindow(
          text.slice(candidate.offset, candidate.offset + NOTE_SCAN_CHARS),
          normalizedTerms,
          topic.terms,
          passageChars,
        );
        const shift = best.offset > 0 ? best.offset : 0;
        const refined = shift > 0 ? text.slice(candidate.offset + shift, candidate.offset + shift + passageChars).trim() : passage;

        // Several headings can look plausible. Rather than taking the first,
        // keep the most policy-like: richest topic vocabulary, then least
        // numeric. Microsoft's bare "Leases" heads a maturity table whose
        // column captions ("Operating Leases", "Finance Leases") are enough to
        // confirm it, so first-match returned a schedule of numbers while the
        // real lease policy sat under another heading entirely.
        const refinedDigits = (refined.match(/\d/g)?.length ?? 0) / Math.max(refined.length, 1);
        const terms = shift > 0 ? best.terms : matchedTerms;
        const quality = terms.filter(term => term.includes(' ')).length * 2 + terms.length;

        if (quality > bestQuality || (quality === bestQuality && refinedDigits < bestDigits)) {
          bestQuality = quality;
          bestDigits = refinedDigits;
          bestPassage = {
            text: refined,
            matchKind: 'heading',
            heading: candidate.heading,
            matchReason: `Found under the heading “${candidate.heading}”.`,
            matchedTerms: terms,
            offset: candidate.offset + shift,
          };
        }
      }

      if (bestPassage) return bestPassage;
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
