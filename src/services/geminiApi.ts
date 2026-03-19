import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize the Gemini API client
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(API_KEY);

export async function askGemini(question: string, context?: string): Promise<string> {
  if (!API_KEY) {
    return 'Warning: Gemini API Key is missing. Please add VITE_GEMINI_API_KEY to your .env file.';
  }

  try {
    // We use gemini-2.5-flash as requested by the user
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    
    let prompt = `You are an expert AI assistant for Vara AI, an SEC Compliance Intelligence Platform. You help financial, legal, and compliance professionals understand SEC filings.\n\n`;
    
    if (context) {
      prompt += `CONTEXT FROM CURRENT PREVIEWED DOCUMENT / SEARCH:\n${context}\n\n`;
    }
    
    prompt += `USER QUESTION:\n${question}\n\n`;
    prompt += `Provide a professional, clear, and direct answer based on the context (if available) or your general financial knowledge. Use markdown formatting for readability.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('Gemini API Error:', error);
    return 'I encountered an error while trying to process your request with Gemini.';
  }
}

export async function aiSummarize(text: string): Promise<string> {
  if (!API_KEY) {
    return 'AI Summary unavailable (API key missing).';
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `You are an SEC compliance expert for Vara AI. ${text}`;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error('Gemini Summarize Error:', error);
    return 'Summary unavailable due to an error.';
  }
}

export async function aiAnalyzeS1(filingText: string, section: string): Promise<string> {
  if (!API_KEY) {
    return 'AI Analysis unavailable (API key missing). Configure VITE_GEMINI_API_KEY in your .env file.';
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

    const sectionPrompts: Record<string, string> = {
      'overview': `Analyze this S-1 registration statement and provide a concise **Business Overview**. Cover: what the company does, its products/services, target market, competitive positioning, revenue model, and growth strategy. Highlight any unique aspects of the business.`,
      'risk-factors': `Analyze the **Risk Factors** in this S-1 registration statement. Identify and categorize the top 8-10 most material risks into groups (e.g., Business/Operational, Financial, Regulatory, Market). For each risk, provide a one-line summary. Flag any unusual or noteworthy risks that stand out compared to typical S-1 filings.`,
      'financials': `Analyze the **Financial Data** in this S-1 registration statement. Provide: (1) Revenue trend and growth rate, (2) Profitability status (net income/loss), (3) Key margins (gross, operating), (4) Cash position and burn rate if applicable, (5) Notable balance sheet items. Present numbers in a clear, structured format.`,
      'use-of-proceeds': `Analyze the **Use of Proceeds** section of this S-1. Summarize: (1) Total estimated offering proceeds, (2) How proceeds will be allocated (percentages if available), (3) Whether specific amounts are earmarked for particular uses, (4) Any debt repayment planned, (5) How this compares to typical IPO use-of-proceeds disclosures.`,
      'management': `Analyze the **Management & Governance** disclosures in this S-1. Cover: (1) Key executives and their backgrounds, (2) Compensation structure highlights, (3) Board composition and independence, (4) Any related-party transactions, (5) Voting structure (dual-class shares, etc.).`,
      'underwriting': `Analyze the **Underwriting & Offering Terms** in this S-1. Cover: (1) Lead underwriters, (2) Offering size and price range, (3) Underwriting discount/commission, (4) Lock-up period terms, (5) Over-allotment option, (6) Any directed share programs.`,
    };

    const sectionPrompt = sectionPrompts[section] || sectionPrompts['overview'];

    // Truncate filing text to fit within context limits (keep first ~60k chars)
    const truncatedText = filingText.length > 60000 ? filingText.substring(0, 60000) + '\n\n[... Document truncated for analysis ...]' : filingText;

    const prompt = `You are a senior IPO analyst for Vara AI, an SEC Compliance Intelligence Platform. You are analyzing an S-1 registration statement filed with the SEC.

${sectionPrompt}

Format your response in clear markdown with headers, bullet points, and bold key terms. Be specific with numbers and facts from the filing. If certain information is not available in the text, note that clearly.

S-1 FILING TEXT:
${truncatedText}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error('Gemini S-1 Analysis Error:', error);
    return 'S-1 analysis encountered an error. Please try again.';
  }
}

// ===========================
// Structured AI Extraction Functions
// ===========================

export interface BoardDataResult {
  directors: Array<{ name: string; role: string; independent: boolean; committees: string[] }>;
  compensation: Array<{ name: string; title: string; salary: string; stockAwards: string; total: string }>;
  boardSize: number;
  independencePercent: number;
  diversity: { malePercent: number; femalePercent: number };
  ceoPayRatio: string;
  sayOnPayApproval: string;
}

export interface DealDetailsResult {
  target: string;
  acquirer: string;
  value: string;
  dealType: string;
  sector: string;
}

function truncateText(text: string, max = 55000): string {
  return text.length > max ? text.substring(0, max) + '\n\n[... Document truncated ...]' : text;
}

function parseJsonResponse<T>(text: string): T | null {
  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

/**
 * Extract board of directors, compensation, diversity, and governance data from DEF 14A text.
 */
export async function aiExtractBoardData(proxyText: string): Promise<BoardDataResult | null> {
  if (!API_KEY) return null;
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `You are an SEC compliance expert. Extract structured data from this DEF 14A proxy statement.

Return ONLY valid JSON (no markdown, no explanation) with this exact schema:
{
  "directors": [{"name": "Full Name", "role": "e.g. Chairman, Independent Director", "independent": true/false, "committees": ["Audit", "Compensation"]}],
  "compensation": [{"name": "Full Name", "title": "CEO/CFO/etc", "salary": "$X,XXX,XXX", "stockAwards": "$XXM", "total": "$XXM"}],
  "boardSize": <number>,
  "independencePercent": <number 0-100>,
  "diversity": {"malePercent": <number>, "femalePercent": <number>},
  "ceoPayRatio": "e.g. 256:1",
  "sayOnPayApproval": "e.g. 94.2%"
}

If data for a field is not found, use reasonable defaults: empty arrays, 0, or "N/A".

DEF 14A TEXT:
${truncateText(proxyText)}`;

    const result = await model.generateContent(prompt);
    const text = (await result.response).text().trim();
    return parseJsonResponse<BoardDataResult>(text);
  } catch (error) {
    console.error('Gemini Board Data Extraction Error:', error);
    return null;
  }
}

/**
 * Rate ESG disclosure quality for specific topics from a 10-K filing.
 */
export async function aiRateESGDisclosure(
  filingText: string,
  topics: string[]
): Promise<Record<string, 'high' | 'medium' | 'low'> | null> {
  if (!API_KEY) return null;
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `You are an ESG disclosure analyst. Rate how thoroughly this 10-K filing discloses each of these ESG topics.

Topics to rate: ${JSON.stringify(topics)}

For each topic, rate as:
- "high" = detailed, quantitative disclosure with specific metrics/targets
- "medium" = mentioned with some detail but lacking specifics
- "low" = barely mentioned or absent

Return ONLY valid JSON (no markdown, no explanation) mapping each topic to its rating:
{"Topic Name": "high"|"medium"|"low", ...}

10-K TEXT:
${truncateText(filingText)}`;

    const result = await model.generateContent(prompt);
    const text = (await result.response).text().trim();
    return parseJsonResponse<Record<string, 'high' | 'medium' | 'low'>>(text);
  } catch (error) {
    console.error('Gemini ESG Rating Error:', error);
    return null;
  }
}

/**
 * Extract M&A deal details from an 8-K or SC 13D filing.
 */
export async function aiExtractDealDetails(filingText: string): Promise<DealDetailsResult | null> {
  if (!API_KEY) return null;
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `You are an M&A analyst. Extract deal details from this SEC filing (8-K, SC 13D, or SC TO-T).

Return ONLY valid JSON (no markdown, no explanation):
{"target": "Company Name", "acquirer": "Company Name", "value": "$X.XB or N/A", "dealType": "Merger Agreement/Asset Purchase/Stock Purchase/Tender Offer", "sector": "e.g. Technology, Healthcare"}

If a field cannot be determined, use "N/A".

FILING TEXT:
${truncateText(filingText)}`;

    const result = await model.generateContent(prompt);
    const text = (await result.response).text().trim();
    return parseJsonResponse<DealDetailsResult>(text);
  } catch (error) {
    console.error('Gemini Deal Extraction Error:', error);
    return null;
  }
}

/**
 * Extract specific clause types from a merger agreement.
 */
export async function aiExtractClauses(
  agreementText: string,
  clauseTypes: string[]
): Promise<Record<string, { text: string; section: string }> | null> {
  if (!API_KEY) return null;
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `You are an M&A attorney reviewing a merger agreement. Extract the following clause types from this agreement.

Clause types to find: ${JSON.stringify(clauseTypes)}

For each clause type found, return the key language (up to ~200 words) and the section reference.

Return ONLY valid JSON (no markdown, no explanation):
{"Clause Type": {"text": "extracted clause language...", "section": "Section X.X"}, ...}

If a clause type is not found, include it with text "Not found in this agreement" and section "N/A".

AGREEMENT TEXT:
${truncateText(agreementText)}`;

    const result = await model.generateContent(prompt);
    const text = (await result.response).text().trim();
    return parseJsonResponse<Record<string, { text: string; section: string }>>(text);
  } catch (error) {
    console.error('Gemini Clause Extraction Error:', error);
    return null;
  }
}

export async function aiAscLookup(query: string): Promise<string> {
  if (!API_KEY) {
    return 'Summary unavailable due to missing API key.';
  }

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
    const prompt = `You are an expert technical accountant for Vara AI. The user is asking a question about accounting standards (e.g., US GAAP, FASB ASC, IFRS). Provide a clear, structured summary citing specific ASC topics/subtopics where applicable. Be direct and professional. USER QUERY: ${query}`;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error('Gemini ASC Error:', error);
    return 'Detailed ASC lookup unavailable due to an error.';
  }
}
