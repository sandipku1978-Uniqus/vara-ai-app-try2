import { describe, it, expect } from 'vitest';
import { extractDocumentTextFromHtml } from '../services/secApi';
import { extractDocumentTextFromHtmlServer } from '../lib/filingTextServer';
import { booleanQueryMatches } from '../utils/booleanSearch';

/**
 * The whole server-side caching plan rests on one property: text extracted on
 * the server must be byte-identical to text extracted in the browser. If it
 * drifts, cached text would silently change which filings match a query.
 *
 * These run the jsdom (browser) path and the linkedom (server) path over the
 * same HTML and require identical output.
 */

const SAMPLES: Array<{ name: string; html: string }> = [
  {
    name: 'adjacent block elements must not merge into one token',
    html: '<html><body><p>material</p><p>weakness</p></body></html>',
  },
  {
    name: 'table cells stay separate values',
    html: '<html><body><table><tr><td>Revenue</td><td>1,234</td></tr><tr><td>Cost</td><td>567</td></tr></table></body></html>',
  },
  {
    name: 'inline XBRL wrappers keep the sentence continuous',
    html: '<html><body><p>Net income of <ix:nonFraction name="us-gaap:NetIncomeLoss">1,234</ix:nonFraction> for the year.</p></body></html>',
  },
  {
    name: 'hidden XBRL metadata is dropped',
    html: '<html><body><ix:header><ix:hidden>SHOULD_NOT_APPEAR</ix:hidden></ix:header><p>Visible disclosure text.</p></body></html>',
  },
  {
    name: 'script and style never contribute text',
    html: '<html><body><script>var x="SCRIPT_TEXT";</script><style>.a{color:red}</style><p>Real text.</p></body></html>',
  },
  {
    name: 'line breaks and nested formatting',
    html: '<html><body><div>First line<br/>Second line</div><div><b>Bold</b> and <i>italic</i> inline.</div></body></html>',
  },
  {
    name: 'realistic filing fragment',
    html: `<html><body>
      <div><p>Item 9A. Controls and Procedures</p></div>
      <div><p>Management identified a <b>material weakness</b> in internal control
      over financial reporting related to information technology general controls.</p></div>
      <table><tr><th>Period</th><th>Amount</th></tr><tr><td>FY2026</td><td>$1.2M</td></tr></table>
      <p>Our auditor, <ix:nonNumeric name="dei:AuditorName">KPMG LLP</ix:nonNumeric>, issued an adverse opinion.</p>
    </body></html>`,
  },
];

describe('filing-text extraction is identical in browser and server', () => {
  for (const { name, html } of SAMPLES) {
    it(name, () => {
      expect(extractDocumentTextFromHtmlServer(html)).toBe(extractDocumentTextFromHtml(html));
    });
  }

  it('never merges tokens across block boundaries (the textContent hazard)', () => {
    const html = '<html><body><p>material</p><p>weakness</p></body></html>';
    const text = extractDocumentTextFromHtmlServer(html);

    // Naive textContent would yield "materialweakness" — one token, so neither
    // term would match and proximity would be meaningless.
    expect(text).not.toContain('materialweakness');
    expect(booleanQueryMatches('material', text)).toBe(true);
    expect(booleanQueryMatches('weakness', text)).toBe(true);
    expect(booleanQueryMatches('material w/2 weakness', text)).toBe(true);
  });

  it('keeps table cell values from merging', () => {
    const html = '<html><body><table><tr><td>Revenue</td><td>1234</td></tr></table></body></html>';
    const text = extractDocumentTextFromHtmlServer(html);
    expect(text).not.toContain('Revenue1234');
  });

  it('yields the same Boolean verdict from either extractor', () => {
    const html = SAMPLES[SAMPLES.length - 1].html;
    const queries = [
      '"material weakness"',
      'material w/5 weakness',
      'auditor AND KPMG',
      '"information technology" AND controls',
      'SCRIPT_TEXT',
    ];
    for (const query of queries) {
      expect(
        booleanQueryMatches(query, extractDocumentTextFromHtmlServer(html)),
        `verdict drift for ${query}`,
      ).toBe(booleanQueryMatches(query, extractDocumentTextFromHtml(html)));
    }
  });

  it('handles empty and malformed HTML without throwing', () => {
    for (const html of ['', '<html></html>', '<p>unclosed', '<<>>']) {
      expect(() => extractDocumentTextFromHtmlServer(html)).not.toThrow();
      expect(() => extractDocumentTextFromHtml(html)).not.toThrow();
    }
  });
});
