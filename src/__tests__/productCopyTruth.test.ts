import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isResearchAccountSynced, researchStorageCopy } from '../components/projects/researchStorageCopy';
import { buildStorageScope, setActiveBrowserStorageScope } from '../services/storageNamespace';
import { getUserDataStatus, resetUserDataForTests, startUserDataSync } from '../services/userData';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/' }));
// The brand lockup renders next/image with a static asset import jsdom cannot size.
vi.mock('../components/brand/URCBrand', () => ({ URCBrandLockup: () => null, URCBrandMark: () => null }));

import LandingPage from '../views/LandingPage';
import SupportCenter from '../views/SupportCenter';

const supportSource = readFileSync(resolve(process.cwd(), 'src/views/SupportCenter.tsx'), 'utf8');
const landingSource = readFileSync(resolve(process.cwd(), 'src/views/LandingPage.tsx'), 'utf8');
const storageCopySource = readFileSync(resolve(process.cwd(), 'src/components/projects/researchStorageCopy.ts'), 'utf8');

describe('product copy truth contracts', () => {
  it('does not document capabilities absent from the current specialist views', () => {
    for (const unsupportedClaim of [
      'trending topics in the overview cards',
      'meeting attendance scores',
      'quantitative trend analysis across filing populations',
      'Search for ESG-related keywords',
      'SPAC filings',
      'merger proxies',
      'Review transaction patterns',
      'clicking a company name in search results',
      'Click any filing to open it in the Filing Detail viewer',
      'search by company or insider name',
      'committee memberships, tenure',
    ]) {
      expect(supportSource).not.toContain(unsupportedClaim);
    }
    expect(supportSource).toContain('those fields are not parsed into the platform table');
    expect(supportSource).toContain('Use View to open a recent source document on SEC.gov');
  });

  it('labels every hard-coded hero-data panel illustrative and avoids collaboration claims', () => {
    expect(landingSource.match(/Illustrative /g)).toHaveLength(4);
    for (const unsupportedClaim of [
      'Live Signal',
      'Operationalize research across the team',
      'repeatable team workflow',
      'without rebuilding your analysis from scratch',
      'with context intact',
      'covers the whole SEC workflow',
      'every major research lane',
      'keep teams in flow',
      'without resetting your work',
      'enterprise research environment',
    ]) {
      expect(landingSource).not.toContain(unsupportedClaim);
    }
    // Where saved research lives is stated by researchStorageCopy, never hard-coded in the views.
    expect(landingSource).toContain('storageCopy.landingWorkflowStorage');
    expect(landingSource).not.toContain('browser-local');
  });

  it('says research is browser-local unless account storage actually answered', () => {
    for (const mode of ['local', 'connecting', 'unavailable'] as const) {
      expect(isResearchAccountSynced({ mode })).toBe(false);
    }
    expect(isResearchAccountSynced({ mode: 'server' })).toBe(true);

    const local = researchStorageCopy(false);
    expect(local.landingWorkflowStorage).toBe('Saved research state remains browser-local.');
    expect(local.landingBenchmarkingDescription).toContain('browser-local saved searches');
    expect(local.landingPlatformDescription).toContain('browser-local research workflow');
    expect(local.supportAlertsAndAnnotationsNote).toContain('not shared across devices');
    expect(local.supportResearchTabsNote).toContain('not shared across devices');
    expect(local.supportStorageFaqAnswer).toContain('not shared across devices');
    for (const text of Object.values(local)) {
      if (typeof text === 'string') expect(text).not.toMatch(/saved to your account|across the devices/);
    }
  });

  it('says research is saved to the account and shared across devices when account sync is available', () => {
    const synced = researchStorageCopy(true);
    expect(synced.landingWorkflowStorage).toBe('Saved research is saved to your account and shared across the devices you sign in from.');
    expect(synced.supportAlertsAndAnnotationsNote).toContain('saved to your account and shared across the devices you sign in from');
    expect(synced.supportResearchTabsNote).toContain('saved to your account');
    expect(synced.supportAnnotationsNote).toContain('saved to your account');
    expect(synced.supportStorageFaqAnswer).toContain('shared across the devices you sign in from');
    expect(synced.supportStorageFaqAnswer).toContain('Neither sends background notifications');
    for (const text of Object.values(synced)) {
      if (typeof text === 'string') expect(text).not.toMatch(/browser-local|stored locally|current browser/);
    }
  });

  it('keeps every storage claim in the support guide behind the status-driven copy', () => {
    expect(supportSource).not.toMatch(/browser-local|stored locally in the browser|local to the current browser/);
    expect(storageCopySource).toContain("status.mode === 'server'");
  });
});

describe('rendered storage copy follows getUserDataStatus()', () => {
  const scope = buildStorageScope('user_alice', null);

  async function connect(available: boolean) {
    resetUserDataForTests();
    window.localStorage.setItem(`urc.identity.${encodeURIComponent(scope)}.urc.userdata.migrated.v1`, 'earlier');
    setActiveBrowserStorageScope(scope);
    // Before the signing secret is set the routes answer 503 and the engine reports 'unavailable'.
    const fetch = vi.fn(async (input: string) => (available
      ? Response.json({ ok: true, items: input.endsWith('/projects') ? [{ id: '11111111-1111-4111-8111-111111111111', clientKey: 'personal', name: 'Personal research', question: '' }] : [] })
      : Response.json({ ok: false, errorClass: 'unavailable', error: 'off' }, { status: 503 })));
    startUserDataSync(scope, { fetch: fetch as never });
    await waitFor(() => expect(getUserDataStatus().mode).toBe(available ? 'server' : 'unavailable'));
  }

  afterEach(() => {
    resetUserDataForTests();
    setActiveBrowserStorageScope(null);
  });

  it('keeps the browser-local wording when the account routes answer 503', async () => {
    await connect(false);
    render(createElement(LandingPage));
    expect(screen.getByText(/Saved research state remains browser-local\./)).toBeInTheDocument();
    render(createElement(SupportCenter));
    expect(screen.getByText('Annotations and saved alerts are local to the current browser.')).toBeInTheDocument();
  });

  it('says research is saved to the account and shared across devices once the account answered', async () => {
    await connect(true);
    render(createElement(LandingPage));
    expect(screen.getByText(/Saved research is saved to your account and shared across the devices you sign in from\./)).toBeInTheDocument();
    expect(screen.queryByText(/browser-local/)).not.toBeInTheDocument();
    render(createElement(SupportCenter));
    expect(screen.getByText('Annotations, saved alerts and research tabs are saved to your account.')).toBeInTheDocument();
  });
});
