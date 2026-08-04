export interface SecCompanyDirectoryFixtureRow {
  cik_str: number | string;
  ticker: string;
  title: string;
}

export type SecCompanyDirectoryFixture = Record<string, SecCompanyDirectoryFixtureRow>;

const COMPLETE_DIRECTORY_SIZE = 10_000;
const FILLER_CIK_START = 9_000_000_000;

/**
 * Preserve the scenario-specific issuers at the start of an SEC-shaped
 * directory, then add deterministic, non-matching issuers until the fixture
 * meets the production full-directory integrity check.
 */
export function buildCompleteSecCompanyDirectory(
  knownRows: readonly SecCompanyDirectoryFixtureRow[],
): SecCompanyDirectoryFixture {
  if (knownRows.length > COMPLETE_DIRECTORY_SIZE) {
    throw new Error(`SEC company directory fixture exceeds ${COMPLETE_DIRECTORY_SIZE} rows`);
  }

  const rows: SecCompanyDirectoryFixtureRow[] = [];
  const ciks = new Set<string>();
  const tickers = new Set<string>();

  const addRow = (row: SecCompanyDirectoryFixtureRow) => {
    const cik = String(row.cik_str).trim();
    const ticker = row.ticker.trim().toUpperCase();
    const title = row.title.trim();
    if (!/^\d{1,10}$/.test(cik) || Number(cik) <= 0 || Number(cik) > 9_999_999_999) {
      throw new Error(`Invalid fixture CIK: ${row.cik_str}`);
    }
    if (!/^[A-Z0-9][A-Z0-9.-]{0,31}$/.test(ticker)) {
      throw new Error(`Invalid fixture ticker: ${row.ticker}`);
    }
    if (!title || title.length > 500 || /[\u0000-\u001F\u007F]/.test(title)) {
      throw new Error(`Invalid fixture company title for ${ticker}`);
    }
    if (ciks.has(String(Number(cik)))) throw new Error(`Duplicate fixture CIK: ${cik}`);
    if (tickers.has(ticker)) throw new Error(`Duplicate fixture ticker: ${ticker}`);

    ciks.add(String(Number(cik)));
    tickers.add(ticker);
    rows.push({ cik_str: Number(cik), ticker, title });
  };

  knownRows.forEach(addRow);

  let fillerIndex = 0;
  while (rows.length < COMPLETE_DIRECTORY_SIZE) {
    const suffix = String(fillerIndex).padStart(5, '0');
    const cik = FILLER_CIK_START + fillerIndex;
    fillerIndex += 1;
    if (ciks.has(String(cik))) continue;

    const ticker = `E2E${suffix}`;
    if (tickers.has(ticker)) continue;
    addRow({ cik_str: cik, ticker, title: `E2E Directory Padding ${suffix}` });
  }

  return Object.fromEntries(rows.map((row, index) => [String(index), row]));
}
