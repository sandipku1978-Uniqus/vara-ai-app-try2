/**
 * Stable issuer data for the localhost-only Playwright identity bypass.
 *
 * The issuer dossier is rendered on the server, so browser route interception
 * cannot replace its SEC submissions request. Keeping this one deliberately
 * impossible fixture issuer behind `isLocalE2eBypass()` lets production-build
 * interaction tests exercise the real Server/Client Component boundary while
 * hosted deployments continue to read only SEC data.
 */
export const LOCAL_E2E_DOSSIER_CIK = '0001000003';
export const LOCAL_E2E_DOSSIER_COMPANY = 'Both Holdings Ltd';
export const LOCAL_E2E_DOSSIER_ACCESSION = '0001000003-26-000003';
export const LOCAL_E2E_DOSSIER_DOCUMENT = 'both-2026-10k.htm';

export const LOCAL_E2E_DOSSIER_SUBMISSION = {
  name: LOCAL_E2E_DOSSIER_COMPANY,
  tickers: ['BOTH'],
  exchanges: ['Nasdaq'],
  sicDescription: 'Evidence management systems',
  sic: '7372',
  stateOfIncorporation: 'DE',
  filings: {
    recent: {
      accessionNumber: [LOCAL_E2E_DOSSIER_ACCESSION, '0001000003-26-000002'],
      filingDate: ['2026-03-18', '2026-02-04'],
      form: ['10-K', '8-K'],
      primaryDocument: [LOCAL_E2E_DOSSIER_DOCUMENT, 'both-2026-8k.htm'],
      primaryDocDescription: ['Annual report for fiscal 2025', 'Material agreement update'],
    },
  },
} as const;
