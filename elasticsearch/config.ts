import { Client } from '@elastic/elasticsearch';

export const ES_INDEX = process.env.ELASTICSEARCH_INDEX || 'sec-filings';

export function createElasticClient(): Client {
  const url = process.env.ELASTICSEARCH_URL;
  const apiKey = process.env.ELASTICSEARCH_API_KEY;

  if (!url) {
    throw new Error(
      'ELASTICSEARCH_URL is not set. Set it to your Elastic Cloud endpoint, e.g. https://my-deployment.es.us-east-1.aws.elastic.cloud:443'
    );
  }

  if (!apiKey) {
    throw new Error(
      'ELASTICSEARCH_API_KEY is not set. Create one in Elastic Cloud under Security > API Keys.'
    );
  }

  return new Client({
    node: url,
    auth: { apiKey },
    requestTimeout: 30_000,
  });
}

/** SEC EDGAR rate-limit-safe delay. */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** SEC requires a descriptive User-Agent. */
export const SEC_USER_AGENT =
  process.env.VITE_EDGAR_USER_AGENT ||
  process.env.EDGAR_USER_AGENT ||
  'Vara AI Research App contact@vara.ai';

/** Base URL for SEC EDGAR archives. */
export const EDGAR_BASE = 'https://www.sec.gov';
export const EDGAR_DATA_BASE = 'https://data.sec.gov';

/** Filing form types we index. */
export const ALL_FORM_TYPES = [
  '10-K', '10-K/A', '10-Q', '10-Q/A',
  '8-K', '8-K/A',
  'DEF 14A', 'DEFA14A',
  'S-1', 'S-1/A', 'S-3', 'S-4',
  '20-F', '20-F/A', '6-K',
  'SC 13D', 'SC 13D/A', 'SC 13G', 'SC 13G/A',
  'SC TO-T', 'SC 14D9',
  'CORRESP', 'UPLOAD',
  'D', 'D/A',
  'ADV', 'ADV/A', 'ADV-W',
  'N-CSR', 'N-CSRS',
  '424B4', '424B2',
  'PX14A6G', 'DFAN14A',
];
