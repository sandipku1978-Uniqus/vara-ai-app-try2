import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('aiApi', () => {
  beforeEach(() => {
    vi.resetModules();
    mockFetch.mockReset();
  });

  // ── askAi ──
  describe('askAi', () => {
    it('sends a POST request to /api/claude', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'AI response' }),
      });
      const { askAi } = await import('../services/aiApi');
      await askAi('What is revenue recognition?');
      expect(mockFetch).toHaveBeenCalledWith('/api/claude', expect.objectContaining({
        method: 'POST',
      }));
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body).not.toHaveProperty('temperature');
    });

    it('returns response text on success', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'Revenue is recognized when performance obligations are satisfied.' }),
      });
      const { askAi } = await import('../services/aiApi');
      const result = await askAi('What is revenue recognition?');
      expect(result).toContain('Revenue');
    });

    it('returns error message on API failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'Server error' }),
      });
      const { askAi } = await import('../services/aiApi');
      const result = await askAi('test');
      expect(result).toBeTruthy();
    });

    it('includes context when provided', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'Answer with context' }),
      });
      const { askAi } = await import('../services/aiApi');
      await askAi('question', 'filing context here');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prompt).toContain('filing context here');
    });

    it('handles network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      const { askAi } = await import('../services/aiApi');
      const result = await askAi('test');
      expect(result).toBeTruthy();
    });

    it('handles empty response text', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: '' }),
      });
      const { askAi } = await import('../services/aiApi');
      const result = await askAi('test');
      expect(result).toBeTruthy();
    });

    it('propagates empty or upstream failures for strict insight callers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: '' }),
      });
      const { askAi } = await import('../services/aiApi');
      await expect(askAi('test', undefined, { throwOnError: true })).rejects.toThrow('empty');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'AI service is not configured.' }),
      });
      await expect(askAi('test', undefined, { throwOnError: true })).rejects.toThrow('not configured');
    });

    it('handles malformed JSON response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.reject(new Error('Invalid JSON')),
      });
      const { askAi } = await import('../services/aiApi');
      const result = await askAi('test');
      expect(result).toBeTruthy();
    });
  });

  // ── aiSummarize ──
  describe('aiSummarize', () => {
    it('calls Claude API with text', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'Summary here' }),
      });
      const { aiSummarize } = await import('../services/aiApi');
      const result = await aiSummarize('Long filing text about revenue...');
      expect(result).toBe('Summary here');
    });

    it('returns error message on failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Failed'));
      const { aiSummarize } = await import('../services/aiApi');
      const result = await aiSummarize('text');
      expect(result).toBeTruthy();
    });

    it('throws on failure when the caller requests an explicit error state', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Failed'));
      const { aiSummarize } = await import('../services/aiApi');
      await expect(aiSummarize('text', { throwOnError: true })).rejects.toThrow('Failed');
    });
  });

  describe('aiSummarizeRedline', () => {
    it('keeps only claims whose exact evidence is present in the diff', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: JSON.stringify([{
          claim: 'The filing added an explicit cybersecurity oversight statement.',
          significance: 'Review the new governance disclosure.',
          evidence: ['the board oversees cybersecurity risk'],
        }]) }),
      });
      const { aiSummarizeRedline } = await import('../services/aiApi');
      const result = await aiSummarizeRedline('[+the board oversees cybersecurity risk+]');
      expect(result).toContain('cybersecurity oversight');
      expect(result).toContain('Evidence:');
    });

    it('withholds unsupported redline claims', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: JSON.stringify([{
          claim: 'The company completed a reverse merger.',
          significance: 'Transaction completed.',
          evidence: ['evidence not present in the diff'],
        }]) }),
      });
      const { aiSummarizeRedline } = await import('../services/aiApi');
      const result = await aiSummarizeRedline('[+standard cover-page checkbox text+]');
      expect(result).not.toContain('reverse merger');
      expect(result).toContain('No material-change claim passed evidence validation');
    });

    it('throws instead of returning provider error copy for strict redline callers', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: 'AI service is not configured.' }),
      });
      const { aiSummarizeRedline } = await import('../services/aiApi');

      await expect(aiSummarizeRedline('[+changed disclosure+]', { throwOnError: true }))
        .rejects.toThrow('AI service is not configured.');
    });
  });

  // ── aiAnalyzeS1 ──
  describe('aiAnalyzeS1', () => {
    it('supports overview section', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'Business overview analysis' }),
      });
      const { aiAnalyzeS1 } = await import('../services/aiApi');
      const result = await aiAnalyzeS1('S-1 filing text...', 'overview');
      expect(result).toBe('Business overview analysis');
    });

    it('supports risk-factors section', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'Risk factors analysis' }),
      });
      const { aiAnalyzeS1 } = await import('../services/aiApi');
      const result = await aiAnalyzeS1('S-1 text', 'risk-factors');
      expect(result).toBe('Risk factors analysis');
    });

    it('supports financials section', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'Financial analysis' }),
      });
      const { aiAnalyzeS1 } = await import('../services/aiApi');
      const result = await aiAnalyzeS1('S-1 text', 'financials');
      expect(result).toBe('Financial analysis');
    });

    it('supports management section', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'Management analysis' }),
      });
      const { aiAnalyzeS1 } = await import('../services/aiApi');
      const result = await aiAnalyzeS1('S-1 text', 'management');
      expect(result).toBe('Management analysis');
    });

    it('truncates very long filing text', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'Result' }),
      });
      const { aiAnalyzeS1 } = await import('../services/aiApi');
      const longText = 'x'.repeat(100000);
      await aiAnalyzeS1(longText, 'overview');
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.prompt.length).toBeLessThan(100000);
    });

    it('defaults to overview for unknown section', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'Default analysis' }),
      });
      const { aiAnalyzeS1 } = await import('../services/aiApi');
      const result = await aiAnalyzeS1('text', 'nonexistent');
      expect(result).toBe('Default analysis');
    });

    it('rejects when analysis cannot be generated instead of returning pseudo-analysis', async () => {
      mockFetch.mockRejectedValueOnce(new Error('API down'));
      const { aiAnalyzeS1 } = await import('../services/aiApi');
      await expect(aiAnalyzeS1('text', 'overview')).rejects.toThrow('API down');
    });
  });

  describe('aiAscLookup', () => {
    it('rejects when guidance cannot be generated instead of returning a fallback answer', async () => {
      mockFetch.mockRejectedValueOnce(new Error('API down'));
      const { aiAscLookup } = await import('../services/aiApi');
      await expect(aiAscLookup('ASC 606')).rejects.toThrow('API down');
    });
  });

  // ── aiExtractBoardData ──
  describe('aiExtractBoardData', () => {
    it('returns parsed board data on success', async () => {
      const boardData = {
        directors: [{ name: 'John', role: 'Chairman', independent: true, committees: ['Audit'] }],
        compensation: [],
        boardSize: 1,
        independencePercent: 100,
        diversity: { malePercent: 100, femalePercent: 0 },
        ceoPayRatio: 'N/A',
        sayOnPayApproval: 'N/A',
      };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: JSON.stringify(boardData) }),
      });
      const { aiExtractBoardData } = await import('../services/aiApi');
      const result = await aiExtractBoardData('DEF 14A text');
      expect(result).not.toBeNull();
      expect(result!.directors.length).toBe(1);
    });

    it('returns null on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Failed'));
      const { aiExtractBoardData } = await import('../services/aiApi');
      const result = await aiExtractBoardData('text');
      expect(result).toBeNull();
    });

    it('maps missing, absent, and malformed model ratings to unrated', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          text: JSON.stringify({
            Climate: 'high',
            Water: 'absent',
            Privacy: 'excellent',
            'Unrequested Topic': 'high',
          }),
        }),
      });
      const { aiRateESGDisclosure } = await import('../services/aiApi');
      const result = await aiRateESGDisclosure('10-K text', ['Climate', 'Water', 'Privacy', 'Labor']);

      expect(result).toEqual({
        Climate: 'high',
        Water: 'unrated',
        Privacy: 'unrated',
        Labor: 'unrated',
      });
    });
  });

  // ── aiRateESGDisclosure ──
  describe('aiRateESGDisclosure', () => {
    it('returns ratings map on success', async () => {
      const ratings = { 'Climate Change': 'high', 'Water Usage': 'low' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: JSON.stringify(ratings) }),
      });
      const { aiRateESGDisclosure } = await import('../services/aiApi');
      const result = await aiRateESGDisclosure('10-K text', ['Climate Change', 'Water Usage']);
      expect(result).not.toBeNull();
      expect(result!['Climate Change']).toBe('high');
    });

    it('returns null on error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Failed'));
      const { aiRateESGDisclosure } = await import('../services/aiApi');
      const result = await aiRateESGDisclosure('text', ['topic']);
      expect(result).toBeNull();
    });
  });

  // ── aiExtractDealDetails ──
  describe('aiExtractDealDetails', () => {
    it('returns deal details on success', async () => {
      const deal = { target: 'TargetCo', acquirer: 'AcquirerCo', value: '$1B', dealType: 'Merger Agreement', sector: 'Technology' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: JSON.stringify(deal) }),
      });
      const { aiExtractDealDetails } = await import('../services/aiApi');
      const result = await aiExtractDealDetails('8-K filing text');
      expect(result).not.toBeNull();
      expect(result!.target).toBe('TargetCo');
    });

    it('rejects on error instead of returning an empty deal result', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Failed'));
      const { aiExtractDealDetails } = await import('../services/aiApi');
      await expect(aiExtractDealDetails('text')).rejects.toThrow('Failed');
    });

    it('rejects malformed deal details instead of treating them as no result', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ text: 'not valid JSON' }),
      });
      const { aiExtractDealDetails } = await import('../services/aiApi');
      await expect(aiExtractDealDetails('text')).rejects.toThrow('valid deal details');
    });
  });

  describe('aiExtractClauses', () => {
    it('rejects on provider failure instead of returning an empty clause result', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Failed'));
      const { aiExtractClauses } = await import('../services/aiApi');
      await expect(aiExtractClauses('agreement text', ['No-shop'])).rejects.toThrow('Failed');
    });
  });
});
