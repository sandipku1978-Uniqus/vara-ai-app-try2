import { aiSummarize } from './aiApi';

export const SEARCH_TREND_AI_FALLBACK = 'AI insight is unavailable. Showing deterministic statistics derived from the current result set.';

type SummarizeTrend = (
  prompt: string,
  options: { throwOnError?: boolean }
) => Promise<string>;

export async function generateSearchTrendReport(
  prompt: string,
  deterministicSummary: string,
  summarize: SummarizeTrend = aiSummarize
): Promise<{ report: string; aiError: string }> {
  try {
    return {
      report: await summarize(prompt, { throwOnError: true }),
      aiError: '',
    };
  } catch {
    return {
      report: deterministicSummary,
      aiError: SEARCH_TREND_AI_FALLBACK,
    };
  }
}
