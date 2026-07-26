/**
 * Server-side filing-text extraction.
 *
 * Parses with linkedom (the browser path uses the platform DOMParser) and then
 * hands off to the SAME walker, so both environments produce byte-identical
 * text. That equivalence is what makes it safe to cache text extracted on the
 * server and evaluate Boolean queries against it — a server/client mismatch
 * would silently change which filings match.
 *
 * Server-only: importing linkedom into a client bundle would ship a parser the
 * browser already has.
 */

import { parseHTML } from 'linkedom';
import { extractTextFromNode, stripSgmlEnvelope } from './filingText';

export function extractDocumentTextFromHtmlServer(html: string): string {
  if (!html || !html.trim()) return '';
  try {
    // Pre-~2015 archive documents (and all R-files) arrive inside an SGML
    // <DOCUMENT> envelope; linkedom finds no <body> in it and extraction
    // returned '' — which downstream treated as "document has no text" and
    // silently excluded the filing from Boolean validation.
    html = stripSgmlEnvelope(html);
    // Empty or badly malformed input can yield a result with no document at
    // all, so this is a guarded read rather than a destructure. A filing we
    // cannot parse must return empty text, never throw into the caller's
    // validation loop.
    const parsed = parseHTML(html) as { document?: { body?: unknown } } | undefined;
    const body = parsed?.document?.body;
    if (!body) return '';
    return extractTextFromNode(body as Parameters<typeof extractTextFromNode>[0]);
  } catch {
    return '';
  }
}
