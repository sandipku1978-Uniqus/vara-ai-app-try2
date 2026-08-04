import { createRef, type ComponentProps } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AIQnAPanelView } from '../components/AIQnAPanelView';
import type { AgentEvidencePacket, AgentRun, PendingAlertDraft } from '../types/agent';

const run: AgentRun = {
  id: 'run-1',
  prompt: 'Summarize Apple risk factors',
  status: 'completed',
  startedAt: '2026-08-03T00:00:00.000Z',
  answer: '**Material risks** identified.',
  actionLog: [{
    id: 'log-1',
    type: 'system',
    title: 'Plan ready',
    detail: 'One action queued.',
    status: 'info',
    timestamp: '2026-08-03T00:00:01.000Z',
  }],
  evidence: null,
};

const evidence: AgentEvidencePacket = {
  title: 'Apple 10-K',
  summary: 'Cited filing evidence.',
  findings: [],
  citations: [{
    id: 'citation-1',
    kind: 'filing',
    title: 'Apple 10-K',
    route: '/filing/apple',
    excerpt: 'Risk factors include supply-chain concentration.',
  }],
  followUps: ['Compare with Microsoft'],
  notes: [],
};

function props(
  overrides: Partial<ComponentProps<typeof AIQnAPanelView>> = {},
): ComponentProps<typeof AIQnAPanelView> {
  return {
    panelWidth: null,
    panelBodyRef: createRef<HTMLDivElement>(),
    messageInputRef: createRef<HTMLInputElement>(),
    agentRuns: [run],
    activeRun: run,
    evidence,
    tab: 'answer',
    running: false,
    streamingText: '',
    loadingStage: '',
    inputValue: '',
    pendingAlertDraft: null,
    suggestions: evidence.followUps,
    onResizeStart: vi.fn(),
    onResizeKeyDown: vi.fn(),
    onClearRuns: vi.fn(),
    onClose: vi.fn(),
    onSelectRun: vi.fn(),
    onTabChange: vi.fn(),
    onConfirmAlert: vi.fn(),
    onDismissAlert: vi.fn(),
    onFillComposer: vi.fn(),
    onOpenCitation: vi.fn(),
    onInputChange: vi.fn(),
    onSubmit: vi.fn(event => event.preventDefault()),
    ...overrides,
  };
}

describe('AIQnAPanelView', () => {
  it('renders the answer and delegates follow-up, input, submit, and close interactions', () => {
    const onFillComposer = vi.fn();
    const onInputChange = vi.fn();
    const onSubmit = vi.fn(event => event.preventDefault());
    const onClose = vi.fn();
    render(<AIQnAPanelView {...props({ onFillComposer, onInputChange, onSubmit, onClose })} />);

    expect(screen.getByText('Material risks')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Compare with Microsoft' }));
    expect(onFillComposer).toHaveBeenCalledWith('Compare with Microsoft');

    fireEvent.change(screen.getByRole('textbox', { name: /Message URC Copilot/i }), { target: { value: 'Next question' } });
    expect(onInputChange).toHaveBeenCalledWith('Next question');
    fireEvent.submit(screen.getByRole('textbox', { name: /Message URC Copilot/i }).closest('form')!);
    expect(onSubmit).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Close copilot' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('delegates evidence navigation without interpreting the citation target', () => {
    const onOpenCitation = vi.fn();
    render(<AIQnAPanelView {...props({ tab: 'evidence', onOpenCitation })} />);

    expect(screen.getByText('Cited filing evidence.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Apple 10-K/i }));
    expect(onOpenCitation).toHaveBeenCalledWith(evidence.citations[0]);
  });

  it('keeps draft-alert persistence behind explicit confirm and dismiss callbacks', () => {
    const draft: PendingAlertDraft = {
      id: 'draft-1',
      name: 'Apple risk alert',
      query: 'risk factors',
      mode: 'semantic',
      filters: {
        keyword: '', dateFrom: '', dateTo: '', entityName: '', formTypes: [],
        sectionKeywords: '', sicCode: '', stateOfInc: '', headquarters: '',
        exchange: [], acceleratedStatus: [], accountant: '', accessionNumber: '',
        fileNumber: '', fiscalYearEnd: '', accountingFramework: '',
      },
      defaultForms: '10-K',
      rationale: 'Track future changes.',
    };
    const onConfirmAlert = vi.fn();
    const onDismissAlert = vi.fn();
    render(<AIQnAPanelView {...props({ pendingAlertDraft: draft, onConfirmAlert, onDismissAlert })} />);

    fireEvent.click(screen.getByRole('button', { name: 'Save Alert' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onConfirmAlert).toHaveBeenCalledOnce();
    expect(onDismissAlert).toHaveBeenCalledOnce();
  });

  it('moves focus to an enabled panel control when an automatic run disables the composer', () => {
    const invokingControl = document.createElement('button');
    document.body.appendChild(invokingControl);
    invokingControl.focus();

    const { rerender } = render(<AIQnAPanelView {...props({ running: false })} />);
    rerender(<AIQnAPanelView {...props({ running: true })} />);

    expect(screen.getByRole('button', { name: 'Close copilot' })).toHaveFocus();
    expect(screen.getByRole('complementary', { name: /research assistant/i })).toHaveAttribute('aria-busy', 'true');
    invokingControl.remove();
  });
});
