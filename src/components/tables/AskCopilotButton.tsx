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
  const { setChatOpen, startAgentRun } = useApp();

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation(); // Don't trigger row click
    setChatOpen(true);
    // Small delay to ensure panel is open before starting the run
    setTimeout(() => {
      startAgentRun(prompt);
    }, 100);
  }

  if (compact) {
    return (
      <button
        onClick={handleClick}
        title={`Ask Copilot: ${prompt.slice(0, 80)}...`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '3px',
          background: 'none', border: 'none',
          color: '#D66CAE', cursor: 'pointer', padding: '2px 4px',
          fontSize: '0.75rem', opacity: 0.8, transition: 'opacity 0.2s',
        }}
        onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '0.8')}
      >
        <Bot size={12} />
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: '4px',
        background: 'rgba(214,108,174,0.1)', border: '1px solid rgba(214,108,174,0.2)',
        borderRadius: '6px', padding: '3px 8px', color: '#D66CAE', cursor: 'pointer',
        fontSize: '0.75rem', transition: 'background 0.2s',
      }}
    >
      <Bot size={12} /> {label || 'Analyze'}
    </button>
  );
}
