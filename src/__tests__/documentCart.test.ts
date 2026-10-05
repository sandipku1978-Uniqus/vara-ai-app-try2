import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CART_LIMIT,
  addCartFiling,
  addToDocumentCart,
  cartAsCitations,
  cartAsResearchResults,
  cartContains,
  cartFilingId,
  cartTickers,
  clearDocumentCart,
  filingIndexUrl,
  getDocumentCart,
  removeCartFiling,
  subscribeDocumentCart,
  toggleCartFiling,
  toggleInDocumentCart,
  type CartFiling,
  type CartFilingInput,
} from '../services/documentCart';
import { scopedStorageKey, setActiveBrowserStorageScope } from '../services/storageNamespace';
import { buildResultRows } from '../services/resultExport';
import {
  chunkSliceText,
  collectSectionSlices,
  sliceFilingSection,
  sliceTextBlocks,
  type CollectDeps,
} from '../services/cartSectionExport';

const NOW = new Date('2026-10-04T00:00:00.000Z');

function input(overrides: Partial<CartFilingInput> = {}): CartFilingInput {
  return {
    cik: '320193',
    accessionNumber: '000032019326000001',
    company: 'Apple Inc.',
    form: '10-K',
    fileDate: '2026-01-30',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-2026.htm',
    origin: 'search',
    ...overrides,
  };
}

describe('cart state transitions', () => {
  it('adds a filing once, keyed by CIK and dashed accession whichever form the surface used', () => {
    const first = addCartFiling([], input(), NOW);
    expect(first.added).toBe(true);
    expect(first.items[0]).toMatchObject({ id: '320193:0000320193-26-000001', accessionNumber: '0000320193-26-000001', addedAt: NOW.toISOString() });

    const again = addCartFiling(first.items, input({ accessionNumber: '0000320193-26-000001', cik: '0000320193' }), NOW);
    expect(again.added).toBe(false);
    expect(again.reason).toBe('duplicate');
    expect(again.items).toHaveLength(1);
  });

  it('lets a later surface fill in a ticker or primary document the first one lacked', () => {
    const { items } = addCartFiling([], input({ origin: 'exhibit' }), NOW);
    const enriched = addCartFiling(items, input({ ticker: 'aapl', primaryDocument: 'aapl-2026.htm', origin: 'dossier' }), NOW);
    expect(enriched.items[0]).toMatchObject({ ticker: 'aapl', primaryDocument: 'aapl-2026.htm', origin: 'exhibit' });
  });

  it('rejects malformed identities and stops at the cart limit', () => {
    expect(addCartFiling([], input({ accessionNumber: 'not-an-accession' })).reason).toBe('invalid');
    expect(addCartFiling([], input({ cik: '' })).reason).toBe('invalid');

    let items: CartFiling[] = [];
    for (let index = 0; index < CART_LIMIT; index += 1) {
      items = addCartFiling(items, input({ accessionNumber: `0000320193-26-${String(index).padStart(6, '0')}` }), NOW).items;
    }
    const overflow = addCartFiling(items, input({ accessionNumber: '0000320193-27-000001' }), NOW);
    expect(overflow).toMatchObject({ added: false, reason: 'full' });
    expect(overflow.items).toHaveLength(CART_LIMIT);
  });

  it('toggles and removes', () => {
    const on = toggleCartFiling([], input(), NOW);
    expect(on.items).toHaveLength(1);
    expect(cartContains(on.items, '320193', '0000320193-26-000001')).toBe(true);
    const off = toggleCartFiling(on.items, input(), NOW);
    expect(off.items).toHaveLength(0);
    expect(removeCartFiling(on.items, cartFilingId('320193', '000032019326000001'))).toHaveLength(0);
  });

  it('collects unique tickers for Benchmarking and counts filings that had none', () => {
    let items: CartFiling[] = [];
    items = addCartFiling(items, input({ ticker: 'AAPL' }), NOW).items;
    items = addCartFiling(items, input({ ticker: 'aapl', accessionNumber: '0000320193-25-000001' }), NOW).items;
    items = addCartFiling(items, input({ cik: '789019', ticker: 'MSFT', accessionNumber: '0000789019-26-000001' }), NOW).items;
    items = addCartFiling(items, input({ cik: '1', ticker: undefined, accessionNumber: '0000000001-26-000001' }), NOW).items;
    expect(cartTickers(items)).toEqual({ tickers: ['AAPL', 'MSFT'], withoutTicker: 1 });
  });

  it('exports rows in the search-result workbook shape without inventing unobserved fields', () => {
    const { items } = addCartFiling([], input({ ticker: 'AAPL', description: 'Annual report', origin: 'dossier' }), NOW);
    const rows = buildResultRows(cartAsResearchResults(items));
    expect(rows[1]).toEqual([
      '2026-01-30', '10-K', 'Apple Inc.', 'AAPL', '320193', '0000320193-26-000001', '',
      'Selected from the issuer dossier', '', '', 'Annual report',
      'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-2026.htm',
    ]);
  });

  it('turns every cart filing into a memo citation carrying its link', () => {
    const { items } = addCartFiling([], input({ description: 'Annual report' }), NOW);
    expect(cartAsCitations(items)).toEqual([{
      kind: 'filing',
      cik: '320193',
      accessionNumber: '0000320193-26-000001',
      company: 'Apple Inc.',
      form: '10-K',
      fileDate: '2026-01-30',
      excerpt: 'Annual report',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-2026.htm',
    }]);
  });

  it('builds the filing index URL for a whole filing', () => {
    expect(filingIndexUrl('0000320193', '000032019326000001'))
      .toBe('https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/0000320193-26-000001-index.htm');
  });
});

describe('cart store', () => {
  beforeEach(() => {
    setActiveBrowserStorageScope('user:u1:org:personal');
    clearDocumentCart();
  });

  afterEach(() => {
    clearDocumentCart();
    setActiveBrowserStorageScope(null);
  });

  it('persists to sessionStorage under the identity scope and notifies subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDocumentCart(listener);
    addToDocumentCart(input());
    unsubscribe();

    expect(listener).toHaveBeenCalled();
    const key = scopedStorageKey('urc.document-cart.v1')!;
    const stored = JSON.parse(window.sessionStorage.getItem(key) || '[]') as CartFiling[];
    expect(stored.map(item => item.id)).toEqual(['320193:0000320193-26-000001']);
    expect(window.localStorage.getItem(key)).toBeNull();
  });

  it('does not show one identity\'s cart under another', () => {
    addToDocumentCart(input());
    setActiveBrowserStorageScope('user:u2:org:personal');
    expect(getDocumentCart()).toHaveLength(0);
    setActiveBrowserStorageScope('user:u1:org:personal');
    expect(getDocumentCart()).toHaveLength(1);
  });

  it('keeps selections made before the identity scope arrived', () => {
    clearDocumentCart();
    setActiveBrowserStorageScope(null);
    clearDocumentCart();
    addToDocumentCart(input());
    setActiveBrowserStorageScope('user:u3:org:personal');
    expect(getDocumentCart().map(item => item.id)).toEqual(['320193:0000320193-26-000001']);
    clearDocumentCart();
  });

  it('toggles through the store', () => {
    toggleInDocumentCart(input());
    expect(getDocumentCart()).toHaveLength(1);
    toggleInDocumentCart(input());
    expect(getDocumentCart()).toHaveLength(0);
  });
});

const TEN_K = [
  'PART I',
  'Item 1. Business',
  'We design and sell devices.',
  'Item 1A. Risk Factors',
  'Our supply chain is concentrated in a small number of regions.',
  'Item 1B. Unresolved Staff Comments',
  'None.',
  'Item 2. Properties',
  'We own our headquarters.',
].join('\n');

describe('cart bulk section download', () => {
  const filing = (overrides: Partial<CartFiling> = {}): CartFiling => ({
    ...addCartFiling([], input(), NOW).items[0],
    ...overrides,
  });

  it('slices with the shared taxonomy for the filing\'s own form', () => {
    const slice = sliceFilingSection(filing(), 'risk-factors', { ok: true, text: TEN_K }, 'aapl-2026.htm');
    expect(slice.status).toBe('extracted');
    expect(slice.text).toContain('supply chain is concentrated');
    expect(slice.text).not.toContain('headquarters');
  });

  it('exports the section in the filing\'s own case, punctuation and line breaks', () => {
    const slice = sliceFilingSection(filing(), 'risk-factors', { ok: true, text: TEN_K }, 'aapl-2026.htm');
    expect(slice.textForm).toBe('original');
    // The as-filed span ends after the section's last word and the punctuation
    // that closes it, so the final sentence keeps its full stop.
    expect(slice.text).toContain('Item 1A. Risk Factors\nOur supply chain is concentrated in a small number of regions.');
    expect(slice.text).not.toContain('Item 1B');
    expect(sliceTextBlocks(slice.text, 'original')).toEqual([
      'Item 1A. Risk Factors',
      'Our supply chain is concentrated in a small number of regions.',
    ]);
  });

  it('distinguishes not mapped, not found, empty and failed reads', () => {
    expect(sliceFilingSection(filing({ form: '8-K' }), 'risk-factors', { ok: true, text: TEN_K }, '').status).toBe('not-mapped');
    expect(sliceFilingSection(filing(), 'risk-factors', { ok: true, text: 'Item 2. Properties\nWe own it.' }, 'x.htm').status).toBe('not-found');
    const empty = sliceFilingSection(filing(), 'risk-factors', { ok: true, text: '  ' }, 'x.htm');
    expect(empty).toMatchObject({ status: 'failed', reason: 'filing text was empty — retry' });
    const limited = sliceFilingSection(filing(), 'risk-factors', { ok: false, kind: 'rate-limit', retryable: true }, 'x.htm');
    expect(limited).toMatchObject({ status: 'failed', reason: 'rate limited — retry' });
  });

  it('reads filings one at a time, resolves missing primary documents, and skips forms the concept does not map', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const fetchText = vi.fn<CollectDeps['fetchText']>(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise(resolve => setTimeout(resolve, 5));
      inFlight -= 1;
      return { ok: true, text: TEN_K };
    });
    const resolvePrimaryDocument = vi.fn(async () => 'resolved.htm');
    const progress: number[] = [];

    const slices = await collectSectionSlices(
      [
        filing({ primaryDocument: 'aapl-2026.htm' }),
        filing({ id: 'b', accessionNumber: '0000320193-25-000001', primaryDocument: undefined }),
        filing({ id: 'c', accessionNumber: '0000320193-25-000002', form: '8-K' }),
      ],
      'risk-factors',
      { fetchText, resolvePrimaryDocument, onProgress: done => progress.push(done) },
    );

    expect(maxInFlight).toBe(1);
    expect(fetchText).toHaveBeenCalledTimes(2);
    expect(fetchText.mock.calls[1][2]).toBe('resolved.htm');
    expect(resolvePrimaryDocument).toHaveBeenCalledTimes(1);
    expect(slices.map(slice => slice.status)).toEqual(['extracted', 'extracted', 'not-mapped']);
    expect(progress).toEqual([1, 2, 3]);
  });

  it('records a transport exception as a failed read, never as an absent section', async () => {
    const slices = await collectSectionSlices([filing({ primaryDocument: 'a.htm' })], 'risk-factors', {
      fetchText: async () => { throw new Error('network'); },
      resolvePrimaryDocument: async () => '',
    });
    expect(slices[0].status).toBe('failed');
  });

  it('chunks long normalized text on word boundaries without dropping words', () => {
    const words = Array.from({ length: 500 }, (_, index) => `word${index}`);
    const chunks = chunkSliceText(words.join(' '), 200);
    expect(chunks.every(chunk => chunk.length <= 200)).toBe(true);
    expect(chunks.join(' ').split(' ')).toEqual(words);
    // An over-long as-filed line is chunked the same way; short lines stay whole.
    const blocks = sliceTextBlocks(`Heading.\n\n${words.join(' ')}\nLast line.`, 'original', 200);
    expect(blocks[0]).toBe('Heading.');
    expect(blocks[blocks.length - 1]).toBe('Last line.');
    expect(blocks.slice(1, -1).join(' ').split(' ')).toEqual(words);
  });
});
