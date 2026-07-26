/**
 * Search-result export (Intelligize-benchmark D1: "Excel List" and "Extract
 * Company List").
 *
 * One workbook, three sheets:
 *   Results  — one row per validated filing, with provenance (match reason,
 *              section, snippet) and a direct EDGAR link.
 *   Issuers  — the extracted company list: unique issuers with tickers, CIK
 *              and how many of the shown filings are theirs.
 *   Coverage — what this export IS: the query as executed, the corpus total,
 *              and the validated window. A spreadsheet detached from the app
 *              must carry the same honesty the results pane shows, or a
 *              partial window silently becomes "the answer" in a workpaper.
 *
 * Row builders are pure and unit-tested; only the writer touches XLSX (lazy
 * import, client-only).
 */

import type { FilingResearchResult } from './filingResearch';
import type { SearchCandidateCoverage } from './secApi';
import { formatUpstreamTotal } from './searchCoverage';

export type SheetRows = Array<Array<string | number>>;

export interface ResultExportContext {
  query: string;
  mode: string;
  coverage: SearchCandidateCoverage | null;
  /** Active structured filters worth recording, already formatted as label: value. */
  filterSummary: string[];
}

const RESULT_HEADER = [
  'Filed', 'Form', 'Issuer', 'Tickers', 'CIK', 'Accession', 'Section',
  'Match basis', 'Auditor', 'Industry', 'Excerpt', 'EDGAR link',
];

export function buildResultRows(results: FilingResearchResult[]): SheetRows {
  return [
    RESULT_HEADER,
    ...results.map(result => [
      result.fileDate,
      result.formType,
      result.entityName,
      (result.tickers || []).join(', '),
      result.cik,
      result.accessionNumber,
      result.matchSectionPath || '',
      result.matchReason || '',
      result.registeredAuditor || result.auditor || '',
      result.sicDescription || result.sic || '',
      result.matchSnippet || '',
      result.filingUrl || '',
    ]),
  ];
}

export function buildIssuerRows(results: FilingResearchResult[]): SheetRows {
  const byCik = new Map<string, { name: string; tickers: Set<string>; cik: string; filings: number }>();
  for (const result of results) {
    const key = result.cik || result.entityName;
    const entry = byCik.get(key) || { name: result.entityName, tickers: new Set<string>(), cik: result.cik, filings: 0 };
    entry.filings += 1;
    for (const ticker of result.tickers || []) entry.tickers.add(ticker);
    byCik.set(key, entry);
  }
  return [
    ['Issuer', 'Tickers', 'CIK', 'Filings in result set'],
    ...Array.from(byCik.values())
      .sort((a, b) => b.filings - a.filings || a.name.localeCompare(b.name))
      .map(entry => [entry.name, Array.from(entry.tickers).join(', '), entry.cik, entry.filings]),
  ];
}

export function buildCoverageRows(context: ResultExportContext, shownCount: number): SheetRows {
  const rows: SheetRows = [
    ['Query as executed', context.query],
    ['Mode', context.mode],
    ['Validated filings in this export', shownCount],
  ];
  if (context.coverage) {
    rows.push(
      ['Filings matching upstream', `${formatUpstreamTotal(context.coverage)}`],
      ['Candidates examined', context.coverage.examined],
      ['Coverage', context.coverage.complete
        ? 'Complete — every upstream candidate was validated'
        : 'Partial candidate window — this export is a verified subset, not the full corpus'],
    );
  }
  for (const filter of context.filterSummary) rows.push(['Filter', filter]);
  rows.push(['Exported', new Date().toISOString()], ['Source', 'Uniqus Research Center — SEC EDGAR']);
  return rows;
}

/** Client-only: builds and downloads the workbook. */
export async function exportResultsWorkbook(
  results: FilingResearchResult[],
  context: ResultExportContext
): Promise<void> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.utils.book_new();

  const resultsSheet = XLSX.utils.aoa_to_sheet(buildResultRows(results));
  resultsSheet['!cols'] = [
    { wch: 11 }, { wch: 8 }, { wch: 34 }, { wch: 10 }, { wch: 10 }, { wch: 20 },
    { wch: 30 }, { wch: 26 }, { wch: 14 }, { wch: 26 }, { wch: 70 }, { wch: 44 },
  ];
  XLSX.utils.book_append_sheet(workbook, resultsSheet, 'Results');

  const issuerSheet = XLSX.utils.aoa_to_sheet(buildIssuerRows(results));
  issuerSheet['!cols'] = [{ wch: 34 }, { wch: 14 }, { wch: 10 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(workbook, issuerSheet, 'Issuers');

  const coverageSheet = XLSX.utils.aoa_to_sheet(buildCoverageRows(context, results.length));
  coverageSheet['!cols'] = [{ wch: 30 }, { wch: 80 }];
  XLSX.utils.book_append_sheet(workbook, coverageSheet, 'Coverage');

  XLSX.writeFile(workbook, `URC_search_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
