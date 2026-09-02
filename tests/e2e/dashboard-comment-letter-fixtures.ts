import type { Page, Route } from '@playwright/test';
import { buildCompleteSecCompanyDirectory } from './sec-company-directory-fixture';

/**
 * Deterministic records shared by the dashboard and comment-letter action
 * journeys. These fixtures model the API contracts the views consume; the
 * journeys can therefore prove navigation and retry behavior without making
 * EDGAR availability part of the UI assertion.
 */

export const DASHBOARD_AAPL_FILING = {
  cik: '320193',
  ticker: 'AAPL',
  issuer: 'Apple Inc.',
  form: '10-K',
  filed: '2026-02-01',
  accession: '0000320193-26-000101',
  document: 'aapl-2026.htm',
  text: 'Apple fixture annual report evidence.',
};

const DASHBOARD_MSFT_FILING = {
  cik: '789019',
  ticker: 'MSFT',
  issuer: 'Microsoft Corporation',
  form: '8-K',
  filed: '2026-03-04',
  accession: '0000789019-26-000202',
  document: 'msft-2026-8k.htm',
  text: 'Microsoft fixture current report evidence.',
};

const DASHBOARD_FILINGS = [DASHBOARD_AAPL_FILING, DASHBOARD_MSFT_FILING];

function dashboardSubmission(filing: typeof DASHBOARD_AAPL_FILING) {
  return {
    cik: filing.cik,
    name: filing.issuer,
    tickers: [filing.ticker],
    exchanges: ['Nasdaq'],
    ein: '',
    description: 'Deterministic dashboard fixture issuer.',
    sic: '3571',
    sicDescription: 'Electronic Computers',
    stateOfIncorporation: 'CA',
    filings: {
      recent: {
        accessionNumber: [filing.accession],
        filingDate: [filing.filed],
        reportDate: [filing.filed],
        acceptanceDateTime: [`${filing.filed}T16:00:00.000Z`],
        act: ['34'],
        form: [filing.form],
        fileNumber: ['001-00001'],
        filmNumber: ['26000001'],
        items: [''],
        size: [1_000_000],
        isXBRL: [1],
        isInlineXBRL: [1],
        primaryDocument: [filing.document],
        primaryDocDescription: [filing.form],
      },
      files: [],
    },
  };
}

/** Layer after installWatchlistFixtures so these exact filing identities win. */
export async function installDashboardActionFixtures(page: Page): Promise<void> {
  await page.route(url => new URL(url).pathname === '/api/stats', route => fulfillJson(route, {
    filings: { count: 2, through: '2026-03-04', source: 'SEC EDGAR fixture' },
    auditors: { count: 1, source: 'PCAOB fixture' },
    letters: { count: 2, withText: 2, source: 'SEC EDGAR fixture' },
  }));

  await page.route('**/api/filing-text**', async (route: Route) => {
    const document = new URL(route.request().url()).searchParams.get('document') || '';
    const filing = DASHBOARD_FILINGS.find(item => document.includes(item.document));
    if (!filing) {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, text: filing.text, cached: true }),
    });
  });

  await page.route('**/api/sec-proxy**', async (route: Route) => {
    const requestUrl = new URL(route.request().url());
    const path = requestUrl.searchParams.get('path') || '';
    const submissions = path.match(/submissions\/CIK0*(\d+)\.json/i);
    if (submissions) {
      const filing = DASHBOARD_FILINGS.find(item => item.cik === String(Number(submissions[1])));
      if (filing) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(dashboardSubmission(filing)),
        });
        return;
      }
    }

    const filing = DASHBOARD_FILINGS.find(item => path.includes(item.document));
    if (filing) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: `<html><body><h1>${filing.issuer}</h1><p>${filing.text}</p></body></html>`,
      });
      return;
    }

    await route.fallback();
  });
}

export const COMMENT_THREAD_ID = 'thread-letterhaven-1';

export const COMMENT_THREAD = {
  thread_id: COMMENT_THREAD_ID,
  cik: 900,
  company_name: 'Letterhaven Industries',
  letters: 2,
  uploads: 1,
  corresps: 1,
  first_letter: '2026-03-04',
  last_letter: '2026-04-11',
};

export const COMMENT_LETTERS = [
  {
    accession: '0000000900-26-000900',
    cik: 900,
    company_name: COMMENT_THREAD.company_name,
    form: 'UPLOAD',
    date_filed: '2026-03-04',
    thread_id: COMMENT_THREAD_ID,
    filename: 'staff-letter.htm',
    has_text: true,
    preview: 'The Staff asked the company to explain its principal-versus-agent revenue conclusion.',
    headline: 'The Staff challenged <b>revenue recognition</b> for principal-agent arrangements.',
    rank: 0.95,
  },
  {
    accession: '0000000900-26-000901',
    cik: 900,
    company_name: COMMENT_THREAD.company_name,
    form: 'CORRESP',
    date_filed: '2026-04-11',
    thread_id: COMMENT_THREAD_ID,
    filename: 'company-response.htm',
    has_text: true,
    preview: 'The company responded with its control analysis and revised the revenue-recognition disclosure.',
    headline: 'The company provided its <b>revenue recognition</b> analysis and revised disclosure.',
    rank: 0.9,
  },
];

/**
 * A registrant whose name CONTAINS the fixture issuer's name. A name filter
 * matches both; only a CIK filter keeps them apart — which is the difference
 * the scope-company journey exists to prove.
 */
export const COMMENT_LOOKALIKE_THREAD = {
  thread_id: 'thread-letterhaven-trust-1',
  cik: 901,
  company_name: `${COMMENT_THREAD.company_name} Trust`,
  letters: 2,
  uploads: 1,
  corresps: 1,
  first_letter: '2026-02-10',
  last_letter: '2026-03-01',
};

/** The browse page holds twelve episodes, so fourteen need exactly one Load more. */
export const COMMENT_BROWSE_THREADS = [
  COMMENT_THREAD,
  COMMENT_LOOKALIKE_THREAD,
  ...Array.from({ length: 12 }, (_, index) => {
    const ordinal = String(index + 1).padStart(2, '0');
    return {
      thread_id: `thread-filler-${ordinal}`,
      cik: 9_100 + index,
      company_name: `Filler Episode ${ordinal} Corp`,
      letters: 2,
      uploads: 1,
      corresps: 1,
      first_letter: '2025-01-01',
      last_letter: '2025-01-15',
    };
  }),
];

export const COMMENT_DIRECTORY = buildCompleteSecCompanyDirectory([
  { cik_str: COMMENT_THREAD.cik, ticker: 'LTHV', title: COMMENT_THREAD.company_name },
  { cik_str: COMMENT_LOOKALIKE_THREAD.cik, ticker: 'LTHT', title: COMMENT_LOOKALIKE_THREAD.company_name },
]);

/** Deterministic extra matches so a search can span more than one page. */
export function commentSearchFillers(count: number) {
  return Array.from({ length: count }, (_, index) => {
    const ordinal = String(index + 1).padStart(2, '0');
    return {
      accession: `0000009200-26-${String(index + 1).padStart(6, '0')}`,
      cik: 9_200 + index,
      company_name: `Filler Match ${ordinal} Corp`,
      form: index % 2 === 0 ? 'UPLOAD' : 'CORRESP',
      date_filed: '2025-06-01',
      thread_id: `thread-filler-match-${ordinal}`,
      filename: `filler-${ordinal}.htm`,
      headline: `Filler excerpt ${ordinal} on <b>revenue recognition</b>.`,
      rank: 0.5,
    };
  });
}

export const COMMENT_TOPIC_QUERY = 'revenue recognition performance obligation principal agent';
export const COMMENT_RETRY_SUMMARY = 'The Staff challenged principal-versus-agent revenue recognition; the company responded with revised disclosure.';

export interface CommentLetterFixtureOptions {
  browseFailures?: number;
  searchFailures?: number;
  threadFailures?: number;
  summaryGetFailures?: number;
  summaryPostFailures?: number;
  /** Filler matches appended to every search answer, for paging journeys. */
  extraSearchMatches?: number;
}

function pageOf<T>(rows: T[], requestUrl: URL, defaultSize: number): { total: number; page: T[] } {
  const from = Math.max(0, Number(requestUrl.searchParams.get('from') || 0));
  const size = Math.max(1, Number(requestUrl.searchParams.get('size') || defaultSize));
  return { total: rows.length, page: rows.slice(from, from + size) };
}

export interface CommentLetterFixtureStats {
  browseRequests: string[];
  searchRequests: string[];
  threadRequests: string[];
  summaryGetRequests: number;
  summaryPostRequests: number;
  recoverBrowse: () => void;
  recoverSearch: () => void;
  recoverThread: () => void;
  recoverSummaryGet: () => void;
  recoverSummaryPost: () => void;
}

function fulfillJson(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify(body),
  });
}

/**
 * Install a complete comment-letter API with opt-in failures that remain
 * active until the test explicitly recovers that source. Keeping a failure
 * latched makes the fixture deterministic under React's development-time
 * effect replay. The returned counters let retry tests prove that a click
 * issued a fresh request for the same operation and criteria, not merely that
 * its error disappeared.
 */
export async function installCommentLetterFixtures(
  page: Page,
  options: CommentLetterFixtureOptions = {}
): Promise<CommentLetterFixtureStats> {
  let browseUnavailable = (options.browseFailures ?? 0) > 0;
  let searchUnavailable = (options.searchFailures ?? 0) > 0;
  let threadUnavailable = (options.threadFailures ?? 0) > 0;
  let summaryGetUnavailable = (options.summaryGetFailures ?? 0) > 0;
  let summaryPostUnavailable = (options.summaryPostFailures ?? 0) > 0;
  const stats: CommentLetterFixtureStats = {
    browseRequests: [],
    searchRequests: [],
    threadRequests: [],
    summaryGetRequests: 0,
    summaryPostRequests: 0,
    recoverBrowse: () => { browseUnavailable = false; },
    recoverSearch: () => { searchUnavailable = false; },
    recoverThread: () => { threadUnavailable = false; },
    recoverSummaryGet: () => { summaryGetUnavailable = false; },
    recoverSummaryPost: () => { summaryPostUnavailable = false; },
  };

  await page.route(url => new URL(url).pathname === '/api/stats', route => fulfillJson(route, {
    letters: {
      count: 2,
      withText: 2,
      through: '2026-04-11',
      lastTextFetch: '2026-04-12T12:00:00.000Z',
      retryPending: 0,
      source: 'SEC EDGAR (UPLOAD/CORRESP)',
    },
  }));

  // Register the broad route first; Playwright gives the later, more-specific
  // summary route precedence.
  await page.route(url => new URL(url).pathname === '/api/letters', async route => {
    const requestUrl = new URL(route.request().url());
    const thread = requestUrl.searchParams.get('thread');
    const query = requestUrl.searchParams.get('q');

    if (thread) {
      stats.threadRequests.push(requestUrl.search);
      if (threadUnavailable) {
        await fulfillJson(route, { error: 'fixture thread unavailable' }, 503);
        return;
      }
      await fulfillJson(route, { thread, letters: thread === COMMENT_THREAD_ID ? COMMENT_LETTERS : [] });
      return;
    }

    if (query) {
      stats.searchRequests.push(requestUrl.search);
      if (searchUnavailable) {
        await fulfillJson(route, { error: 'fixture search unavailable' }, 502);
        return;
      }
      const form = requestUrl.searchParams.get('form');
      // The search RPC narrows by registrant-name substring only (there is
      // no CIK parameter), and this fixture models exactly that.
      const company = (requestUrl.searchParams.get('company') || '').toLowerCase();
      const matches = [...COMMENT_LETTERS, ...commentSearchFillers(options.extraSearchMatches ?? 0)]
        .filter(letter => !form || letter.form === form)
        .filter(letter => !company || letter.company_name.toLowerCase().includes(company))
        .map(letter => ({
          accession: letter.accession,
          cik: letter.cik,
          company_name: letter.company_name,
          form: letter.form,
          date_filed: letter.date_filed,
          thread_id: letter.thread_id,
          filename: letter.filename,
          headline: letter.headline,
          rank: letter.rank,
        }));
      const { total, page } = pageOf(matches, requestUrl, 20);
      await fulfillJson(route, { total, matches: page });
      return;
    }

    stats.browseRequests.push(requestUrl.search);
    if (browseUnavailable) {
      await fulfillJson(route, { error: 'fixture corpus unavailable' }, 503);
      return;
    }
    // The browse RPC takes either a CIK (exact) or a name substring.
    const cik = requestUrl.searchParams.get('cik');
    const company = (requestUrl.searchParams.get('company') || '').toLowerCase();
    const threads = COMMENT_BROWSE_THREADS
      .filter(thread => !cik || String(thread.cik) === cik)
      .filter(thread => !company || thread.company_name.toLowerCase().includes(company));
    const { total, page } = pageOf(threads, requestUrl, 20);
    await fulfillJson(route, { total, threads: page });
  });

  // The company picker resolves suggestions from the SEC directory; the
  // fixture directory carries the issuer and its look-alike so a pick has a
  // CIK to resolve to.
  await page.route('**/api/sec-proxy**', async route => {
    const path = new URL(route.request().url()).searchParams.get('path') || '';
    if (!path.includes('company_tickers.json')) {
      await route.fallback();
      return;
    }
    await fulfillJson(route, COMMENT_DIRECTORY);
  });

  await page.route(url => new URL(url).pathname === '/api/letters/summary', async route => {
    if (route.request().method() === 'POST') {
      stats.summaryPostRequests += 1;
      if (summaryPostUnavailable) {
        await fulfillJson(route, { error: 'fixture generation unavailable' }, 503);
        return;
      }
      await fulfillJson(route, {
        thread: COMMENT_THREAD_ID,
        summary: COMMENT_RETRY_SUMMARY,
        model: 'fixture-model',
        generatedAt: '2026-04-12T12:00:00.000Z',
        coverage: {
          totalLetters: 2,
          lettersWithText: 2,
          lettersRepresented: 2,
          truncatedLetters: 0,
          missingTextLetters: 0,
          omittedLetters: 0,
          method: 'fixture',
        },
      });
      return;
    }

    stats.summaryGetRequests += 1;
    if (summaryGetUnavailable) {
      await fulfillJson(route, { error: 'fixture cache unavailable' }, 503);
      return;
    }
    await fulfillJson(route, { error: 'not generated' }, 404);
  });

  return stats;
}
