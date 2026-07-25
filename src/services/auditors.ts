export interface AuditorOption {
  label: string;
  aliases: string[];
  queryTerms: string[];
  patterns: RegExp[];
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export const AUDITOR_OPTIONS: AuditorOption[] = [
  {
    label: 'Deloitte',
    aliases: ['Deloitte', 'Deloitte & Touche', 'Deloitte & Touche LLP', 'Deloitte LLP'],
    queryTerms: ['Deloitte', '"Deloitte & Touche"'],
    patterns: [
      /\bdeloitte(?:\s*&\s*touche)?(?:\s+llp)?\b/i,
    ],
  },
  {
    label: 'PwC',
    aliases: ['PwC', 'PricewaterhouseCoopers', 'PricewaterhouseCoopers LLP', 'Price Waterhouse Coopers'],
    queryTerms: ['PwC', '"PricewaterhouseCoopers"'],
    patterns: [
      /\bpricewaterhousecoopers(?:\s+llp)?\b/i,
      /\bpwc\b/i,
    ],
  },
  {
    label: 'EY',
    aliases: ['EY', 'EY LLP', 'Ernst & Young', 'Ernst & Young LLP', 'Ernst and Young', 'Ernst and Young LLP'],
    queryTerms: ['EY', '"Ernst & Young"'],
    patterns: [
      /\bernst\s*(?:&|and)\s*young(?:\s+llp)?\b/i,
      /\bey(?:\s+llp)?\b/i,
    ],
  },
  {
    label: 'KPMG',
    aliases: ['KPMG', 'KPMG LLP'],
    queryTerms: ['KPMG'],
    patterns: [
      /\bkpmg(?:\s+llp)?\b/i,
    ],
  },
  {
    label: 'BDO',
    aliases: ['BDO', 'BDO USA', 'BDO USA LLP', 'BDO LLP'],
    queryTerms: ['BDO'],
    patterns: [
      /\bbdo(?:\s+usa)?(?:\s+llp)?\b/i,
    ],
  },
  {
    label: 'Grant Thornton',
    aliases: ['Grant Thornton', 'Grant Thornton LLP'],
    queryTerms: ['"Grant Thornton"'],
    patterns: [
      /\bgrant\s+thornton(?:\s+llp)?\b/i,
    ],
  },
  {
    label: 'RSM',
    aliases: ['RSM', 'RSM US LLP', 'RSM US'],
    queryTerms: ['RSM'],
    patterns: [
      /\brsm(?:\s+us)?(?:\s+llp)?\b/i,
    ],
  },
  {
    label: 'Crowe',
    aliases: ['Crowe', 'Crowe LLP'],
    queryTerms: ['Crowe'],
    patterns: [
      /\bcrowe(?:\s+llp)?\b/i,
    ],
  },
  {
    label: 'Baker Tilly',
    aliases: ['Baker Tilly', 'Baker Tilly US', 'Baker Tilly US LLP', 'Baker Tilly Virchow Krause'],
    queryTerms: ['"Baker Tilly"'],
    patterns: [
      /\bbaker\s+tilly(?:\s+us)?(?:\s+llp)?\b/i,
      /\bbaker\s+tilly\s+virchow\s+krause\b/i,
    ],
  },
  {
    label: 'Moss Adams',
    aliases: ['Moss Adams', 'Moss Adams LLP'],
    queryTerms: ['"Moss Adams"'],
    patterns: [
      /\bmoss\s+adams(?:\s+llp)?\b/i,
    ],
  },
  {
    label: 'Marcum',
    aliases: ['Marcum', 'Marcum LLP', 'CBIZ Marcum'],
    queryTerms: ['Marcum', '"CBIZ Marcum"'],
    patterns: [
      /\bmarcum(?:\s+llp)?\b/i,
      /\bcbiz\s+marcum\b/i,
    ],
  },
];

const BIG_FOUR_LABELS = new Set(['Deloitte', 'PwC', 'EY', 'KPMG']);
const NORMALIZED_AUDITOR_INDEX = new Map<string, AuditorOption>();

for (const option of AUDITOR_OPTIONS) {
  for (const alias of option.aliases) {
    NORMALIZED_AUDITOR_INDEX.set(normalize(alias), option);
  }
  NORMALIZED_AUDITOR_INDEX.set(normalize(option.label), option);
}

function isBigFourValue(value: string): boolean {
  return /\bbig\s+4\b|\bbig\s+four\b/i.test(value);
}

export function canonicalizeAuditorInput(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (isBigFourValue(trimmed)) return 'Big 4';

  const exact = NORMALIZED_AUDITOR_INDEX.get(normalize(trimmed));
  if (exact) {
    return exact.label;
  }

  const mention = findAuditorMention(trimmed);
  return mention?.label || trimmed;
}

export function findAuditorMention(value: string): AuditorOption | null {
  const normalizedValue = normalize(value);
  if (!normalizedValue) return null;

  for (const option of AUDITOR_OPTIONS) {
    if (option.patterns.some(pattern => pattern.test(value))) {
      return option;
    }

    if (option.aliases.some(alias => normalizedValue.includes(normalize(alias)))) {
      return option;
    }
  }

  return null;
}

export function stripAuditorMentions(value: string, option: AuditorOption): string {
  let next = value;
  const aliases = Array.from(new Set([option.label, ...option.aliases]))
    .sort((a, b) => b.length - a.length);

  for (const alias of aliases) {
    const escaped = escapeRegex(alias).replace(/\s+/g, '\\s+');
    next = next
      .replace(new RegExp(`\\baudited\\s+by\\s+${escaped}\\b`, 'ig'), ' ')
      .replace(new RegExp(`\\bauditor\\s*:?\\s*${escaped}\\b`, 'ig'), ' ')
      .replace(new RegExp(`\\b${escaped}\\b`, 'ig'), ' ');
  }

  return next;
}

export function buildAuditorSearchTerms(value: string): string[] {
  const canonical = canonicalizeAuditorInput(value);
  if (!canonical) return [];

  if (canonical === 'Big 4') {
    return AUDITOR_OPTIONS
      .filter(option => BIG_FOUR_LABELS.has(option.label))
      .flatMap(option => option.queryTerms);
  }

  const option = NORMALIZED_AUDITOR_INDEX.get(normalize(canonical));
  if (!option) {
    return [canonical];
  }

  return Array.from(new Set([option.label, ...option.queryTerms]));
}

export function matchesAuditorSelection(resultAuditor: string, filterValue: string): boolean {
  const canonicalFilter = canonicalizeAuditorInput(filterValue);
  if (!canonicalFilter) return true;

  const canonicalResult = canonicalizeAuditorInput(resultAuditor);
  if (!canonicalResult) return false;

  if (canonicalFilter === 'Big 4') {
    return BIG_FOUR_LABELS.has(canonicalResult);
  }

  if (canonicalResult === canonicalFilter) {
    return true;
  }

  return normalize(resultAuditor).includes(normalize(filterValue));
}

/**
 * Earliest firm mentioned in `chunk`, or ''.
 *
 * Position, not list order: returning the first AUDITOR_OPTIONS entry that
 * matched anywhere made the answer depend on how the catalogue happens to be
 * ordered rather than on what the document says.
 */
function matchAuditorInChunk(chunk: string): string {
  let best = '';
  let bestIndex = Infinity;

  for (const option of AUDITOR_OPTIONS) {
    for (const pattern of option.patterns) {
      // Patterns are shared module state; a lastIndex left over from a global
      // match would silently skip the start of the next chunk.
      const search = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
      const found = search.exec(chunk);
      if (found && found.index < bestIndex) {
        bestIndex = found.index;
        best = option.label;
      }
    }
  }
  return best;
}

/**
 * Text that only appears in an auditor's own report, in precision order.
 *
 * Anchoring is what makes this reliable. Scanning slices of a 10-K for bare
 * firm names attributes whatever it happens to land on: NextEra's auditor came
 * back as "RSM" because the filing writes "rate stabilization mechanism (RSM)"
 * in its rate-agreement discussion, and Home Depot's came back as EY because
 * the real report (`/s/ KPMG LLP`, mid-document) fell outside the scanned
 * window while a director's biography mentioning Ernst & Young fell inside it.
 */
const AUDIT_REPORT_ANCHORS: Array<{ pattern: RegExp; before: number; after: number }> = [
  // The signature line itself — the firm is the signatory.
  { pattern: /\/s\/\s*/gi, before: 0, after: 120 },
  // Every PCAOB report closes with tenure, immediately after the signature.
  { pattern: /we have served as (?:the|our)[^.]{0,80}auditor since/gi, before: 1_200, after: 200 },
  // Some filers (utilities especially) carry neither, but do carry the heading.
  { pattern: /report of independent registered public accounting firm/gi, before: 1_500, after: 8_000 },
];

export function detectAuditorInText(text: string): string {
  if (!text.trim()) return '';

  for (const anchor of AUDIT_REPORT_ANCHORS) {
    const pattern = new RegExp(anchor.pattern.source, anchor.pattern.flags.includes('g')
      ? anchor.pattern.flags
      : `${anchor.pattern.flags}g`);
    for (const match of text.matchAll(pattern)) {
      const start = Math.max(0, (match.index ?? 0) - anchor.before);
      const end = (match.index ?? 0) + match[0].length + anchor.after;
      const firm = matchAuditorInChunk(text.slice(start, end));
      if (firm) return firm;
    }
  }

  // No audit report found — an exhibit, a fragment, or a pre-2000 filing.
  // Fall back to the whole document rather than reporting nothing.
  return matchAuditorInChunk(text);
}
