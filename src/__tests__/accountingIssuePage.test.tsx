import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import Page, { generateStaticParams } from '../app/accounting/[topic]/page';
import { ACCOUNTING_ISSUES } from '../config/accountingTopics';
import { DISCLOSURE_TOPICS } from '../services/disclosureTopics';
import {
  assembleAsuIndex,
  parseEffectiveDates,
  parseIssuedListing,
  parseProposedListing,
  type AsuIndex,
} from '../services/asuIndex';

vi.mock('next/navigation', () => ({
  notFound: () => { throw new Error('NEXT_NOT_FOUND'); },
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/accounting/segment-reporting',
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * The issue page is exercised through its App Router page, with every service
 * running for real and only the network mocked: /api/asu answers from the
 * saved FASB fixtures, /api/letters from a recorded-shape payload, and every
 * other request (the filing search's SEC calls) fails, so the precedents panel
 * must show its source and a non-authoritative failure rather than a zero.
 */

const FIXTURES = join(process.cwd(), 'src', '__tests__', 'fixtures', 'fasb');
const asuIndex: AsuIndex = assembleAsuIndex({
  issued: { id: 'issued', origin: 'live', httpStatus: 200, readAt: '2026-10-05T03:57:14.000Z', parsed: parseIssuedListing(JSON.parse(readFileSync(join(FIXTURES, 'issued-listing.json'), 'utf8'))) },
  effective: { id: 'effective-dates', origin: 'live', httpStatus: 200, readAt: '2026-10-05T03:57:14.000Z', parsed: parseEffectiveDates(JSON.parse(readFileSync(join(FIXTURES, 'effective-dates-first-40.json'), 'utf8'))) },
  proposed: { id: 'proposed', origin: 'live', httpStatus: 200, readAt: '2026-10-05T03:57:14.000Z', parsed: parseProposedListing(JSON.parse(readFileSync(join(FIXTURES, 'documents-open-for-comment.json'), 'utf8'))) },
}, '2026-10-05T03:57:15.000Z');

const fetchLog: string[] = [];

function respond(url: string): Response {
  const parsed = new URL(url, 'https://urc.test');
  if (parsed.pathname === '/api/asu') {
    const topic = parsed.searchParams.get('topic') || '';
    const entries = asuIndex.entries.filter(entry => !topic || entry.ascTopics.includes(topic) || entry.ascSubtopics.includes(topic));
    return Response.json({ ok: true, entries, coverage: asuIndex.coverage });
  }
  if (parsed.pathname === '/api/letters') {
    return Response.json({
      total: 214,
      totalIsFloor: false,
      matches: [
        { accession: '0000000000-24-000001', cik: 1, company_name: 'Example Industries Inc.', form: 'UPLOAD', date_filed: '2024-06-03', thread_id: 'thread-1', filename: 'filename1.pdf', headline: 'identify your <b>CODM</b> and explain how <b>operating segments</b> were determined', rank: 0.9 },
      ],
    });
  }
  return new Response('upstream unavailable', { status: 503 });
}

beforeEach(() => {
  fetchLog.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    fetchLog.push(url);
    return respond(url);
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderIssue(topic: string) {
  const element = await Page({ params: Promise.resolve({ topic }) });
  return render(element);
}

describe('/accounting/[topic] issue pages', () => {
  it('prerenders exactly one page per disclosure topic', () => {
    expect(generateStaticParams().map(params => params.topic)).toEqual(DISCLOSURE_TOPICS.map(topic => topic.id));
    expect(ACCOUNTING_ISSUES).toHaveLength(DISCLOSURE_TOPICS.length);
  });

  it('rejects an unknown issue as not found', async () => {
    await expect(Page({ params: Promise.resolve({ topic: 'not-a-topic' }) })).rejects.toThrow('NEXT_NOT_FOUND');
  });

  it('renders all five panels, each stating its source and coverage', async () => {
    await renderIssue('segment-reporting');

    expect(screen.getByRole('heading', { level: 1, name: 'Segment reporting' })).toBeInTheDocument();
    const panels = ['Precedents', 'Staff comments', 'Authoritative references', 'Uniqus guidance', 'Peer comparison'];
    for (const name of panels) {
      const panel = screen.getByRole('region', { name });
      expect(within(panel).getByText('Source')).toBeInTheDocument();
      expect(within(panel).getByText('Coverage')).toBeInTheDocument();
    }

    const precedents = screen.getByRole('region', { name: 'Precedents' });
    expect(within(precedents).getByText(/SEC EDGAR filings/)).toBeInTheDocument();
    expect(within(precedents).getByText(/Research library entry/)).toBeInTheDocument();
    expect(within(precedents).getByText(/cites ASU 2023-07/)).toBeInTheDocument();

    const letters = screen.getByRole('region', { name: 'Staff comments' });
    expect(within(letters).getByText(/SEC comment-letter corpus/)).toBeInTheDocument();
    await waitFor(() => expect(within(letters).getByText('Showing 1 of 214 matching letters, most relevant first')).toBeInTheDocument());
    expect(within(letters).getByRole('link', { name: 'Example Industries Inc.' })).toHaveAttribute('href', '/comment-letters?thread=thread-1');
    expect(within(letters).getByText('CODM').tagName).toBe('MARK');

    const references = screen.getByRole('region', { name: 'Authoritative references' });
    expect(within(references).getByText(/FASB Codification \(licensed/)).toBeInTheDocument();
    expect(within(references).getByRole('link', { name: /ASC 280/ })).toHaveAttribute('href', 'https://asc.fasb.org/280/');
    await waitFor(() => expect(within(references).getByRole('link', { name: 'ASU 2023-07' })).toBeInTheDocument());
    expect(within(references).getByRole('link', { name: 'ASU 2023-07' })).toHaveAttribute('href', '/accounting?tab=asu&asu=2023-07#asu-2023-07');
    expect(within(references).getByRole('link', { name: /Filings citing ASU 2023-07/ }).getAttribute('href')).toMatch(/^\/search\?v=1&cites=ASU\+2023-07&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&forms=10-K$/);
    expect(within(references).getByText(/name ASC 280 in their titles, of 236 indexed \(read live from fasb\.org, read 2026-10-05\)/)).toBeInTheDocument();
    expect(fetchLog).toContain('/api/asu?topic=280');

    const guidance = screen.getByRole('region', { name: 'Uniqus guidance' });
    expect(within(guidance).getByText(/Reviewed internal guidance/)).toBeInTheDocument();
    expect(within(guidance).getByText(/No knowledge-base entry maps to ASC 280/)).toBeInTheDocument();
    expect(within(guidance).getByRole('textbox', { name: 'Question about Segment reporting' })).toBeInTheDocument();

    const peers = screen.getByRole('region', { name: 'Peer comparison' });
    expect(within(peers).getByRole('link', { name: 'Compare peers on segment reporting' })).toHaveAttribute('href', '/compare?topic=segment-reporting');

    // The precedent search went to the network and failed there; the panel
    // says so instead of reporting zero precedents.
    await waitFor(() => expect(within(precedents).getByRole('alert')).toHaveTextContent('The precedent search failed. This is not an authoritative zero'), { timeout: 4000 });
    expect(within(precedents).getByText(/search did not complete/)).toBeInTheDocument();
    expect(fetchLog.some(url => url.startsWith('/api/sec-efts?') && url.includes('ASU+2023-07') && url.includes('forms=10-K'))).toBe(true);
    expect(within(precedents).getByRole('link', { name: 'Open this search in the Research Workbench' }).getAttribute('href'))
      .toMatch(/^\/search\?v=1&q=segment&mode=boolean&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&cites=ASU\+2023-07&forms=10-K$/);
  });

  it('shows the knowledge-base excerpt as reviewed internal guidance when one maps to the issue', async () => {
    await renderIssue('leases');
    const guidance = screen.getByRole('region', { name: 'Uniqus guidance' });
    expect(within(guidance).getByText(/2 knowledge-base entries map to ASC 842/)).toBeInTheDocument();
    expect(within(guidance).getByText('IFRS 16 — Leases')).toBeInTheDocument();
    expect(within(guidance).getAllByText(/reviewed internal guidance/).length).toBeGreaterThan(0);
  });

  it('labels an issue outside the Codification instead of matching ASUs to it', async () => {
    await renderIssue('critical-audit-matters');
    const references = screen.getByRole('region', { name: 'Authoritative references' });
    expect(within(references).getByText('This issue is not a Codification topic, so no ASUs are matched to it.')).toBeInTheDocument();
    expect(within(references).getByRole('link', { name: /AS 3101/ })).toHaveAttribute('href', 'https://pcaobus.org/oversight/standards/auditing-standards/details/AS3101');
    expect(fetchLog.some(url => url.startsWith('/api/asu'))).toBe(false);
  });
});
