'use client';

import type { ReactNode } from 'react';

/**
 * Renders the AI memo draft's constrained markdown (headings, "- " bullets,
 * **bold**, [n] citation markers) as typeset content. Purpose-built parser —
 * no HTML injection surface, no markdown dependency.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\[\d+\])/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  let part = 0;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b${part}`}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(
        <span key={`${keyPrefix}-c${part}`} className="el-badge el-badge-citation memo-draft-cite">
          {token}
        </span>
      );
    }
    cursor = match.index + token.length;
    part += 1;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}

export default function MemoDraft({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let bullets: ReactNode[] = [];

  const flushBullets = (key: string) => {
    if (bullets.length === 0) return;
    blocks.push(<ul key={key}>{bullets}</ul>);
    bullets = [];
  };

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      flushBullets(`ul-${index}`);
      return;
    }
    if (line.startsWith('## ')) {
      flushBullets(`ul-${index}`);
      blocks.push(<h4 key={`h4-${index}`}>{renderInline(line.slice(3), `h4-${index}`)}</h4>);
    } else if (line.startsWith('# ')) {
      flushBullets(`ul-${index}`);
      blocks.push(<h3 key={`h3-${index}`}>{renderInline(line.slice(2), `h3-${index}`)}</h3>);
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      bullets.push(<li key={`li-${index}`}>{renderInline(line.slice(2), `li-${index}`)}</li>);
    } else {
      flushBullets(`ul-${index}`);
      blocks.push(<p key={`p-${index}`}>{renderInline(line, `p-${index}`)}</p>);
    }
  });
  flushBullets('ul-end');

  return <div className="memo-draft-content">{blocks}</div>;
}
