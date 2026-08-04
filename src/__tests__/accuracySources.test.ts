import { describe, expect, it, vi } from 'vitest';
import {
  auditorFromIxbrl,
  createSerializedRequestPacer,
  fetchDisclosureHtml,
} from '../../scripts/accuracy/sources';

describe('accuracy source extraction', () => {
  it('serializes concurrent SEC request starts under the courtesy interval', async () => {
    let clock = 1_000;
    const waits: number[] = [];
    const pace = createSerializedRequestPacer(100, () => clock, async milliseconds => {
      waits.push(milliseconds);
      clock += milliseconds;
    });

    await Promise.all([pace(), pace(), pace(), pace()]);

    expect(waits).toEqual([100, 100, 100]);
    expect(clock).toBe(1_300);
  });

  it('returns the exact alternate archive document selected for disclosure scoring', async () => {
    const primaryHtml = '<html><body><p>The annual report incorporates its financial statements.</p></body></html>';
    const exhibitHtml = `<html><body><p>${[
      'Significant accounting policies',
      'basis of presentation',
      'deferred tax',
      'accumulated depreciation',
    ].join('. ')}</p></body></html>`;
    const requested: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input instanceof Request ? input.url : input);
      requested.push(url);
      if (url.endsWith('/primary.htm')) return new Response(primaryHtml);
      if (url.endsWith('/index.json')) {
        return Response.json({
          directory: { item: [{ name: 'annual-report.htm', size: '9000' }] },
        });
      }
      if (url.endsWith('/annual-report.htm')) return new Response(exhibitHtml);
      return new Response('not found', { status: 404 });
    }));

    try {
      const resolved = await fetchDisclosureHtml('1234', '000000123426000001', 'primary.htm');
      expect(resolved).toEqual({ html: exhibitHtml, document: 'annual-report.htm' });
      expect(requested).toEqual([
        'https://www.sec.gov/Archives/edgar/data/1234/000000123426000001/primary.htm',
        'https://www.sec.gov/Archives/edgar/data/1234/000000123426000001/index.json',
        'https://www.sec.gov/Archives/edgar/data/1234/000000123426000001/annual-report.htm',
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads nested iXBRL auditor facts and decodes entities once', () => {
    const result = auditorFromIxbrl(`
      <html><body>
        <ix:nonNumeric name="dei:AuditorName">Ernst&#160;&amp; <span>Young</span>&#160;LLP</ix:nonNumeric>
        <ix:nonNumeric name="dei:AuditorFirmId">42</ix:nonNumeric>
      </body></html>
    `);

    expect(result).toEqual({ name: 'Ernst & Young LLP', firmId: '42' });
  });

  it('does not turn double-encoded markup into an element', () => {
    const result = auditorFromIxbrl(`
      <ix:nonNumeric name="dei:AuditorName">Safe &amp;lt;script&amp;gt; Firm</ix:nonNumeric>
    `);

    expect(result.name).toBe('Safe &lt;script&gt; Firm');
  });

  it('ignores ordinary HTML elements that impersonate auditor facts by name', () => {
    const result = auditorFromIxbrl(`
      <input name="dei:AuditorName" value="Injected Auditor">
      <div name="dei:AuditorName">Injected Auditor</div>
      <span name="dei:AuditorFirmId">999999</span>
      <ix:nonNumeric name="dei:AuditorName">Genuine Auditor LLP</ix:nonNumeric>
      <IX:NONNUMERIC name="dei:AuditorFirmId">77</IX:NONNUMERIC>
    `);

    expect(result).toEqual({ name: 'Genuine Auditor LLP', firmId: '77' });
  });

  it('rejects similarly named facts from other elements and namespaces', () => {
    const result = auditorFromIxbrl(`
      <ix:nonFraction name="dei:AuditorFirmId">123</ix:nonFraction>
      <other:nonNumeric name="dei:AuditorName">Namespace Impostor LLP</other:nonNumeric>
      <meta name="dei:AuditorName" content="Metadata Impostor LLP">
    `);

    expect(result).toEqual({ name: null, firmId: null });
  });
});
