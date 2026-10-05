import { cacheService } from '../../../lib/cache';
import {
  aiErrorResponse,
  AiContentFilterError,
  complete,
  isAiServiceConfigured,
  isAiTimeout,
  modelUsageFromAiUsage,
  outputTokenBudget,
  planAiCall,
  stream as streamModel,
  type AiCompletion,
  type AiUsage,
} from '../../../lib/ai-gateway';
import { findAiModel } from '../../../lib/ai-models';
import {
  answerMetadata,
  NATIVE_WEB_SEARCH_MAX_USES,
  prepareWebSearch,
  WEB_SEARCH_OFF,
  webSearchReservationTokens,
  withWebAddendum,
  type AiAnswerMetadata,
  type WebSearchPreparation,
} from '../../../lib/ai-web-search';
import { SEC_RESEARCH_SYSTEM_PROMPT } from '../../../lib/systemPrompts';
import {
  acquireAiConcurrency,
  checkAiRateLimit,
  estimateModelTokenReservation,
  modelCostWeights,
  rateLimitResponse,
  releaseAiConcurrency,
  reserveAiTokenBudget,
} from '../../../lib/rate-limit';
import { requireApiAccess } from '../../../lib/api-auth';
import { validateChatRequest } from '../../../lib/ai-input';
import { buildFrameworkContext } from '../../../lib/framework-context';
import crypto from 'crypto';
import { withRouteObservability } from '../../../lib/route-observability';
import {
  classifyAiFailure,
  recordAiUsage,
  type AiCallOutcome,
  type ModelUsage,
} from '../../../lib/ai-usage';

/** The platform default would kill this route mid-flight; see the in-route budgets. */
export const maxDuration = 300;

type CachedAnswer = AiAnswerMetadata & { text: string };

function isCachedAnswer(value: unknown): value is CachedAnswer {
  return Boolean(value && typeof value === 'object' && typeof (value as CachedAnswer).text === 'string' && typeof (value as CachedAnswer).model === 'string');
}

function errorUsage(error: unknown): AiUsage | null {
  return (error as { usage?: AiUsage | null } | null)?.usage ?? null;
}

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
    const { prompt, messages, maxTokens, frameworks, reasoningEffort, webSearch } = validation.value;
    const isComplex = frameworks.length > 0;

    const rate = await checkAiRateLimit(req, access.identity, {
      operation: 'stream',
    });
    if (!rate.allowed) return rateLimitResponse(rate);

    if (!isAiServiceConfigured()) {
      return Response.json({ error: 'AI service is not configured.' }, { status: 503 });
    }
    const plan = planAiCall(validation.value.model);
    const model = findAiModel(validation.value.model)!;
    const effectiveMaxTokens = outputTokenBudget(model, isComplex ? 8192 : maxTokens, reasoningEffort);

    // 1. Check cache — if hit, return JSON immediately (no streaming needed).
    //    Key includes frameworks (they change the injected KB and model config),
    //    the model/transport/effort/web search, and the EFFECTIVE params, so
    //    different configs can't collide.
    const payloadSignature = JSON.stringify({
      prompt,
      messages,
      frameworks: [...frameworks].sort(),
      model: plan.wireModel,
      transport: plan.transport,
      reasoningEffort,
      webSearch,
    });
    const hash = crypto.createHash('sha256').update(`${access.identity.cacheScope}:${payloadSignature}-${effectiveMaxTokens}`).digest('hex');
    const cacheKey = `ai-cache:v2:${hash}`;

    const cachedResponse = await cacheService.get<unknown>(cacheKey);
    if (isCachedAnswer(cachedResponse)) {
      return new Response(JSON.stringify({ ...cachedResponse, cached: true }), {
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

    const weights = modelCostWeights(model.pricing);
    const webReservation = webSearchReservationTokens(model, webSearch);
    const estimatedTokens = estimateModelTokenReservation(
      SEC_RESEARCH_SYSTEM_PROMPT.length + apiMessages.reduce((total, message) => total + message.content.length, 0),
      effectiveMaxTokens,
      1,
      { weights, webSearchCalls: webReservation.webSearchCalls }
    ) + webReservation.extraTokens;
    const reportedModel = plan.transport === 'direct-anthropic' ? plan.wireModel : model.id;
    const question = prompt || apiMessages[apiMessages.length - 1].content;

    // 3. Framework (complex) queries answer as one JSON response; standard
    //    queries stream over SSE.
    if (isComplex) {
      const concurrency = await acquireAiConcurrency(access.identity);
      if (!concurrency.allowed) return rateLimitResponse(concurrency);
      const budget = await reserveAiTokenBudget(access.identity, estimatedTokens);
      if (!budget.allowed) {
        await releaseAiConcurrency(concurrency.lease);
        return rateLimitResponse(budget);
      }
      const modelCallStartedAt = Date.now();
      const usageRecord = {
        route: 'stream', model: reportedModel, provider: model.provider, reasoningEffort, weights,
        userId: access.identity.userId, reservation: budget.reservation, startedAt: modelCallStartedAt,
      };
      let web: WebSearchPreparation = WEB_SEARCH_OFF;
      const completion: AiCompletion = await (async () => {
        try {
          web = await prepareWebSearch({ model, webSearch, question, signal: req.signal });
          const result = await complete({
            model: model.id,
            system: withWebAddendum(SEC_RESEARCH_SYSTEM_PROMPT, web.systemAddendum),
            messages: apiMessages,
            maxTokens: effectiveMaxTokens,
            reasoningEffort,
            webSearch: web.nativeSearch,
            maxWebSearches: NATIVE_WEB_SEARCH_MAX_USES,
            cacheSystemPrompt: web.report.mode !== 'retrieval' && web.report.mode !== 'unavailable',
            signal: req.signal,
          });
          await recordAiUsage({ ...usageRecord, usage: modelUsageFromAiUsage(result.usage), outcome: 'completed', additionalBillableTokens: web.retrievalBillableTokens });
          return result;
        } catch (error) {
          await recordAiUsage({ ...usageRecord, usage: modelUsageFromAiUsage(errorUsage(error)), outcome: classifyAiFailure(error), additionalBillableTokens: web.retrievalBillableTokens });
          throw error;
        } finally {
          await releaseAiConcurrency(concurrency.lease);
        }
      })();

      const answer: CachedAnswer = { text: completion.text, ...answerMetadata(completion, reasoningEffort, web) };
      // Reasoning output is the highest-variance path — cache briefly, not
      // for a week (one bad generation was served for 7 days).
      await cacheService.set(cacheKey, answer, { ex: 3600 });

      return new Response(JSON.stringify({ ...answer, cached: false }), {
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
    // One usage line per streamed request, whichever way it ends.
    const streamStartedAt = Date.now();
    const usageRecord = {
      route: 'stream', model: reportedModel, provider: model.provider, reasoningEffort, weights,
      userId: access.identity.userId, reservation: budget.reservation, startedAt: streamStartedAt,
    };
    let web: WebSearchPreparation = WEB_SEARCH_OFF;
    let usageRecorded = false;
    const settleStream = async (usage: ModelUsage | null, outcome: AiCallOutcome) => {
      if (usageRecorded) return;
      usageRecorded = true;
      await recordAiUsage({ ...usageRecord, usage, outcome, additionalBillableTokens: web.retrievalBillableTokens });
    };

    // Retrieval (models without native search) runs before the first byte,
    // so its results are in the prompt the stream answers from.
    const modelStream = await (async () => {
      try {
        web = await prepareWebSearch({ model, webSearch, question, signal: req.signal });
        return streamModel({
          model: model.id,
          system: withWebAddendum(SEC_RESEARCH_SYSTEM_PROMPT, web.systemAddendum),
          messages: apiMessages,
          maxTokens: effectiveMaxTokens,
          reasoningEffort,
          webSearch: web.nativeSearch,
          maxWebSearches: NATIVE_WEB_SEARCH_MAX_USES,
          cacheSystemPrompt: web.report.mode !== 'retrieval' && web.report.mode !== 'unavailable',
          signal: req.signal,
        });
      } catch (error) {
        await settleStream(null, classifyAiFailure(error));
        await releaseAiConcurrency(concurrency.lease);
        throw error;
      }
    })();

    const encoder = new TextEncoder();
    let fullText = '';

    const readableStream = new ReadableStream({
      async start(controller) {
        try {
          let completion: AiCompletion | null = null;
          for await (const event of modelStream) {
            if (event.type === 'text-delta') {
              fullText += event.text;
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text: event.text })}\n\n`)
              );
            } else if (event.type === 'finish') {
              completion = event.completion;
            }
          }
          if (!completion) throw new Error('Model stream ended without a final response.');
          const metadata = answerMetadata(completion, reasoningEffort, web);
          const answer: CachedAnswer = { text: completion.text || fullText, ...metadata };

          // The final event carries how the answer was produced (no `text`
          // key, so older clients that only read text ignore it).
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, ...metadata })}\n\n`));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
          await settleStream(modelUsageFromAiUsage(completion.usage), 'completed');

          // Cache the full response after stream completes
          await cacheService.set(cacheKey, answer, { ex: 3600 });
        } catch (error) {
          // Whatever streamed before the failure was generated and billed.
          await settleStream(
            modelUsageFromAiUsage(errorUsage(error) ?? modelStream.partialUsage()),
            classifyAiFailure(error)
          );
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({
              error: isAiTimeout(error)
                ? 'AI generation timed out.'
                : error instanceof AiContentFilterError
                  ? 'The model declined to answer this request.'
                  : 'Stream error',
            })}\n\n`)
          );
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } finally {
          await releaseAiConcurrency(concurrency.lease);
        }
      },
      cancel() {
        modelStream.abort();
        // The client went away mid-answer: what was generated so far is
        // billed, the rest is not — an unknown split, so the estimate stands.
        void settleStream(modelUsageFromAiUsage(modelStream.partialUsage()), 'unknown');
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
    const mapped = aiErrorResponse(error);
    if (mapped) return mapped;
    console.error('Claude Stream API Error:', error);
    return new Response(JSON.stringify({ error: 'An error occurred processing your request' }), { status: 500 });
  }
}

export const POST = withRouteObservability('stream', handlePost);
