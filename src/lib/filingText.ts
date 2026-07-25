/**
 * Filing-text extraction, shared by the browser and the server.
 *
 * The original implementation used `innerText`, which is layout-aware and
 * exists only in a real browser — so filing text could not be extracted (or
 * cached) server-side. The obvious substitute, `textContent`, is wrong in a way
 * that silently corrupts search: it concatenates across block boundaries, so
 * `<p>foo</p><p>bar</p>` becomes `foobar` — one token where there were two.
 * That would break proximity matching and phrase boundaries.
 *
 * This walker is therefore explicit rather than layout-derived: it inserts
 * separators at the boundaries that matter and nowhere else, so both
 * environments produce identical output by construction instead of by luck.
 */

/** Elements whose boundaries must become line breaks, or tokens merge across them. */
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'dd', 'div', 'dl', 'dt',
  'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'hr', 'html', 'legend', 'li', 'main', 'nav', 'ol', 'p', 'pre', 'section',
  'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul',
]);

/** Cells sit side by side on a line; a space keeps their values from merging. */
const CELL_TAGS = new Set(['td', 'th']);

/** Never contribute text. */
const DROPPED_TAGS = new Set(['script', 'style', 'noscript', 'template']);

/**
 * Inline XBRL wrappers. Their *content* is real filing text, but the elements
 * themselves must not introduce breaks — a number wrapped in ix:nonfraction is
 * part of the surrounding sentence.
 */
const XBRL_UNWRAP_PREFIXES = ['ix:', 'xbrli:'];

/** Hidden XBRL metadata blocks: machine content that is not filing prose. */
const XBRL_DROPPED_TAGS = new Set(['ix:header', 'ix:hidden', 'xbrli:context', 'xbrli:unit']);

interface MinimalNode {
  nodeType: number;
  nodeName: string;
  textContent: string | null;
  childNodes: ArrayLike<MinimalNode>;
}

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

/**
 * Walks the tree once, emitting text with explicit boundary separators.
 * Accepts any DOM-shaped node so the browser's DOMParser output and linkedom's
 * both work without adapters.
 */
export function extractTextFromNode(root: MinimalNode): string {
  const parts: string[] = [];

  const walk = (node: MinimalNode): void => {
    if (node.nodeType === TEXT_NODE) {
      const value = node.textContent || '';
      if (value) parts.push(value);
      return;
    }
    if (node.nodeType !== ELEMENT_NODE) return;

    const tag = node.nodeName.toLowerCase();
    if (DROPPED_TAGS.has(tag) || XBRL_DROPPED_TAGS.has(tag)) return;

    if (tag === 'br') {
      parts.push('\n');
      return;
    }

    const isXbrlWrapper = XBRL_UNWRAP_PREFIXES.some(prefix => tag.startsWith(prefix));
    const isBlock = BLOCK_TAGS.has(tag) && !isXbrlWrapper;
    const isCell = CELL_TAGS.has(tag);

    if (isBlock) parts.push('\n');
    else if (isCell) parts.push(' ');

    const children = node.childNodes;
    for (let i = 0; i < children.length; i += 1) walk(children[i]);

    if (isBlock) parts.push('\n');
  };

  walk(root);
  return normalizeFilingWhitespace(parts.join(''));
}

/**
 * Break extracted filing text into readable paragraphs.
 *
 * Filing HTML frequently marks paragraphs with styling rather than structure,
 * so extraction can yield a single unbroken block — which is how a 20,000
 * character Item 1A became a wall nothing could be read out of. Real breaks are
 * used where they exist; anything still oversized is split at sentence
 * boundaries so the reader gets paragraphs instead of a slab.
 */
export function splitIntoParagraphs(text: string, maxChars = 700): string[] {
  const blocks = text.split(/\n\s*\n/).map(block => block.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean);

  const paragraphs: string[] = [];
  for (const block of blocks) {
    if (block.length <= maxChars) {
      paragraphs.push(block);
      continue;
    }
    // Split after sentence-ending punctuation, keeping the punctuation.
    const sentences = block.split(/(?<=[.!?])\s+(?=[A-Z(“"])/);
    let current = '';
    for (const sentence of sentences) {
      if (current && (current.length + sentence.length) > maxChars) {
        paragraphs.push(current.trim());
        current = '';
      }
      current += (current ? ' ' : '') + sentence;
    }
    if (current.trim()) paragraphs.push(current.trim());
  }

  return paragraphs;
}

/** Whitespace normalization, kept identical to the original implementation. */
export function normalizeFilingWhitespace(text: string): string {
  return text
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
