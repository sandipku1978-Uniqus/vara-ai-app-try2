import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import AsuIndexPanel, { filterAsuEntries } from '../components/accounting/AsuIndexPanel';
import {
  assembleAsuIndex,
  parseEffectiveDates,
  parseIssuedListing,
  parseProposedListing,
} from '../services/asuIndex';

const FIXTURES = join(process.cwd(), 'src', '__tests__', 'fixtures', 'fasb');
const load = (name: string) => JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
// The saved-copy path: FASB refused the server, so every page is the snapshot.
const index = assembleAsuIndex({
  issued: { id: 'issued', origin: 'snapshot', httpStatus: 403, readAt: '2026-10-05T03:57:14.000Z', parsed: parseIssuedListing(load('issued-listing.json')), error: 'fasb.org refused the server\'s request (HTTP 403, Cloudflare bot protection).' },
  effective: { id: 'effective-dates', origin: 'snapshot', httpStatus: 403, readAt: '2026-10-05T03:57:14.000Z', parsed: parseEffectiveDates(load('effective-dates-first-40.json')), error: 'blocked' },
  proposed: { id: 'proposed', origin: 'snapshot', httpStatus: 403, readAt: '2026-10-05T03:57:14.000Z', parsed: parseProposedListing(load('documents-open-for-comment.json')), error: 'blocked' },
}, '2026-10-05T04:00:00.000Z');

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ok: true, entries: index.entries, coverage: index.coverage })));
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ASU index tab', () => {
  it('states that the rows come from the saved FASB copy, and when it was read', async () => {
    render(<AsuIndexPanel />);
    expect(await screen.findByText(/served from the saved fasb\.org copy because fasb\.org refused the server \(read 2026-10-05\)/)).toBeInTheDocument();
    expect(screen.getByText('Showing 236 of 236 Updates')).toBeInTheDocument();
  });

  it('highlights and scrolls to a deep-linked row, with its PDF, citing-filings search, and issue page', async () => {
    render(<AsuIndexPanel focusNumber="2023-07" />);
    const row = (await screen.findByText('ASU 2023-07')).closest('li')!;
    expect(row).toHaveAttribute('id', 'asu-2023-07');
    expect(row.className).toContain('asu-index-row--target');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(within(row).getByText('Issued November 2023 · ASC 280')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: /PDF on fasb\.org/ })).toHaveAttribute('href', expect.stringContaining('ASU%202023-07.pdf'));
    expect(within(row).getByRole('link', { name: 'Filings citing ASU 2023-07 (10-K, last 2 years)' }).getAttribute('href')).toMatch(/^\/search\?v=1&cites=ASU\+2023-07&/);
    expect(within(row).getByRole('link', { name: 'Issue page: Segment reporting' })).toHaveAttribute('href', '/accounting/segment-reporting');
  });

  it('filters by number, title, or topic, and by status', async () => {
    render(<AsuIndexPanel />);
    await screen.findByText('ASU 2023-07');
    fireEvent.change(screen.getByLabelText('Filter ASUs by number, title, or ASC topic'), { target: { value: '842' } });
    expect(screen.getByText('ASU 2016-02')).toBeInTheDocument();
    expect(screen.queryByText('ASU 2023-07')).toBeNull();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'proposed' } });
    expect(screen.queryByText('ASU 2016-02')).toBeNull();

    expect(filterAsuEntries(index.entries, 'ASU 2023-07', 'all').map(entry => entry.number)).toEqual(['2023-07']);
    expect(filterAsuEntries(index.entries, '', 'proposed')).toHaveLength(3);
  });
});
