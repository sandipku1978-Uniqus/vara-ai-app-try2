export interface Company {
  id: string;
  name: string;
  ticker: string;
  cik: string;
  industry: string;
  logoUrl?: string;
  marketCap: string;
}

export interface Filing {
  id: string;
  companyId: string;
  type: '10-K' | '10-Q' | '8-K' | 'S-1' | 'DEF 14A';
  date: string;
  summary: string;
  url?: string;
  sections: FilingSection[];
}

export interface FilingSection {
  id: string;
  title: string;
  content: string; // Could be markdown or plain text
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'ai';
  content: string;
  timestamp: string;
  sourceFilingId?: string;
  sourceSectionId?: string;
}

export interface EsgDataPoint {
  companyId: string;
  year: number;
  score: number; // 0-100 scale representing disclosure comprehensiveness
}

export interface GlobalState {
  watchlist: string[]; // array of companyIds
  chatHistory: ChatMessage[];
  searchQuery: string;
}
