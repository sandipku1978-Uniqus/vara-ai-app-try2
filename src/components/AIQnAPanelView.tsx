import {
  useEffect,
  useRef,
  useState,
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
  FileDown,
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
import type { AiAnswerMeta } from '../services/aiApi';
import ResponsibleAIBanner from './ResponsibleAIBanner';
import { exportAnswerDocx, answerFileStem } from '../services/answerExport';
import { buildAnswerEvidencePackage, fetchAppVersion } from '../services/evidencePackage';
import { exportEvidencePackageJson, readSessionDisplayName } from '../services/memoExport';
import type { PanelTab } from './AIQnAPanel.helpers';
import { AnswerModelLine, WebSourcesList } from './ai/AnswerModelMeta';
import { ModelSelector } from './ai/ModelSelector';

/**
 * Answer footer export: one icon button opening a two-item menu — the Word
 * document (answer, citations, evidence packet, evidence-package appendix)
 * or the evidence package alone as JSON.
 */
function AnswerExportButton({ run, evidence }: { run: AgentRun; evidence: AgentEvidencePacket | null }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [open]);

  async function exportAs(format: 'docx' | 'json') {
    setOpen(false);
    setBusy(true);
    setFailed(false);
    try {
      const generatedAt = new Date();
      const evidencePackage = buildAnswerEvidencePackage({ run, evidence, generatedAt, appVersion: await fetchAppVersion() });
      if (format === 'json') exportEvidencePackageJson(evidencePackage, answerFileStem(run, generatedAt));
      else await exportAnswerDocx({ run, evidence, author: readSessionDisplayName(), generatedAt, evidencePackage });
    } catch (error) {
      console.error('Answer export failed:', error);
      setFailed(true);
    } finally {
      setBusy(false);
      buttonRef.current?.focus();
    }
  }

  return (
    <div
      className="answer-export"
      style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
      // Focus leaving the control and its menu closes the menu.
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn-small"
        aria-label="Export this answer"
        aria-haspopup="menu"
        aria-expanded={open}
        title="Export answer to Word, or its evidence package as JSON"
        disabled={busy}
        onClick={() => setOpen(current => !current)}
      >
        {busy ? <Loader2 size={15} className="spinner" /> : <FileDown size={15} />}
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Export this answer"
          className="answer-export-menu"
          style={{
            position: 'absolute', right: 0, bottom: 'calc(100% + 4px)', zIndex: 5, display: 'flex', flexDirection: 'column',
            minWidth: '200px', padding: '4px', borderRadius: '6px', border: '1px solid var(--border-color)',
            background: 'var(--surface-panel)', boxShadow: '0 8px 20px color-mix(in srgb, var(--text-primary) 14%, transparent)',
          }}
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              buttonRef.current?.focus();
            } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || []);
              const index = items.indexOf(document.activeElement as HTMLButtonElement);
              const next = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
              items[next]?.focus();
            }
          }}
        >
          {(['docx', 'json'] as const).map(format => (
            <button
              key={format}
              type="button"
              role="menuitem"
              onClick={() => void exportAs(format)}
              style={{ textAlign: 'left', padding: '6px 10px', border: 'none', borderRadius: '4px', background: 'transparent', color: 'var(--text-primary)', fontSize: '0.78rem', cursor: 'pointer' }}
            >
              {format === 'docx' ? 'Word document (.docx)' : 'Evidence package (.json)'}
            </button>
          ))}
        </div>
      )}
      {failed && <span role="alert" style={{ fontSize: '0.72rem', color: 'var(--status-error)' }}>Export failed — retry.</span>}
    </div>
  );
}

interface AnswerTabProps {
  activeRun: AgentRun;
  evidence: AgentEvidencePacket | null;
  streamingText: string;
  loadingStage: string;
  pendingAlertDraft: PendingAlertDraft | null;
  suggestions: string[];
  answerMeta: AiAnswerMeta | null;
  onConfirmAlert: () => void;
  onDismissAlert: () => void;
  onFillComposer: (text: string) => void;
}

function AnswerTab({
  activeRun,
  evidence,
  streamingText,
  loadingStage,
  pendingAlertDraft,
  suggestions,
  answerMeta,
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

      {activeRun.answer && (answerMeta || activeRun.status === 'completed') && (
        <>
          <div className="copilot-answer-footer">
            <div className="copilot-answer-footer-start">
              {answerMeta && <AnswerModelLine meta={answerMeta} />}
            </div>
            {activeRun.status === 'completed' && <AnswerExportButton run={activeRun} evidence={evidence} />}
          </div>
          {answerMeta && <WebSourcesList sources={answerMeta.webSources} />}
        </>
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
  /** What the server reported answering the active run, when it reported it. */
  answerMeta?: AiAnswerMeta | null;
  /** Model ids the gateway can serve; null/undefined = unknown, offer the full registry. */
  availableModelIds?: Set<string> | null;
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
  answerMeta = null,
  availableModelIds = null,
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
                evidence={evidence}
                streamingText={streamingText}
                loadingStage={loadingStage}
                pendingAlertDraft={pendingAlertDraft}
                suggestions={suggestions}
                answerMeta={answerMeta}
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
        <ModelSelector availableModelIds={availableModelIds} />
        <button type="submit" disabled={!inputValue.trim() || running} className="send-btn" aria-label={running ? 'Copilot is working' : 'Send message to copilot'}>
          {running ? <Loader2 size={16} className="spinner" /> : <Send size={16} />}
        </button>
      </form>
    </div>
  );
}
