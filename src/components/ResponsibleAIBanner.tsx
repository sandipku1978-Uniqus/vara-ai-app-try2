'use client';

import { Info } from 'lucide-react';

export default function ResponsibleAIBanner() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '5px 10px', marginTop: '4px',
      background: 'var(--surface-subtle)',
      border: '1px solid var(--border-color)',
      borderRadius: '4px', fontSize: '0.68rem', color: 'var(--text-muted)',
    }}>
      <Info size={11} style={{ flexShrink: 0, color: 'var(--status-warning)' }} />
      <span>AI-generated — verify before use</span>
    </div>
  );
}
