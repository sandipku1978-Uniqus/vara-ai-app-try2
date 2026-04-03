'use client';

import { useState } from 'react';
import { Bot, ClipboardCopy, Download, CheckCircle2 } from 'lucide-react';
import { useApp } from '../../context/AppState';

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

function buildCsv(data: Record<string, any>[], columns: Array<{ key: string; label?: string; header?: string }>): string {
  const header = columns.map(col => col.label || col.header || col.key).join(',');
  const rows = data.map(row =>
    columns.map(col => {
      const val = row[col.key] != null ? String(row[col.key]) : '';
      return val.includes(',') || val.includes('"') || val.includes('\n')
        ? `"${val.replace(/"/g, '""')}"`
        : val;
    }).join(',')
  );
  return [header, ...rows].join('\n');
}

/**
 * Universal toolbar for search result tables.
 * Provides: Export CSV, Copy to Clipboard, Analyze in Copilot.
 */
export default function ResultsToolbar({ data, columns, label = 'results', copilotPrompt }: ResultsToolbarProps) {
  const { setChatOpen } = useApp();
  const [copied, setCopied] = useState(false);

  if (data.length === 0) return null;

  function handleExportCsv() {
    const csv = buildCsv(data, columns);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `URC_${label.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleCopy() {
    const header = columns.map(col => col.label || col.header || col.key).join('\t');
    const rows = data.map(row => rowToText(row, columns));
    navigator.clipboard.writeText([header, ...rows].join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function handleAnalyzeInCopilot() {
    setChatOpen(true);
    // The copilot will pick up context from activeSearchContext
    // If a specific prompt is provided, we could set it — but for now opening the panel is sufficient
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      padding: '8px 0',
      marginBottom: '8px',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      fontSize: '0.8rem',
    }}>
      <span style={{ color: '#64748B', marginRight: '4px' }}>
        {data.length} result{data.length !== 1 ? 's' : ''}
      </span>

      <button
        onClick={handleExportCsv}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '6px', padding: '4px 10px', color: '#94A3B8', cursor: 'pointer',
          fontSize: '0.78rem', transition: 'border-color 0.2s',
        }}
        title="Export as CSV"
      >
        <Download size={13} /> CSV
      </button>

      <button
        onClick={handleCopy}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: '6px', padding: '4px 10px', color: copied ? '#4ade80' : '#94A3B8', cursor: 'pointer',
          fontSize: '0.78rem', transition: 'color 0.2s, border-color 0.2s',
        }}
        title="Copy table to clipboard"
      >
        {copied ? <><CheckCircle2 size={13} /> Copied</> : <><ClipboardCopy size={13} /> Copy</>}
      </button>

      <button
        onClick={handleAnalyzeInCopilot}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '4px',
          background: 'linear-gradient(135deg, rgba(72,40,121,0.3), rgba(178,30,125,0.3))',
          border: '1px solid rgba(214,108,174,0.3)',
          borderRadius: '6px', padding: '4px 10px', color: '#D66CAE', cursor: 'pointer',
          fontSize: '0.78rem', transition: 'border-color 0.2s',
        }}
        title="Analyze these results with URC Copilot"
      >
        <Bot size={13} /> Analyze in Copilot
      </button>
    </div>
  );
}
