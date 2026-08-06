/**
 * Inline XBRL reader.
 *
 * The primary document of a modern 10-K *is* the XBRL instance — facts are
 * embedded in the HTML that a human reads. Reading them from that document
 * rather than from a separate instance file gives every fact a character range
 * in the document a preparer will actually open, which is what makes a finding
 * verifiable (build spec §4, "provenance is mandatory").
 *
 * This is a deliberate scanner rather than a DOM parse. A 10-K routinely runs
 * past 10 MB of markup, filing agents emit inconsistent namespace prefixes, and
 * a DOM walk discards the byte offsets that make the evidence pack useful.
 */

export interface IxbrlContext {
  id: string;
  start_date?: string;
  end_date?: string;
  instant?: string;
  /** Non-empty for segment, geography and other dimensional breakdowns. */
  dimensions: Array<{ dimension: string; member: string }>;
}

export interface IxbrlFact {
  /** Namespace prefix as filed, e.g. `us-gaap` or `dei`. */
  prefix: string;
  /** Local name, e.g. `Assets`. */
  name: string;
  context_ref: string;
  unit_ref?: string;
  decimals?: string;
  scale?: number;
  sign?: -1 | 1;
  /** Parsed numeric value with scale and sign applied; undefined for text facts. */
  value?: number;
  /** The literal as it appears in the document, before scaling. */
  literal: string;
  numeric: boolean;
  char_start: number;
  char_end: number;
}

export interface IxbrlDocument {
  facts: IxbrlFact[];
  contexts: Map<string, IxbrlContext>;
  units: Set<string>;
  /** True when the document declares the inline XBRL namespace at all. */
  hasInlineXbrl: boolean;
}

const ATTRIBUTE_PATTERN = /([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  ATTRIBUTE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTRIBUTE_PATTERN.exec(source))) {
    attributes[match[1].toLowerCase()] = match[2] ?? match[3] ?? match[4] ?? '';
  }
  return attributes;
}

/** Local name of a possibly namespace-prefixed element. */
function localName(tag: string): string {
  const colon = tag.indexOf(':');
  return (colon >= 0 ? tag.slice(colon + 1) : tag).toLowerCase();
}

interface ElementMatch {
  tagName: string;
  attributes: Record<string, string>;
  innerStart: number;
  innerEnd: number;
  outerStart: number;
  outerEnd: number;
  selfClosing: boolean;
}

/**
 * Find every element whose local name is in `names`, with its inner range.
 *
 * One linear pass with a stack, not a forward re-scan per element: a 10-K is
 * routinely 10 MB, and re-scanning from each of a few thousand facts turns a
 * five-second parse into a timeout. Nesting is tracked by local name, so an
 * `ix:nonNumeric` wrapping another closes against the right tag; anything left
 * open at end of document is discarded rather than allowed to swallow the rest.
 */
function findElements(html: string, names: Set<string>): ElementMatch[] {
  const results: ElementMatch[] = [];
  const stack: Array<{ local: string; open: Omit<ElementMatch, 'innerEnd' | 'outerEnd'> }> = [];
  const tagPattern = /<(\/?)([a-zA-Z_][-\w:.]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>/g;
  let match: RegExpExecArray | null;

  while ((match = tagPattern.exec(html))) {
    const closing = match[1] === '/';
    const tagName = match[2];
    const local = localName(tagName);
    if (!names.has(local)) continue;

    if (closing) {
      // Close against the innermost open element of the same local name;
      // anything opened inside it and never closed is dropped with it.
      for (let index = stack.length - 1; index >= 0; index -= 1) {
        if (stack[index].local !== local) continue;
        const { open } = stack[index];
        stack.length = index;
        results.push({
          ...open,
          innerEnd: match.index,
          outerEnd: match.index + match[0].length,
        });
        break;
      }
      continue;
    }

    const rawAttributes = match[3] || '';
    const innerStart = match.index + match[0].length;
    const open = {
      tagName,
      attributes: parseAttributes(rawAttributes),
      innerStart,
      outerStart: match.index,
      selfClosing: /\/\s*$/.test(rawAttributes),
    };
    if (open.selfClosing) {
      results.push({ ...open, innerEnd: innerStart, outerEnd: innerStart });
      continue;
    }
    stack.push({ local, open });
  }

  // Document order keeps provenance offsets monotonic for the evidence pack.
  results.sort((left, right) => left.outerStart - right.outerStart);
  return results;
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

export function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&[a-z]+;|&#\d+;/gi, entity => ENTITIES[entity.toLowerCase()] ?? ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse an inline XBRL numeric literal.
 *
 * Filers present negatives as parentheses, em dashes as zero, and thousands
 * separators by locale. Everything that is not a recognisable number returns
 * undefined so the caller can record an unparsed fact instead of inventing one.
 */
export function parseNumericLiteral(literal: string, format?: string): number | undefined {
  const text = literal.trim();
  if (!text) return undefined;
  if (format && /fixed-?zero/i.test(format)) return 0;
  if (/^[—–\-−]$/.test(text)) return 0;

  const negative = /^\(.*\)$/.test(text);
  const digits = text
    .replace(/[()]/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/[,\s ]/g, '')
    .replace(/[$%]/g, '');
  if (!/^-?\d*\.?\d+$/.test(digits)) return undefined;
  const value = Number(digits);
  if (!Number.isFinite(value)) return undefined;
  return negative ? -Math.abs(value) : value;
}

function splitQName(value: string): { prefix: string; name: string } {
  const colon = value.indexOf(':');
  if (colon < 0) return { prefix: '', name: value };
  return { prefix: value.slice(0, colon), name: value.slice(colon + 1) };
}

/** Read every inline fact, context and unit from a filed primary document. */
export function parseInlineXbrl(html: string): IxbrlDocument {
  const hasInlineXbrl = /xmlns:ix\s*=|<ix:/i.test(html);
  const facts: IxbrlFact[] = [];
  const contexts = new Map<string, IxbrlContext>();
  const units = new Set<string>();

  for (const element of findElements(html, new Set(['nonfraction', 'nonnumeric']))) {
    const attributes = element.attributes;
    const qname = attributes.name;
    if (!qname) continue;
    const { prefix, name } = splitQName(qname);
    const numeric = localName(element.tagName) === 'nonfraction';
    const literal = stripTags(html.slice(element.innerStart, element.innerEnd));
    const scaleAttribute = attributes.scale ? Number(attributes.scale) : undefined;
    const scale = Number.isFinite(scaleAttribute) ? (scaleAttribute as number) : undefined;
    const sign = attributes.sign === '-' ? -1 : undefined;

    let value: number | undefined;
    if (numeric) {
      const parsed = parseNumericLiteral(literal, attributes.format);
      if (parsed !== undefined) {
        value = parsed * (scale ? 10 ** scale : 1) * (sign ?? 1);
      }
    }

    facts.push({
      prefix,
      name,
      context_ref: attributes.contextref || '',
      unit_ref: attributes.unitref || undefined,
      decimals: attributes.decimals || undefined,
      scale,
      sign: sign ?? undefined,
      value,
      literal,
      numeric,
      char_start: element.outerStart,
      char_end: element.outerEnd,
    });
  }

  for (const element of findElements(html, new Set(['context']))) {
    const id = element.attributes.id;
    if (!id) continue;
    const inner = html.slice(element.innerStart, element.innerEnd);
    const startDate = /<[a-z0-9]*:?startdate[^>]*>([^<]+)</i.exec(inner)?.[1]?.trim();
    const endDate = /<[a-z0-9]*:?enddate[^>]*>([^<]+)</i.exec(inner)?.[1]?.trim();
    const instant = /<[a-z0-9]*:?instant[^>]*>([^<]+)</i.exec(inner)?.[1]?.trim();
    const dimensions: IxbrlContext['dimensions'] = [];
    const memberPattern = /<[a-z0-9]*:?explicitmember\b([^>]*)>([^<]*)</gi;
    let member: RegExpExecArray | null;
    while ((member = memberPattern.exec(inner))) {
      const dimension = parseAttributes(member[1]).dimension || '';
      dimensions.push({ dimension, member: member[2].trim() });
    }
    contexts.set(id, { id, start_date: startDate, end_date: endDate, instant, dimensions });
  }

  for (const element of findElements(html, new Set(['unit']))) {
    if (element.attributes.id) units.add(element.attributes.id);
  }

  return { facts, contexts, units, hasInlineXbrl };
}
