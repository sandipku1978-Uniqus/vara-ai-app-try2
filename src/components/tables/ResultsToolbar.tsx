'use client';

import { useState } from 'react';
import { Bot, ClipboardCopy, Download, CheckCircle2, AlertCircle } from 'lucide-react';
import { useApp } from '../../context/AppState';
import { buildCsv } from '../../utils/csv';

export { buildCsv, escapeCsvCell } from '../../utils/csv';

interface ResultsToolbarProps {
  /** Array of data rows currently displayed */
  data: Record<string, any>[];
  /** Column keys to include in export (in order) */
  columns: Array<{ key: string; label?: string; header?: string }>;
  /** Label for the dataset (used in filename) */
  label?: string;
  /** Optional: pre-built prompt for "Analyze in Copilot" */
  copilotPrompt?: string;
}

function rowToText(row: Record<string, any>, columns: Array<{ key: string; label?: string; header?: string }>): string {
  return columns.map(col => {
    const val = row[col.key];
    return val != null ? String(val) : '';
  }).join('\t');
}

/**
 * Universal toolbar for search result tables.
 * Provides: Export CSV, Copy to Clipboard, Analyze in Copilot.
 */
export default function ResultsToolbar({ data, columns, label = 'results', copilotPrompt }: ResultsToolbarProps) {
  const { setChatOpen, enqueueAgentPrompt } = useApp();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  if (data.length === 0) return null;

  function handleExportCsv() {
    const csv = buildCsv(data, columns);
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeLabel = label.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'results';
    link.download = `URC_${safeLabel}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function handleCopy() {
    const header = columns.map(col => col.label || col.header || col.key).join('\t');
    const rows = data.map(row => rowToText(row, columns));
    setCopyError(false);
    try {
      await navigator.clipboard.writeText([header, ...rows].join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      setCopyError(true);
      setTimeout(() => setCopyError(false), 3000);
    }
  }

  function handleAnalyzeInCopilot() {
    const snapshot = data.slice(0, 20).map(row => rowToText(row, columns)).join('\n');
    const prompt = copilotPrompt?.trim() || [
      `Analyze these ${data.length} ${label} results.`,
      'Identify supported patterns, notable outliers, and practical next steps based only on this immutable result snapshot.',
      `${columns.map(col => col.label || col.header || col.key).join('\t')}\n${snapshot}`,
    ].join('\n\n');
    setChatOpen(true);
    enqueueAgentPrompt(prompt);
  }

  return (
    <div role="toolbar" aria-label={`${label} result actions`} style={{
      display: 'flex',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: '8px',
      padding: '8px 0',
      marginBottom: '8px',
      borderBottom: '1px solid var(--border-color)',
      fontSize: '0.8rem',
    }}>
      <span style={{ color: 'var(--text-muted)', marginRight: '4px' }}>
        {data.length} result{data.length !== 1 ? 's' : ''}
      </span>

      <button
        type="button"
        onClick={handleExportCsv}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          background: 'var(--surface-subtle)', border: '1px solid var(--border-color)',
          borderRadius: '6px', padding: '4px 10px', color: 'var(--text-secondary)', cursor: 'pointer',
          fontSize: '0.78rem', transition: 'border-color 0.2s',
        }}
        title="Export as CSV"
      >
        <Download size={13} /> CSV
      </button>

      <button
        type="button"
        onClick={handleCopy}
        aria-live="polite"
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          background: 'var(--interactive-hover)', border: '1px solid var(--border-color)',
          borderRadius: '6px', padding: '4px 10px', color: copyError ? 'var(--status-error)' : copied ? 'var(--status-success)' : 'var(--text-secondary)', cursor: 'pointer',
          fontSize: '0.78rem', transition: 'color 0.2s, border-color 0.2s',
        }}
        title="Copy table to clipboard"
      >
        {copyError ? <><AlertCircle size={13} /> Copy failed</> : copied ? <><CheckCircle2 size={13} /> Copied</> : <><ClipboardCopy size={13} /> Copy</>}
      </button>

      <button
        type="button"
        onClick={handleAnalyzeInCopilot}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          background: 'var(--interactive-hover-strong)',
          border: '1px solid color-mix(in srgb, var(--accent-primary) 30%, transparent)',
          borderRadius: '6px', padding: '4px 10px', color: 'var(--accent-primary)', cursor: 'pointer',
          fontSize: '0.78rem', transition: 'border-color 0.2s',
        }}
        title="Analyze these results with URC Copilot"
      >
        <Bot size={13} /> Analyze in Copilot
      </button>
    </div>
  );
}
