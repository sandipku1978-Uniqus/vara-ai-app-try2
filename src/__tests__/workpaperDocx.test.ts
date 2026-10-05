/**
 * The Word builders produce real, openable documents: each test packs the
 * docx, unzips it, and asserts on word/document.xml (and its relationships,
 * where hyperlinks live) rather than on the builder's inputs.
 */
import { Packer, type Document } from 'docx';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';

import { buildMemoDocument, draftPurpose, draftTitle } from '../services/memoExport';
import { buildAnswerDocument } from '../services/answerExport';
import { buildSectionDocument, buildSectionIndexCsv, type CartSectionSlice } from '../services/cartSectionExport';
import { buildDocument, markdownToDocxBlocks } from '../services/docxShared';
import {
  buildAnswerEvidencePackage,
  buildMemoEvidencePackage,
  type EvidenceAppVersion,
} from '../services/evidencePackage';
import type { MemoCitation, MemoDraftRecord } from '../services/memoTray';
import type { AgentEvidencePacket, AgentRun } from '../types/agent';
import type { CartFiling } from '../services/documentCart';

async function unpack(document: Document): Promise<{ xml: string; rels: string; files: string[] }> {
  const buffer = await Packer.toBuffer(document);
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')!.async('string');
  const rels = await zip.file('word/_rels/document.xml.rels')!.async('string');
  return { xml, rels, files: Object.keys(zip.files) };
}

/** Visible text of document.xml, runs joined, for readable assertions. */
function visibleText(xml: string): string {
  return Array.from(xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)).map(match => match[1]).join('');
}

const VERSION: EvidenceAppVersion = { status: 'reported', sha: 'abc1234', ref: 'main', deploymentId: 'dpl_1', environment: 'production' };
const NOW = new Date('2026-10-04T12:00:00.000Z');

const CITATIONS: MemoCitation[] = [
  {
    id: '320193:0000320193-26-000001#Item 1A',
    kind: 'filing',
    cik: '320193',
    accessionNumber: '0000320193-26-000001',
    company: 'Apple Inc.',
    form: '10-K',
    fileDate: '2026-01-30',
    excerpt: 'Supply-chain concentration remains a material risk.',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-2026.htm',
    note: 'Compare to prior year.',
    addedAt: '2026-10-01T00:00:00.000Z',
    section: 'Item 1A',
  },
  {
    id: '789019:0000789019-26-000001',
    kind: 'filing',
    cik: '789019',
    accessionNumber: '0000789019-26-000001',
    company: 'Microsoft Corporation',
    form: '10-K',
    fileDate: '2026-07-30',
    excerpt: '',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/789019/000078901926000001/msft-2026.htm',
    note: '',
    addedAt: '2026-10-01T00:00:00.000Z',
  },
];

const DRAFT: MemoDraftRecord = {
  text: '# Research memo — Supply-chain risk\n## Purpose\nAssess supply-chain risk at Apple and Microsoft.\n## Observations\n- Apple flags **concentration** [1].\n- Microsoft excerpt is metadata-only [2].\n- Unknown source [7].',
  generatedAt: '2026-10-03T09:00:00.000Z',
  citationIds: CITATIONS.map(citation => citation.id),
};

function memoInput(overrides: Partial<Parameters<typeof buildMemoDocument>[0]> = {}) {
  const evidencePackage = buildMemoEvidencePackage({
    title: 'Research memo — Supply-chain risk',
    question: 'How do Apple and Microsoft describe supply-chain risk?',
    citations: CITATIONS,
    draft: DRAFT,
    generatedAt: NOW,
    appVersion: VERSION,
  });
  return {
    title: 'Research memo — Supply-chain risk',
    question: 'How do Apple and Microsoft describe supply-chain risk?',
    author: 'Sandip Khetan',
    generatedAt: NOW,
    citations: CITATIONS,
    draft: DRAFT,
    draftIsStale: false,
    evidencePackage,
    ...overrides,
  };
}

describe('memo Word export', () => {
  it('writes title, question, date, author, the draft, the evidence table, sources and the appendix', async () => {
    const { xml, rels, files } = await unpack(buildMemoDocument(memoInput()));
    const text = visibleText(xml);

    expect(files).toContain('word/document.xml');
    expect(text).toContain('Research memo — Supply-chain risk');
    expect(text).toContain('How do Apple and Microsoft describe supply-chain risk?');
    expect(text).toContain('2026-10-04');
    expect(text).toContain('Sandip Khetan');
    // The draft's own title line is the document title, not repeated as a heading.
    expect(text.match(/Research memo — Supply-chain risk/g)?.length).toBeGreaterThanOrEqual(1);
    expect(text).toContain('Assess supply-chain risk at Apple and Microsoft.');

    // Evidence table columns and row values.
    for (const header of ['Company', 'Form', 'Filed', 'Accession', 'Section', 'Excerpt', 'Your note', 'SEC URL']) {
      expect(text).toContain(header);
    }
    expect(text).toContain('0000320193-26-000001');
    expect(text).toContain('Item 1A');
    expect(text).toContain('Supply-chain concentration remains a material risk.');
    expect(text).toContain('Compare to prior year.');
    expect(text).toContain('— (metadata-only citation)');

    // SEC URL is a live external hyperlink.
    expect(rels).toContain('https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-2026.htm');
    expect(rels).toMatch(/TargetMode="External"/);

    expect(text).toContain('Sources');
    expect(text).toContain('Appendix — Evidence package');
    expect(text).toContain('urc.evidence-package.v1');
    expect(text).toContain('commit abc1234');
    expect(text).toContain('Model: not reported');
  });

  it('names the model, provider and effort the draft was saved with in the appendix', async () => {
    const draft: MemoDraftRecord = {
      ...DRAFT,
      aiMetadata: {
        requestedModel: 'openai/gpt-5.6', requestedEffort: 'high', model: 'openai/gpt-5.6', provider: 'openai',
        reasoningEffort: 'high', webSources: [],
      },
    };
    const evidencePackage = buildMemoEvidencePackage({
      title: 'Research memo — Supply-chain risk', citations: CITATIONS, draft, generatedAt: NOW, appVersion: VERSION,
    });
    const { xml } = await unpack(buildMemoDocument(memoInput({ draft, evidencePackage })));
    const text = visibleText(xml);
    expect(text).toContain('Model: openai/gpt-5.6 (openai). Reasoning effort: high (as reported by the AI route response).');
    expect(text).not.toContain('Model: not reported');
  });

  it('keeps [n] markers as superscript references linked to their evidence row, and leaves unresolvable ones as typed', async () => {
    const { xml } = await unpack(buildMemoDocument(memoInput()));
    expect(xml).toContain('w:name="evidence_1"');
    expect(xml).toContain('w:name="evidence_2"');
    expect(xml).toMatch(/<w:hyperlink [^>]*w:anchor="evidence_1"/);
    expect(xml).toMatch(/<w:hyperlink [^>]*w:anchor="evidence_2"/);
    expect(xml).toContain('w:vertAlign w:val="superscript"');
    // [7] points at no citation: visible, unlinked.
    expect(visibleText(xml)).toContain('[7]');
    expect(xml).not.toContain('w:anchor="evidence_7"');
  });

  it('links a stale draft\'s markers through the citation they were drafted from', async () => {
    // Apple was removed after drafting; Microsoft is now row 1.
    const remaining = [CITATIONS[1]];
    const { xml } = await unpack(buildMemoDocument(memoInput({ citations: remaining, draftIsStale: true })));
    const text = visibleText(xml);
    expect(text).toContain('Citations changed after this draft was generated');
    // Draft [2] (Microsoft) now resolves to evidence row 1; draft [1] (Apple) is unlinked.
    expect(xml).toMatch(/<w:hyperlink [^>]*w:anchor="evidence_1"/);
    expect(xml).not.toContain('w:anchor="evidence_2"');
  });

  it('says what was not recorded instead of inventing an author or question', async () => {
    const { xml } = await unpack(buildMemoDocument(memoInput({ author: null, question: '', draft: null })));
    const text = visibleText(xml);
    expect(text).toContain('Not recorded (no signed-in display name)');
    expect(text).toMatch(/Question: Not recorded/);
    expect(text).not.toContain('AI draft');
  });

  it('reads the draft title and purpose', () => {
    expect(draftTitle(DRAFT.text)).toBe('Research memo — Supply-chain risk');
    expect(draftPurpose(DRAFT.text)).toBe('Assess supply-chain risk at Apple and Microsoft.');
    expect(draftTitle('no heading')).toBeNull();
  });
});

describe('copilot answer Word export', () => {
  const run: AgentRun = {
    id: 'run-1',
    prompt: 'Summarize Apple risk factors',
    status: 'completed',
    startedAt: '2026-10-04T11:00:00.000Z',
    completedAt: '2026-10-04T11:00:30.000Z',
    answer: '## Summary\n**Material risks** identified in Item 1A.\n\n| Risk | Change |\n| --- | --- |\n| Supply chain | Expanded |',
    actionLog: [],
    evidence: null,
    plan: {
      goal: 'Summarize', rationale: 'r', confidence: 'high', followUps: [],
      actions: [{ id: 'a1', type: 'summarize_filing', title: 'Summarize latest 10-K', input: {} }],
    },
  };
  const evidence: AgentEvidencePacket = {
    title: 'Apple 10-K',
    summary: 'Cited filing evidence.',
    findings: ['Supply-chain concentration is highlighted.'],
    citations: [{
      id: 'c1',
      kind: 'section',
      title: 'Apple 10-K — Risk Factors',
      sectionLabel: 'Item 1A',
      excerpt: 'Risk factors include supply-chain concentration.',
      externalUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-2026.htm',
    }],
    followUps: [],
    notes: ['Read one filing.'],
  };

  it('writes the answer, its citations with SEC links, the packet and the appendix', async () => {
    const evidencePackage = buildAnswerEvidencePackage({ run, evidence, generatedAt: NOW, appVersion: VERSION });
    const { xml, rels } = await unpack(buildAnswerDocument({ run, evidence, author: 'Analyst One', generatedAt: NOW, evidencePackage }));
    const text = visibleText(xml);
    expect(text).toContain('Copilot answer — Apple 10-K');
    expect(text).toContain('Summarize Apple risk factors');
    expect(text).toContain('Material risks');
    // Markdown table became a Word table.
    expect(xml).toContain('<w:tbl>');
    expect(text).toContain('Supply chain');
    expect(text).toContain('Risk factors include supply-chain concentration.');
    expect(text).toContain('Supply-chain concentration is highlighted.');
    expect(text).toContain('Summarize latest 10-K (summarize_filing)');
    expect(rels).toContain('https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-2026.htm');
    expect(text).toContain('Appendix — Evidence package');
    expect(text).toContain('Analyst One');
  });
});

describe('cart section Word export', () => {
  const filing = (n: number, form = '10-K'): CartFiling => ({
    id: `${n}:0000000000-26-00000${n}`,
    cik: String(n),
    accessionNumber: `000000000${n}-26-00000${n}`,
    company: `Company ${n}`,
    form,
    fileDate: '2026-02-01',
    ticker: `CO${n}`,
    sourceUrl: `https://www.sec.gov/Archives/edgar/data/${n}/000000000${n}2600000${n}/doc.htm`,
    origin: 'search',
    addedAt: NOW.toISOString(),
  });
  const slices: CartSectionSlice[] = [
    { filing: filing(1), conceptKey: 'risk-factors', sectionLabel: 'Risk Factors', status: 'extracted', text: 'Item 1A. Risk Factors\nOur supply chain is concentrated.', textForm: 'original', document: 'doc.htm' },
    { filing: filing(2, '8-K'), conceptKey: 'risk-factors', sectionLabel: 'Risk Factors', status: 'not-mapped', text: '', document: '', reason: 'Risk Factors is not mapped for Form 8-K' },
    { filing: filing(3), conceptKey: 'risk-factors', sectionLabel: 'Risk Factors', status: 'failed', text: '', document: 'doc.htm', reason: 'rate limited — retry' },
  ];

  it('puts each filing on its own page with its status, and labels the text form', async () => {
    const { xml, rels } = await unpack(buildSectionDocument(slices, 'risk-factors', NOW));
    const text = visibleText(xml);
    expect(xml.match(/<w:br w:type="page"\/>/g)).toHaveLength(3);
    expect(text).toContain('Risk Factors — 3 selected filings');
    expect(text).toContain('1 of 3');
    expect(text).toContain('Item 1A. Risk FactorsOur supply chain is concentrated.');
    expect(text).toContain('Not mapped for this form — Risk Factors is not mapped for Form 8-K.');
    expect(text).toContain('Could not read filing — rate limited — retry.');
    expect(text).toContain('As filed — the filing’s own case, punctuation and line breaks');
    expect(text).not.toContain('Normalized');
    expect(rels).toContain('https://www.sec.gov/Archives/edgar/data/1/');
  });

  it('writes a CSV index with one row per filing and its status', () => {
    const csv = buildSectionIndexCsv(slices).trim().split('\r\n');
    expect(csv).toHaveLength(4);
    expect(csv[0]).toContain('Status');
    expect(csv[0]).toContain('Text form');
    expect(csv[1]).toContain('Extracted');
    expect(csv[1]).toContain('As filed');
    expect(csv[2]).toContain('Not mapped for this form');
    expect(csv[3]).toContain('Could not read filing');
  });
});

describe('shared Markdown → docx', () => {
  it('treats a heading line followed by body text as a heading plus a paragraph', async () => {
    const { xml } = await unpack(buildDocument(markdownToDocxBlocks('## Purpose\nOne sentence of purpose.'), 't'));
    expect(xml).toContain('w:val="Heading2"');
    const text = visibleText(xml);
    expect(text).toContain('Purpose');
    expect(text).toContain('One sentence of purpose.');
  });
});
