import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act, waitFor } from '@testing-library/react';
import { AppProvider, useApp } from '../context/AppState';
import React from 'react';
import { buildStorageScope, scopedStorageKey } from '../services/storageNamespace';

function TestConsumer({ onRender }: { onRender: (ctx: ReturnType<typeof useApp>) => void }) {
  const ctx = useApp();
  React.useEffect(() => { onRender(ctx); });
  return null;
}

function renderWithProvider(onRender: (ctx: ReturnType<typeof useApp>) => void) {
  return render(
    <AppProvider>
      <TestConsumer onRender={onRender} />
    </AppProvider>
  );
}

describe('AppState', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  describe('useApp', () => {
    it('throws when used outside AppProvider', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => {
        render(<TestConsumer onRender={() => {}} />);
      }).toThrow('useApp must be used within an AppProvider');
      errorSpy.mockRestore();
    });
  });

  describe('watchlist', () => {
    it('reloads identity data on user and organization changes without cross-overwriting', async () => {
      const testGlobal = globalThis as typeof globalThis & {
        __urcTestAuth?: { isLoaded: boolean; userId: string | null; orgId: string | null };
      };
      const keyA = scopedStorageKey('vara.watchlist.v1', buildStorageScope('user_a', 'org_1'))!;
      const keyB = scopedStorageKey('vara.watchlist.v1', buildStorageScope('user_b', 'org_1'))!;
      const keyBOrg2 = scopedStorageKey('vara.watchlist.v1', buildStorageScope('user_b', 'org_2'))!;
      window.localStorage.setItem(keyA, JSON.stringify(['AAA']));
      window.localStorage.setItem(keyB, JSON.stringify(['BBB']));
      window.localStorage.setItem(keyBOrg2, JSON.stringify(['CCC']));
      testGlobal.__urcTestAuth = { isLoaded: true, userId: 'user_a', orgId: 'org_1' };

      let watchlist: string[] = [];
      const renderTree = () => (
        <AppProvider>
          <TestConsumer onRender={ctx => { watchlist = ctx.watchlist; }} />
        </AppProvider>
      );
      const { rerender } = render(renderTree());
      await waitFor(() => expect(watchlist).toEqual(['AAA']));

      testGlobal.__urcTestAuth = { isLoaded: true, userId: 'user_b', orgId: 'org_1' };
      rerender(renderTree());
      await waitFor(() => expect(watchlist).toEqual(['BBB']));
      expect(JSON.parse(window.localStorage.getItem(keyB)!)).toEqual(['BBB']);

      testGlobal.__urcTestAuth = { isLoaded: true, userId: 'user_b', orgId: 'org_2' };
      rerender(renderTree());
      await waitFor(() => expect(watchlist).toEqual(['CCC']));
      expect(JSON.parse(window.localStorage.getItem(keyBOrg2)!)).toEqual(['CCC']);
      expect(JSON.parse(window.localStorage.getItem(keyA)!)).toEqual(['AAA']);
    });

    it('initializes with default watchlist', () => {
      let watchlist: string[] = [];
      renderWithProvider(ctx => { watchlist = ctx.watchlist; });
      expect(watchlist).toContain('AAPL');
      expect(watchlist).toContain('MSFT');
    });

    it('adds to watchlist', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      act(() => { ctx!.addToWatchlist('TSLA'); });
      expect(ctx!.watchlist).toContain('TSLA');
    });

    it('does not add duplicate tickers', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      const initialLength = ctx!.watchlist.length;
      act(() => { ctx!.addToWatchlist('AAPL'); });
      expect(ctx!.watchlist.length).toBe(initialLength);
    });

    it('uppercases ticker on add', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      act(() => { ctx!.addToWatchlist('googl'); });
      expect(ctx!.watchlist).toContain('GOOGL');
    });

    it('removes from watchlist', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      act(() => { ctx!.removeFromWatchlist('AAPL'); });
      expect(ctx!.watchlist).not.toContain('AAPL');
    });

    it('ignores empty ticker', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      const before = ctx!.watchlist.length;
      act(() => { ctx!.addToWatchlist(''); });
      expect(ctx!.watchlist.length).toBe(before);
    });

    it('trims whitespace from ticker', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      act(() => { ctx!.addToWatchlist('  NVDA  '); });
      expect(ctx!.watchlist).toContain('NVDA');
    });
  });

  describe('chat', () => {
    it('starts with initial AI message', () => {
      let history: any[] = [];
      renderWithProvider(ctx => { history = ctx.chatHistory; });
      expect(history.length).toBe(1);
      expect(history[0].role).toBe('ai');
    });

    it('adds chat messages', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      act(() => { ctx!.addChatMessage({ role: 'user', content: 'Hello' }); });
      expect(ctx!.chatHistory.length).toBe(2);
      expect(ctx!.chatHistory[1].content).toBe('Hello');
    });

    it('assigns unique ID to each message', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      act(() => {
        ctx!.addChatMessage({ role: 'user', content: 'A' });
        ctx!.addChatMessage({ role: 'user', content: 'B' });
      });
      const ids = ctx!.chatHistory.map(m => m.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });

    it('sets timestamp on messages', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      act(() => { ctx!.addChatMessage({ role: 'user', content: 'Test' }); });
      expect(ctx!.chatHistory[1].timestamp).toBeTruthy();
    });
  });

  describe('chat open state', () => {
    it('starts with chat closed', () => {
      let isOpen = true;
      renderWithProvider(ctx => { isOpen = ctx.isChatOpen; });
      expect(isOpen).toBe(false);
    });

    it('toggles chat open', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      act(() => { ctx!.setChatOpen(true); });
      expect(ctx!.isChatOpen).toBe(true);
    });
  });

  describe('search query', () => {
    it('starts empty', () => {
      let query = 'not empty';
      renderWithProvider(ctx => { query = ctx.searchQuery; });
      expect(query).toBe('');
    });

    it('updates search query', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      act(() => { ctx!.setSearchQuery('revenue recognition'); });
      expect(ctx!.searchQuery).toBe('revenue recognition');
    });
  });

  describe('agent runs', () => {
    it('starts with empty agent runs', () => {
      let runs: any[] = [];
      renderWithProvider(ctx => { runs = ctx.agentRuns; });
      expect(runs).toEqual([]);
    });

    it('starts a new agent run', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      let runId: string = '';
      act(() => { runId = ctx!.startAgentRun('Find Apple 10-K'); });
      expect(runId).toBeTruthy();
      expect(ctx!.agentRuns.length).toBe(1);
      expect(ctx!.agentRuns[0].status).toBe('running');
    });

    it('queues external Copilot prompts until the panel executor consumes them', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      let requestId = '';

      act(() => { requestId = ctx!.enqueueAgentPrompt('  Analyze this filing  '); });

      expect(requestId).toBeTruthy();
      expect(ctx!.agentPromptQueue).toHaveLength(1);
      expect(ctx!.agentPromptQueue[0].prompt).toBe('Analyze this filing');
      expect(ctx!.agentRuns).toEqual([]);

      act(() => { ctx!.removeAgentPromptRequest(requestId); });
      expect(ctx!.agentPromptQueue).toEqual([]);
    });

    it('updates an agent run', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      let runId: string = '';
      act(() => { runId = ctx!.startAgentRun('test'); });
      act(() => { ctx!.updateAgentRun(runId, { status: 'completed', answer: 'Done' }); });
      expect(ctx!.agentRuns[0].status).toBe('completed');
      expect(ctx!.agentRuns[0].answer).toBe('Done');
    });

    it('appends agent log entry', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      let runId: string = '';
      act(() => { runId = ctx!.startAgentRun('test'); });
      act(() => {
        ctx!.appendAgentLog(runId, {
          type: 'search_filings',
          title: 'Searching',
          detail: 'Searching for filings',
          status: 'completed',
        });
      });
      expect(ctx!.agentRuns[0].actionLog.length).toBe(1);
    });

    it('clears agent runs', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      act(() => { ctx!.startAgentRun('test'); });
      act(() => { ctx!.clearAgentRuns(); });
      expect(ctx!.agentRuns).toEqual([]);
      expect(ctx!.activeAgentRunId).toBeNull();
    });

    it('limits agent runs to 20', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      act(() => {
        for (let i = 0; i < 25; i++) {
          ctx!.startAgentRun(`run ${i}`);
        }
      });
      expect(ctx!.agentRuns.length).toBeLessThanOrEqual(20);
    });
  });

  describe('saved alerts', () => {
    it('starts with empty alerts', () => {
      let alerts: any[] = [];
      renderWithProvider(ctx => { alerts = ctx.savedAlerts; });
      expect(alerts).toEqual([]);
    });

    it('adds a saved alert', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      act(() => {
        ctx!.addSavedAlert({
          name: 'Revenue Alert',
          query: 'revenue',
          mode: 'semantic',
          filters: {} as any,
          defaultForms: '10-K',
        });
      });
      expect(ctx!.savedAlerts.length).toBe(1);
      expect(ctx!.savedAlerts[0].name).toBe('Revenue Alert');
    });

    it('prevents duplicate alerts', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      const alert = {
        name: 'Test',
        query: 'revenue',
        mode: 'semantic' as const,
        filters: {} as any,
        defaultForms: '10-K',
      };
      act(() => { ctx!.addSavedAlert(alert); });
      act(() => { ctx!.addSavedAlert(alert); });
      expect(ctx!.savedAlerts.length).toBe(1);
    });

    it('removes a saved alert', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      act(() => {
        ctx!.addSavedAlert({ name: 'Test', query: 'q', mode: 'semantic', filters: {} as any, defaultForms: '10-K' });
      });
      const alertId = ctx!.savedAlerts[0].id;
      act(() => { ctx!.removeSavedAlert(alertId); });
      expect(ctx!.savedAlerts.length).toBe(0);
    });

    it('updates a saved alert', () => {
      let ctx: ReturnType<typeof useApp> | null = null;
      renderWithProvider(c => { ctx = c; });
      act(() => {
        ctx!.addSavedAlert({ name: 'Test', query: 'q', mode: 'semantic', filters: {} as any, defaultForms: '10-K' });
      });
      const alertId = ctx!.savedAlerts[0].id;
      act(() => { ctx!.updateSavedAlert(alertId, { name: 'Updated' }); });
      expect(ctx!.savedAlerts[0].name).toBe('Updated');
    });
  });
});
