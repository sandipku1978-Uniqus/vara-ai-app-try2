import { describe, it, expect } from 'vitest';
import { assertSecDocumentResponse, looksLikeSecErrorText, SecUpstreamError } from '../lib/sec-upstream';

/**
 * Remediation handoff 2026-07-31, WP4 item 4 / acceptance T13.
 *
 * fetchSecResponse deliberately passes non-OK responses through (sec-proxy
 * forwards status codes), so every caller that EXTRACTS text must gate on
 * this guard first. Without it, an SEC rate-threshold page — served as prose
 * HTML — was extracted and upserted into the shared urc_filing_text cache as
 * the filing's permanent text: cache poisoning that turned every later
 * Boolean validation of that accession into a match against the error page.
 */

function response(status: number, contentType?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(contentType ? { 'content-type': contentType } : {}),
  } as unknown as Response;
}

describe('assertSecDocumentResponse', () => {
  it.each([
    ['403 rate threshold', 403],
    ['404 not found', 404],
    ['429 too many requests', 429],
    ['500 server error', 500],
    ['503 unavailable', 503],
  ])('rejects a %s response even when its body is HTML prose', (_label, status) => {
    expect(() => assertSecDocumentResponse(response(status, 'text/html'))).toThrow(SecUpstreamError);
    try {
      assertSecDocumentResponse(response(status, 'text/html'));
    } catch (error) {
      expect((error as SecUpstreamError).status).toBe(status);
    }
  });

  it('maps an out-of-range status to 502 rather than passing it through', () => {
    try {
      assertSecDocumentResponse(response(304, 'text/html'));
    } catch (error) {
      expect((error as SecUpstreamError).status).toBe(502);
    }
  });

  it.each([
    ['application/pdf'],
    ['image/png'],
    ['application/octet-stream'],
    ['application/zip'],
  ])('rejects a 200 %s document with 415 — binary is never filing text', contentType => {
    try {
      assertSecDocumentResponse(response(200, contentType));
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as SecUpstreamError).status).toBe(415);
    }
  });

  it.each([
    ['text/html'],
    ['text/html; charset=utf-8'],
    ['application/xhtml+xml'],
    ['text/plain'],
    ['text/xml'],
    ['application/xml'],
  ])('accepts a 200 %s document', contentType => {
    expect(() => assertSecDocumentResponse(response(200, contentType))).not.toThrow();
  });

  it('tolerates a missing content-type header on a 200 (pre-2001 archive quirks)', () => {
    expect(() => assertSecDocumentResponse(response(200))).not.toThrow();
  });
});

describe('looksLikeSecErrorText — cached-poison detection (audit R1)', () => {
  it('flags a short cached SEC error page', () => {
    const page = 'SEC.gov — Your Request Originated from an Undeclared Automated Tool. Please declare your traffic.';
    expect(looksLikeSecErrorText(page)).toContain('Undeclared Automated Tool');
  });

  it('never flags a full filing that quotes the phrase', () => {
    const filing = 'x'.repeat(6000) + ' the SEC notice "Request Rate Threshold Exceeded" appeared in our logs ';
    expect(looksLikeSecErrorText(filing)).toBeNull();
  });

  it('passes clean extracted text through', () => {
    expect(looksLikeSecErrorText('Annual report discussing goodwill impairment charges for fiscal 2026.')).toBeNull();
  });
});
