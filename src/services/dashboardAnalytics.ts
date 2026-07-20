import { countFilingsByMonth, type SecSubmission } from './secApi';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function buildWatchlistAnalytics(
  watchlist: string[],
  submissionsByTicker: Record<string, SecSubmission>,
  year: number,
  throughMonthIndex: number
): {
  filingVolumeData: Record<string, string | number | null>[];
  filingMix: Array<{ form: string; count: number }>;
  unavailableTickers: string[];
} {
  const unavailableTickers = watchlist.filter(ticker => !submissionsByTicker[ticker]);
  const countsByTicker = Object.fromEntries(watchlist.map(ticker => [
    ticker,
    submissionsByTicker[ticker] ? countFilingsByMonth(submissionsByTicker[ticker], year) : {},
  ]));
  const filingVolumeData = MONTHS.slice(0, Math.min(Math.max(throughMonthIndex, 0), 11) + 1).map(month => ({
    month,
    ...Object.fromEntries(watchlist.map(ticker => [
      ticker,
      submissionsByTicker[ticker] ? countsByTicker[ticker]?.[month] || 0 : null,
    ])),
  }));

  const formCounts = new Map<string, number>();
  for (const ticker of watchlist) {
    const submission = submissionsByTicker[ticker];
    if (!submission) continue;
    const recent = submission.filings.recent;
    recent.form.forEach((form, index) => {
      if (!recent.filingDate[index]?.startsWith(String(year))) return;
      formCounts.set(form, (formCounts.get(form) || 0) + 1);
    });
  }
  const filingMix = Array.from(formCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([form, count]) => ({ form, count }));

  return { filingVolumeData, filingMix, unavailableTickers };
}
