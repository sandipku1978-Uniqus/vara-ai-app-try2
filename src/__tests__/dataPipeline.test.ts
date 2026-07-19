import { describe, expect, it } from 'vitest';
import { parseMasterIndex, getQuartersInRange, CORE_FORMS } from '../../data-pipeline/edgar-index';
import { parseUsDate, canonicalFirm, toAuditorRow } from '../../data-pipeline/load-auditors';

const SAMPLE_IDX = [
  'Description:           Master Index of EDGAR Dissemination Feed',
  'CIK|Company Name|Form Type|Date Filed|Filename',
  '--------------------------------------------------------------------------------',
  '1000228|HENRY SCHEIN INC|DEF 14A|2026-04-08|edgar/data/1000228/0001193125-26-146317.txt',
  '1000275|ROYAL BANK OF CANADA|SCHEDULE 13G/A|2026-07-06|edgar/data/1000275/0001214659-26-008237.txt',
  '320193|Apple Inc.|10-K|2025-11-01|edgar/data/320193/0000320193-25-000123.txt',
  'garbage line without pipes',
  'notanumber|Bad Co|10-K|2026-01-01|edgar/data/1/0000000001-26-000001.txt',
].join('\n');

describe('data-pipeline/edgar-index', () => {
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
});

describe('data-pipeline/load-auditors', () => {
  it('parses PCAOB US-style timestamps and ISO dates', () => {
    expect(parseUsDate('1/31/2017 12:00:00 AM')).toBe('2017-01-31');
    expect(parseUsDate('12/4/2025 12:00:00 AM')).toBe('2025-12-04');
    expect(parseUsDate('2026-03-31')).toBe('2026-03-31');
    expect(parseUsDate('')).toBeNull();
    expect(parseUsDate(undefined)).toBeNull();
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
      'Audit Report Date': '10/30/2025 12:00:00 AM',
      'Fiscal Period End Date': '9/27/2025 12:00:00 AM',
      'Filing Date': '11/1/2025 12:00:00 AM',
    });
    expect(row).not.toBeNull();
    expect(row!.issuer_cik).toBe(320193);
    expect(row!.firm_canonical).toBe('KPMG');
    expect(row!.is_latest).toBe(true);
    expect(row!.fiscal_period_end).toBe('2025-09-27');
  });

  it('rejects records without an id or firm name', () => {
    expect(toAuditorRow({ 'Form Filing ID': '', 'Firm Name': 'X' })).toBeNull();
    expect(toAuditorRow({ 'Form Filing ID': '7', 'Firm Name': '' })).toBeNull();
  });
});
