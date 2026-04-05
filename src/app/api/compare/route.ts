import { Anthropic } from '@anthropic-ai/sdk';
import { cacheService } from '../../../lib/cache';
import { COMPARISON_SYSTEM_PROMPT, DEF14A_COMPARISON_PROMPT } from '../../../lib/systemPrompts';
import crypto from 'crypto';


const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

export async function POST(req: Request) {
  try {
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

    // Build comparison configuration string for cache
    const payloadSignature = JSON.stringify({ tickers, section, length: filingContexts.length });
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
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
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

    await cacheService.set(cacheKey, textPayload, { ex: 604800 });

    return new Response(JSON.stringify({ analysis: textPayload, cached: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('Claude API Route Error (Compare):', error);
    return new Response(JSON.stringify({ error: 'An error occurred processing your request' }), { status: 500 });
  }
}
