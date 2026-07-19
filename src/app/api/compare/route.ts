import { Anthropic } from '@anthropic-ai/sdk';
import { cacheService } from '../../../lib/cache';
import { COMPARISON_SYSTEM_PROMPT, DEF14A_COMPARISON_PROMPT } from '../../../lib/systemPrompts';
import { checkAiRateLimit, rateLimitResponse } from '../../../lib/rate-limit';
import crypto from 'crypto';


const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';

export async function POST(req: Request) {
  try {
    const rate = checkAiRateLimit(req);
    if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
    const { tickers, section, filingContexts } = await req.json();

    if (!tickers || !Array.isArray(tickers) || tickers.length < 2) {
      return new Response(JSON.stringify({ error: 'At least 2 tickers are required.' }), { status: 400 });
    }
    if (tickers.length > 10) {
      return new Response(JSON.stringify({ error: 'Maximum 10 tickers allowed.' }), { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ 
        analysis: 'API Key not configured. Please supply an Anthropic API Key to use AI Peer Comparison.' 
      }), { status: 200, headers: { 'Content-Type': 'application/json' }});
    }

    // Cache key hashes the FULL filing text, not just tickers+section+count —
    // the old length-only signature served a stale analysis whenever the same
    // tickers were compared with different excerpts (new fiscal year, 10-K/A,
    // corrected extraction).
    const payloadSignature = JSON.stringify({
      tickers,
      section,
      texts: filingContexts.map((f: any) => `${f.ticker}:${f.companyName}:${f.text}`),
    });
    const hash = crypto.createHash('sha256').update(payloadSignature).digest('hex');
    const cacheKey = `ai-compare:${hash}`;

    const cachedResponse = await cacheService.get<string>(cacheKey);
    if (cachedResponse) {
      return new Response(JSON.stringify({ analysis: cachedResponse, cached: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Combine filing context for Claude
    const comparisonContext = filingContexts.map((f: any) =>
      `<company ticker="${f.ticker}" name="${f.companyName}">\n${f.text}\n</company>`
    ).join('\n\n');

    // Select prompt based on filing type (DEF 14A uses governance-specific prompt)
    const isProxyComparison = section.toLowerCase().includes('compensation') ||
      section.toLowerCase().includes('governance') ||
      section.toLowerCase().includes('say-on-pay') ||
      section.toLowerCase().includes('board');
    const basePrompt = isProxyComparison ? DEF14A_COMPARISON_PROMPT : COMPARISON_SYSTEM_PROMPT;

    // Using the latest Claude 4.6 Sonnet model with prompt caching
    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      // Thinking budget comes out of max_tokens: 8192-4000 left ~4k visible
      // tokens, which truncated 10-company comparison tables mid-row.
      max_tokens: 16384,
      thinking: { type: 'enabled', budget_tokens: 4000 },
      temperature: 1, // Must be 1 when using thinking
      system: [
        {
          type: 'text',
          text: basePrompt,
          cache_control: { type: 'ephemeral' },
        },
        {
          type: 'text',
          text: `<filings>\n${comparisonContext}\n</filings>`,
        },
      ],
      messages: [{ role: 'user', content: `Compare the ${section} disclosures across these ${tickers.length} companies. Focus on material differences a practitioner would need to know for benchmarking.` }],
    });

    const textPayload = msg.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    // Content-hashed key makes longer caching safe (same inputs → same key),
    // but temp-1 thinking output is non-deterministic — keep TTL moderate.
    await cacheService.set(cacheKey, textPayload, { ex: 86400 });

    return new Response(JSON.stringify({ analysis: textPayload, cached: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('Claude API Route Error (Compare):', error);
    return new Response(JSON.stringify({ error: 'An error occurred processing your request' }), { status: 500 });
  }
}
