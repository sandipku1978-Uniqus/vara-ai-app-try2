import type { Page, Route } from '@playwright/test';

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

export const COMMENT_TOPIC_QUERY = 'revenue recognition performance obligation principal agent';
export const COMMENT_RETRY_SUMMARY = 'The Staff challenged principal-versus-agent revenue recognition; the company responded with revised disclosure.';

export interface CommentLetterFixtureOptions {
  browseFailures?: number;
  searchFailures?: number;
  threadFailures?: number;
  summaryGetFailures?: number;
  summaryPostFailures?: number;
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
      const matches = COMMENT_LETTERS
        .filter(letter => !form || letter.form === form)
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
      await fulfillJson(route, { total: matches.length, matches });
      return;
    }

    stats.browseRequests.push(requestUrl.search);
    if (browseUnavailable) {
      await fulfillJson(route, { error: 'fixture corpus unavailable' }, 503);
      return;
    }
    const company = requestUrl.searchParams.get('company') || '';
    const threads = company && !COMMENT_THREAD.company_name.toLowerCase().includes(company.toLowerCase())
      ? []
      : [COMMENT_THREAD];
    await fulfillJson(route, { total: threads.length, threads });
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
