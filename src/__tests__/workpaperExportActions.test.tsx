/**
 * The export actions on the memo tray and the copilot answer footer download
 * real files: the .docx blob is unzipped and read, the .json parsed.
 */
import { createRef, type ComponentProps } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MemoTray from '../components/memo/MemoTray';
import { AIQnAPanelView } from '../components/AIQnAPanelView';
import { addCitation, clearMemoDraft, clearMemoTray } from '../services/memoTray';
import type { AgentEvidencePacket, AgentRun } from '../types/agent';

const downloads: Array<{ name: string; blob: Blob }> = [];

async function docxText(blob: Blob): Promise<string> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file('word/document.xml')!.async('string');
  return Array.from(xml.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)).map(match => match[1]).join('');
}

beforeEach(() => {
  downloads.length = 0;
  let pending: Blob | null = null;
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { pending = blob as Blob; return 'blob:test'; });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    if (pending) downloads.push({ name: this.download, blob: pending });
    pending = null;
  });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (url === '/api/version') return new Response(JSON.stringify({ ok: true, sha: 'cafe123', ref: 'main', deploymentId: null, environment: 'preview' }));
    return new Response('', { status: 404 });
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('memo tray Word export', () => {
  beforeEach(() => {
    clearMemoTray();
    clearMemoDraft();
    addCitation({
      kind: 'filing',
      cik: '320193',
      accessionNumber: '0000320193-26-000001',
      company: 'Apple Inc.',
      form: '10-K',
      fileDate: '2026-01-30',
      excerpt: 'Supply-chain concentration remains a material risk.',
      sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-2026.htm',
    });
  });

  afterEach(() => {
    clearMemoTray();
    clearMemoDraft();
  });

  it('downloads a .docx carrying the title and question entered, the evidence table and the appendix', async () => {
    const user = userEvent.setup();
    render(<MemoTray />);
    await user.click(screen.getByRole('button', { name: 'Open memo tray (1 citation)' }));
    await user.click(screen.getByRole('button', { name: 'Export Word' }));
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Supply-chain memo');
    await user.type(screen.getByRole('textbox', { name: 'Question' }), 'How concentrated is supply?');
    await user.click(screen.getByRole('button', { name: /Download \.docx/ }));

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toMatch(/^URC_memo_Supply-chain_memo_\d{4}-\d{2}-\d{2}\.docx$/);
    const text = await docxText(downloads[0].blob);
    expect(text).toContain('Supply-chain memo');
    expect(text).toContain('How concentrated is supply?');
    expect(text).toContain('Supply-chain concentration remains a material risk.');
    expect(text).toContain('Appendix — Evidence package');
    expect(text).toContain('commit cafe123');
  });

  it('downloads the evidence package as JSON', async () => {
    const user = userEvent.setup();
    render(<MemoTray />);
    await user.click(screen.getByRole('button', { name: 'Open memo tray (1 citation)' }));
    await user.click(screen.getByRole('button', { name: 'Export Word' }));
    await user.click(screen.getByRole('button', { name: /Evidence package \.json/ }));

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toMatch(/_evidence\.json$/);
    const pkg = JSON.parse(await downloads[0].blob.text());
    expect(pkg).toMatchObject({
      schema: 'urc.evidence-package.v1',
      subject: { kind: 'memo' },
      sources: [{ accessionNumber: '0000320193-26-000001', role: 'cited' }],
      appVersion: { status: 'reported', sha: 'cafe123' },
    });
  });
});

describe('copilot answer footer export', () => {
  const run: AgentRun = {
    id: 'run-1',
    prompt: 'Summarize Apple risk factors',
    status: 'completed',
    startedAt: '2026-08-03T00:00:00.000Z',
    completedAt: '2026-08-03T00:00:10.000Z',
    answer: '**Material risks** identified.',
    actionLog: [],
    evidence: null,
  };
  const evidence: AgentEvidencePacket = {
    title: 'Apple 10-K',
    summary: 'Cited filing evidence.',
    findings: [],
    citations: [{ id: 'c1', kind: 'filing', title: 'Apple 10-K', excerpt: 'Risk factors include supply-chain concentration.' }],
    followUps: [],
    notes: [],
  };

  function props(): ComponentProps<typeof AIQnAPanelView> {
    return {
      panelWidth: null, panelBodyRef: createRef<HTMLDivElement>(), messageInputRef: createRef<HTMLInputElement>(),
      agentRuns: [run], activeRun: run, evidence, tab: 'answer', running: false, streamingText: '', loadingStage: '',
      inputValue: '', pendingAlertDraft: null, suggestions: [],
      onResizeStart: vi.fn(), onResizeKeyDown: vi.fn(), onClearRuns: vi.fn(), onClose: vi.fn(), onSelectRun: vi.fn(),
      onTabChange: vi.fn(), onConfirmAlert: vi.fn(), onDismissAlert: vi.fn(), onFillComposer: vi.fn(),
      onOpenCitation: vi.fn(), onInputChange: vi.fn(), onSubmit: vi.fn(),
    };
  }

  it('offers Word and JSON from one footer button, with keyboard access', async () => {
    const user = userEvent.setup();
    render(<AIQnAPanelView {...props()} />);
    const trigger = screen.getByRole('button', { name: 'Export this answer' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await user.click(trigger);
    const word = screen.getByRole('menuitem', { name: 'Word document (.docx)' });
    expect(word).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Evidence package (.json)' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();

    await user.click(trigger);
    await user.click(screen.getByRole('menuitem', { name: 'Word document (.docx)' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].name).toMatch(/^URC_copilot_Summarize_Apple_risk_factors_.*\.docx$/);
    const text = await docxText(downloads[0].blob);
    expect(text).toContain('Summarize Apple risk factors');
    expect(text).toContain('Material risks');
    expect(text).toContain('Risk factors include supply-chain concentration.');
    expect(text).toContain('Appendix — Evidence package');
  });

  it('shows no export control while the run is still going', () => {
    render(<AIQnAPanelView {...props()} activeRun={{ ...run, status: 'running' }} />);
    expect(screen.queryByRole('button', { name: 'Export this answer' })).not.toBeInTheDocument();
  });
});
