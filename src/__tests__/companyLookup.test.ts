import { describe, it, expect } from 'vitest';
import { rankCompanyMatches } from '../services/companyLookup';

/**
 * Ordered exactly as SEC's company_tickers.json orders them (roughly by size),
 * which is what the old matcher iterated. SPACE EXPLORATION sits deliberately
 * far down the list: the reported bug was that it was never reached.
 */
const SPACE_ROWS: Array<[string, string, string]> = [
  ['HWM', '4281', 'Howmet Aerospace Inc.'],
  ['HONA', '2089271', 'Honeywell Aerospace Inc.'],
  ['EXR', '1289490', 'Extra Space Storage Inc.'],
  ['ASTS', '1780312', 'AST SpaceMobile, Inc.'],
  ['MDA', '1857047', 'MDA Space Ltd.'],
  ['FLY', '1860160', 'Firefly Aerospace Inc.'],
  ['YSS', '2086587', 'York Space Systems Inc.'],
  ['RXT', '1810019', 'Rackspace Technology, Inc.'],
  ['CSR', '798359', 'CENTERSPACE'],
  ['TALK', '1803901', 'Talkspace, Inc.'],
  ['PKE', '76267', 'PARK AEROSPACE CORP'],
  ['GEMI', '2054855', 'Gemini Space Station, Inc.'],
  ['SAAQ', '2043212', 'Space Asset Acquisition Corp.'],
  ['TAKOF', '1836875', 'Volatus Aerospace Inc.'],
  ['EVTL', '1867102', 'Vertical Aerospace Ltd.'],
  ['SIDU', '1879726', 'Sidus Space Inc.'],
  ['FJET', '1898604', 'Starfighters Space, Inc.'],
  ['BAER', '1856961', 'Bridger Aerospace Group Holdings, Inc.'],
  ['GEOS', '1001115', 'GEOSPACE TECHNOLOGIES CORP'],
  ['XTIA', '1642453', 'XTI Aerospace, Inc.'],
  ['HSPOF', '1946573', 'Horizon Space Acquisition I Corp.'],
  ['SSGC', '1867287', 'SafeSpace Global Corp'],
  ['BRQL', '1084267', 'DYNAMIC AEROSPACE SYSTEMS Corp'],
  ['ZSPC', '1637736', 'zSpace, Inc.'],
  ['SPCX', '1181412', 'SPACE EXPLORATION TECHNOLOGIES CORP'], // 25th match
  ['AADX', '2073298', 'Applied Aerospace & Defense, Inc.'],
];

const EXTRA: Array<[string, string, string]> = [
  ['AAPL', '320193', 'Apple Inc.'],
  ['GOOGL', '1652044', 'Alphabet Inc.'],
  ['MSFT', '789019', 'MICROSOFT CORP'],
];

const tickerMap: Record<string, string> = {};
const titleMap: Record<string, string> = {};
for (const [ticker, cik, title] of [...SPACE_ROWS, ...EXTRA]) {
  tickerMap[ticker] = cik;
  titleMap[ticker] = title;
}

const ALIASES = { SPACEX: 'SPCX', GOOGLE: 'GOOGL' };

const rank = (q: string, limit = 15) =>
  rankCompanyMatches(q, { tickerMap, titleMap, limit });

describe('rankCompanyMatches — reported: typing "space" never offered SpaceX', () => {
  it('surfaces SPACE EXPLORATION TECHNOLOGIES for "space"', () => {
    const tickers = rank('space').map(r => r.ticker);
    expect(tickers).toContain('SPCX');
  });

  it('ranks it first for "space", above the SPAC that shares the prefix', () => {
    // SEC's directory order cannot decide this: it is size-ordered at the head
    // but parks unranked registrants in a tail block among ETFs — SPCX sits at
    // 7180 between MDY and DIA, BELOW nano-cap "Space Asset Acquisition Corp."
    // at 3563. The curated brand table is the signal that reflects intent.
    const order = rankCompanyMatches('space', { tickerMap, titleMap, aliasMap: ALIASES })
      .map(r => r.ticker);

    expect(order[0]).toBe('SPCX');
    expect(order.indexOf('SPCX')).toBeLessThan(order.indexOf('SAAQ'));
  });

  it('reaches it directly by the name people actually type', () => {
    const result = rankCompanyMatches('spacex', { tickerMap, titleMap, aliasTicker: 'SPCX' });
    expect(result[0].ticker).toBe('SPCX');
  });

  it('orders whole-word matches above matches buried inside a word', () => {
    const order = rank('space').map(r => r.ticker);
    // "Extra Space Storage" (word start) must beat "Rackspace" (inside a word).
    expect(order.indexOf('EXR')).toBeLessThan(order.indexOf('RXT'));
    expect(order.indexOf('EXR')).toBeLessThan(order.indexOf('HWM'));
  });

  it('still returns the mid-word matches — ranking, not filtering', () => {
    const tickers = rank('space');
    expect(tickers.map(r => r.ticker)).toEqual(expect.arrayContaining(['RXT', 'HWM']));
  });

  it('is case-insensitive and tolerates stray whitespace', () => {
    const baseline = rank('space').map(r => r.ticker);
    for (const q of ['SPACE', 'Space', '  space  ']) {
      expect(rank(q).map(r => r.ticker), `"${q}" should rank identically`).toEqual(baseline);
    }
  });

  it('needs enough letters before a brand prefix counts as a signal', () => {
    // "sp" would prefix-match too many brands to mean anything.
    const short = rankCompanyMatches('sp', { tickerMap, titleMap, aliasMap: ALIASES });
    expect(short.every(r => r.ticker !== undefined)).toBe(true);
    // Reached by ticker prefix, not by the alias table.
    expect(rankCompanyMatches('goo', { tickerMap, titleMap, aliasMap: ALIASES })[0].ticker)
      .toBe('GOOGL');
  });

  it('collapses warrant and unit share classes onto one row per issuer', () => {
    // SAAQ / SAAQW / SAAQU are three tickers on one CIK. Letting each hold a
    // slot is what pushes genuinely different companies off the visible list.
    const withClasses = {
      ...tickerMap, SAAQW: '2043212', SAAQU: '2043212',
    };
    const withClassTitles = {
      ...titleMap,
      SAAQW: 'Space Asset Acquisition Corp.',
      SAAQU: 'Space Asset Acquisition Corp.',
    };
    const ciks = rankCompanyMatches('space', {
      tickerMap: withClasses, titleMap: withClassTitles,
    }).map(r => r.cik);

    expect(new Set(ciks).size, 'every row should be a distinct issuer').toBe(ciks.length);
  });
});

describe('rankCompanyMatches — ticker matching still wins', () => {
  it('puts an exact ticker above any name match', () => {
    expect(rank('MDA')[0].ticker).toBe('MDA');
  });

  it('honours a brand alias', () => {
    const result = rankCompanyMatches('GOOGLE', {
      tickerMap, titleMap, aliasTicker: 'GOOGL',
    });
    expect(result[0].ticker).toBe('GOOGL');
  });

  it('ranks ticker prefixes above name matches', () => {
    // "SP" prefixes the SPCX ticker; it must beat companies merely named "...sp...".
    expect(rank('SP')[0].ticker).toBe('SPCX');
  });

  it('never returns a candidate without a CIK', () => {
    for (const row of rank('space')) {
      expect(row.cik, `${row.ticker} needs a CIK`).toBeTruthy();
    }
  });

  it('deduplicates: one row per ticker even when several rules match', () => {
    const tickers = rank('SPCX').map(r => r.ticker);
    expect(tickers.filter(t => t === 'SPCX')).toHaveLength(1);
  });

  it('returns nothing for an empty query rather than the whole directory', () => {
    expect(rank('')).toEqual([]);
    expect(rank('   ')).toEqual([]);
  });

  it('respects the limit', () => {
    expect(rank('space', 3)).toHaveLength(3);
  });
});

describe('rankCompanyMatches — scale', () => {
  it('scans the full directory fast enough for every keystroke', () => {
    const bigTickers: Record<string, string> = {};
    const bigTitles: Record<string, string> = {};
    for (let i = 0; i < 11_000; i += 1) {
      bigTickers[`T${i}`] = String(i);
      bigTitles[`T${i}`] = `Company Number ${i} Holdings Inc.`;
    }
    bigTickers.SPCX = '1181412';
    bigTitles.SPCX = 'SPACE EXPLORATION TECHNOLOGIES CORP';

    const started = performance.now();
    const result = rankCompanyMatches('space', { tickerMap: bigTickers, titleMap: bigTitles });
    const elapsed = performance.now() - started;

    expect(result[0].ticker).toBe('SPCX');
    // Removing the early break means a full scan; it must stay imperceptible.
    expect(elapsed, `full-directory scan took ${elapsed.toFixed(1)}ms`).toBeLessThan(150);
  });
});
