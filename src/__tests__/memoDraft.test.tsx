import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import MemoDraft from '../components/memo/MemoDraft';

const SAMPLE = [
  '# Research memo — Organon & Co.',
  '',
  '## Purpose',
  'Summarize the cited **10-K** evidence.',
  '',
  '## Evidence summary',
  '- Organon & Co. filed a **Form 10-K** on 2026-02-24 [1].',
  '- The filing was audited by PwC [1].',
  '',
  '## Open questions',
  '- Restatement scope requires the prior-year filing [1].',
].join('\n');

describe('MemoDraft renderer', () => {
  it('typesets headings, bullets, bold, and citation badges', () => {
    render(<MemoDraft text={SAMPLE} />);

    expect(screen.getByRole('heading', { level: 3 }).textContent).toContain('Organon & Co.');
    const sections = screen.getAllByRole('heading', { level: 4 }).map(h => h.textContent);
    expect(sections).toEqual(['Purpose', 'Evidence summary', 'Open questions']);

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getAllByText('[1]')).toHaveLength(3);
    expect(screen.getByText('Form 10-K').tagName).toBe('STRONG');
    // No raw markdown syntax leaks into the rendered output
    expect(document.body.textContent).not.toContain('##');
    expect(document.body.textContent).not.toContain('**');
  });
});
