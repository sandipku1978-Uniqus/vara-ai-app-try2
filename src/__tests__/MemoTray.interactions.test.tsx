import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MemoTray from '../components/memo/MemoTray';
import {
  addCitation,
  clearMemoDraft,
  clearMemoTray,
  getMemoCitations,
} from '../services/memoTray';

const FIRST_CITATION = {
  kind: 'filing' as const,
  cik: '320193',
  accessionNumber: '0000320193-26-000001',
  company: 'Apple Inc.',
  form: '10-K',
  fileDate: '2026-01-30',
  excerpt: 'Supply-chain concentration remains a material risk.',
  sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-2026.htm',
};

const SECOND_CITATION = {
  ...FIRST_CITATION,
  cik: '789019',
  accessionNumber: '0000789019-26-000001',
  company: 'Microsoft Corporation',
  sourceUrl: 'https://www.sec.gov/Archives/edgar/data/789019/000078901926000001/msft-2026.htm',
};

function renderOpenTray() {
  render(<MemoTray />);
  fireEvent.click(screen.getByRole('button', { name: 'Open memo tray (1 citation)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
  expect(screen.getByRole('button', { name: 'Confirm clear all' })).toBeInTheDocument();
}

describe('MemoTray clear confirmation', () => {
  beforeEach(() => {
    clearMemoTray();
    clearMemoDraft();
    addCitation(FIRST_CITATION);
  });

  afterEach(() => {
    vi.useRealTimers();
    clearMemoTray();
    clearMemoDraft();
  });

  it('disarms when focus leaves the destructive action and preserves focus through explicit cancel', async () => {
    const user = userEvent.setup();
    renderOpenTray();
    fireEvent.blur(screen.getByRole('button', { name: 'Confirm clear all' }));
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument();
    expect(getMemoCitations()).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Clear all' }));
    const confirmButton = screen.getByRole('button', { name: 'Confirm clear all' });
    expect(confirmButton).toHaveFocus();
    await user.tab();
    const cancelButton = screen.getByRole('button', { name: 'Cancel clear' });
    expect(cancelButton).toHaveFocus();
    await user.click(cancelButton);
    expect(screen.getByRole('button', { name: 'Clear all' })).toHaveFocus();
    expect(getMemoCitations()).toHaveLength(1);
  });

  it('invalidates authorization when the citation ledger changes', () => {
    renderOpenTray();
    act(() => addCitation(SECOND_CITATION));

    expect(screen.queryByRole('button', { name: 'Confirm clear all' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(getMemoCitations()).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Confirm clear all' })).toBeInTheDocument();
  });

  it('expires destructive authorization after a short timeout', () => {
    vi.useFakeTimers();
    renderOpenTray();

    act(() => vi.advanceTimersByTime(5_001));
    expect(screen.getByRole('button', { name: 'Clear all' })).toBeInTheDocument();
    expect(getMemoCitations()).toHaveLength(1);
  });
});
