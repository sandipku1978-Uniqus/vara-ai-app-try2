import { GoogleGenerativeAI } from '@google/generative-ai';
import type {
  AgentContextSnapshot,
  AgentEvidencePacket,
  AgentPlan,
  FilingLocator,
  FilingSectionSnippet,
} from '../types/agent';
import { buildHeuristicAgentPlan, sanitizeAgentPlan } from './agentPlanner';

// Initialize the Gemini API client
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const genAI = new GoogleGenerativeAI(API_KEY);

function getGeminiModel() {
  return genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
}

export async function askGemini(question: string, context?: string): Promise<string> {
  if (!API_KEY) {
    return 'Warning: Gemini API Key is missing. Please add VITE_GEMINI_API_KEY to your .env file.';
  }

  try {
    const model = getGeminiModel();
    
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
    const model = getGeminiModel();
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
    const model = getGeminiModel();

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

function fallbackEvidenceAnswer(evidence: AgentEvidencePacket): string {
  const bullets = evidence.findings.slice(0, 6).map(item => `- ${item}`).join('\n');
  const followUps = evidence.followUps.slice(0, 4).map(item => `- ${item}`).join('\n');

  return [
    `## ${evidence.title}`,
    '',
    evidence.summary,
    '',
    bullets ? '### Key Findings\n' + bullets : '',
    followUps ? '\n### Suggested Next Steps\n' + followUps : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function fallbackFilingSummary(locator: FilingLocator, sections: FilingSectionSnippet[], mode = 'default'): string {
  const intro =
    mode === 'important-parts'
      ? `## ${locator.companyName} ${locator.formType} Important Parts`
      : `## ${locator.companyName} ${locator.formType} Summary`;

  const bullets = sections
    .slice(0, 6)
    .map(section => {
      const excerpt = section.excerpt.replace(/\s+/g, ' ').trim();
      const sentence = excerpt.split(/(?<=[.?!])\s+/).slice(0, 2).join(' ').trim();
      return `### ${section.label}\n- ${sentence || 'Relevant disclosure found in this section.'}`;
    })
    .join('\n\n');

  return [intro, '', bullets || '- The filing loaded, but no structured sections were detected for summarization.'].join('\n');
}

export async function planAgentRun(prompt: string, context: AgentContextSnapshot): Promise<AgentPlan> {
  const fallbackPlan = buildHeuristicAgentPlan(prompt, context);
  if (!API_KEY) {
    return fallbackPlan;
  }

  try {
    const model = getGeminiModel();
    const planningPrompt = `You are Vara Copilot, a structured planning model for an SEC research platform.

Return ONLY valid JSON with this schema:
{
  "goal": "short goal",
  "rationale": "1-2 sentence rationale",
  "confidence": "high" | "medium" | "low",
  "followUps": ["short suggestion"],
  "actions": [
    {
      "type": "resolve_company" | "find_latest_filing" | "open_filing" | "jump_to_section" | "search_filings" | "search_comment_letters" | "find_peers" | "apply_filters" | "set_compare_cohort" | "summarize_filing" | "summarize_result_set" | "draft_alert" | "save_alert" | "export_clean_pdf",
      "title": "short action label",
      "reason": "why this action helps",
      "input": { "freeform": "object with only the needed fields" }
    }
  ]
}

Rules:
- Use only allowlisted action types.
- Favor deterministic app actions over narrative.
- Low-risk navigation and filtering actions are allowed automatically.
- Alerts must be drafted for review before save.
- If the user asks for "important parts" of a 10-K, plan to open the filing and summarize it.
- Prefer the current filing, search, and compare context when the prompt implies "this filing" or "same auditor".

Current app context:
${JSON.stringify(context, null, 2)}

User prompt:
${prompt}`;

    const result = await model.generateContent(planningPrompt);
    const text = (await result.response).text().trim();
    return sanitizeAgentPlan(parseJsonResponse<AgentPlan>(text), prompt, context);
  } catch (error) {
    console.error('Gemini planner error:', error);
    return fallbackPlan;
  }
}

export async function generateAgentAnswer(
  evidence: AgentEvidencePacket,
  context: AgentContextSnapshot
): Promise<string> {
  if (!API_KEY) {
    return fallbackEvidenceAnswer(evidence);
  }

  try {
    const model = getGeminiModel();
    const prompt = `You are Vara Copilot, an SEC accounting and disclosure research assistant.

Write a concise, practical answer based only on the evidence below.
- Start with a short executive summary.
- Then include a few high-signal bullets.
- Mention the most relevant sections or filings by name.
- End with 2-3 practical follow-up suggestions.
- Do not invent facts beyond the evidence packet.

Current app context:
${JSON.stringify({ pagePath: context.pagePath, pageLabel: context.pageLabel }, null, 2)}

Evidence packet:
${JSON.stringify(
  {
    title: evidence.title,
    summary: evidence.summary,
    findings: evidence.findings,
    citations: evidence.citations.slice(0, 12).map(citation => ({
      title: citation.title,
      subtitle: citation.subtitle,
      sectionLabel: citation.sectionLabel,
      excerpt: citation.excerpt,
    })),
    followUps: evidence.followUps,
    notes: evidence.notes,
  },
  null,
  2
)}`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();
    return text || fallbackEvidenceAnswer(evidence);
  } catch (error) {
    console.error('Gemini agent answer error:', error);
    return fallbackEvidenceAnswer(evidence);
  }
}

export async function generateFilingSummary(
  locator: FilingLocator,
  sections: FilingSectionSnippet[],
  mode = 'default'
): Promise<string> {
  if (!API_KEY) {
    return fallbackFilingSummary(locator, sections, mode);
  }

  try {
    const model = getGeminiModel();
    const sectionPayload = sections.map(section => ({
      label: section.label,
      excerpt: section.excerpt,
    }));

    const prompt = `You are Vara Copilot summarizing an SEC filing for an accounting research user.

Filing:
${JSON.stringify(locator, null, 2)}

Mode: ${mode}

Section evidence:
${JSON.stringify(sectionPayload, null, 2)}

If mode is "important-parts", structure the answer with:
1. Executive summary
2. Business overview
3. Top risk factors
4. MD&A themes and performance drivers
5. Key financial highlights
6. Notable accounting policy or disclosure items
7. Controls, auditor, or accountant-change signals if present
8. What to investigate next

Use only the provided sections. If a requested section is missing, say that directly. Reference section labels inline in parentheses. Keep the answer concise and practical.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text().trim();
    return text || fallbackFilingSummary(locator, sections, mode);
  } catch (error) {
    console.error('Gemini filing summary error:', error);
    return fallbackFilingSummary(locator, sections, mode);
  }
}

/**
 * Extract board of directors, compensation, diversity, and governance data from DEF 14A text.
 */
export async function aiExtractBoardData(proxyText: string): Promise<BoardDataResult | null> {
  if (!API_KEY) return null;
  try {
    const model = getGeminiModel();
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
    const model = getGeminiModel();
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
    const model = getGeminiModel();
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
    const model = getGeminiModel();
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
    const model = getGeminiModel();
    const prompt = `You are an expert technical accountant for Vara AI. The user is asking a question about accounting standards (e.g., US GAAP, FASB ASC, IFRS). Provide a clear, structured summary citing specific ASC topics/subtopics where applicable. Be direct and professional. USER QUERY: ${query}`;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    return response.text().trim();
  } catch (error) {
    console.error('Gemini ASC Error:', error);
    return 'Detailed ASC lookup unavailable due to an error.';
  }
}
