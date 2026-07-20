import { describe, expect, it, vi } from 'vitest';
import { generateSearchTrendReport, SEARCH_TREND_AI_FALLBACK } from '../services/searchTrendReport';

describe('search trend report generation', () => {
  it('requires strict AI errors and returns the generated report on success', async () => {
    const summarize = vi.fn().mockResolvedValue('AI report');

    await expect(generateSearchTrendReport('prompt', 'deterministic report', summarize)).resolves.toEqual({
      report: 'AI report',
      aiError: '',
    });
    expect(summarize).toHaveBeenCalledWith('prompt', { throwOnError: true });
  });

  it('labels the deterministic fallback when AI is unavailable', async () => {
    const summarize = vi.fn().mockRejectedValue(new Error('AI service is not configured.'));

    await expect(generateSearchTrendReport('prompt', 'deterministic report', summarize)).resolves.toEqual({
      report: 'deterministic report',
      aiError: SEARCH_TREND_AI_FALLBACK,
    });
  });
});
