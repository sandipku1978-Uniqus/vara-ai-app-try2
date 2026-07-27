/**
 * Exact corpus counts above EDGAR's 10,000 ceiling.
 *
 * EFTS stops counting a single query at 10,000 (`total.relation: 'gte'`) —
 * which is why the corpus headline says "10,000+" where Intelligize shows an
 * exact figure. But counts of DATE SLICES are exact whenever each slice stays
 * under the ceiling, and they sum: count per year, split any saturated year
 * into months, add them up. ~26 cheap requests buy the number the headline
 * could not otherwise state.
 *
 * Honesty rules carry through: if even a single MONTH saturates the ceiling
 * (it happens for the very broadest phrases), the sum is reported as a floor
 * — the affordance upgrades precision, it never fabricates exactness.
 *
 * The counting fetcher is injected so the aggregation logic is unit-testable
 * without a network.
 */

import { buildSecEftsUrl, normalizeEftsForms } from './secApi';

export interface ExactCountRequest {
  query: string;
  forms?: string;
  dateFrom?: string;
  dateTo?: string;
  entityName?: string;
  entityCik?: string;
}

export interface ExactCountResult {
  total: number;
  /** True when some slice still saturated the ceiling — the total is a floor. */
  floor: boolean;
  requests: number;
}

export interface SliceCount {
  total: number;
  /** EFTS said "at least" — the slice saturated the counting ceiling. */
  saturated: boolean;
}

export type SliceCounter = (startDate: string, endDate: string) => Promise<SliceCount>;

const EFTS_COUNT_CEILING = 10_000;
const FTS_FLOOR_YEAR = 2001;
/** Pacing between count requests — same posture as the legacy retrieval lane. */
const INTER_REQUEST_DELAY_MS = 220;

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Year slices [start, end] covering the request's date window. */
export function planYearSlices(dateFrom?: string, dateTo?: string): Array<{ start: string; end: string }> {
  const startYear = dateFrom ? Number(dateFrom.slice(0, 4)) : FTS_FLOOR_YEAR;
  const endYear = dateTo ? Number(dateTo.slice(0, 4)) : new Date().getFullYear();
  const slices: Array<{ start: string; end: string }> = [];
  for (let year = startYear; year <= endYear; year += 1) {
    const start = year === startYear && dateFrom ? dateFrom : `${year}-01-01`;
    const end = year === endYear && dateTo ? dateTo : `${year}-12-31`;
    slices.push({ start, end });
  }
  return slices;
}

/** Month slices within one year slice. */
export function planMonthSlices(start: string, end: string): Array<{ start: string; end: string }> {
  const year = Number(start.slice(0, 4));
  const slices: Array<{ start: string; end: string }> = [];
  for (let month = 1; month <= 12; month += 1) {
    const mm = String(month).padStart(2, '0');
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const sliceStart = `${year}-${mm}-01`;
    const sliceEnd = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
    if (sliceEnd < start || sliceStart > end) continue;
    slices.push({ start: sliceStart < start ? start : sliceStart, end: sliceEnd > end ? end : sliceEnd });
  }
  return slices;
}

/**
 * Sum exact counts across date slices, splitting saturated years into months.
 * Pure aggregation over an injected counter.
 */
export async function aggregateExactCount(
  countSlice: SliceCounter,
  dateFrom: string | undefined,
  dateTo: string | undefined,
  onProgress?: (label: string) => void,
  signal?: AbortSignal
): Promise<ExactCountResult> {
  let total = 0;
  let floor = false;
  let requests = 0;

  // A failed slice must not abort the whole count: skip it and mark the sum a
  // floor — "at least N" stays honest where a partial sum presented as exact
  // would not, and one transient SEC 500 out of ~26 requests is routine.
  const countOrFloor = async (start: string, end: string): Promise<SliceCount | null> => {
    try {
      const count = await countSlice(start, end);
      requests += 1;
      return count;
    } catch {
      requests += 1;
      floor = true;
      return null;
    }
  };

  for (const year of planYearSlices(dateFrom, dateTo)) {
    if (signal?.aborted) { floor = true; break; }
    onProgress?.(year.start.slice(0, 4));
    const yearCount = await countOrFloor(year.start, year.end);
    if (!yearCount) continue;

    if (!yearCount.saturated) {
      total += yearCount.total;
      continue;
    }

    // The year saturated the ceiling — months almost never do.
    for (const month of planMonthSlices(year.start, year.end)) {
      if (signal?.aborted) { floor = true; break; }
      onProgress?.(month.start.slice(0, 7));
      const monthCount = await countOrFloor(month.start, month.end);
      if (!monthCount) continue;
      total += monthCount.total;
      if (monthCount.saturated) floor = true;
    }
  }

  return { total, floor, requests };
}

/** EFTS-backed slice counter for one search request, with per-slice retries. */
export function buildEftsSliceCounter(request: ExactCountRequest): SliceCounter {
  return async (startDate, endDate) => {
    const params: Record<string, string> = {
      q: request.query,
      dateRange: 'custom',
      startdt: startDate,
      enddt: endDate,
      from: '0',
    };
    if (request.forms) params.forms = normalizeEftsForms(request.forms);
    if (request.entityCik) params.ciks = request.entityCik.padStart(10, '0');
    else if (request.entityName) params.entityName = request.entityName;

    // SEC intermittently 500s under bursts (observed live when a count ran
    // while a refinement pass was still paging). Retry with backoff before
    // giving the slice up to the caller's floor handling.
    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await delay(700 * attempt);
      const response = await fetch(buildSecEftsUrl('LATEST/search-index', params));
      if (!response.ok) {
        lastStatus = response.status;
        if (response.status === 429 || response.status >= 500) continue;
        break;
      }
      const data = await response.json() as { hits?: { total?: { value?: number; relation?: string } } };
      const value = Number(data.hits?.total?.value ?? 0);
      const saturated = data.hits?.total?.relation === 'gte' || value >= EFTS_COUNT_CEILING;
      await delay(INTER_REQUEST_DELAY_MS);
      return { total: value, saturated };
    }
    throw new Error(`EFTS count failed: ${lastStatus}`);
  };
}

/** Count the exact number of EFTS matches for a request, date-sliced. */
export async function countExactMatches(
  request: ExactCountRequest,
  options: { onProgress?: (label: string) => void; signal?: AbortSignal } = {}
): Promise<ExactCountResult> {
  return aggregateExactCount(
    buildEftsSliceCounter(request),
    request.dateFrom,
    request.dateTo,
    options.onProgress,
    options.signal
  );
}
