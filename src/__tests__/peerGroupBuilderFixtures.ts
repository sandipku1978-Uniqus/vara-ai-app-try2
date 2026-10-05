import type { CompanyDirectoryEntry } from '../services/secApi';

/** SIC 3571 as the company store returned it (2026-10), with the directory rows the builder joins it to. */
export const sicPeerFixtures = {
  directory: [
    { cik: '320193', ticker: 'AAPL', title: 'Apple Inc.' },
    { cik: '1571996', ticker: 'DELL', title: 'Dell Technologies Inc.' },
    { cik: '1375365', ticker: 'SMCI', title: 'Super Micro Computer, Inc.' },
    { cik: '926326', ticker: 'OMCL', title: 'OMNICELL, INC.' },
  ] as CompanyDirectoryEntry[],
  route: {
    sic: '3571',
    companies: [
      { cik: '320193', name: 'Apple Inc.', tickers: ['AAPL'], exchanges: ['Nasdaq'], sic: '3571', sicDescription: 'Electronic Computers' },
      { cik: '926326', name: 'OMNICELL, INC.', tickers: ['OMCL'], exchanges: ['Nasdaq'], sic: '3571', sicDescription: 'Electronic Computers' },
      { cik: '1375365', name: 'Super Micro Computer, Inc.', tickers: ['SMCI', 'SMCIP'], exchanges: ['Nasdaq', 'Nasdaq'], sic: '3571', sicDescription: 'Electronic Computers' },
      { cik: '1571996', name: 'Dell Technologies Inc.', tickers: ['DELL'], exchanges: ['NYSE'], sic: '3571', sicDescription: 'Electronic Computers' },
    ],
    matched: 4,
    returned: 4,
    capped: false,
    source: 'urc_sec_companies',
  },
};
