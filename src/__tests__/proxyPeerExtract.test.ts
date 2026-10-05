import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  extractPeerGroupFromBlocks,
  isCompanyNameLike,
  parsePeerName,
  peerAnchorScore,
  proxyBlocksFromNode,
  splitNameList,
  type MinimalNode,
  type PeerGroupExtraction,
} from '../services/proxyPeerExtract';

/**
 * Real DEF 14As, trimmed to the peer-group section (header comment in each
 * fixture names the accession). Each one exercises a layout the extractor
 * has to survive: multi-column name grids, revenue columns with the issuer's
 * own row, bullets inside one cell, two groups side by side with two names
 * per cell, one-row bullet tables split by a page break, printed tickers,
 * a sentence list, stacked category headings — and two proxies that mention
 * a peer group without naming one.
 */

const FIXTURES = join(process.cwd(), 'src', '__tests__', 'fixtures', 'proxies');

function extract(file: string): PeerGroupExtraction | null {
  const html = readFileSync(join(FIXTURES, file), 'utf8');
  const document = new DOMParser().parseFromString(html, 'text/html');
  return extractPeerGroupFromBlocks(proxyBlocksFromNode(document.body as unknown as MinimalNode));
}

function names(result: PeerGroupExtraction | null): string[] {
  return result?.peers.map(peer => peer.name) ?? [];
}

describe('deterministic peer-group extraction on real proxies', () => {
  it('Apple 2026: a five-column grid under an in-table caption', () => {
    const result = extract('apple-2026.html');
    expect(result?.method).toBe('table');
    expect(names(result)).toEqual([
      'Alphabet', 'Cisco', 'Mastercard', 'NVIDIA', 'Verizon',
      'Amazon', 'Comcast', 'Meta', 'Oracle', 'Visa',
      'AT&T', 'Disney', 'Microsoft', 'Qualcomm', 'Warner Bros. Discovery',
      'Broadcom', 'Intel', 'Netflix', 'Salesforce',
    ]);
    expect(result?.anchorText).toBe('The chart below lists the companies in our 2025 primary peer group.');
    expect(result?.peers[0].group).toBe('2025 Primary Peer Group');
  });

  it('Intel 2026: names beside revenue columns, the issuer row and percentile row excluded', () => {
    const result = extract('intel-2026.html');
    expect(result?.method).toBe('table');
    const found = names(result);
    expect(found).toHaveLength(17);
    expect(found[0]).toBe('Advanced Micro Devices, Inc.');
    expect(found).toContain('Hewlett Packard Enterprise');
    expect(found).toContain('Texas Instruments Incorporated');
    expect(found).not.toContain('Intel');
    expect(found).not.toContain('Intel Percentile');
    expect(found.some(name => /\d/.test(name))).toBe(false);
  });

  it('Coca-Cola 2026: bullet lists inside cells, after the criteria rows, foreign registrants kept', () => {
    const result = extract('coca-cola-2026.html');
    expect(result?.method).toBe('table');
    const found = names(result);
    expect(found).toHaveLength(18);
    expect(found).toEqual(expect.arrayContaining(['Abbott Laboratories', 'Nestlé S.A.', 'Danone S.A.', 'Unilever PLC', 'The Procter & Gamble Company']));
    // Selection criteria above the caption row are not companies.
    expect(found.some(name => /size|brands|financially/i.test(name))).toBe(false);
    expect(result?.peers[0].group).toBe('2025 Compensation Comparator Group**');
  });

  it('Microsoft 2025: two captioned groups, two names per cell, each name keeps its group', () => {
    const result = extract('microsoft-2025.html');
    expect(result?.method).toBe('table');
    const found = names(result);
    expect(found).toHaveLength(24);
    expect(found.slice(0, 4)).toEqual(['Adobe', 'Alphabet', 'Amazon', 'Apple']);
    const group = (name: string) => result?.peers.find(peer => peer.name === name)?.group;
    expect(group('Nvidia')).toBe('Primary Peer Group – Technology');
    expect(group('Walt Disney')).toBe('Secondary Peer Group – General Industry');
  });

  it('U.S. Physical Therapy 2026: one bullet per table, across a page break, is a list', () => {
    const result = extract('us-physical-therapy-2026.html');
    expect(result?.method).toBe('list');
    expect(names(result)).toEqual([
      'Surgery Partners, Inc.', 'Astrana Health, Inc.', 'Concentra Group Holdings, Inc.', 'The Pennant Group, Inc.',
      'Corvel Corporation', 'Enhabit, Inc.', 'RadNet, Inc.', 'Addus HomeCare Corporation',
      'Cross Country Healthcare, Inc.', 'National Healthcare Corp.',
    ]);
    expect(result?.anchorText).toBe('The most recent targeted peer group consisted of the following companies:');
  });

  it('Etsy 2026: printed tickers are kept as resolution evidence', () => {
    const result = extract('etsy-2026.html');
    expect(result?.method).toBe('table');
    expect(result?.peers).toHaveLength(18);
    expect(result?.peers.find(peer => peer.name === 'eBay')).toMatchObject({ tickerHint: 'EBAY' });
    expect(result?.peers.find(peer => peer.name === 'Zillow Group')).toMatchObject({ tickerHint: 'Z' });
  });

  it('Costco 2025: a sentence list, ending at the sentence break after "Ltd."', () => {
    const result = extract('costco-2025.html');
    expect(result?.method).toBe('list');
    expect(names(result)).toEqual([
      'Walmart Inc.', 'The Home Depot, Inc.', "Lowe's Companies, Inc.", 'The TJX Companies, Inc.', 'Target Corporation',
      'The Kroger Company', 'Best Buy Inc.', "BJ's Wholesale Club Holdings, Inc.", 'CVS Health Corporation',
      'Ross Stores Inc.', 'Wesfarmers Ltd.',
    ]);
    expect(result?.anchorText).toMatch(/following peer companies:$/);
  });

  it('Starbucks 2026: category headings inside cells become group captions, not peers', () => {
    const result = extract('starbucks-2026.html');
    const found = names(result);
    expect(found).toHaveLength(19);
    expect(found).not.toContain('Consumer Staples');
    expect(found).not.toContain('Iconic Global Brand/Category Leaders');
    expect(result?.peers.find(peer => peer.name === 'PepsiCo, Inc.')?.group).toMatch(/— Consumer Staples$/);
  });

  it('Agilysys 2026: a TSR peer group defined by SIC code names no companies', () => {
    expect(extract('agilysys-2026.html')).toBeNull();
  });

  it('Cintas 2026: a passing mention beside an incentive table is not a peer list', () => {
    expect(extract('cintas-2026.html')).toBeNull();
  });
});

describe('name recognition', () => {
  it('strips bullets, footnote marks and printed tickers', () => {
    expect(parsePeerName('● QUALCOMM Incorporated*')).toEqual({ name: 'QUALCOMM Incorporated', tickerHint: null });
    expect(parsePeerName('Salesforce(1)')).toEqual({ name: 'Salesforce', tickerHint: null });
    expect(parsePeerName('eBay (EBAY)')).toEqual({ name: 'eBay', tickerHint: 'EBAY' });
    expect(parsePeerName('Axon Enterprise, Inc. (NASDAQ: AXON)')).toEqual({ name: 'Axon Enterprise, Inc.', tickerHint: 'AXON' });
  });

  it('rejects headings, figures, sentences and wrapped fragments', () => {
    for (const value of ['Company', 'Revenue ($ in billions)', '52.9', '36th', 'Intel Percentile', 'Target', 'Threshold',
      'We benchmark against these companies', 'BOARD OF', '2025 Peer Group', 'Market Capitalization']) {
      expect(isCompanyNameLike(value) && parsePeerName(value) !== null, value).toBe(value === 'Target');
    }
    for (const value of ['3M Company', 'AT&T', 'e.l.f. Beauty, Inc.', 'Yum! Brands, Inc.', 'Bank of America', 'iHeartMedia, Inc.']) {
      expect(isCompanyNameLike(value), value).toBe(true);
    }
  });

  it('splits a sentence list and re-attaches legal suffixes', () => {
    expect(splitNameList('Adobe Inc., Amazon.com, Inc., Cisco Systems, Inc., Intuit Inc. and Oracle Corporation')).toEqual([
      'Adobe Inc.', 'Amazon.com, Inc.', 'Cisco Systems, Inc.', 'Intuit Inc.', 'Oracle Corporation',
    ]);
    expect(splitNameList('Merck & Co., Inc.; Pfizer Inc.; Amgen Inc.; AbbVie Inc.')).toEqual([
      'Merck & Co., Inc.', 'Pfizer Inc.', 'Amgen Inc.', 'AbbVie Inc.',
    ]);
  });

  it('anchors the compensation group above a TSR or director-pay mention', () => {
    const compensation = peerAnchorScore('Our compensation peer group consisted of the following companies:');
    const tsr = peerAnchorScore('Relative TSR is measured against the S&P 500 Index peer group.');
    const director = peerAnchorScore('Non-employee director pay is compared with the peer group used for executive compensation.');
    expect(compensation).toBeGreaterThan(tsr);
    expect(compensation).toBeGreaterThan(director);
    expect(peerAnchorScore('The Committee reviewed base salaries.')).toBe(0);
  });
});
