import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ push: vi.fn() }));
const app = vi.hoisted(() => ({ setPendingCompareIntent: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => '/search',
  useRouter: () => ({ push: navigation.push }),
}));
vi.mock('../context/AppState', () => ({ useApp: () => app }));

import CartTray from '../components/cart/CartTray';
import CartToggle from '../components/cart/CartToggle';
import { clearDocumentCart, getDocumentCart, type CartFilingInput } from '../services/documentCart';
import { clearMemoTray, getMemoCitations } from '../services/memoTray';
import { setActiveBrowserStorageScope } from '../services/storageNamespace';

const APPLE: CartFilingInput = {
  cik: '320193',
  accessionNumber: '0000320193-26-000001',
  company: 'Apple Inc.',
  form: '10-K',
  fileDate: '2026-01-30',
  ticker: 'AAPL',
  sourceUrl: 'https://www.sec.gov/Archives/edgar/data/320193/000032019326000001/aapl-2026.htm',
  origin: 'search',
};
const NO_TICKER: CartFilingInput = { ...APPLE, cik: '1', accessionNumber: '0000000001-26-000001', company: 'Private Filer', ticker: undefined };

function renderSurface() {
  return render(
    <>
      <CartToggle filing={APPLE} />
      <CartToggle filing={NO_TICKER} />
      <CartTray />
    </>,
  );
}

describe('document cart UI', () => {
  beforeEach(() => {
    setActiveBrowserStorageScope('user:test:org:personal');
    clearDocumentCart();
    clearMemoTray();
    navigation.push.mockReset();
    app.setPendingCompareIntent.mockReset();
  });

  afterEach(() => {
    clearDocumentCart();
    clearMemoTray();
    setActiveBrowserStorageScope(null);
  });

  it('a row checkbox selects the filing and the header badge counts it', async () => {
    const user = userEvent.setup();
    renderSurface();
    expect(screen.getByRole('button', { name: 'Open document cart (0 filings selected)' })).toBeInTheDocument();

    const box = screen.getByRole('checkbox', { name: 'Select Apple Inc. Form 10-K filed 2026-01-30 for the document cart' });
    await user.click(box);
    expect(box).toBeChecked();
    expect(screen.getByRole('button', { name: 'Open document cart (1 filing selected)' })).toBeInTheDocument();
    expect(getDocumentCart()).toHaveLength(1);

    await user.click(box);
    expect(box).not.toBeChecked();
    expect(getDocumentCart()).toHaveLength(0);
  });

  it('lists selections, removes one, adds all to the memo, and opens Benchmarking with the tickers it has', async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(screen.getByRole('checkbox', { name: /Select Apple Inc\./ }));
    await user.click(screen.getByRole('checkbox', { name: /Select Private Filer/ }));
    await user.click(screen.getByRole('button', { name: 'Open document cart (2 filings selected)' }));

    const panel = screen.getByRole('complementary', { name: 'Document cart' });
    const list = within(panel).getByRole('list', { name: '2 selected filings' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByText('Apple Inc. (AAPL)')).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Add all to memo' }));
    expect(getMemoCitations().map(citation => citation.company)).toEqual(['Apple Inc.', 'Private Filer']);
    expect(within(panel).getByText('Added 2 citations to the memo tray.')).toBeInTheDocument();

    await user.click(within(panel).getByRole('button', { name: 'Compare selected' }));
    expect(app.setPendingCompareIntent).toHaveBeenCalledWith(expect.objectContaining({
      tickers: ['AAPL'],
      message: expect.stringContaining('1 selected filing has no ticker'),
    }));
    expect(navigation.push).toHaveBeenCalledWith('/compare');
  });

  it('removes a filing from the panel and closes on Escape back to the trigger', async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(screen.getByRole('checkbox', { name: /Select Apple Inc\./ }));
    const trigger = screen.getByRole('button', { name: 'Open document cart (1 filing selected)' });
    // aria-controls names the tray only while the tray exists.
    expect(trigger).not.toHaveAttribute('aria-controls');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-controls', 'urc-document-cart');
    expect(document.getElementById('urc-document-cart')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Apple Inc. Form 10-K filed 2026-01-30 from the document cart' }));
    expect(getDocumentCart()).toHaveLength(0);
    expect(screen.getByText('No filings selected.')).toBeInTheDocument();

    screen.getByRole('button', { name: 'Close document cart' }).focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('complementary', { name: 'Document cart' })).not.toBeInTheDocument();
    expect(trigger).not.toHaveAttribute('aria-controls');
  });

  it('disables Compare when no selected filing carries a ticker', async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(screen.getByRole('checkbox', { name: /Select Private Filer/ }));
    await user.click(screen.getByRole('button', { name: /Open document cart/ }));
    expect(screen.getByRole('button', { name: 'Compare selected' })).toBeDisabled();
  });
});
