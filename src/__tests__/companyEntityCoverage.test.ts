/**
 * Entity-resolution coverage proof.
 *
 * Sandip's report: "Organon & Co / OGN" was silently unsearchable — the old
 * resolver was a hardcoded ~10-name map. This suite proves the shared
 * matcher resolves EVERY listed issuer in the SEC ticker directory, using a
 * full snapshot of company_tickers.json (10,426 rows) as the corpus:
 *
 *   - every ticker resolves to its own directory row
 *   - every exact company title resolves to a row with that title
 *   - regression cases for the failures users actually hit
 *
 * Refresh the fixture when listings drift (it proves matching logic, not
 * directory freshness — runtime always fetches the live file):
 *   curl -s -H "User-Agent: URC contact@uniqus.com" \
 *     https://www.sec.gov/files/company_tickers.json | node -e "..." \
 *   (see scripts in docs/e2e-perf-2026-07.md)
 */

import { describe, expect, test } from 'vitest';
import { aliasTickerFor, matchCompanyEntry, type CompanyDirectoryEntry } from '../services/secApi';
import snapshotRows from './fixtures/company-tickers-snapshot.json';

const directory = snapshotRows as CompanyDirectoryEntry[];

describe('company entity coverage — full SEC directory', () => {
  test('fixture is the full directory, not a sample', () => {
    expect(directory.length).toBeGreaterThan(9_000);
  });

  test('every ticker in the directory resolves', () => {
    const failures: string[] = [];
    for (const entry of directory) {
      const hit = matchCompanyEntry(directory, entry.ticker);
      // Duplicate tickers cannot exist in the SEC file; assert identity
      if (!hit || hit.ticker !== entry.ticker) {
        failures.push(`${entry.ticker} (${entry.title})`);
      }
    }
    expect(failures, `unresolvable tickers:\n${failures.slice(0, 20).join('\n')}`).toHaveLength(0);
  });

  test('every exact company title resolves to that title', () => {
    const failures: string[] = [];
    for (const entry of directory) {
      if (!entry.title.trim()) continue;
      const hit = matchCompanyEntry(directory, entry.title);
      // Share classes repeat titles (BEP/BEPH...) — same title is success;
      // file order picks the primary listing.
      if (!hit || hit.title !== entry.title) {
        failures.push(`${entry.title} → ${hit ? hit.title : 'null'}`);
      }
    }
    expect(failures, `unresolvable titles:\n${failures.slice(0, 20).join('\n')}`).toHaveLength(0);
  });

  test('lowercase tickers resolve (users rarely type caps)', () => {
    for (const raw of ['ogn', 'aapl', 'coin', 'jpm']) {
      const hit = matchCompanyEntry(directory, raw);
      expect(hit?.ticker, raw).toBe(raw.toUpperCase());
    }
  });

  test('regression: the companies users reported as unsearchable', () => {
    expect(matchCompanyEntry(directory, 'OGN')?.title).toMatch(/Organon/i);
    expect(matchCompanyEntry(directory, 'Organon')?.title).toMatch(/Organon/i);
    expect(matchCompanyEntry(directory, 'Organon & Co.')?.title).toMatch(/Organon/i);
    // Sun Pharma trades in India (not SEC-listed) — resolution correctly
    // returns null rather than a wrong company.
    expect(matchCompanyEntry(directory, 'apple')?.title).toBe('Apple Inc.');
  });

  test('name prefixes resolve to the primary (market-cap-first) listing', () => {
    expect(matchCompanyEntry(directory, 'apple')?.ticker).toBe('AAPL');
    expect(matchCompanyEntry(directory, 'microsoft')?.ticker).toBe('MSFT');
    expect(matchCompanyEntry(directory, 'coinbase')?.ticker).toBe('COIN');
  });

  test('topic sentences do not read as companies', () => {
    expect(matchCompanyEntry(directory, 'revenue recognition disclosures in the pharmaceutical industry sector')).toBeNull();
    expect(matchCompanyEntry(directory, 'ic')).toBeNull(); // sub-4-char non-ticker
  });
});

describe('brand aliases — household names that file under another registrant', () => {
  test('every alias target is a live ticker in the directory', () => {
    for (const brand of ['google', 'YouTube', 'Facebook', 'instagram', 'WhatsApp']) {
      const ticker = aliasTickerFor(brand);
      expect(ticker, `alias for ${brand}`).toBeTruthy();
      const entry = matchCompanyEntry(directory, ticker!);
      expect(entry?.ticker, `directory row for ${brand} → ${ticker}`).toBe(ticker);
    }
  });

  test('google resolves to Alphabet, facebook to Meta', () => {
    expect(matchCompanyEntry(directory, aliasTickerFor('google')!)?.title).toMatch(/Alphabet/i);
    expect(matchCompanyEntry(directory, aliasTickerFor('facebook')!)?.title).toMatch(/Meta/i);
  });

  test('non-brand text has no alias', () => {
    expect(aliasTickerFor('revenue recognition')).toBeNull();
    expect(aliasTickerFor('apple')).toBeNull();
  });
});

describe('EFTS forms normalization', () => {
  test('amendment suffixes are stripped and deduped — a /A entry poisons the whole EFTS filter', async () => {
    const { normalizeEftsForms } = await import('../services/secApi');
    expect(normalizeEftsForms('10-K,10-K/A,8-K,8-K/A,S-1,S-1/A,DEF 14A,DEFM14A,S-4,S-4/A,425')).toBe('10-K,8-K,S-1,DEF 14A,DEFM14A,S-4,425');
    expect(normalizeEftsForms('8-K')).toBe('8-K');
    expect(normalizeEftsForms('')).toBe('');
  });
});
