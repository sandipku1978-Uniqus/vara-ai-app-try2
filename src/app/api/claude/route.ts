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
export const maxDuration = 180;


const anthropic = createAnthropicClient(process.env.ANTHROPIC_API_KEY || '');

// Model is env-configurable so upgrades are a Vercel env change, not a deploy
const CLAUDE_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

async function handlePost(req: Request) {
  try {
    const access = await requireApiAccess();
    if (access.response) return access.response;

    const validation = await validateChatRequest(req);
    if (validation.response) return validation.response;
    const { prompt, messages, maxTokens, frameworks } = validation.value;
    const isComplex = frameworks.length > 0;
    const effectiveMaxTokens = isComplex ? 8192 : maxTokens;

    const rate = await checkAiRateLimit(req, access.identity, {
      operation: 'claude',
    });
    if (!rate.allowed) return rateLimitResponse(rate);

    if (!process.env.ANTHROPIC_API_KEY) {
      return Response.json({ error: 'AI service is not configured.' }, { status: 503 });
    }

    // 1. Cache key must cover everything that changes the answer: frameworks
    //    alter both the injected KB context and the model config (isComplex),
    //    so omitting them served one framework's cached answer to another.
    //    Hash the EFFECTIVE config, not the raw request values.
    const payloadSignature = JSON.stringify({ prompt, messages, frameworks: [...frameworks].sort() });
    const hash = crypto.createHash('sha256').update(`${access.identity.cacheScope}:${payloadSignature}-${effectiveMaxTokens}`).digest('hex');
    const cacheKey = `ai-cache:${hash}`;

    // 2. Check Vercel KV Cache
    const cachedResponse = await cacheService.get<string>(cacheKey);
    if (cachedResponse) {
      return new Response(JSON.stringify({ text: cachedResponse, cached: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const kbContext = buildFrameworkContext(frameworks);

    const apiMessages = messages.length > 0 ? messages.map(message => ({ ...message })) : [{ role: 'user' as const, content: prompt }];
    if (kbContext && apiMessages.length > 0) {
      // Labeled as reference material so the model can't cite the static KB
      // as if it came from a filing.
      apiMessages[apiMessages.length - 1].content += `\n\n[Reference material — internal cross-framework knowledge base, NOT from any filing]:${kbContext}`;
    }

    const concurrency = await acquireAiConcurrency(access.identity);
    if (!concurrency.allowed) return rateLimitResponse(concurrency);
    const budget = await reserveAiTokenBudget(
      access.identity,
      estimateModelTokenReservation(
        SEC_RESEARCH_SYSTEM_PROMPT.length + apiMessages.reduce((total, message) => total + message.content.length, 0),
        effectiveMaxTokens
      )
    );
    if (!budget.allowed) {
      await releaseAiConcurrency(concurrency.lease);
      return rateLimitResponse(budget);
    }
    const msg = await (async () => {
      try {
        return await anthropic.messages.create({
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
        }, { signal: req.signal });
      } finally {
        await releaseAiConcurrency(concurrency.lease);
      }
    })();

    const textPayload = msg.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    // Sonnet 5 rejects caller-selected temperatures, so every generation uses
    // the model default. Keep these variable outputs briefly rather than using
    // a fictitious request temperature to select or partition the cache.
    await cacheService.set(cacheKey, textPayload, { ex: 3600 });

    return new Response(JSON.stringify({ text: textPayload, cached: false }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    if (req.signal.aborted) {
      return Response.json({ error: 'Request cancelled.' }, { status: 499 });
    }
    if (isAnthropicTimeout(error)) {
      return Response.json({ error: 'AI generation timed out.' }, { status: 504 });
    }
    console.error('Claude API Route Error:', error);
    return new Response(JSON.stringify({ error: 'An error occurred processing your request' }), { status: 500 });
  }
}

export const POST = withRouteObservability('claude', handlePost);
