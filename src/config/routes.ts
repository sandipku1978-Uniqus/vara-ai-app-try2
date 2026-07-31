import { EARNINGS_SCOPE_LABEL } from './earnings';
import { ENFORCEMENT_SCOPE_LABEL } from './enforcement';

export interface ProductRoute {
  path: string;
  label: string;
  group: 'Monitor' | 'Research' | 'Benchmark' | 'Reference' | 'Transactions' | 'More';
  keywords: string;
  palette?: boolean;
}

export const PUBLIC_PAGE_PATHS = ['/', '/support', '/privacy', '/terms'] as const;

export const PRODUCT_ROUTES: ProductRoute[] = [
  { path: '/dashboard', label: 'Dashboard', group: 'Monitor', keywords: 'home monitor overview', palette: true },
  { path: '/earnings', label: EARNINGS_SCOPE_LABEL, group: 'Monitor', keywords: 'earnings release exhibit ex-99.1', palette: true },
  { path: '/search', label: 'Research Workbench', group: 'Research', keywords: 'search filings full text', palette: true },
  { path: '/comment-letters', label: 'Comment Letters', group: 'Research', keywords: 'sec staff upload corresp review', palette: true },
  { path: '/exhibits', label: 'Exhibits & Agreements', group: 'Research', keywords: 'contracts agreements', palette: true },
  { path: '/no-action-letters', label: 'No-Action Letters', group: 'Research', keywords: 'staff guidance', palette: true },
  { path: '/compare', label: 'Benchmarking', group: 'Benchmark', keywords: 'peers compare financials', palette: true },
  { path: '/accounting-analytics', label: 'Accounting Analytics', group: 'Benchmark', keywords: 'ratios metrics', palette: true },
  { path: '/esg', label: 'ESG Research', group: 'Benchmark', keywords: 'climate sustainability', palette: true },
  { path: '/boards', label: 'Board Profiles', group: 'Benchmark', keywords: 'governance compensation', palette: true },
  { path: '/insiders', label: 'Insider Trading', group: 'Benchmark', keywords: 'form 3 form 4 form 5', palette: true },
  { path: '/accounting', label: 'Accounting Standards', group: 'Reference', keywords: 'asc asu ifrs ind as', palette: true },
  { path: '/regulation', label: 'Securities Regulation', group: 'Reference', keywords: 'rules releases', palette: true },
  { path: '/enforcement', label: ENFORCEMENT_SCOPE_LABEL, group: 'Reference', keywords: 'litigation releases civil actions', palette: true },
  { path: '/ipo', label: 'IPO Center', group: 'Transactions', keywords: 's-1 f-1 offering', palette: true },
  { path: '/mna', label: 'M&A Research', group: 'Transactions', keywords: 'merger deals tender', palette: true },
  { path: '/exempt-offerings', label: 'Exempt Offerings', group: 'Transactions', keywords: 'form d regulation d', palette: true },
  { path: '/adv-registrations', label: 'ADV Registrations', group: 'Transactions', keywords: 'investment adviser iard iapd', palette: true },
  { path: '/support', label: 'Support Center', group: 'More', keywords: 'help documentation', palette: true },
  { path: '/privacy', label: 'Privacy', group: 'More', keywords: 'data privacy retention', palette: true },
  { path: '/terms', label: 'Terms', group: 'More', keywords: 'terms use legal', palette: true },
];

export function findProductRoute(pathname: string): ProductRoute | null {
  if (pathname.startsWith('/filing/')) {
    return { path: '/filing', label: 'Filing Detail', group: 'Research', keywords: '' };
  }
  if (pathname.startsWith('/company/')) {
    return { path: '/company', label: 'Company Dossier', group: 'Research', keywords: '' };
  }

  return PRODUCT_ROUTES
    .filter(route => pathname === route.path || pathname.startsWith(`${route.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0] || null;
}
