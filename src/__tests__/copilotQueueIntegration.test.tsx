import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppProvider, useApp } from '../context/AppState';
import { AIQnAPanel } from '../components/AIQnAPanel';
import AskCopilotButton from '../components/tables/AskCopilotButton';
import ResultsToolbar from '../components/tables/ResultsToolbar';
import { planAgentRun, generateAgentAnswerStreaming } from '../services/aiApi';

vi.mock('next/navigation', () => ({
  usePathname: () => '/search',
  useRouter: () => ({ push: vi.fn(), back: vi.fn() }),
}));

vi.mock('../services/aiApi', () => ({
  planAgentRun: vi.fn(async (prompt: string) => ({
    goal: prompt,
    rationale: 'Test plan',
    confidence: 'high',
    actions: [],
    followUps: [],
  })),
  generateAgentAnswerStreaming: vi.fn(async (_evidence: unknown, _context: unknown, onChunk: (chunk: string) => void) => {
    onChunk('Completed');
    return 'Completed';
  }),
  generateFilingSummary: vi.fn(),
  summarizeConversation: vi.fn(async () => ''),
}));

vi.mock('../services/agentEvidence', () => ({
  buildCommentLetterCitation: vi.fn(),
  buildFilingCitation: vi.fn(),
  buildImportantSectionSnippets: vi.fn(),
  buildSearchResultCitation: vi.fn(),
  discoverPeersBySic: vi.fn(),
  fetchFilingEvidence: vi.fn(),
  findLatestFilingForCompany: vi.fn(),
  resolveCompanyHint: vi.fn(),
}));

vi.mock('../services/filingResearch', () => ({
  buildSearchTrendSummary: vi.fn(async () => ''),
  executeFilingResearchSearch: vi.fn(async () => []),
}));

vi.mock('../services/filingExport', () => ({ openCleanPrintView: vi.fn() }));

function QueueProbe() {
  const { agentPromptQueue } = useApp();
  return <output data-testid="queued-prompts">{agentPromptQueue.map(request => request.prompt).join('|')}</output>;
}

describe('Copilot prompt queue integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  });

  it('consumes a row prompt in AIQnAPanel and invokes the real panel executor', async () => {
    const prompt = 'Analyze Apple filing row';
    const user = userEvent.setup();
    render(
      <AppProvider>
        <AskCopilotButton prompt={prompt} label="Analyze filing" />
        <AIQnAPanel />
      </AppProvider>
    );

    await user.click(screen.getByRole('button', { name: /Analyze filing with Copilot/i }));

    await waitFor(() => expect(planAgentRun).toHaveBeenCalledWith(prompt, expect.objectContaining({ pagePath: expect.any(String) })));
    await waitFor(() => expect(generateAgentAnswerStreaming).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('Completed')).toBeInTheDocument();
  });

  it('queues the supplied ResultsToolbar prompt unchanged', async () => {
    const user = userEvent.setup();
    render(
      <AppProvider>
        <ResultsToolbar
          data={[{ company: 'Apple', form: '10-K' }]}
          columns={[{ key: 'company', header: 'Company' }, { key: 'form', header: 'Form' }]}
          label="filings"
          copilotPrompt="Compare these selected filings"
        />
        <QueueProbe />
      </AppProvider>
    );

    await user.click(screen.getByRole('button', { name: /Analyze in Copilot/i }));
    expect(screen.getByTestId('queued-prompts')).toHaveTextContent('Compare these selected filings');
  });

  it('captures a result snapshot when ResultsToolbar has no custom prompt', () => {
    render(
      <AppProvider>
        <ResultsToolbar
          data={[{ company: 'Apple', form: '10-K' }]}
          columns={[{ key: 'company', header: 'Company' }, { key: 'form', header: 'Form' }]}
          label="filings"
        />
        <QueueProbe />
      </AppProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /Analyze in Copilot/i }));
    expect(screen.getByTestId('queued-prompts')).toHaveTextContent('Company Form');
    expect(screen.getByTestId('queued-prompts')).toHaveTextContent('Apple 10-K');
  });
});
