import { describe, expect, it, vi } from 'vitest';

// The as-filed mapping is exact or empty (never approximate). Force the empty
// case so the export's fallback to the normalized slice is exercised.
vi.mock('../utils/sectionTaxonomy', async importOriginal => ({
  ...(await importOriginal<typeof import('../utils/sectionTaxonomy')>()),
  extractResolvedSectionOriginal: () => '',
}));

import { buildSectionDocument, buildSectionIndexCsv, sliceFilingSection } from '../services/cartSectionExport';
import type { CartFiling } from '../services/documentCart';
import { Packer, type Document } from 'docx';
import JSZip from 'jszip';

async function documentText(document: Document): Promise<string> {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(document));
  const xml = await zip.file('word/document.xml')!.async('string');
  return Array.from(xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)).map(match => match[1]).join('');
}

const FILING: CartFiling = {
  id: '320193:0000320193-26-000001',
  cik: '320193',
  accessionNumber: '0000320193-26-000001',
  company: 'Apple Inc.',
  form: '10-K',
  fileDate: '2026-01-30',
  sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-2026.htm',
  origin: 'search',
  addedAt: '2026-10-04T00:00:00.000Z',
};

const TEN_K = [
  'Item 1. Business',
  'We design and sell devices.',
  'Item 1A. Risk Factors',
  'Our supply chain is concentrated in a small number of regions.',
  'Item 1B. Unresolved Staff Comments',
  'None.',
].join('\n');

describe('cart section export without an exact as-filed mapping', () => {
  it('falls back to the normalized slice and labels it, on the page and in the CSV', async () => {
    const slice = sliceFilingSection(FILING, 'risk-factors', { ok: true, text: TEN_K }, 'aapl-2026.htm');
    expect(slice).toMatchObject({ status: 'extracted', textForm: 'normalized' });
    expect(slice.text).toContain('our supply chain is concentrated');

    const text = await documentText(buildSectionDocument([slice], 'risk-factors', new Date('2026-10-04T00:00:00.000Z')));
    expect(text).toContain('As filed, except 1 filing marked “Normalized” below');
    expect(text).toContain('Normalized (lowercase, punctuation removed) — the as-filed text could not be mapped exactly');

    expect(buildSectionIndexCsv([slice])).toContain('Normalized (lowercase, punctuation removed)');
  });
});
