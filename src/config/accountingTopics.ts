export interface AscTopic {
  id: string;
  name: string;
}

export const FASB_CODIFICATION_URL = 'https://asc.fasb.org/';

export const CURATED_ASC_TOPICS: AscTopic[] = [
  { id: '100', name: 'General Principles' },
  { id: '200', name: 'Presentation' },
  { id: '280', name: 'Segment Reporting' },
  { id: '300', name: 'Assets' },
  { id: '326', name: 'Financial Instruments — Credit Losses' },
  { id: '350', name: 'Intangibles — Goodwill and Other' },
  { id: '400', name: 'Liabilities' },
  { id: '450', name: 'Contingencies' },
  { id: '500', name: 'Equity' },
  { id: '600', name: 'Revenue' },
  { id: '606', name: 'Revenue from Contracts with Customers' },
  { id: '700', name: 'Expenses' },
  { id: '718', name: 'Compensation — Stock Compensation' },
  { id: '740', name: 'Income Taxes' },
  { id: '800', name: 'Broad Transactions' },
  { id: '805', name: 'Business Combinations' },
  { id: '815', name: 'Derivatives and Hedging' },
  { id: '820', name: 'Fair Value Measurement' },
  { id: '842', name: 'Leases' },
  { id: '900', name: 'Industry' },
];

export function ascTopicUrl(topicId: string): string {
  return `${FASB_CODIFICATION_URL}${encodeURIComponent(topicId)}/`;
}

export function filterCuratedAscTopics(query: string): AscTopic[] {
  const normalized = query.trim().toLowerCase().replace(/^asc\s*/i, '');
  if (!normalized) return CURATED_ASC_TOPICS;
  return CURATED_ASC_TOPICS.filter(topic => (
    topic.id.includes(normalized) || topic.name.toLowerCase().includes(normalized)
  ));
}
