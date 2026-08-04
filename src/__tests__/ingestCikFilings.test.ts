import { describe, expect, it, vi } from 'vitest';
import {
  loadTargetedFilingRows,
  parseSubmissionArrays,
  type SubmissionJsonFetcher,
} from '../../scripts/ingest-cik-filings';

const cik = 320193;
const mainUrl = 'https://data.sec.gov/submissions/CIK0000320193.json';

function filingArrays(rows: Array<{ accession: string; date: string; form: string }>) {
  return {
    accessionNumber: rows.map(row => row.accession),
    filingDate: rows.map(row => row.date),
    form: rows.map(row => row.form),
  };
}

function mainDocument(options?: {
  recent?: ReturnType<typeof filingArrays>;
  files?: Array<{ name: string; filingFrom: string; filingTo: string; filingCount: number }>;
}) {
  return {
    cik: String(cik),
    name: 'Apple Inc.',
    filings: {
      recent: options?.recent || filingArrays([]),
      files: options?.files || [],
    },
  };
}

describe('targeted CIK archive completeness', () => {
  it('fetches every archive whose range overlaps the floor and skips older archives', async () => {
    const requiredArchive = 'CIK0000320193-submissions-001.json';
    const fetchJson = vi.fn<SubmissionJsonFetcher>(async url => {
      if (url === mainUrl) {
        return mainDocument({
          recent: filingArrays([
            { accession: '0000320193-26-000002', date: '2026-07-31', form: '8-K' },
          ]),
          files: [
            { name: 'CIK0000320193-submissions-002.json', filingFrom: '2000-01-01', filingTo: '2009-12-31', filingCount: 1 },
            { name: requiredArchive, filingFrom: '2010-01-01', filingTo: '2019-12-31', filingCount: 1 },
          ],
        });
      }
      if (url.endsWith(requiredArchive)) {
        return filingArrays([
          { accession: '0000320193-15-000001', date: '2015-03-01', form: '10-K' },
        ]);
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const rows = await loadTargetedFilingRows(cik, '2010-01-01', fetchJson);

    expect(fetchJson.mock.calls.map(call => call[0])).toEqual([
      mainUrl,
      `https://data.sec.gov/submissions/${requiredArchive}`,
    ]);
    expect(rows.map(row => row.accession)).toEqual([
      '0000320193-26-000002',
      '0000320193-15-000001',
    ]);
  });

  it('rejects inconsistent parallel arrays in the recent block', async () => {
    const fetchJson = vi.fn<SubmissionJsonFetcher>(async () => ({
      ...mainDocument(),
      filings: {
        recent: {
          accessionNumber: ['0000320193-26-000002'],
          filingDate: [],
          form: ['8-K'],
        },
        files: [],
      },
    }));

    await expect(loadTargetedFilingRows(cik, '2010-01-01', fetchJson))
      .rejects.toThrow('inconsistent lengths (1/0/1)');
  });

  it('rejects an invalid required archive payload instead of silently ingesting recent only', async () => {
    const archive = 'CIK0000320193-submissions-001.json';
    const fetchJson = vi.fn<SubmissionJsonFetcher>(async url => {
      if (url === mainUrl) {
        return mainDocument({
          recent: filingArrays([
            { accession: '0000320193-26-000002', date: '2026-07-31', form: '8-K' },
          ]),
          files: [{ name: archive, filingFrom: '2010-01-01', filingTo: '2019-12-31', filingCount: 1 }],
        });
      }
      return { accessionNumber: [], filingDate: [], form: ['10-K'] };
    });

    await expect(loadTargetedFilingRows(cik, '2010-01-01', fetchJson))
      .rejects.toThrow(`archive ${archive} filing arrays have inconsistent lengths`);
  });

  it('rejects a parallel but truncated archive page against its declared filingCount', async () => {
    const archive = 'CIK0000320193-submissions-001.json';
    const fetchJson = vi.fn<SubmissionJsonFetcher>(async url => (
      url === mainUrl
        ? mainDocument({
            files: [{
              name: archive,
              filingFrom: '2010-01-01',
              filingTo: '2019-12-31',
              filingCount: 2,
            }],
          })
        : filingArrays([
            { accession: '0000320193-15-000001', date: '2015-03-01', form: '10-K' },
          ])
    ));

    await expect(loadTargetedFilingRows(cik, '2010-01-01', fetchJson))
      .rejects.toThrow(`archive ${archive} returned 1/2 declared filings`);
  });

  it('propagates a required archive fetch failure and writes no partial result', async () => {
    const archive = 'CIK0000320193-submissions-001.json';
    const fetchJson = vi.fn<SubmissionJsonFetcher>(async url => {
      if (url === mainUrl) {
        return mainDocument({
          files: [{ name: archive, filingFrom: '2010-01-01', filingTo: '2019-12-31', filingCount: 0 }],
        });
      }
      throw new Error('SEC archive unavailable');
    });

    await expect(loadTargetedFilingRows(cik, '2010-01-01', fetchJson))
      .rejects.toThrow('SEC archive unavailable');
  });

  it('deduplicates an accession repeated across recent and archive pages', async () => {
    const archive = 'CIK0000320193-submissions-001.json';
    const duplicate = { accession: '0000320193-20-000001', date: '2020-01-02', form: '10-K' };
    const fetchJson = vi.fn<SubmissionJsonFetcher>(async url => (
      url === mainUrl
        ? mainDocument({
            recent: filingArrays([duplicate]),
            files: [{ name: archive, filingFrom: '2010-01-01', filingTo: '2020-01-02', filingCount: 1 }],
          })
        : filingArrays([duplicate])
    ));

    const rows = await loadTargetedFilingRows(cik, '2010-01-01', fetchJson);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      accession: duplicate.accession,
      form: '10-K',
      root_form: '10-K',
      is_amendment: false,
    });
  });

  it('rejects conflicting metadata for a duplicate accession', async () => {
    const archive = 'CIK0000320193-submissions-001.json';
    const fetchJson = vi.fn<SubmissionJsonFetcher>(async url => (
      url === mainUrl
        ? mainDocument({
            recent: filingArrays([
              { accession: '0000320193-20-000001', date: '2020-01-02', form: '10-K' },
            ]),
            files: [{ name: archive, filingFrom: '2010-01-01', filingTo: '2020-01-02', filingCount: 1 }],
          })
        : filingArrays([
            { accession: '0000320193-20-000001', date: '2020-01-03', form: '10-K/A' },
          ])
    ));

    await expect(loadTargetedFilingRows(cik, '2010-01-01', fetchJson))
      .rejects.toThrow('conflicting duplicate accession');
  });

  it('applies the date floor and product form exclusions after merging every page', async () => {
    const fetchJson = vi.fn<SubmissionJsonFetcher>(async () => mainDocument({
      recent: filingArrays([
        { accession: '0000320193-09-000001', date: '2009-12-31', form: '10-K' },
        { accession: '0000320193-26-000001', date: '2026-07-30', form: '13F-HR' },
        { accession: '0000320193-26-000002', date: '2026-07-31', form: '8-K/A' },
      ]),
    }));

    const rows = await loadTargetedFilingRows(cik, '2010-01-01', fetchJson);

    expect(rows).toEqual([expect.objectContaining({
      accession: '0000320193-26-000002',
      form: '8-K/A',
      root_form: '8-K',
      is_amendment: true,
    })]);
  });

  it('rejects malformed filing fields before they can be filtered away', () => {
    expect(() => parseSubmissionArrays({
      accessionNumber: ['bad-accession'],
      filingDate: ['2026-02-30'],
      form: [''],
    }, 'fixture')).toThrow('accessionNumber[0] is malformed');
  });
});
