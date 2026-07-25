/**
 * Read a filing's structure from the registrant's own XBRL tagging instead of
 * inferring it from prose.
 *
 * Every modern annual report ships FilingSummary.xml: an index of every note
 * and accounting-policy block, generated from the iXBRL the registrant tagged.
 * Each entry points at a small R*.htm file holding exactly that block.
 *
 * This is what makes topic retrieval robust across industries. Locating a
 * policy by scanning the whole document for headings and vocabulary has to
 * cope with every drafting convention there is — insurers leading with reserve
 * disclosures, REITs pushing revenue policy deep into property notes, run-in
 * paragraphs with no heading of their own, maturity tables titled "Leases".
 * Reading the block the registrant tagged sidesteps all of it: the boundaries
 * are exact and the wording no longer has to be guessed at.
 *
 * The prose locator in disclosureTopics is still the fallback, and still
 * earns its keep — pre-2019 filings, some foreign private issuers, and
 * exhibits carry no tagging at all.
 */

import type { DisclosureTopic, TopicPassage } from './disclosureTopics';

export interface FilingReport {
  /** Human label, e.g. "LEASES" or "ACCOUNTING POLICIES (Policies)". */
  shortName: string;
  /** R*.htm within the filing directory. */
  file: string;
}

/**
 * EDGAR serves R-files wrapped in an SGML <DOCUMENT> envelope, so a DOM parser
 * sees <DOCUMENT> as the root and finds no <body> — the block extracts as an
 * empty string. Cut to the real markup first.
 */
export function stripSgmlEnvelope(html: string): string {
  const start = html.search(/<html[\s>]/i);
  return start >= 0 ? html.slice(start) : html;
}

/**
 * Remove the R-file's rendering header so the reader sees the disclosure.
 *
 * Every block opens with the same generated preamble — taxonomy version, the
 * block's own name, the period, the date, and the XBRL element label — before
 * the prose starts:
 *
 *     v3.25.3 / Revenue / 12 Months Ended / Sep. 27, 2025
 *     Revenue from Contract with Customer [Abstract]
 *     Revenue
 *     Revenue
 *     The Company recognizes revenue at the amount to which…
 *
 * The bracketed element label is the reliable end of that preamble. The title
 * is then commonly repeated once or twice before the body, so leading repeats
 * are collapsed too.
 */
export function stripXbrlReportChrome(text: string): string {
  const lines = text.split('\n');

  // The taxonomy label closing the header appears within the first few lines.
  const labelIndex = lines.findIndex((line, index) =>
    index < 12 && /\[(?:abstract|line items|table|domain|member|policy text block)\]\s*$/i.test(line.trim())
  );

  const body = labelIndex >= 0
    ? lines.slice(labelIndex + 1)
    // No label — drop the version stamp and period header individually.
    : lines.filter((line, index) =>
        !(index < 6 && (/^v\d+(?:\.\d+)+$/.test(line.trim()) || /^\d+\s+Months\s+Ended$/i.test(line.trim()))));

  // R-files append the XBRL element documentation after the prose — a run of
  // "- Definition / Disclosure of accounting policy for… / + References /
  // + Details / Name: us-gaap_…" per tagged block. On Microsoft's policies
  // block that is 30KB of taxonomy boilerplate, and the passage locator
  // happily returned it as the accounting policy.
  const docsIndex = body.findIndex(line => /^-\s*Definition$/i.test(line.trim()));
  if (docsIndex > 0) body.length = docsIndex;
  // The documentation run is introduced by a lone "X" toggle.
  while (body.length && (!body[body.length - 1].trim() || body[body.length - 1].trim() === 'X')) body.pop();

  while (body.length && !body[0].trim()) body.shift();

  // "Revenue / Revenue / The Company recognizes…" — collapse the repeated title.
  while (body.length > 1) {
    const first = body[0].trim().toLowerCase();
    const next = (body.find((line, index) => index > 0 && line.trim()) || '').trim().toLowerCase();
    if (!first || !next || first !== next) break;
    body.shift();
    while (body.length && !body[0].trim()) body.shift();
  }

  const result = body.join('\n').trim();
  // Never hand back nothing: an unexpected shape keeps the original.
  return result.length > 40 ? result : text;
}

function tagValue(fragment: string, tag: string): string {
  const match = fragment.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1].trim() : '';
}

export function parseFilingSummary(xml: string): FilingReport[] {
  if (!xml || !xml.includes('<Report')) return [];

  const reports: FilingReport[] = [];
  for (const match of xml.matchAll(/<Report[^>]*>([\s\S]*?)<\/Report>/g)) {
    const file = tagValue(match[1], 'HtmlFileName');
    const shortName = tagValue(match[1], 'ShortName');
    // A report with no HTML rendering (XML-only) cannot be read as a document.
    if (file && shortName) reports.push({ shortName, file });
  }
  return reports;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * A rendering of the numbers, not the narrative. "(Details)" and "(Tables)"
 * hold the tagged facts behind a note — the columns of figures, not the policy
 * a reader is looking for.
 */
function isNumericRendering(shortName: string): boolean {
  return /\((?:detail|details|tables)\)|parenthetical/i.test(shortName);
}

function isPolicyBlock(shortName: string): boolean {
  return /\(polic/i.test(shortName);
}

/**
 * Blocks worth reading for a topic, best first.
 *
 * A dedicated note wins over the policies block: it is the fuller disclosure,
 * and across the sector corpus it resolved more topics than the policies block
 * did. The policies block is the reliable second, because registrants that
 * fold a policy into the significant-accounting-policies note give it no note
 * of its own — which is exactly the case the prose locator could never reach.
 *
 * Topic headings are reused as the match vocabulary, so adding a topic needs
 * no separate mapping table here.
 */
export interface RankedBlock extends FilingReport {
  /**
   * 'note' — the registrant tagged this block as being about the topic, so the
   * block itself is the disclosure. 'policy' — a combined significant-policies
   * block covering many topics, which still has to be searched within.
   */
  kind: 'note' | 'policy';
}

export function rankTopicBlocks(reports: FilingReport[], topic: DisclosureTopic): RankedBlock[] {
  const readable = reports.filter(report => !isNumericRendering(report.shortName));

  /**
   * How well a block's name names the topic. Position matters: "UNEARNED
   * REVENUE" contains "revenue" but is the deferred-revenue note, and
   * returning its table as the revenue recognition policy is exactly the kind
   * of near-miss a plain substring test cannot tell apart from a real match.
   * A longer heading matching is also stronger evidence than a short one.
   */
  const nameScore = (shortName: string): number => {
    const name = normalize(shortName);
    let best = 0;
    for (const heading of topic.headings) {
      const normalizedHeading = normalize(heading);
      if (normalizedHeading.length <= 2 || !name.includes(normalizedHeading)) continue;
      const placement = name === normalizedHeading ? 100
        : name.startsWith(normalizedHeading) ? 60
        : 20;
      best = Math.max(best, placement + normalizedHeading.length);
    }
    return best;
  };

  const namedNotes = readable
    .filter(report => !isPolicyBlock(report.shortName) && nameScore(report.shortName) > 0)
    .sort((a, b) => nameScore(b.shortName) - nameScore(a.shortName));

  const policyBlocks = readable.filter(report => isPolicyBlock(report.shortName));

  // A note whose title leads with the topic is the disclosure and outranks
  // everything. A note that merely CONTAINS the word does not: Microsoft has
  // no revenue note at all, so "UNEARNED REVENUE" — the deferred-revenue
  // table — was beating the policies block that actually holds its revenue
  // policy. Those go last, after the registrant's own policy block.
  const STRONG_NAME = 60;
  const leadingNotes = namedNotes.filter(report => nameScore(report.shortName) >= STRONG_NAME);
  const incidentalNotes = namedNotes.filter(report => nameScore(report.shortName) < STRONG_NAME);

  const ranked: RankedBlock[] = [
    ...leadingNotes.map(report => ({ ...report, kind: 'note' as const })),
    ...policyBlocks.map(report => ({ ...report, kind: 'policy' as const })),
    ...incidentalNotes.map(report => ({ ...report, kind: 'note' as const })),
  ];

  // De-duplicate while preserving priority.
  const seen = new Set<string>();
  return ranked.filter(report => {
    if (seen.has(report.file)) return false;
    seen.add(report.file);
    return true;
  });
}

/**
 * The head of a block the registrant tagged as this topic, trimmed at a
 * sentence boundary so it reads as prose rather than stopping mid-word.
 */
function openingPassage(text: string, topic: DisclosureTopic, blockName: string, chars = 2600): TopicPassage {
  const termsIn = (body: string): string[] => {
    const lower = body.toLowerCase();
    return topic.terms.filter(term => lower.includes(term.toLowerCase()));
  };
  // Trim to a sentence end, but only when that keeps most of the window —
  // measuring against the window SIZE rather than the text length matters for
  // blocks shorter than `chars`, where the looser test cut real content.
  const trimToSentence = (body: string): string => {
    const lastStop = body.lastIndexOf('. ');
    return (lastStop > chars * 0.5 ? body.slice(0, lastStop + 1) : body).trim();
  };

  // Read from the top of the block and stop there.
  //
  // Two cleverer variants were measured against the 32-issuer corpus and both
  // scored WORSE than this: hunting the densest window inside the block (148)
  // and skipping a leading table to the first prose (148), against 151 for the
  // plain head. A block the registrant tagged for this topic opens with the
  // disclosure; moving the window off the top mostly finds a way to be wrong.
  // Terms are counted on the passage actually returned, not on the untrimmed
  // window: the count feeds block selection, so counting text the reader never
  // sees would let a block win on evidence it does not display.
  const body = trimToSentence(text.slice(0, chars));

  return {
    text: body,
    matchKind: 'heading',
    heading: blockName,
    matchReason: `Tagged by the registrant as “${blockName}”.`,
    matchedTerms: termsIn(body),
    offset: 0,
  };
}

/** How diagnostic a located passage is — multi-word terms are the strong signal. */
function passageStrength(passage: TopicPassage): number {
  if (passage.matchKind === 'none') return 0;
  return passage.matchedTerms.reduce((total, term) => total + (term.includes(' ') ? 3 : 1), 0);
}

export interface TopicBlockMatch {
  passage: TopicPassage;
  /** The registrant's own name for the block, shown as provenance. */
  blockName: string;
}

/**
 * Best passage for a topic across a filing's tagged blocks.
 *
 * Reads candidates in priority order and keeps the strongest, stopping early
 * once a block is clearly on topic so a filing costs one or two small fetches
 * rather than a multi-megabyte document. Returns null when nothing tagged
 * covers the topic, which is the caller's cue to fall back to the prose
 * locator over the whole filing.
 */
export async function locateTopicInBlocks(options: {
  reports: FilingReport[];
  topic: DisclosureTopic;
  /** Fetches a block and returns its EXTRACTED TEXT (not raw html). */
  loadBlock: (file: string) => Promise<string>;
  locate: (text: string, topic: DisclosureTopic) => TopicPassage;
  maxBlocks?: number;
}): Promise<TopicBlockMatch | null> {
  const candidates = rankTopicBlocks(options.reports, options.topic).slice(0, options.maxBlocks ?? 4);

  let best: TopicBlockMatch | null = null;
  let bestStrength = 0;

  for (const candidate of candidates) {
    let text: string;
    try {
      text = stripXbrlReportChrome(await options.loadBlock(candidate.file));
    } catch {
      continue; // A block that will not load is not a verdict on the topic.
    }
    if (!text || text.length < 200) continue;

    // A block the registrant tagged as this topic IS the disclosure — read it
    // from the top. Running heading heuristics inside it re-introduces exactly
    // the failure the tagging removes: Honeywell's block is titled "REVENUE
    // RECOGNITION AND CONTRACTS WITH CUSTOMERS", and searching within it for a
    // "revenue" heading lands on the disaggregation table further down.
    // A combined policies block covers many topics, so that one is searched.
    const passage = candidate.kind === 'note'
      ? openingPassage(text, options.topic, candidate.shortName)
      : options.locate(text, options.topic);
    const strength = passageStrength(passage);
    if (strength > bestStrength) {
      bestStrength = strength;
      best = { passage, blockName: candidate.shortName };
    }
    // Two diagnostic terms is a block that plainly discusses the topic; no
    // reason to spend another fetch looking for a better one.
    if (bestStrength >= 6) break;
  }

  return best;
}

export function filingSummaryPath(cik: string, accession: string): string {
  return `Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/FilingSummary.xml`;
}

export function filingBlockPath(cik: string, accession: string, file: string): string {
  return `Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, '')}/${file}`;
}
