import { Anthropic } from '@anthropic-ai/sdk';
import { cacheService } from '../../../lib/cache';
import { SEC_RESEARCH_SYSTEM_PROMPT } from '../../../lib/systemPrompts';
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
      return new Response(
        JSON.stringify({ text: 'API Key not configured. This is a fallback response from the local development server simulating the Copilot.' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // 1. Check cache — if hit, return JSON immediately (no streaming needed).
    //    Key includes frameworks (they change the injected KB and model config)
    //    and the EFFECTIVE params, so different configs can't collide.
    const isComplexForKey = frameworks.length > 0;
    const payloadSignature = JSON.stringify({ prompt, messages, frameworks: [...frameworks].sort() });
    const keyMaxTokens = isComplexForKey ? 8192 : maxTokens;
    const keyTemp = isComplexForKey ? 1 : temperature;
    const hash = crypto.createHash('sha256').update(`${payloadSignature}-${keyMaxTokens}-${keyTemp}`).digest('hex');
    const cacheKey = `ai-cache:${hash}`;

    const cachedResponse = await cacheService.get<string>(cacheKey);
    if (cachedResponse) {
      return new Response(JSON.stringify({ text: cachedResponse, cached: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Build messages with framework KB context
    let kbContext = '';
    if (frameworks.includes('IFRS')) {
      try {
        kbContext += '\nIFRS Context: ' + require('../../../data/standards/ifrs-kb.json').standards.map((s: any) => `${s.id}: ${s.keyDifferences.join(' ')}`).join('\n');
      } catch (e) {}
    }
    if (frameworks.includes('Ind AS')) {
      try {
        kbContext += '\nInd AS Context: ' + require('../../../data/standards/ind-as-kb.json').standards.map((s: any) => `${s.id}: ${s.keyDifferences.join(' ')}`).join('\n');
      } catch (e) {}
    }

    const apiMessages = messages.length > 0 ? messages : [{ role: 'user' as const, content: prompt }];
    if (kbContext && apiMessages.length > 0) {
      apiMessages[apiMessages.length - 1].content += `\n\n[Reference material — internal cross-framework knowledge base, NOT from any filing]:${kbContext}`;
    }

    const isComplex = frameworks.length > 0;

    // 3. Stream response via SSE
    // Note: Extended thinking is not compatible with streaming, so complex queries
    // fall back to non-streaming with thinking enabled
    if (isComplex) {
      const msg = await anthropic.messages.create({
        model: CLAUDE_MODEL,
        max_tokens: 8192,
        thinking: { type: 'enabled', budget_tokens: 4000 },
        temperature: 1,
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

      // Temp-1 extended-thinking output is the highest-variance path — cache
      // briefly, not for a week (one bad generation was served for 7 days).
      const ttlSeconds = 3600;
      await cacheService.set(cacheKey, textPayload, { ex: ttlSeconds });

      return new Response(JSON.stringify({ text: textPayload, cached: false }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 4. SSE streaming for standard queries
    const stream = anthropic.messages.stream({
      model: CLAUDE_MODEL,
      max_tokens: clampedMaxTokens,
      temperature: clampedTemp,
      system: [{
        type: 'text',
        text: SEC_RESEARCH_SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      }],
      messages: apiMessages,
    });

    const encoder = new TextEncoder();
    let fullText = '';

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          for await (const event of stream) {
            if (
              event.type === 'content_block_delta' &&
              event.delta.type === 'text_delta'
            ) {
              const chunk = event.delta.text;
              fullText += chunk;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: chunk })}\n\n`)
              );
            }
          }

          // Signal completion
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();

          // Cache the full response after stream completes
          const ttlSeconds = temperature < 0.3 ? 604800 : 3600;
          await cacheService.set(cacheKey, fullText, { ex: ttlSeconds });
        } catch (error) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: 'Stream error' })}\n\n`)
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
      },
    });

    return new Response(readableStream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  } catch (error: unknown) {
    console.error('Claude Stream API Error:', error);
    return new Response(JSON.stringify({ error: 'An error occurred processing your request' }), { status: 500 });
  }
}
