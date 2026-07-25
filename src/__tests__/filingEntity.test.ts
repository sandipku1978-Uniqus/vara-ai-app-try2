import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  submissions: new Map<string, unknown>(),
  atomByTicker: new Map<string, string>(),
  submissionCalls: [] as string[],
  proxyCalls: [] as string[],
}));

vi.mock('../services/secApi', () => ({
  fetchCompanySubmissions: async (cik: string) => {
    mocks.submissionCalls.push(cik);
    return mocks.submissions.get(cik) ?? null;
  },
}));

import {
  __clearFilingEntityCache,
  getEntityFilingStatus,
  lookupCikByTicker,
  resolveFilingEntityCik,
} from '../services/filingEntity';

function withForms(forms: string[], dates?: string[]) {
  return { filings: { recent: { form: forms, filingDate: dates ?? forms.map(() => '2026-02-18') } } };
}

/** The real shapes: a successor shell, and the entity holding the history. */
const HOLDCO = '2115436';   // ExxonMobil Holdings Corp — 8-K12B, no annual
const OPERATING = '34088';  // EXXON MOBIL CORP — 10-K 2026-02-18

beforeEach(() => {
  __clearFilingEntityCache();
  mocks.submissions.clear();
  mocks.atomByTicker.clear();
  mocks.submissionCalls.length = 0;
  mocks.proxyCalls.length = 0;

  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    mocks.proxyCalls.push(url);
    const ticker = new URL(url, 'http://localhost').searchParams.get('ticker') ?? '';
    const cik = mocks.atomByTicker.get(ticker);
    return cik
      ? { ok: true, json: async () => ({ ok: true, cik }) }
      : { ok: true, json: async () => ({ ok: true, cik: null }) };
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('getEntityFilingStatus', () => {
  it('recognises an entity that files annual reports', async () => {
    mocks.submissions.set(OPERATING, withForms(['8-K', '10-K', '10-Q'], ['2026-03-01', '2026-02-18', '2026-01-05']));
    const status = await getEntityFilingStatus(OPERATING);
    expect(status).toMatchObject({ hasAnnualReport: true, latestAnnual: '2026-02-18' });
  });

  it('counts 20-F and 40-F — foreign issuers file annually too', async () => {
    for (const form of ['20-F', '40-F']) {
      mocks.submissions.set('1', withForms([form]));
      expect((await getEntityFilingStatus('1'))?.hasAnnualReport, form).toBe(true);
    }
  });

  it('reports a successor shell as having no annual report', async () => {
    // The exact form set on the real ExxonMobil Holdings Corp.
    mocks.submissions.set(HOLDCO, withForms(['8-K', 'S-8 POS', 'POSASR', '8-K12B']));
    expect((await getEntityFilingStatus(HOLDCO))?.hasAnnualReport).toBe(false);
  });

  it('returns null when submissions cannot be read', async () => {
    expect(await getEntityFilingStatus('999')).toBeNull();
  });
});

describe('lookupCikByTicker', () => {
  it('returns the CIK the lookup route resolved', async () => {
    mocks.atomByTicker.set('XOM', '34088');
    expect(await lookupCikByTicker('XOM')).toBe('34088');
  });

  it('rejects a malformed ticker without issuing a request', async () => {
    expect(await lookupCikByTicker('../../etc/passwd')).toBeNull();
    expect(mocks.proxyCalls).toHaveLength(0);
  });

  it('returns null rather than throwing when EDGAR is unavailable', async () => {
    expect(await lookupCikByTicker('NOPE')).toBeNull();
  });
});

describe('resolveFilingEntityCik (reported: XOM resolved to a CIK with no filings)', () => {
  it('redirects a ticker from the successor shell to the filing entity', async () => {
    mocks.submissions.set(HOLDCO, withForms(['8-K', '8-K12B']));
    mocks.submissions.set(OPERATING, withForms(['10-K'], ['2026-02-18']));
    mocks.atomByTicker.set('XOM', OPERATING);

    expect(await resolveFilingEntityCik('XOM', HOLDCO)).toBe(OPERATING);
  });

  it('leaves a healthy entity alone, and never calls EDGAR for it', async () => {
    mocks.submissions.set(OPERATING, withForms(['10-K']));
    expect(await resolveFilingEntityCik('XOM', OPERATING)).toBe(OPERATING);
    expect(mocks.proxyCalls, 'no lookup needed when the CIK already files').toHaveLength(0);
  });

  it('keeps the directory CIK when submissions are unreachable', async () => {
    // No evidence of a problem is not evidence of a problem.
    expect(await resolveFilingEntityCik('XOM', HOLDCO)).toBe(HOLDCO);
  });

  it('keeps the directory CIK when EDGAR offers no alternative', async () => {
    mocks.submissions.set(HOLDCO, withForms(['8-K12B']));
    expect(await resolveFilingEntityCik('XOM', HOLDCO)).toBe(HOLDCO);
  });

  it('refuses a candidate that also has no annual report', async () => {
    mocks.submissions.set(HOLDCO, withForms(['8-K12B']));
    mocks.submissions.set('777', withForms(['8-K']));
    mocks.atomByTicker.set('XOM', '777');

    expect(await resolveFilingEntityCik('XOM', HOLDCO)).toBe(HOLDCO);
  });

  it('memoises so a correction costs one round trip per ticker', async () => {
    mocks.submissions.set(HOLDCO, withForms(['8-K12B']));
    mocks.submissions.set(OPERATING, withForms(['10-K']));
    mocks.atomByTicker.set('XOM', OPERATING);

    const first = await resolveFilingEntityCik('XOM', HOLDCO);
    const callsAfterFirst = mocks.submissionCalls.length;
    const second = await resolveFilingEntityCik('XOM', HOLDCO);

    expect(second).toBe(first);
    expect(mocks.submissionCalls).toHaveLength(callsAfterFirst);
  });

  it('survives a thrown lookup by returning the directory CIK', async () => {
    mocks.submissions.set(HOLDCO, withForms(['8-K12B']));
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    expect(await resolveFilingEntityCik('XOM', HOLDCO)).toBe(HOLDCO);
  });
});
