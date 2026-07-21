'use client';

import { Bot } from 'lucide-react';
import { useApp } from '../../context/AppState';

interface AskCopilotButtonProps {
  /** The prompt to send to the copilot when clicked */
  prompt: string;
  /** Optional: compact mode for table cells */
  compact?: boolean;
  /** Optional: custom label */
  label?: string;
}

/**
 * Inline button that opens the copilot with a pre-filled prompt about a specific filing/result.
 * Use in DataTable column renders for per-row AI analysis.
 */
export default function AskCopilotButton({ prompt, compact = false, label }: AskCopilotButtonProps) {
  const { isChatOpen, setChatOpen, enqueueAgentPrompt } = useApp();

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation(); // Don't trigger row click
    setChatOpen(true);
    enqueueAgentPrompt(prompt);
  }

  if (compact) {
    return (
      <button
        onClick={handleClick}
        type="button"
        aria-label={`Ask Copilot: ${prompt}`}
        aria-expanded={isChatOpen}
        aria-controls="urc-copilot-panel"
        title={`Ask Copilot: ${prompt.slice(0, 80)}...`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '3px',
          background: 'none', border: 'none',
          color: 'var(--accent-primary)', cursor: 'pointer', padding: '2px 4px',
          fontSize: '0.75rem',
        }}
      >
        <Bot size={12} aria-hidden="true" />
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      type="button"
      aria-label={`${label || 'Analyze'} with Copilot: ${prompt}`}
      aria-expanded={isChatOpen}
      aria-controls="urc-copilot-panel"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        background: 'var(--surface-accent)', border: '1px solid var(--border-color)',
        borderRadius: '4px', padding: '3px 8px', color: 'var(--accent-primary)', cursor: 'pointer',
        fontSize: '0.75rem', transition: 'background-color 0.2s, border-color 0.2s',
      }}
    >
      <Bot size={12} aria-hidden="true" /> {label || 'Analyze'}
    </button>
  );
}
