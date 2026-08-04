import {
  LOCAL_E2E_DOSSIER_CIK,
  LOCAL_E2E_DOSSIER_COMPANY,
} from '../../src/app/company/[ticker]/dossierE2eFixture';

export interface RouteContract {
  path: string;
  heading: RegExp;
  headingLevel: 1 | 2 | 3;
  public: boolean;
  note?: string;
}

function h1(path: string, heading: RegExp, isPublic = false): RouteContract {
  return { path, heading, headingLevel: 1, public: isPublic };
}

function exactText(value: string): RegExp {
  return new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
}

/**
 * A route belongs here only when it represents a user-facing product page.
 * Keeping the expected H1 beside the path turns accidental redirects, loading
 * shells, copy drift, and wrong-page renders into useful failures.
 */
export const STATIC_ROUTE_CONTRACTS: readonly RouteContract[] = [
  h1('/dashboard', /^Overview Dashboard$/),
  h1('/earnings', /^Earnings Release Exhibits$/),
  h1('/search', /^Research Workbench$/),
  h1('/comment-letters', /^Comment Letters$/),
  h1('/exhibits', /^Exhibits & Agreements$/),
  h1('/no-action-letters', /^No-Action Letters$/),
  h1('/compare', /^Disclosure Benchmarking Matrix$/),
  h1('/accounting-analytics', /^Accounting Analytics$/),
  h1('/esg', /^ESG Research Center$/),
  h1('/boards', /^Board Profiles & Executive Compensation$/),
  h1('/insiders', /^Insider Trading$/),
  h1('/accounting', /^Accounting Research Hub$/),
  h1('/regulation', /^Securities Regulation$/),
  h1('/enforcement', /^SEC Litigation Releases$/),
  h1('/ipo', /^IPO & Pre-IPO Readiness Center$/),
  h1('/mna', /^M&A and Transactional Research$/),
  h1('/exempt-offerings', /^Exempt Offerings$/),
  h1('/adv-registrations', /^Investment Adviser Registrations$/),
  h1('/support', /^Learn the URC workflow quickly$/, true),
  h1('/privacy', /^Privacy and data use$/, true),
  h1('/terms', /^Terms of use$/, true),
] as const;

export const LANDING_ROUTE_CONTRACT = h1(
  '/',
  /Move from SEC question to\s+client-ready insight faster\./,
  true,
);

/**
 * Stable, representative deep links. The filing viewer currently identifies
 * the document with an H3 instead of a page H1; the semantic audit deliberately
 * reports that information-architecture gap without breaking route smoke.
 */
export const DYNAMIC_ROUTE_CONTRACTS: readonly RouteContract[] = [
  {
    path: `/company/${LOCAL_E2E_DOSSIER_CIK}`,
    heading: exactText(LOCAL_E2E_DOSSIER_COMPANY),
    headingLevel: 1,
    public: false,
    note: 'The localhost-only dossier issuer exercises the real server/client boundary without a live SEC dependency.',
  },
  {
    path: '/filing/0000320193_0000320193-24-000123_aapl-20240928.htm',
    heading: /^aapl-20240928\.htm$/i,
    headingLevel: 3,
    public: false,
    note: 'Representative Apple 10-K filing detail route.',
  },
] as const;

export const INTERNAL_ROUTE_CONTRACT: RouteContract = {
  path: '/design-gallery',
  heading: /^Command bar$/,
  headingLevel: 2,
  public: false,
  note: 'Internal static specimen; development tests exercise its state matrix and production builds reject the route.',
};

export const ALL_ROUTE_CONTRACTS: readonly RouteContract[] = [
  LANDING_ROUTE_CONTRACT,
  ...STATIC_ROUTE_CONTRACTS,
  ...DYNAMIC_ROUTE_CONTRACTS,
  INTERNAL_ROUTE_CONTRACT,
];

export const PUBLIC_ROUTE_CONTRACTS: readonly RouteContract[] = [
  LANDING_ROUTE_CONTRACT,
  ...STATIC_ROUTE_CONTRACTS.filter(contract => contract.public),
];
