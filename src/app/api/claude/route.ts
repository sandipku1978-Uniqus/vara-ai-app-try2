import { Anthropic } from '@anthropic-ai/sdk';
import { cacheService } from '../../../lib/cache';
import { SEC_RESEARCH_SYSTEM_PROMPT } from '../../../lib/systemPrompts';
import { checkAiRateLimit, rateLimitResponse } from '../../../lib/rate-limit';
import crypto from 'crypto';


const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || '',
});

// Model is env-configurable so upgrades are a Vercel env change, not a deploy
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

export async function POST(req: Request) {
  try {
    const rate = checkAiRateLimit(req);
    if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
    const body = await req.json();
    const { prompt, messages = [], maxTokens = 4096, temperature = 0.2, frameworks = [] } = body;

    if (!prompt && (!messages || messages.length === 0)) {
      return new Response(JSON.stringify({ error: 'Missing prompt or messages' }), { status: 400 });
    }

    // Input validation
    const clampedMaxTokens = Math.min(Math.max(Number(maxTokens) || 4096, 1), 16384);
    const clampedTemp = Math.min(Math.max(Number(temperature) || 0.2, 0), 1);
    if (messages.length > 100) {
      return new Response(JSON.stringify({ error: 'Too many messages (max 100)' }), { status: 400 });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({
        text: 'API Key not configured. This is a fallback response from the local development server simulating the Copilot.'
      }), { status: 200, headers: { 'Content-Type': 'application/json' }});
    }

    // 1. Cache key must cover everything that changes the answer: frameworks
    //    alter both the injected KB context and the model config (isComplex),
    //    so omitting them served one framework's cached answer to another.
    //    Hash the EFFECTIVE config, not the raw request values.
    const isComplex = frameworks.length > 0;
    const effectiveTemp = isComplex ? 1 : clampedTemp;
    const effectiveMaxTokens = isComplex ? 8192 : clampedMaxTokens;
    const payloadSignature = JSON.stringify({ prompt, messages, frameworks: [...frameworks].sort() });
    const hash = crypto.createHash('sha256').update(`${payloadSignature}-${effectiveMaxTokens}-${effectiveTemp}`).digest('hex');
    const cacheKey = `ai-cache:${hash}`;

    // 2. Check Vercel KV Cache
    const cachedResponse = await cacheService.get<string>(cacheKey);
    if (cachedResponse) {
      return new Response(JSON.stringify({ text: cachedResponse, cached: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    let kbContext = '';
    if (frameworks.includes('IFRS')) {
      try { kbContext += '\nIFRS Context: ' + require('../../../data/standards/ifrs-kb.json').standards.map((s:any)=>`${s.id}: ${s.keyDifferences.join(' ')}`).join('\n'); } catch (e) {}
    }
    if (frameworks.includes('Ind AS')) {
      try { kbContext += '\nInd AS Context: ' + require('../../../data/standards/ind-as-kb.json').standards.map((s:any)=>`${s.id}: ${s.keyDifferences.join(' ')}`).join('\n'); } catch (e) {}
    }

    const apiMessages = messages.length > 0 ? messages : [{ role: 'user', content: prompt }];
    if (kbContext && apiMessages.length > 0) {
      // Labeled as reference material so the model can't cite the static KB
      // as if it came from a filing.
      apiMessages[apiMessages.length - 1].content += `\n\n[Reference material — internal cross-framework knowledge base, NOT from any filing]:${kbContext}`;
    }

    const msg = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: effectiveMaxTokens,
      // Sonnet 5 rejects budget_tokens and non-default temperature (400):
      // adaptive thinking replaces the fixed budget; simple queries stay thinking-off
      thinking: isComplex ? { type: 'adaptive' } : { type: 'disabled' },
      // Prompt caching: system prompt cached at Anthropic for 90% input token discount
      system: [{
        type: 'text',
        text: SEC_RESEARCH_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      }],
      messages: apiMessages,
    });

    const textPayload = msg.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    // 4. Save to Cache. TTL keyed to the EFFECTIVE temperature — the complex
    //    path runs at temp 1 with extended thinking (highest variance), which
    //    the old body-temperature check froze for 7 days.
    const ttlSeconds = effectiveTemp < 0.3 ? 604800 : 3600; // 7 days only for near-deterministic runs
    await cacheService.set(cacheKey, textPayload, { ex: ttlSeconds });

    return new Response(JSON.stringify({ text: textPayload, cached: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    console.error('Claude API Route Error:', error);
    return new Response(JSON.stringify({ error: 'An error occurred processing your request' }), { status: 500 });
  }
}
