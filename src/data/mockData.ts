import { Company, Filing, EsgDataPoint } from '../types';

export const mockCompanies: Company[] = [
  { id: 'c1', name: 'Apple Inc.', ticker: 'AAPL', cik: '0000320193', industry: 'Technology', marketCap: '$2.8T' },
  { id: 'c2', name: 'Microsoft Corporation', ticker: 'MSFT', cik: '0000789019', industry: 'Technology', marketCap: '$3.0T' },
  { id: 'c3', name: 'Alphabet Inc.', ticker: 'GOOGL', cik: '0001652044', industry: 'Technology', marketCap: '$1.7T' },
  { id: 'c4', name: 'Tesla, Inc.', ticker: 'TSLA', cik: '0001318605', industry: 'Automotive', marketCap: '$600B' },
  { id: 'c5', name: 'JPMorgan Chase & Co.', ticker: 'JPM', cik: '0000019617', industry: 'Financials', marketCap: '$500B' },
];

export const mockFilings: Filing[] = [
  {
    id: 'f1',
    companyId: 'c1',
    type: '10-K',
    date: '2023-11-03',
    summary: 'Annual report detailing Apple\'s financial performance, supply chain risks, and service revenue growth for fiscal 2023.',
    sections: [
      { id: 's1', title: 'Item 1. Business', content: 'The Company designs, manufactures and markets smartphones, personal computers, tablets, wearables and accessories...' },
      { id: 's2', title: 'Item 1A. Risk Factors', content: 'Global economic conditions could materially adversely affect the Company. The Company relies on single or limited-source suppliers...' },
      { id: 's3', title: 'Item 7. MD&A', content: 'Net sales decreased 3% during 2023 compared to 2022, driven by lower net sales of iPhone and Mac...' }
    ]
  },
  {
    id: 'f2',
    companyId: 'c2',
    type: '10-K',
    date: '2023-07-27',
    summary: 'Microsoft\'s annual 10-K highlighting heavy investments in AI (OpenAI partnership), cloud infrastructure, and gaming acquisitions.',
    sections: [
      { id: 's1', title: 'Item 1. Business', content: 'Microsoft is a technology company whose mission is to empower every person and every organization on the planet to achieve more. We are investing in AI to fundamentally transform productivity...' },
      { id: 's2', title: 'Item 1A. Risk Factors', content: 'Transformative technologies like AI may present new risks. Our cloud-based services expose us to significant security and regulatory risks...' },
      { id: 's3', title: 'Item 7. MD&A', content: 'Server products and cloud services revenue increased 19%. Search and news advertising revenue increased...' }
    ]
  },
  {
    id: 'f3',
    companyId: 'c3',
    type: '10-K',
    date: '2024-01-31',
    summary: 'Alphabet\'s 10-K emphasizing AI integration into core search, YouTube ad resilience, & cloud profitability.',
    sections: [
      { id: 's1', title: 'Item 1. Business', content: 'Alphabet is a collection of businesses — the largest of which is Google. We continue to invest in deep compute and AI research...' },
      { id: 's2', title: 'Item 1A. Risk Factors', content: 'We face intense competition. New AI products and language models from competitors could disrupt our search dominance...' }
    ]
  }
];

export const mockEsgData: EsgDataPoint[] = [
  { companyId: 'c1', year: 2021, score: 65 },
  { companyId: 'c1', year: 2022, score: 72 },
  { companyId: 'c1', year: 2023, score: 85 },
  { companyId: 'c2', year: 2021, score: 78 },
  { companyId: 'c2', year: 2022, score: 84 },
  { companyId: 'c2', year: 2023, score: 91 },
  { companyId: 'c3', year: 2021, score: 60 },
  { companyId: 'c3', year: 2022, score: 65 },
  { companyId: 'c3', year: 2023, score: 70 },
];

export const trendingTopics = [
  { topic: 'Generative AI', count: 420 },
  { topic: 'Supply Chain Resiliency', count: 315 },
  { topic: 'Cybersecurity', count: 289 },
  { topic: 'Interest Rates', count: 250 },
  { topic: 'Climate Transition', count: 185 }
];
