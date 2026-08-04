import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseCsv } from 'csv-parse/sync';
import {
  CORE_FORMS,
  fetchQuarterIndex,
  getQuartersInRange,
  isValidEdgarDate,
  matchesFormFamilies,
  parseFormFamilies,
  parseMasterIndex,
  shouldIngestTargetedCikForm,
  validateMasterIndexDocument,
} from '../../data-pipeline/edgar-index';
import {
  auditorCsvParseOptions,
  parseUsDate,
  canonicalFirm,
  KNOWN_AUDITOR_REPORT_TYPES,
  MAX_PRODUCTION_AUDITOR_SKIPPED_ROWS,
  MAX_PRODUCTION_AUDITOR_SKIPPED_RATIO,
  MIN_PRODUCTION_AUDITOR_ROWS,
  MIN_PRODUCTION_LATEST_AUDITOR_ROWS,
  MIN_PRODUCTION_ORDINARY_ISSUER_ROWS,
  normalizeAndValidateAuditorHeaders,
  ORDINARY_ISSUER_REPORT_TYPE,
  refreshAuditorViews,
  REQUIRED_AUDITOR_CSV_HEADERS,
  toAuditorRow,
  validateAuditorDatasetBeforeWrite,
  validateAuditorDatasetSummaryBeforeWrite,
  validateAuditorLoadMode,
} from '../../data-pipeline/load-auditors';
import { rethreadIngestedLetters } from '../../data-pipeline/ingest-letters';

const SAMPLE_IDX = [
  'Description:           Master Index of EDGAR Dissemination Feed',
  'CIK|Company Name|Form Type|Date Filed|Filename',
  '--------------------------------------------------------------------------------',
  '1000228|HENRY SCHEIN INC|DEF 14A|2026-04-08|edgar/data/1000228/0001193125-26-146317.txt',
  '1000275|ROYAL BANK OF CANADA|SCHEDULE 13G/A|2026-07-06|edgar/data/1000275/0001214659-26-008237.txt',
  '320193|Apple Inc.|10-K|2025-11-01|edgar/data/320193/0000320193-25-000123.txt',
  '320193|Impossible Date Corp|10-K|2026-02-30|edgar/data/320193/0000320193-26-000124.txt',
  'garbage line without pipes',
  'notanumber|Bad Co|10-K|2026-01-01|edgar/data/1/0000000001-26-000001.txt',
].join('\n');

describe('data-pipeline/edgar-index', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses pipe-delimited master.idx including multi-word forms', () => {
    const entries = parseMasterIndex(SAMPLE_IDX);
    expect(entries).toHaveLength(3);
    expect(entries[0].formType).toBe('DEF 14A');
    expect(entries[1].formType).toBe('SCHEDULE 13G/A');
    expect(entries[1].accessionNumber).toBe('0001214659-26-008237');
    expect(entries[2].cik).toBe(320193);
  });

  it('covers both SC 13D and SCHEDULE 13D spellings in the core form set', () => {
    expect(CORE_FORMS.has('SC 13D')).toBe(true);
    expect(CORE_FORMS.has('SCHEDULE 13D')).toBe(true);
    expect(CORE_FORMS.has('DEF 14A')).toBe(true);
  });

  it('keeps ownership reports and proposed-sale notices in routine metadata refreshes', () => {
    for (const family of ['3', '4', '5', '144']) {
      expect(CORE_FORMS.has(family), family).toBe(true);
      expect(CORE_FORMS.has(`${family}/A`), `${family}/A`).toBe(true);
    }
  });

  it('treats explicit backfill form filters as case-insensitive families', () => {
    const families = parseFormFamilies(' 3, 4/A,5,144 ');
    expect(families).toEqual(new Set(['3', '4', '5', '144']));
    expect(matchesFormFamilies('4', families!)).toBe(true);
    expect(matchesFormFamilies('4/A', families!)).toBe(true);
    expect(matchesFormFamilies('144/a', families!)).toBe(true);
    expect(matchesFormFamilies('10-K', families!)).toBe(false);
    expect(parseFormFamilies(undefined)).toBeNull();
  });

  it('retains ownership families in targeted CIK coverage backfills', () => {
    for (const form of ['3', '3/A', '4', '4/A', '5', '5/A', '144', '144/A']) {
      expect(shouldIngestTargetedCikForm(form), form).toBe(true);
    }
    expect(shouldIngestTargetedCikForm('13F-HR')).toBe(false);
    expect(shouldIngestTargetedCikForm('13f-nt/a')).toBe(false);
  });

  it('computes quarter ranges without Date-object timezone drift', () => {
    expect(getQuartersInRange('2026-01-01', '2026-07-19')).toEqual([
      { year: 2026, quarter: 1 },
      { year: 2026, quarter: 2 },
      { year: 2026, quarter: 3 },
    ]);
    expect(getQuartersInRange('2025-10-01', '2026-01-05')).toEqual([
      { year: 2025, quarter: 4 },
      { year: 2026, quarter: 1 },
    ]);
  });

  it('strictly rejects malformed and impossible EDGAR dates', () => {
    expect(isValidEdgarDate('2024-02-29')).toBe(true);
    for (const value of ['2026-2-01', '2026-02-30', '2025-02-29', '2026-13-01', 'not-a-date']) {
      expect(isValidEdgarDate(value), value).toBe(false);
      expect(() => getQuartersInRange(value, '2026-07-31')).toThrow(/Invalid start date/);
    }
    expect(() => getQuartersInRange('2026-01-01', '2026-04-31')).toThrow(/Invalid end date/);
  });

  it('rejects reversed metadata windows instead of returning a green empty range', () => {
    expect(() => getQuartersInRange('2026-08-01', '2026-07-31')).toThrow(
      'Invalid date range: start 2026-08-01 is after end 2026-07-31.'
    );
  });

  it('fails closed when an existing quarter returns 404', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));

    await expect(fetchQuarterIndex(2025, 4)).rejects.toThrow(
      /master index returned HTTP 404/i,
    );
  });

  it('permits only an explicitly future quarter to be absent', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));

    await expect(fetchQuarterIndex(2999, 1)).resolves.toEqual([]);
  });

  it('rejects malformed, truncated, and partially invalid HTTP-200 indexes', async () => {
    expect(() => validateMasterIndexDocument('<html>Request Rate Threshold Exceeded</html>'))
      .toThrow(/missing exact .* header/i);
    expect(() => validateMasterIndexDocument([
      'CIK|Company Name|Form Type|Date Filed|Filename',
      '--------------------------------------------------------------------------------',
    ].join('\n'))).toThrow(/no filing rows/i);
    expect(() => validateMasterIndexDocument([
      'CIK|Company Name|Form Type|Date Filed|Filename',
      '--------------------------------------------------------------------------------',
      '320193|Apple Inc.|10-K|2025-11-01|edgar/data/320193/0000320193-25-000123.txt',
      'malformed trailing row',
    ].join('\n'))).toThrow(/1 of 2 filing rows failed validation/i);
  });

  it('accepts a structurally complete master index response', async () => {
    const valid = [
      'Description: Master Index of EDGAR Dissemination Feed',
      'CIK|Company Name|Form Type|Date Filed|Filename',
      '--------------------------------------------------------------------------------',
      '320193|Apple Inc.|10-K|2025-11-01|edgar/data/320193/0000320193-25-000123.txt',
    ].join('\n');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(valid, {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })));

    await expect(fetchQuarterIndex(2025, 4)).resolves.toMatchObject([
      { cik: 320193, formType: '10-K', accessionNumber: '0000320193-25-000123' },
    ]);
  });
});

describe('data-pipeline/load-auditors', () => {
  it('fails closed when PCAOB renames, removes, duplicates, or empties a required CSV header', () => {
    const headers = [...REQUIRED_AUDITOR_CSV_HEADERS];
    expect(normalizeAndValidateAuditorHeaders(headers)).toEqual(headers);
    expect(() => normalizeAndValidateAuditorHeaders(
      headers.map(header => header === 'Audit Report Type' ? 'Report Type' : header)
    )).toThrow('missing required header(s): Audit Report Type');
    expect(() => normalizeAndValidateAuditorHeaders([...headers, 'Firm Name']))
      .toThrow('duplicate header(s): Firm Name');
    expect(() => normalizeAndValidateAuditorHeaders([...headers, '']))
      .toThrow('header 13 is empty');
  });

  it('rejects rows whose field count does not match the PCAOB header', () => {
    const truncatedCsv = [
      REQUIRED_AUDITOR_CSV_HEADERS.join(','),
      '1,1,248,KPMG LLP',
    ].join('\n');

    expect(() => parseCsv(truncatedCsv, auditorCsvParseOptions())).toThrow(/Invalid Record Length/);
  });

  it('parses PCAOB US-style timestamps and ISO dates', () => {
    expect(parseUsDate('1/31/2017 12:00:00 AM')).toBe('2017-01-31');
    expect(parseUsDate('12/4/2025 12:00:00 AM')).toBe('2025-12-04');
    expect(parseUsDate('2026-03-31')).toBe('2026-03-31');
    expect(parseUsDate('')).toBeNull();
    expect(parseUsDate(undefined)).toBeNull();
    expect(parseUsDate('02/29/2024')).toBe('2024-02-29');
    expect(parseUsDate('02/29/2025')).toBeNull();
    expect(parseUsDate('02/30/2025')).toBeNull();
    expect(parseUsDate('2025-13-01')).toBeNull();
    expect(parseUsDate('2025-01-01 trailing')).toBeNull();
  });

  it('canonicalizes network firm names and preserves others', () => {
    expect(canonicalFirm('Grant Thornton LLP')).toBe('Grant Thornton');
    expect(canonicalFirm('Ernst & Young LLP')).toBe('EY');
    expect(canonicalFirm('PricewaterhouseCoopers LLP')).toBe('PwC');
    expect(canonicalFirm('Cohen & Company, Ltd.')).toBe('Cohen & Company, Ltd.');
  });

  it('maps a Form AP record to a row with padded-CIK handling', () => {
    const row = toAuditorRow({
      'Form Filing ID': '42',
      'Latest Form AP Filing': '1',
      'Firm ID': '248',
      'Firm Name': 'KPMG LLP',
      'Firm Country': 'United States',
      'Issuer CIK': '0000320193',
      'Issuer Name': 'Apple Inc.',
      'Audit Report Type': ORDINARY_ISSUER_REPORT_TYPE,
      'Audit Fund Series': 'Series 1',
      'Audit Report Date': '10/30/2025 12:00:00 AM',
      'Fiscal Period End Date': '9/27/2025 12:00:00 AM',
      'Filing Date': '11/1/2025 12:00:00 AM',
    });
    expect(row).not.toBeNull();
    expect(row!.issuer_cik).toBe(320193);
    expect(row!.firm_canonical).toBe('KPMG');
    expect(row!.is_latest).toBe(true);
    expect(row!.audit_report_type).toBe(ORDINARY_ISSUER_REPORT_TYPE);
    expect(row!.audit_fund_series).toBe('Series 1');
    expect(row!.fiscal_period_end).toBe('2025-09-27');
  });

  it('fails closed on malformed PCAOB identifiers, flags, and nonblank dates', () => {
    const valid = {
      'Form Filing ID': '42',
      'Latest Form AP Filing': '1',
      'Firm ID': '248',
      'Firm Name': 'KPMG LLP',
      'Issuer CIK': '0000320193',
      'Audit Report Type': ORDINARY_ISSUER_REPORT_TYPE,
      'Audit Report Date': '10/30/2025',
    };

    expect(toAuditorRow({ ...valid, 'Form Filing ID': '42.5' })).toBeNull();
    expect(toAuditorRow({ ...valid, 'Form Filing ID': '-42' })).toBeNull();
    expect(toAuditorRow({ ...valid, 'Latest Form AP Filing': 'yes' })).toBeNull();
    expect(toAuditorRow({ ...valid, 'Firm ID': '248x' })).toBeNull();
    expect(toAuditorRow({ ...valid, 'Issuer CIK': '32abc0193' })).toBeNull();
    expect(toAuditorRow({ ...valid, 'Issuer CIK': '00000000000' })).toBeNull();
    expect(toAuditorRow({ ...valid, 'Audit Report Date': '02/30/2025' })).toBeNull();
    expect(toAuditorRow({
      ...valid,
      'Firm ID': '',
      'Issuer CIK': '',
      'Audit Report Date': '',
    })).toMatchObject({ firm_id: null, issuer_cik: null, audit_report_date: null });
  });

  it('requires complete recognized report-type coverage and ordinary-issuer rows before any write', () => {
    const ordinary = toAuditorRow({
      'Form Filing ID': '1',
      'Latest Form AP Filing': '1',
      'Firm Name': 'KPMG LLP',
      'Issuer CIK': '320193',
      'Audit Report Type': ORDINARY_ISSUER_REPORT_TYPE,
      'Audit Report Date': '10/30/2025',
    })!;
    const fundOnly = toAuditorRow({
      'Form Filing ID': '2',
      'Latest Form AP Filing': '1',
      'Firm Name': 'KPMG LLP',
      'Issuer CIK': '320193',
      'Audit Report Type': 'Investment Company',
      'Audit Report Date': '10/30/2025',
    })!;
    const benefitPlan = toAuditorRow({
      'Form Filing ID': '3',
      'Latest Form AP Filing': '1',
      'Firm Name': 'KPMG LLP',
      'Audit Report Type': 'Employee Benefit Plan',
    })!;

    expect(KNOWN_AUDITOR_REPORT_TYPES).toEqual([
      ORDINARY_ISSUER_REPORT_TYPE,
      'Investment Company',
      'Employee Benefit Plan',
    ]);
    expect(validateAuditorDatasetBeforeWrite(
      [ordinary, fundOnly, benefitPlan],
      { mode: 'fixture' },
    ))
      .toEqual({ ordinaryIssuerCoverage: 1 });
    expect(() => validateAuditorDatasetBeforeWrite([])).toThrow('zero valid auditor rows');
    expect(() => validateAuditorDatasetBeforeWrite([fundOnly]))
      .toThrow('zero latest ordinary-issuer Form AP rows');
    expect(() => validateAuditorDatasetBeforeWrite([
      ordinary,
      { ...fundOnly, audit_report_type: null },
    ])).toThrow('1/2 rows have a blank Audit Report Type');
    expect(() => validateAuditorDatasetBeforeWrite([
      ordinary,
      { ...fundOnly, audit_report_type: 'Issuer' },
    ])).toThrow('unrecognized Audit Report Type value(s): Issuer');
    expect(() => validateAuditorDatasetBeforeWrite(
      [ordinary, { ...ordinary }],
      { mode: 'fixture' },
    )).toThrow('duplicate Form Filing ID 1');
    expect(() => validateAuditorDatasetBeforeWrite(
      [{ ...ordinary, issuer_cik: 10_000_000_000 }],
      { mode: 'fixture' },
    )).toThrow('invalid Issuer CIK');
    expect(() => validateAuditorDatasetBeforeWrite(
      [{ ...ordinary, audit_report_date: '2025-02-30' }],
      { mode: 'fixture' },
    )).toThrow('invalid Audit Report Date');
    expect(() => validateAuditorDatasetBeforeWrite(
      [{ ...ordinary, is_latest: '1' as never }],
      { mode: 'fixture' },
    )).toThrow('invalid Latest Form AP Filing flag');
  });

  it('rejects a parseable one-row production file as truncated', () => {
    const ordinary = toAuditorRow({
      'Form Filing ID': '1',
      'Latest Form AP Filing': '1',
      'Firm Name': 'KPMG LLP',
      'Issuer CIK': '320193',
      'Audit Report Type': ORDINARY_ISSUER_REPORT_TYPE,
      'Audit Report Date': '10/30/2025',
    })!;

    expect(() => validateAuditorDatasetBeforeWrite([ordinary])).toThrow(
      `valid rows 1 < ${MIN_PRODUCTION_AUDITOR_ROWS.toLocaleString('en-US')}`
    );
  });

  it('rejects production-scale row counts with an excessive invalid/skip rate', () => {
    expect(() => validateAuditorDatasetSummaryBeforeWrite({
      sourceRowCount: 131_000,
      validRowCount: 130_000,
      skippedRowCount: 1_000,
      latestRowCount: 125_000,
      ordinaryIssuerCoverage: 70_000,
    })).toThrow('PCAOB CSV skipped 1,000/131,000 rows');
    expect(MAX_PRODUCTION_AUDITOR_SKIPPED_ROWS).toBe(250);
    expect(MAX_PRODUCTION_AUDITOR_SKIPPED_RATIO).toBe(0.001);
  });

  it('accepts a complete production-scale PCAOB summary', () => {
    expect(() => validateAuditorDatasetSummaryBeforeWrite({
      sourceRowCount: 155_269,
      validRowCount: 155_269,
      skippedRowCount: 0,
      latestRowCount: 149_652,
      ordinaryIssuerCoverage: 85_370,
    })).not.toThrow();
    expect([
      MIN_PRODUCTION_AUDITOR_ROWS,
      MIN_PRODUCTION_LATEST_AUDITOR_ROWS,
      MIN_PRODUCTION_ORDINARY_ISSUER_ROWS,
    ]).toEqual([125_000, 120_000, 65_000]);
  });

  it('allows a small dataset only through the explicit dry-run path', () => {
    const fundOnly = toAuditorRow({
      'Form Filing ID': '2',
      'Latest Form AP Filing': '1',
      'Firm Name': 'KPMG LLP',
      'Issuer CIK': '320193',
      'Audit Report Type': 'Investment Company',
      'Audit Report Date': '10/30/2025',
    })!;

    expect(validateAuditorDatasetBeforeWrite([fundOnly], {
      mode: 'dry-run',
      sourceRowCount: 1,
      skippedRowCount: 0,
    })).toEqual({ ordinaryIssuerCoverage: 0 });
  });

  it('allows row limits only for an explicitly bounded dry run', () => {
    expect(validateAuditorLoadMode(false, undefined, false)).toBe(0);
    expect(validateAuditorLoadMode(true, '25', true)).toBe(25);
    expect(() => validateAuditorLoadMode(false, '25', true))
      .toThrow('--limit is allowed only with --dry-run');
    expect(() => validateAuditorLoadMode(true, undefined, true))
      .toThrow('--limit must be a positive integer');
    expect(() => validateAuditorLoadMode(true, '1.5', true))
      .toThrow('--limit must be a positive integer');
  });

  it('fails the load when an authoritative materialized view cannot refresh', async () => {
    const client = {
      rpc: vi.fn()
        .mockResolvedValueOnce({ error: { message: 'statement timeout' } }),
    };

    await expect(refreshAuditorViews(client as never)).rejects.toThrow(
      'urc_auditor_periods_mat refresh failed after Form AP upsert: statement timeout'
    );
    expect(client.rpc.mock.calls.map(call => call[0])).toEqual([
      'urc_refresh_auditor_periods',
    ]);
  });

  it('refreshes temporal evidence before its current-issuer projection', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ error: null }) };

    await refreshAuditorViews(client as never);

    expect(client.rpc.mock.calls.map(call => call[0])).toEqual([
      'urc_refresh_auditor_periods',
      'urc_refresh_current_auditors',
    ]);
  });

  it('rejects records without an id or firm name', () => {
    expect(toAuditorRow({ 'Form Filing ID': '', 'Firm Name': 'X' })).toBeNull();
    expect(toAuditorRow({ 'Form Filing ID': '7', 'Firm Name': '' })).toBeNull();
  });
});

describe('data-pipeline/ingest-letters', () => {
  it('fails the ingest when the derived thread rebuild RPC fails', async () => {
    const client = {
      rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'statement timeout' } }),
    };

    await expect(rethreadIngestedLetters(client as never)).rejects.toThrow(
      'urc_thread_letters failed after comment-letter metadata upsert: statement timeout'
    );
  });

  it('returns the authoritative rethread count on success', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: 17, error: null }) };
    await expect(rethreadIngestedLetters(client as never)).resolves.toBe(17);
  });
});
