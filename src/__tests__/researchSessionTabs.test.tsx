import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import ResearchSessionTabs, { researchTabId } from '../components/research/ResearchSessionTabs';
import { defaultSearchFilters } from '../components/filters/SearchFilterBar';
import type { ResearchSearchSession } from '../services/researchSessions';

function session(id: string, title: string): ResearchSearchSession {
  return {
    id,
    title,
    query: title,
    mode: 'semantic',
    filters: { ...defaultSearchFilters },
    results: [],
    isRefining: false,
    searched: true,
    errorMsg: '',
    interpretation: [],
    resolvedSearch: {
      query: title,
      mode: 'semantic',
      filters: { ...defaultSearchFilters },
    },
    selectedResultId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('ResearchSessionTabs', () => {
  it('renders the caller-owned empty state without creating a tab list', () => {
    render(
      <ResearchSessionTabs
        sessions={[]}
        emptyMessage="No saved searches"
        onSelect={() => {}}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('No saved searches')).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('selects tabs by click and exposes stable panel relationships', () => {
    const first = session('search one', 'Material weakness');
    const second = session('search/two', 'Lease disclosures');
    const onSelect = vi.fn();
    render(
      <ResearchSessionTabs
        sessions={[first, second]}
        activeSessionId={first.id}
        emptyMessage="No searches"
        onSelect={onSelect}
        onClose={() => {}}
      />
    );

    const active = screen.getByRole('tab', { name: /material weakness/i });
    const next = screen.getByRole('tab', { name: /lease disclosures/i });
    expect(active).toHaveAttribute('aria-selected', 'true');
    expect(active).toHaveAttribute('id', researchTabId(first.id));
    expect(next).toHaveAttribute('aria-controls', `research-panel-${second.id}`);

    fireEvent.click(next);
    expect(onSelect).toHaveBeenCalledWith(second);
  });

  it('supports wrapped arrow navigation plus Home and End', () => {
    const first = session('one', 'First');
    const second = session('two', 'Second');
    const third = session('three', 'Third');
    const onSelect = vi.fn();
    render(
      <ResearchSessionTabs
        sessions={[first, second, third]}
        activeSessionId={first.id}
        emptyMessage="No searches"
        onSelect={onSelect}
        onClose={() => {}}
      />
    );

    fireEvent.keyDown(screen.getByRole('tab', { name: /first/i }), { key: 'ArrowLeft' });
    expect(onSelect).toHaveBeenLastCalledWith(third);

    fireEvent.keyDown(screen.getByRole('tab', { name: /second/i }), { key: 'Home' });
    expect(onSelect).toHaveBeenLastCalledWith(first);

    fireEvent.keyDown(screen.getByRole('tab', { name: /first/i }), { key: 'End' });
    expect(onSelect).toHaveBeenLastCalledWith(third);
  });

  it('closes only the requested session', () => {
    const first = session('one', 'First');
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(
      <ResearchSessionTabs
        sessions={[first]}
        activeSessionId={first.id}
        emptyMessage="No searches"
        onSelect={onSelect}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /close first search/i }));
    expect(onClose).toHaveBeenCalledWith(first.id);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
