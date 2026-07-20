import { describe, expect, it } from 'vitest';

import { buildCsv, escapeCsvCell } from '../components/tables/ResultsToolbar';
import {
  buildSecTargetUrl,
  sanitizeSecHtml,
  SecUpstreamError,
  validateSecRedirect,
} from '../lib/sec-upstream';
import { sanitizeAgentActionInput } from '../services/agentPlanner';
import { sanitizeFilingHtml } from '../services/filingExport';
import {
  buildStorageScope,
  scopedStorageKey,
  setActiveBrowserStorageScope,
} from '../services/storageNamespace';

describe('security hardening', () => {
  it('neutralizes spreadsheet formulas while preserving RFC-style CSV quoting', () => {
    expect(escapeCsvCell('=HYPERLINK("https://evil.test")')).toBe(`"'=HYPERLINK(""https://evil.test"")"`);
    expect(escapeCsvCell(' \t-2+3')).toBe("' \t-2+3");
    expect(buildCsv([{ value: '@SUM(1,2)', note: 'line\n"quoted"' }], [
      { key: 'value', header: 'Value' },
      { key: 'note', header: 'Note' },
    ])).toBe('Value,Note\r\n"\'@SUM(1,2)","line\n""quoted"""');
  });

  it('removes executable and non-SEC content from filing exports', () => {
    const sanitized = sanitizeFilingHtml(`
      <style>body{background:url(https://evil.test)}</style>
      <svg><script>alert(1)</script></svg>
      <p id="clobber" style="color:red" onclick="alert(1)">Safe text</p>
      <a href="javascript:alert(1)">bad</a>
      <a href="/Archives/edgar/data/1/good.htm">good</a>
      <img src="https://evil.test/pixel.png" onerror="alert(1)">
    `, 'https://www.sec.gov/Archives/edgar/data/1/source.htm');

    expect(sanitized).toContain('Safe text');
    expect(sanitized).toContain('https://www.sec.gov/Archives/edgar/data/1/good.htm');
    expect(sanitized).not.toMatch(/script|svg|onclick|onerror|javascript:|evil\.test|style=|id=/i);
  });

  it('enforces exact SEC upstream targets and rejects redirect escapes', () => {
    expect(() => buildSecTargetUrl('proxy', '%2e%2e/private', new URLSearchParams())).toThrow(SecUpstreamError);
    expect(() => buildSecTargetUrl('proxy', 'admin', new URLSearchParams())).toThrow(SecUpstreamError);
    expect(() => buildSecTargetUrl(
      'proxy',
      'rules-regulations/staff-guidance',
      new URLSearchParams({ url: 'https://evil.test' })
    )).toThrow(SecUpstreamError);
    expect(() => validateSecRedirect(new URL('https://evil.test/Archives/edgar/data/1/a.htm'), 'proxy'))
      .toThrow(SecUpstreamError);
    expect(() => validateSecRedirect(
      new URL('https://www.sec.gov/Archives/edgar/data/1/a.htm?url=https://evil.test'),
      'proxy'
    )).toThrow(SecUpstreamError);

    expect(buildSecTargetUrl(
      'proxy',
      'Archives/edgar/data/1/a.htm',
      new URLSearchParams()
    ).toString()).toBe('https://www.sec.gov/Archives/edgar/data/1/a.htm');
  });

  it('sanitizes proxied SEC HTML and retains inert filing structure', () => {
    const result = sanitizeSecHtml(`
      <script>alert(1)</script>
      <form action="https://evil.test"><input name="x"></form>
      <p onclick="alert(1)">Disclosure</p>
      <a href="javascript:alert(1)">bad</a>
      <a href="/Archives/edgar/data/1/a.htm">good</a>
    `, new URL('https://www.sec.gov/Archives/edgar/data/1/source.htm'));

    expect(result).toContain('Disclosure');
    expect(result).toContain('https://www.sec.gov/Archives/edgar/data/1/a.htm');
    expect(result).not.toMatch(/<script|<form|<input|onclick|javascript:/i);
  });

  it('drops undeclared model tool fields and clamps bounded inputs', () => {
    const input = sanitizeAgentActionInput('set_compare_cohort', {
      tickers: ['aapl', 'INVALID/TICKER', 'MSFT'],
      companyHints: Array.from({ length: 30 }, (_, index) => `Issuer ${index}`),
      maxCompanies: 99,
      viewMode: 'shell-command',
      selectedSection: 'x'.repeat(500),
      __proto__: { polluted: true },
      command: 'rm -rf /',
    });

    expect(input.tickers).toEqual(['AAPL', 'MSFT']);
    expect(input.companyHints).toHaveLength(10);
    expect(input.maxCompanies).toBe(10);
    expect(input.selectedSection).toHaveLength(300);
    expect(input).not.toHaveProperty('viewMode');
    expect(input).not.toHaveProperty('command');
    expect({}).not.toHaveProperty('polluted');
  });

  it('separates browser data by both user and organization', () => {
    const first = buildStorageScope('user_1', 'org_1');
    const second = buildStorageScope('user_1', 'org_2');
    setActiveBrowserStorageScope(first);
    const firstKey = scopedStorageKey('vara.watchlist.v1');
    setActiveBrowserStorageScope(second);
    const secondKey = scopedStorageKey('vara.watchlist.v1');

    expect(firstKey).not.toBe(secondKey);
    expect(firstKey).toContain('vara.watchlist.v1');
    expect(secondKey).toContain('vara.watchlist.v1');
  });
});
