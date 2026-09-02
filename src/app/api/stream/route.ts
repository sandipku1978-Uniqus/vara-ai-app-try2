import { cacheService } from '../../../lib/cache';
import { createAnthropicClient, isAnthropicTimeout } from '../../../lib/ai-runtime';
import { SEC_RESEARCH_SYSTEM_PROMPT } from '../../../lib/systemPrompts';
import {
  acquireAiConcurrency,
  checkAiRateLimit,
  estimateModelTokenReservation,
  rateLimitResponse,
  releaseAiConcurrency,
  reserveAiTokenBudget,
} from '../../../lib/rate-limit';
import { requireApiAccess } from '../../../lib/api-auth';
import { validateChatRequest } from '../../../lib/ai-input';
import { buildFrameworkContext } from '../../../lib/framework-context';
import crypto from 'crypto';
import { withRouteObservability } from '../../../lib/route-observability';

/** The platform default would kill this route mid-flight; see the in-route budgets. */
export const maxDuration = 300;

const anthropic = createAnthropicClient(process.env.ANTHROPIC_API_KEY || '');

const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

async function handlePost(req: Request) {
  try {
    const access = await requireApiAccess();
    if (access.response) return access.response;

    const validation = await validateChatRequest(req);
    if (validation.response) return validation.response;
    // Excerpt grounding lives in /api/claude, which builds the grounded system
    // prompt and reports the excerpts; silently answering here would return an
    // ungrounded reply to a caller that asked for a grounded one.
    if (validation.value.grounding) {
      return Response.json({ error: 'Grounded requests must use /api/claude.' }, { status: 400 });
    }
    const { prompt, messages, maxTokens, frameworks } = validation.value;
    const isComplex = frameworks.length > 0;
    const effectiveMaxTokens = isComplex ? 8192 : maxTokens;

    const rate = await checkAiRateLimit(req, access.identity, {
      operation: 'stream',
    });
    if (!rate.allowed) return rateLimitResponse(rate);

    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json({ error: 'AI service is not configured.' }, { status: 503 });
    }

    // 1. Check cache — if hit, return JSON immediately (no streaming needed).
    //    Key includes frameworks (they change the injected KB and model config)
    //    and the EFFECTIVE params, so different configs can't collide.
    const payloadSignature = JSON.stringify({ prompt, messages, frameworks: [...frameworks].sort() });
    const hash = crypto.createHash('sha256').update(`${access.identity.cacheScope}:${payloadSignature}-${effectiveMaxTokens}`).digest('hex');
    const cacheKey = `ai-cache:${hash}`;

    const cachedResponse = await cacheService.get<string>(cacheKey);
    if (cachedResponse) {
      return new Response(JSON.stringify({ text: cachedResponse, cached: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2. Build messages with framework KB context
    const kbContext = buildFrameworkContext(frameworks);

    const apiMessages = messages.length > 0 ? messages.map(message => ({ ...message })) : [{ role: 'user' as const, content: prompt }];
    if (kbContext && apiMessages.length > 0) {
      apiMessages[apiMessages.length - 1].content += `\n\n[Reference material — internal cross-framework knowledge base, NOT from any filing]:${kbContext}`;
    }

    const estimatedTokens = estimateModelTokenReservation(
      SEC_RESEARCH_SYSTEM_PROMPT.length + apiMessages.reduce((total, message) => total + message.content.length, 0),
      effectiveMaxTokens
    );

    // 3. Stream response via SSE
    // Note: Extended thinking is not compatible with streaming, so complex queries
    // fall back to non-streaming with thinking enabled
    if (isComplex) {
      const concurrency = await acquireAiConcurrency(access.identity);
      if (!concurrency.allowed) return rateLimitResponse(concurrency);
      const budget = await reserveAiTokenBudget(access.identity, estimatedTokens);
      if (!budget.allowed) {
        await releaseAiConcurrency(concurrency.lease);
        return rateLimitResponse(budget);
      }
      const msg = await (async () => {
        try {
          return await anthropic.messages.create({
            model: CLAUDE_MODEL,
            max_tokens: 8192,
            // Sonnet 5: adaptive thinking only; temperature must be omitted
            thinking: { type: 'adaptive' },
            system: [{
              type: 'text',
              text: SEC_RESEARCH_SYSTEM_PROMPT,
              cache_control: { type: 'ephemeral' },
            }],
            messages: apiMessages,
          }, { signal: req.signal });
        } finally {
          await releaseAiConcurrency(concurrency.lease);
        }
      })();

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
    const concurrency = await acquireAiConcurrency(access.identity);
    if (!concurrency.allowed) return rateLimitResponse(concurrency);
    const budget = await reserveAiTokenBudget(access.identity, estimatedTokens);
    if (!budget.allowed) {
      await releaseAiConcurrency(concurrency.lease);
      return rateLimitResponse(budget);
    }
    const stream = await (async () => {
      try {
        return anthropic.messages.stream({
          model: CLAUDE_MODEL,
          max_tokens: maxTokens,
          // Sonnet 5 runs adaptive thinking when the field is omitted and rejects
          // non-default temperature — keep the fast SSE path explicitly thinking-off
          thinking: { type: 'disabled' },
          system: [{
            type: 'text',
            text: SEC_RESEARCH_SYSTEM_PROMPT,
            cache_control: { type: 'ephemeral' },
          }],
          messages: apiMessages,
        }, { signal: req.signal });
      } catch (error) {
        await releaseAiConcurrency(concurrency.lease);
        throw error;
      }
    })();

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
          await cacheService.set(cacheKey, fullText, { ex: 3600 });
        } catch (error) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              error: isAnthropicTimeout(error) ? 'AI generation timed out.' : 'Stream error',
            })}\n\n`)
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } finally {
          await releaseAiConcurrency(concurrency.lease);
        }
      },
      cancel() {
        stream.abort();
        void releaseAiConcurrency(concurrency.lease);
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
    if (req.signal.aborted) {
      return Response.json({ error: 'Request cancelled.' }, { status: 499 });
    }
    if (isAnthropicTimeout(error)) {
      return Response.json({ error: 'AI generation timed out.' }, { status: 504 });
    }
    console.error('Claude Stream API Error:', error);
    return new Response(JSON.stringify({ error: 'An error occurred processing your request' }), { status: 500 });
  }
}

export const POST = withRouteObservability('stream', handlePost);
