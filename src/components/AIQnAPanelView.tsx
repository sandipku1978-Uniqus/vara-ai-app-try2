import {
  useEffect,
  useRef,
  type FormEventHandler,
  type KeyboardEventHandler,
  type MouseEventHandler,
  type RefObject,
} from 'react';
import {
  AlertTriangle,
  BellRing,
  Bot,
  CheckCircle2,
  ClipboardList,
  ExternalLink,
  FileSearch,
  Loader2,
  Send,
  Sparkles,
  X,
} from 'lucide-react';

import { BRAND } from '../config/brand';
import { SAMPLE_PROMPTS, SAMPLE_PROMPT_CATEGORIES } from '../data/samplePrompts';
import type {
  AgentCitation,
  AgentEvidencePacket,
  AgentRun,
  PendingAlertDraft,
} from '../types/agent';
import { renderMarkdown } from '../utils/markdownRenderer';
import ResponsibleAIBanner from './ResponsibleAIBanner';
import type { PanelTab } from './AIQnAPanel.helpers';

interface AnswerTabProps {
  activeRun: AgentRun;
  streamingText: string;
  loadingStage: string;
  pendingAlertDraft: PendingAlertDraft | null;
  suggestions: string[];
  onConfirmAlert: () => void;
  onDismissAlert: () => void;
  onFillComposer: (text: string) => void;
}

function AnswerTab({
  activeRun,
  streamingText,
  loadingStage,
  pendingAlertDraft,
  suggestions,
  onConfirmAlert,
  onDismissAlert,
  onFillComposer,
}: AnswerTabProps) {
  return (
    <div className="panel-tab-content">
      {activeRun.answer ? (
        <div className="copilot-answer md-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(activeRun.answer) }} />
      ) : streamingText ? (
        <div className="copilot-answer md-content streaming" dangerouslySetInnerHTML={{ __html: renderMarkdown(streamingText) }} />
      ) : activeRun.status === 'running' ? (
        <div className="loading-state">
          <Loader2 size={16} className="spinner" />
          <span>{loadingStage || 'Running actions and assembling evidence...'}</span>
        </div>
      ) : (
        <div className="empty-state-small">This run has no answer yet.</div>
      )}

      {pendingAlertDraft && (
        <div className="draft-alert-card">
          <div className="draft-alert-header">
            <BellRing size={16} />
            <span>Draft Alert Ready</span>
          </div>
          <div className="draft-alert-name">{pendingAlertDraft.name}</div>
          <div className="draft-alert-meta">{pendingAlertDraft.defaultForms} | {pendingAlertDraft.mode}</div>
          <p>{pendingAlertDraft.rationale}</p>
          <div className="draft-alert-actions">
            <button className="primary-btn" onClick={onConfirmAlert}>Save Alert</button>
            <button className="secondary-btn" onClick={onDismissAlert}>Dismiss</button>
          </div>
        </div>
      )}

      <div className="suggestions-block">
        <div className="section-label">Follow-ups</div>
        <div className="suggestion-list">
          {suggestions.slice(0, 4).map(suggestion => (
            <button
              key={suggestion}
              className="suggestion-pill"
              title="Fill the message box — edit if you like, then press Enter"
              onClick={() => onFillComposer(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function EvidenceTab({
  evidence,
  onOpenCitation,
}: {
  evidence: AgentEvidencePacket | null;
  onOpenCitation: (citation: AgentCitation) => void;
}) {
  return (
    <div className="panel-tab-content">
      <div className="section-label">Evidence Summary</div>
      <p className="evidence-summary">{evidence?.summary || 'No evidence packet available yet.'}</p>

      <div className="section-label">Citations</div>
      <div className="citation-list">
        {evidence?.citations?.length ? evidence.citations.map(citation => (
          <button key={citation.id} className="citation-card" onClick={() => onOpenCitation(citation)}>
            <div className="citation-card-header">
              <span>{citation.title}</span>
              {(citation.route || citation.externalUrl || citation.filingRoute) ? <ExternalLink size={14} /> : <FileSearch size={14} />}
            </div>
            {(citation.subtitle || citation.meta) && (
              <div className="citation-card-meta">{citation.subtitle || citation.meta}</div>
            )}
            {citation.excerpt && <p>{citation.excerpt.slice(0, 220)}{citation.excerpt.length > 220 ? '...' : ''}</p>}
          </button>
        )) : (
          <div className="empty-state-small">No citations yet.</div>
        )}
      </div>
    </div>
  );
}

function ActionsTab({ activeRun }: { activeRun: AgentRun }) {
  return (
    <div className="panel-tab-content">
      <div className="section-label">Action Log</div>
      <div className="action-log-list">
        {activeRun.actionLog.length ? activeRun.actionLog.map(entry => (
          <div key={entry.id} className={`action-log-item ${entry.status}`}>
            <div className="action-log-title">{entry.title}</div>
            <div className="action-log-detail">{entry.detail}</div>
          </div>
        )) : (
          <div className="empty-state-small">No actions recorded yet.</div>
        )}
      </div>

      {activeRun.plan && (
        <>
          <div className="section-label">Search Logic</div>
          <div className="search-logic-card">
            <div className="search-logic-row">
              <span className="search-logic-label">Goal:</span>
              <span>{activeRun.plan.goal}</span>
            </div>
            {activeRun.plan.confidence && (
              <div className="search-logic-row">
                <span className="search-logic-label">Confidence:</span>
                <span className={`confidence-badge ${activeRun.plan.confidence}`}>{activeRun.plan.confidence}</span>
              </div>
            )}
            {activeRun.plan.rationale && (
              <div className="search-logic-row">
                <span className="search-logic-label">Rationale:</span>
                <span>{activeRun.plan.rationale}</span>
              </div>
            )}
          </div>

          <div className="section-label">Planned Actions</div>
          <div className="planned-actions">
            {activeRun.plan.actions.map(action => (
              <div key={action.id} className="planned-action">
                <div className="planned-action-title">{action.title}</div>
                <div className="planned-action-reason">{action.reason || action.type}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function EmptyCopilotState({ onFillComposer }: { onFillComposer: (text: string) => void }) {
  return (
    <div className="empty-copilot-state">
      {SAMPLE_PROMPT_CATEGORIES.map(category => (
        <div key={category} className="sample-category">
          <div className="section-label">{category}</div>
          <div className="suggestion-list">
            {SAMPLE_PROMPTS.filter(prompt => prompt.category === category).slice(0, 3).map(sample => (
              <button
                key={sample.label}
                className="suggestion-pill"
                onClick={() => onFillComposer(sample.prompt)}
                title={sample.prompt}
              >
                {sample.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface AIQnAPanelViewProps {
  panelWidth: number | null;
  panelBodyRef: RefObject<HTMLDivElement | null>;
  messageInputRef: RefObject<HTMLInputElement | null>;
  agentRuns: AgentRun[];
  activeRun: AgentRun | null;
  evidence: AgentEvidencePacket | null;
  tab: PanelTab;
  running: boolean;
  streamingText: string;
  loadingStage: string;
  inputValue: string;
  pendingAlertDraft: PendingAlertDraft | null;
  suggestions: string[];
  onResizeStart: MouseEventHandler<HTMLDivElement>;
  onResizeKeyDown: KeyboardEventHandler<HTMLDivElement>;
  onClearRuns: () => void;
  onClose: () => void;
  onSelectRun: (runId: string) => void;
  onTabChange: (tab: PanelTab) => void;
  onConfirmAlert: () => void;
  onDismissAlert: () => void;
  onFillComposer: (text: string) => void;
  onOpenCitation: (citation: AgentCitation) => void;
  onInputChange: (value: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}

export function AIQnAPanelView({
  panelWidth,
  panelBodyRef,
  messageInputRef,
  agentRuns,
  activeRun,
  evidence,
  tab,
  running,
  streamingText,
  loadingStage,
  inputValue,
  pendingAlertDraft,
  suggestions,
  onResizeStart,
  onResizeKeyDown,
  onClearRuns,
  onClose,
  onSelectRun,
  onTabChange,
  onConfirmAlert,
  onDismissAlert,
  onFillComposer,
  onOpenCitation,
  onInputChange,
  onSubmit,
}: AIQnAPanelViewProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!running) return;
    const activeElement = document.activeElement;
    if (activeElement === messageInputRef.current || !panelRef.current?.contains(activeElement)) {
      closeButtonRef.current?.focus();
    }
  }, [messageInputRef, running]);

  return (
    <div
      ref={panelRef}
      id="urc-copilot-panel"
      role="complementary"
      aria-label={`${BRAND.copilotName} research assistant`}
      aria-busy={running}
      className="ai-panel glass-card"
      style={panelWidth ? { width: `${panelWidth}px`, maxWidth: '100vw' } : undefined}
    >
      <div
        className="ai-panel-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize copilot panel (arrow keys)"
        tabIndex={0}
        onMouseDown={onResizeStart}
        onKeyDown={onResizeKeyDown}
        title="Drag, or focus and use arrow keys, to resize"
      />
      <div className="ai-panel-header">
        <div className="ai-title">
          <Sparkles size={18} className="ai-icon" />
          <span>{BRAND.copilotName}</span>
        </div>
        <div className="ai-header-actions">
          {agentRuns.length > 0 && (
            <button type="button" className="icon-btn-small" onClick={onClearRuns} title="Clear run history" aria-label="Clear copilot run history">
              <ClipboardList size={16} />
            </button>
          )}
          <button ref={closeButtonRef} type="button" className="icon-btn-small" onClick={onClose} title="Close copilot" aria-label="Close copilot">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="ai-panel-body" ref={panelBodyRef}>
        <div className="copilot-hero">
          <div className="copilot-hero-icon">
            <Bot size={18} />
          </div>
          <div>
            <h3>Structured research copilot</h3>
            <p>Ask {BRAND.shortName} to open filings, set filters, prepare peer cohorts, summarize evidence, and draft alerts for review.</p>
          </div>
        </div>

        {agentRuns.length > 1 && (
          <div className="run-history">
            {agentRuns.slice(0, 4).map(run => (
              <button
                key={run.id}
                className={`history-chip ${activeRun?.id === run.id ? 'active' : ''}`}
                onClick={() => onSelectRun(run.id)}
              >
                {run.prompt.length > 42 ? `${run.prompt.slice(0, 42)}...` : run.prompt}
              </button>
            ))}
          </div>
        )}

        {activeRun ? (
          <div className="run-card">
            <div className="run-card-header">
              <div>
                <div className="run-label">Latest request</div>
                <div className="run-prompt">{activeRun.prompt}</div>
              </div>
              <div className={`run-status ${activeRun.status}`}>
                {activeRun.status === 'running'
                  ? <Loader2 size={14} className="spinner" />
                  : activeRun.status === 'completed'
                    ? <CheckCircle2 size={14} />
                    : <AlertTriangle size={14} />}
                <span>{activeRun.status}</span>
              </div>
            </div>

            <div className="panel-tabs">
              {(['answer', 'evidence', 'actions'] as PanelTab[]).map(item => (
                <button key={item} className={tab === item ? 'active' : ''} onClick={() => onTabChange(item)}>
                  {item === 'answer' ? 'Answer' : item === 'evidence' ? 'Evidence' : 'Action Log'}
                </button>
              ))}
            </div>

            {tab === 'answer' && (
              <AnswerTab
                activeRun={activeRun}
                streamingText={streamingText}
                loadingStage={loadingStage}
                pendingAlertDraft={pendingAlertDraft}
                suggestions={suggestions}
                onConfirmAlert={onConfirmAlert}
                onDismissAlert={onDismissAlert}
                onFillComposer={onFillComposer}
              />
            )}
            {tab === 'evidence' && <EvidenceTab evidence={evidence} onOpenCitation={onOpenCitation} />}
            {tab === 'actions' && <ActionsTab activeRun={activeRun} />}
          </div>
        ) : (
          <EmptyCopilotState onFillComposer={onFillComposer} />
        )}

        <ResponsibleAIBanner />
      </div>

      <form className="ai-input-area" onSubmit={onSubmit}>
        <input
          ref={messageInputRef}
          type="text"
          aria-label={`Message ${BRAND.copilotName}`}
          value={inputValue}
          onChange={event => onInputChange(event.target.value)}
          placeholder={`Ask ${BRAND.shortName} to open filings, compare peers, find comment letters, or draft alerts...`}
          disabled={running}
        />
        <button type="submit" disabled={!inputValue.trim() || running} className="send-btn" aria-label={running ? 'Copilot is working' : 'Send message to copilot'}>
          {running ? <Loader2 size={16} className="spinner" /> : <Send size={16} />}
        </button>
      </form>
    </div>
  );
}
