import type {
  AgentContextSnapshot,
  AgentEvidencePacket,
  AgentPlan,
  FilingLocator,
  FilingSectionSnippet,
} from '../types/agent';
import { BRAND } from '../config/brand';
import { buildHeuristicAgentPlan, isAmbiguousIntent, sanitizeAgentPlan } from './agentPlanner';
import {
  buildAskAiPrompt,
  buildS1AnalysisPrompt,
  buildAgentPlannerPrompt,
  buildAgentAnswerPrompt,
  buildFilingSummaryPrompt,
  buildBoardExtractionPrompt,
  buildESGRatingPrompt,
  buildDealExtractionPrompt,
  buildClauseExtractionPrompt,
  buildAscLookupPrompt,
  REDLINE_SUMMARY_PROMPT,
  CONVERSATION_SUMMARY_PROMPT,
} from '../lib/systemPrompts';
import { selectFilingText } from '../utils/filingTextSelection';

const CLAUDE_API_ENDPOINT = '/api/claude';
const CLAUDE_STREAM_ENDPOINT = '/api/stream';

interface ClaudeRequestOptions {
  maxTokens?: number;
  messages?: Array<{ role: 'user' | 'assistant'; content: string }>;
  frameworks?: string[];
}

interface ClaudeResponsePayload {
  text?: string;
  error?: string;
}

// The server intentionally makes exactly one model attempt per request (spend
// control), so a single upstream blip becomes a user-visible failure. Retry
// transient statuses once from here — each attempt re-passes auth, rate
// limits, and budget. 4xx responses (validation, auth, rate limits) never retry.
const TRANSIENT_CLAUDE_STATUSES = new Set([500, 502, 503, 504, 529]);
const TRANSIENT_RETRY_DELAY_MS = process.env.VITEST ? 25 : 1500;

async function callClaude(prompt: string, options: ClaudeRequestOptions = {}): Promise<string> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS));

    let response: Response;
    try {
      response = await fetch(CLAUDE_API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          messages: options.messages,
          maxTokens: options.maxTokens,
          frameworks: options.frameworks,
        }),
      });
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Claude request failed.');
      continue;
    }

    const payload = (await response.json().catch(() => null)) as ClaudeResponsePayload | null;

    if (!response.ok) {
      lastError = new Error(payload?.error || 'Claude request failed.');
      if (TRANSIENT_CLAUDE_STATUSES.has(response.status)) continue;
      throw lastError;
    }

    const text = payload?.text?.trim();
    if (!text) {
      throw new Error('Claude returned an empty response.');
    }

    return text;
  }

  throw lastError ?? new Error('Claude request failed.');
}

/**
 * Streaming Claude client — reads SSE from /api/stream and invokes onChunk for each text delta.
 * Returns the full accumulated response text.
 */
export async function callClaudeStreaming(
  prompt: string,
  options: ClaudeRequestOptions & { onChunk: (text: string) => void }
): Promise<string> {
  const response = await fetch(CLAUDE_STREAM_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      messages: options.messages,
      maxTokens: options.maxTokens,
      frameworks: options.frameworks,
    }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error || 'Claude streaming request failed.');
  }

  // Check if this was a cache hit (returned as JSON, not SSE)
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = (await response.json()) as ClaudeResponsePayload;
    const text = payload.text?.trim() || '';
    if (text) options.onChunk(text);
    return text;
  }

  // Read SSE stream
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body for streaming.');

  const decoder = new TextDecoder();
  let accumulated = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        if (parsed.text) {
          accumulated += parsed.text;
          options.onChunk(parsed.text);
        }
      } catch {
        // Skip malformed SSE lines
      }
    }
  }

  return accumulated;
}

function getUserFacingError(error: unknown, fallback: string): string {
  if (error instanceof Error && /ANTHROPIC_API_KEY/i.test(error.message)) {
    return error.message;
  }

  return fallback;
}

export interface MemoCitationInput {
  company: string;
  form: string;
  fileDate: string;
  accessionNumber: string;
  excerpt: string;
  note: string;
}

/**
 * Draft a research memo grounded strictly in the tray's cited evidence.
 * The model is told to cite by [n] and to flag gaps rather than fill them.
 */
export async function aiDraftMemoFromCitations(citations: MemoCitationInput[]): Promise<string> {
  const evidence = citations
    .map((citation, index) =>
      `[${index + 1}] ${citation.company} — Form ${citation.form}, filed ${citation.fileDate} (accession ${citation.accessionNumber})` +
      (citation.excerpt.trim() ? `\nCited excerpt: ${citation.excerpt.trim()}` : '') +
      (citation.note.trim() ? `\nResearcher note: ${citation.note.trim()}` : ''))
    .join('\n\n');

  const prompt = [
    'Draft a concise SEC research memo based ONLY on the cited evidence below.',
    'Requirements:',
    '- Cite every factual statement with its bracketed source number, e.g. [1].',
    '- Do not introduce facts, figures, or filings that are not in the evidence.',
    '- Where the evidence is insufficient for a conclusion, say so explicitly and list what additional filings would resolve it.',
    '- Structure: Purpose, Evidence summary, Observations, Open questions.',
    '',
    'CITED EVIDENCE:',
    evidence,
  ].join('\n');

  return callClaude(prompt, { maxTokens: 2048 });
}

export async function askAi(
  question: string,
  context?: string,
  options: { throwOnError?: boolean } = {}
): Promise<string> {
  try {
    const prompt = buildAskAiPrompt(question, context);
    return await callClaude(prompt, { maxTokens: 2400 });
  } catch (error) {
    console.error('Claude API Error:', error);
    if (options.throwOnError) throw error;
    return getUserFacingError(error, 'I encountered an error while trying to process your request with Claude.');
  }
}

export async function aiSummarize(text: string, options: { throwOnError?: boolean } = {}): Promise<string> {
  try {
    return await callClaude(`You are an SEC compliance expert for ${BRAND.productName}. ${text}`, {
      maxTokens: 2400,
    });
  } catch (error) {
    console.error('Claude Summarize Error:', error);
    if (options.throwOnError) throw error;
    return getUserFacingError(error, 'Summary unavailable due to an error.');
  }
}

// Re-export for any existing imports
export { REDLINE_SUMMARY_PROMPT } from '../lib/systemPrompts';

interface RedlineClaim {
  claim: string;
  significance: string;
  evidence: string[];
}

function normalizeRedlineEvidence(value: string): string {
  return value
    .replace(/\[\+|\+\]|\[-|-\]/g, '')
    .replace(/[“”"']/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export async function aiSummarizeRedline(
  diffSummaryText: string,
  options: { throwOnError?: boolean } = {}
): Promise<string> {
  try {
    const response = await callClaude(
      `${REDLINE_SUMMARY_PROMPT}\n\nDIFF SUMMARY:\n${diffSummaryText}`,
      { maxTokens: 2000 }
    );
    const claims = parseJsonResponse<RedlineClaim[]>(response);
    const normalizedDiff = normalizeRedlineEvidence(diffSummaryText);
    const verified = Array.isArray(claims)
      ? claims.filter(item => {
          if (!item?.claim?.trim() || !Array.isArray(item.evidence) || item.evidence.length === 0) return false;
          return item.evidence.every(value => {
            const evidence = normalizeRedlineEvidence(value);
            return evidence.length >= 8 && normalizedDiff.includes(evidence);
          });
        }).slice(0, 8)
      : [];

    if (verified.length === 0) {
      return 'No material-change claim passed evidence validation. Review the deterministic added, removed, and changed blocks below.';
    }

    return verified.map(item => [
      `- ${item.claim.trim()}${item.significance?.trim() ? ` — ${item.significance.trim()}` : ''}`,
      `  Evidence: ${item.evidence.map(value => `“${value.trim()}”`).join('; ')}`,
    ].join('\n')).join('\n');
  } catch (error) {
    console.error('Claude Redline Summarize Error:', error);
    if (options.throwOnError) throw error;
    return getUserFacingError(error, 'Redline summary unavailable due to an error.');
  }
}

export async function aiAnalyzeS1(filingText: string, section: string): Promise<string> {
  const prompt = buildS1AnalysisPrompt(filingText, section);
  return callClaude(prompt, { maxTokens: 2200 });
}

// ===========================
// Structured AI Extraction Functions
// ===========================

export interface BoardDataResult {
  directors: Array<{ name: string; role: string; independent: boolean; committees: string[] }>;
  compensation: Array<{ name: string; title: string; salary: string; stockAwards: string; total: string }>;
  boardSize: number | null;
  independencePercent: number | null;
  diversity: { malePercent: number | null; femalePercent: number | null };
  ceoPayRatio: string | null;
  sayOnPayApproval: string | null;
}

export interface DealDetailsResult {
  target: string;
  acquirer: string;
  value: string;
  dealType: string;
  sector: string;
}

function parseJsonResponse<T>(text: string): T | null {
  try {
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
  const heuristicPlan = buildHeuristicAgentPlan(prompt, context);

  // Hybrid intent resolution: only call Claude when heuristic is ambiguous (saves tokens + latency)
  if (!isAmbiguousIntent(heuristicPlan)) {
    return heuristicPlan;
  }

  try {
    const planningPrompt = buildAgentPlannerPrompt(context as unknown as Record<string, unknown>, prompt);
    const text = await callClaude(planningPrompt, { maxTokens: 2400 });
    return sanitizeAgentPlan(parseJsonResponse<AgentPlan>(text), prompt, context);
  } catch (error) {
    console.error('Claude planner error:', error);
    return heuristicPlan;
  }
}

export async function generateAgentAnswer(
  evidence: AgentEvidencePacket,
  context: AgentContextSnapshot
): Promise<string> {
  try {
    const evidenceJson = JSON.stringify(
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
    );

    const contextJson = JSON.stringify(
      {
        pagePath: context.pagePath,
        pageLabel: context.pageLabel,
        accountingFramework: context.search?.filters?.accountingFramework || null,
      },
      null,
      2
    );

    const prompt = buildAgentAnswerPrompt(
      evidenceJson,
      contextJson,
      context.search?.filters?.accountingFramework
    );

    const builtMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    // Inject history to maintain multi-turn preservation!
    if (context.conversation && context.conversation.length > 0) {
      context.conversation.forEach(turn => {
        if (turn.prompt) {
          builtMessages.push({ role: 'user', content: turn.prompt });
        }
        if (turn.answer) {
          builtMessages.push({ role: 'assistant', content: turn.answer });
        }
      });
    }

    // Finally append the current generated system augmented prompt as the final user message
    builtMessages.push({ role: 'user', content: prompt });

    const text = await callClaude(prompt, { maxTokens: 4096, messages: builtMessages });
    return text || fallbackEvidenceAnswer(evidence);
  } catch (error) {
    console.error('Claude agent answer error:', error);
    return fallbackEvidenceAnswer(evidence);
  }
}

/**
 * Streaming variant of generateAgentAnswer — delivers tokens incrementally via onChunk callback.
 */
export async function generateAgentAnswerStreaming(
  evidence: AgentEvidencePacket,
  context: AgentContextSnapshot,
  onChunk: (text: string) => void
): Promise<string> {
  try {
    const evidenceJson = JSON.stringify(
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
    );

    const contextJson = JSON.stringify(
      {
        pagePath: context.pagePath,
        pageLabel: context.pageLabel,
        accountingFramework: context.search?.filters?.accountingFramework || null,
      },
      null,
      2
    );

    const prompt = buildAgentAnswerPrompt(
      evidenceJson,
      contextJson,
      context.search?.filters?.accountingFramework
    );

    const builtMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];

    if (context.conversation && context.conversation.length > 0) {
      context.conversation.forEach(turn => {
        if (turn.prompt) builtMessages.push({ role: 'user', content: turn.prompt });
        if (turn.answer) builtMessages.push({ role: 'assistant', content: turn.answer });
      });
    }

    builtMessages.push({ role: 'user', content: prompt });

    const text = await callClaudeStreaming(prompt, {
      maxTokens: 4096,
      messages: builtMessages,
      onChunk,
    });

    return text || fallbackEvidenceAnswer(evidence);
  } catch (error) {
    console.error('Claude streaming agent answer error:', error);
    const fallback = fallbackEvidenceAnswer(evidence);
    onChunk(fallback);
    return fallback;
  }
}

/**
 * Summarize a long conversation into a compressed context (Plan Section 6.1).
 */
export async function summarizeConversation(
  turns: Array<{ prompt: string; answer: string }>
): Promise<string> {
  try {
    const conversationText = turns
      .map(t => `User: ${t.prompt}\nAssistant: ${t.answer}`)
      .join('\n\n');

    return await callClaude(
      `${CONVERSATION_SUMMARY_PROMPT}\n\nCONVERSATION:\n${conversationText}`,
      { maxTokens: 500 }
    );
  } catch (error) {
    console.error('Claude conversation summary error:', error);
    // Fallback: just use last turn as summary
    const last = turns[turns.length - 1];
    return last ? `Previous discussion covered: ${last.prompt}` : '';
  }
}

export async function generateFilingSummary(
  locator: FilingLocator,
  sections: FilingSectionSnippet[],
  mode = 'default'
): Promise<string> {
  // No extracted text -> no generative summary. With only the locator
  // (company name, form, date) in the prompt, the model produces a fluent
  // summary from its priors — confidently masking a failed text fetch.
  const hasUsableText = sections.some(section => (section.excerpt || '').trim().length > 0);
  if (!hasUsableText) {
    return fallbackFilingSummary(locator, sections, mode);
  }
  try {
    const sectionPayload = sections.map(section => ({
      label: section.label,
      excerpt: section.excerpt,
    }));

    const prompt = buildFilingSummaryPrompt(
      JSON.stringify(locator, null, 2),
      JSON.stringify(sectionPayload, null, 2),
      mode
    );

    const text = await callClaude(prompt, { maxTokens: 4096 });
    return text || fallbackFilingSummary(locator, sections, mode);
  } catch (error) {
    console.error('Claude filing summary error:', error);
    return fallbackFilingSummary(locator, sections, mode);
  }
}

/**
 * Extract board of directors, compensation, diversity, and governance data from DEF 14A text.
 */
export async function aiExtractBoardData(proxyText: string): Promise<BoardDataResult | null> {
  try {
    const evidence = selectFilingText(proxyText, [
      'director', 'board of directors', 'independent', 'committee', 'compensation',
      'pay ratio', 'diversity', 'say-on-pay', 'say on pay',
    ]);
    const prompt = buildBoardExtractionPrompt(evidence.text);
    const text = await callClaude(prompt, { maxTokens: 2400 });
    return parseJsonResponse<BoardDataResult>(text);
  } catch (error) {
    console.error('Claude Board Data Extraction Error:', error);
    return null;
  }
}

/**
 * Rate ESG disclosure quality for specific topics from a 10-K filing.
 */
export async function aiRateESGDisclosure(
  filingText: string,
  topics: string[]
): Promise<Record<string, 'high' | 'medium' | 'low' | 'unrated'> | null> {
  try {
    const evidence = selectFilingText(filingText, [
      ...topics,
      'environment', 'climate', 'emission', 'energy', 'privacy', 'security',
      'diversity', 'inclusion', 'human capital', 'labor', 'supply chain',
    ]);
    const prompt = buildESGRatingPrompt(evidence.text, topics);
    const text = await callClaude(prompt, { maxTokens: 1200 });
    const parsed = parseJsonResponse<Record<string, unknown>>(text);
    if (!parsed) return null;
    const allowedRatings = new Set(['high', 'medium', 'low']);
    return Object.fromEntries(
      topics.map(topic => {
        const rating = parsed[topic];
        const normalized: 'high' | 'medium' | 'low' | 'unrated' =
          typeof rating === 'string' && allowedRatings.has(rating)
            ? rating as 'high' | 'medium' | 'low'
            : 'unrated';
        return [topic, normalized] as const;
      }),
    );
  } catch (error) {
    console.error('Claude ESG Rating Error:', error);
    return null;
  }
}

/**
 * Extract M&A deal details from an 8-K or SC 13D filing.
 */
export async function aiExtractDealDetails(filingText: string): Promise<DealDetailsResult> {
  const evidence = selectFilingText(filingText, [
    'merger agreement', 'purchase agreement', 'transaction', 'consideration',
    'acquirer', 'target', 'tender offer', 'effective time',
  ]);
  const prompt = buildDealExtractionPrompt(evidence.text);
  const text = await callClaude(prompt, { maxTokens: 1200 });
  const parsed = parseJsonResponse<DealDetailsResult>(text);
  if (!parsed) throw new Error('The AI response did not contain valid deal details.');
  return parsed;
}

/**
 * Extract specific clause types from a merger agreement.
 */
export async function aiExtractClauses(
  agreementText: string,
  clauseTypes: string[]
): Promise<Record<string, { text: string; section: string }>> {
  const evidence = selectFilingText(agreementText, [
    ...clauseTypes, 'termination', 'material adverse', 'representations',
    'covenant', 'conditions', 'indemnification',
  ]);
  const prompt = buildClauseExtractionPrompt(evidence.text, clauseTypes);
  const text = await callClaude(prompt, { maxTokens: 1800 });
  const parsed = parseJsonResponse<Record<string, { text: string; section: string }>>(text);
  if (!parsed) throw new Error('The AI response did not contain valid clause details.');
  return parsed;
}

export async function aiAscLookup(query: string): Promise<string> {
  const prompt = buildAscLookupPrompt(query);
  return callClaude(prompt, { maxTokens: 2400 });
}
