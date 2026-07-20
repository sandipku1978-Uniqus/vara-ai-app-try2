import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  fetchSecNoActionLetters,
  fetchSecStaffGuidance,
  parseNoActionIndex,
  parseRulemakingIndex,
  parseStaffGuidanceIndex,
  searchInvestmentAdvisers,
} from '../services/officialSources';
import { fetchLitigationReleases, parseLitigationReleases } from '../services/secApi';

const fetchMock = vi.fn();

describe('official SEC source parsers', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('parses rulemaking status, file number, issue date, title, and canonical link', () => {
    const items = parseRulemakingIndex(`
      <table><tbody><tr>
        <td><time>July 16, 2026</time></td>
        <td>S7-2026-25</td>
        <td>Electronic Delivery<div class="division">Corporation Finance</div></td>
        <td><a class="info-button" href="/rules-regulations/2026/07/s7-2026-25#proposed">
          <span class="info-button__top">Proposed Rule</span>
          <div class="regulation-node-title">Electronic Delivery of Information</div>
          <div class="regulation-node-metadata">Release 33-11430</div>
        </a></td>
      </tr></tbody></table>
    `);

    expect(items).toEqual([expect.objectContaining({
      title: 'Electronic Delivery of Information',
      date: 'July 16, 2026',
      fileNumber: 'S7-2026-25',
      status: 'Proposed',
      division: 'Corporation Finance',
      url: 'https://www.sec.gov/rules-regulations/2026/07/s7-2026-25#proposed',
    })]);
  });

  it('parses official staff-guidance links and labels them nonbinding', () => {
    const items = parseStaffGuidanceIndex(`
      <div class="field--name-field-text"><ul><li>
        <a href="/rules-regulations/staff-guidance/accounting-bulletins">Staff Accounting Bulletins</a>
      </li></ul></div>
    `);

    expect(items[0]).toMatchObject({
      title: 'Staff Accounting Bulletins',
      status: 'Staff view — nonbinding',
      url: 'https://www.sec.gov/rules-regulations/staff-guidance/accounting-bulletins',
    });
  });

  it('uses only the chronological no-action list and retains division and date', () => {
    const items = parseNoActionIndex(`
      <div id="wex"><ul><li><a href="/not-chronological">Topic navigation</a></li></ul></div>
      <div id="wexchron"><ul><li>
        <a href="/files/corpfin/no-action/example.pdf">Example Requestor</a>, July 8, 2026
      </li></ul></div>
    `, 'Corporation Finance');

    expect(items).toEqual([expect.objectContaining({
      title: 'Example Requestor',
      date: 'July 8, 2026',
      type: 'No-action',
      division: 'Corporation Finance',
      url: 'https://www.sec.gov/files/corpfin/no-action/example.pdf',
    })]);
  });

  it('parses the legacy Investment Management chronology without including earlier alphabetical links', () => {
    const items = parseNoActionIndex(`
      <ul><li><a href="/alpha-entry.htm">Alphabetical Entry</a>, January 1, 2000</li></ul>
      <table><tr><td><a name="chron"></a>Chronological List</td></tr></table>
      <ul><li><a href="/divisions/investment/noaction/example.htm">Legacy Adviser</a>, March 4, 2003</li></ul>
      <a name="regulation"></a>
      <ul><li><a href="/later-entry.htm">Later Entry</a>, April 1, 2004</li></ul>
    `, 'Investment Management');

    expect(items).toEqual([expect.objectContaining({
      title: 'Legacy Adviser',
      date: 'March 4, 2003',
      division: 'Investment Management',
      url: 'https://www.sec.gov/divisions/investment/noaction/example.htm',
    })]);
  });

  it('fails when any configured no-action source drifts instead of hiding it behind another source', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<div id="wexchron"><ul><li><a href="/corp.htm">Corp Item</a>, July 1, 2026</li></ul></div>',
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<html><body>Unexpected Investment Management contract</body></html>',
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => '<h2 id="chron">Chronological</h2><ul><li><a href="/markets.htm">Markets Item</a>, July 2, 2026</li></ul>',
      });

    await expect(fetchSecNoActionLetters()).rejects.toThrow('Investment Management');
  });

  it('parses the current litigation-release table without treating attachment links as releases', () => {
    const items = parseLitigationReleases(`
      <table><tbody><tr class="pr-list-page-row">
        <td><time>March 27, 2026</time></td>
        <td>
          <div class="release-view__respondents"><a href="/enforcement-litigation/litigation-releases/lr-26510">FAT Brands, Inc.</a></div>
          <div class="view-table_subfield_release_number"><span class="view-table_subfield_value">LR-26510</span></div>
          <a href="/files/litigation/litreleases/2026/stip26510.pdf">Joint Stipulation</a>
        </td>
      </tr></tbody></table>
    `);

    expect(items).toEqual([{
      date: 'March 27, 2026',
      title: 'FAT Brands, Inc.',
      releaseNumber: 'LR-26510',
      url: 'https://www.sec.gov/enforcement-litigation/litigation-releases/lr-26510',
    }]);
  });

  it('maps the official IAPD firm response and constructs the official profile URL', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: {
          total: 21,
          hits: [{
            _source: {
              firm_source_id: '162379',
              firm_ia_full_sec_number: '802-76129',
              firm_name: 'BLACKROCK INVESTMENT MANAGEMENT (UK) LIMITED',
              firm_ia_scope: 'ACTIVE',
              firm_ia_disclosure_fl: 'Y',
              firm_ia_address_details: JSON.stringify({ officeAddress: { city: 'LONDON', country: 'United Kingdom' } }),
            },
          }],
        },
      }),
    });

    const result = await searchInvestmentAdvisers('BlackRock', 25);

    expect(String(fetchMock.mock.calls[0][0])).toContain('https://api.adviserinfo.sec.gov/search/firm?');
    expect(String(fetchMock.mock.calls[0][0])).toContain('query=BlackRock');
    expect(result).toEqual({
      total: 21,
      firms: [{
        crdNumber: '162379',
        secNumber: '802-76129',
        name: 'BLACKROCK INVESTMENT MANAGEMENT (UK) LIMITED',
        registrationScope: 'ACTIVE',
        hasDisclosures: true,
        city: 'LONDON',
        state: '',
        country: 'United Kingdom',
        url: 'https://adviserinfo.sec.gov/firm/summary/162379',
      }],
    });
  });

  it('treats an empty official index parse as source drift instead of a legitimate zero', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => '<html><body>Unexpected official page contract</body></html>',
    });

    await expect(fetchSecStaffGuidance()).rejects.toThrow('no parseable entries');
    await expect(fetchLitigationReleases()).rejects.toThrow('no parseable entries');
  });
});
