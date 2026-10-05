import { cacheService } from '../../../lib/cache';
import {
  aiErrorResponse,
  complete,
  isAiServiceConfigured,
  modelUsageFromAiUsage,
  outputTokenBudget,
  planAiCall,
  type AiCompletion,
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
import {
  SEC_RESEARCH_SYSTEM_PROMPT,
  buildAscLookupPrompt,
  buildGroundedAscSystemPrompt,
  buildGroundedAscUserPrompt,
} from '../../../lib/systemPrompts';
import { selectFrameworkExcerpts } from '../../../lib/framework-excerpts';
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
import { classifyAiFailure, recordAiUsage } from '../../../lib/ai-usage';

/** The platform default would kill this route mid-flight; see the in-route budgets. */
export const maxDuration = 180;

/** What the KV cache keeps for an answer: the text and how it was produced. */
type CachedAnswer = AiAnswerMetadata & { text: string };

function isCachedAnswer(value: unknown): value is CachedAnswer {
  return Boolean(value && typeof value === 'object' && typeof (value as CachedAnswer).text === 'string' && typeof (value as CachedAnswer).model === 'string');
}

async function handlePost(req: Request) {
  try {
    const access = await requireApiAccess();
    if (access.response) return access.response;

    const validation = await validateChatRequest(req);
    if (validation.response) return validation.response;
    const { prompt, messages, maxTokens, frameworks, grounding, reasoningEffort, webSearch } = validation.value;
    const isComplex = frameworks.length > 0;

    const rate = await checkAiRateLimit(req, access.identity, {
      operation: 'claude',
    });
    if (!rate.allowed) return rateLimitResponse(rate);

    if (!isAiServiceConfigured()) {
      return Response.json({ error: 'AI service is not configured.' }, { status: 503 });
    }
    // A model this deployment cannot serve (no gateway key) is a 503 before
    // any budget is touched.
    const plan = planAiCall(validation.value.model);
    const model = findAiModel(validation.value.model)!;
    // Reasoning shares the output allowance, so effort adds headroom on top
    // of the answer length the caller asked for.
    const effectiveMaxTokens = outputTokenBudget(model, isComplex ? 8192 : maxTokens, reasoningEffort);

    // Grounded Accounting Hub questions: pick the knowledge base excerpts that
    // bear on the question and put them, with the citation contract, in the
    // system prompt the model actually receives. When nothing in the
    // knowledge base is relevant the request falls through to the labeled
    // model-recall prompt — the two paths are never blended, and the reply
    // reports which one it took so the UI can label it truthfully.
    const selection = grounding ? selectFrameworkExcerpts(prompt, grounding.topic) : null;
    const groundedExcerpts = selection?.coverage === 'grounded' ? selection.excerpts : null;
    const systemPromptText = groundedExcerpts ? buildGroundedAscSystemPrompt(groundedExcerpts) : SEC_RESEARCH_SYSTEM_PROMPT;
    const groundingReport = grounding && selection
      ? { source: grounding.source, coverage: selection.coverage, excerpts: selection.excerpts }
      : null;

    // 1. Cache key must cover everything that changes the answer: frameworks
    //    alter both the injected KB context and the model config (isComplex),
    //    so omitting them served one framework's cached answer to another.
    //    Hash the EFFECTIVE config, not the raw request values. The selected
    //    excerpts are inputs too: an edited knowledge base must miss the cache
    //    rather than serve an answer whose [n] markers point at old text. The
    //    model that runs (and on which transport), its effort and web search
    //    change the answer as well.
    const payloadSignature = JSON.stringify({
      prompt,
      messages,
      frameworks: [...frameworks].sort(),
      grounding: groundingReport
        ? { topic: grounding?.topic ?? null, excerpts: groundingReport.excerpts.map(excerpt => [excerpt.n, excerpt.id, excerpt.text]) }
        : null,
      model: plan.wireModel,
      transport: plan.transport,
      reasoningEffort,
      webSearch,
    });
    const hash = crypto.createHash('sha256').update(`${access.identity.cacheScope}:${payloadSignature}-${effectiveMaxTokens}`).digest('hex');
    const cacheKey = `ai-cache:v2:${hash}`;

    // 2. Check Vercel KV Cache
    const cachedResponse = await cacheService.get<unknown>(cacheKey);
    if (isCachedAnswer(cachedResponse)) {
      return new Response(JSON.stringify({ ...cachedResponse, cached: true, ...(groundingReport ? { grounding: groundingReport } : {}) }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const kbContext = buildFrameworkContext(frameworks);

    const userContent = grounding
      ? (groundedExcerpts ? buildGroundedAscUserPrompt(prompt) : buildAscLookupPrompt(prompt))
      : prompt;
    const apiMessages = messages.length > 0 ? messages.map(message => ({ ...message })) : [{ role: 'user' as const, content: userContent }];
    if (kbContext && apiMessages.length > 0) {
      // Labeled as reference material so the model can't cite the static KB
      // as if it came from a filing.
      apiMessages[apiMessages.length - 1].content += `\n\n[Reference material — internal cross-framework knowledge base, NOT from any filing]:${kbContext}`;
    }

    const concurrency = await acquireAiConcurrency(access.identity);
    if (!concurrency.allowed) return rateLimitResponse(concurrency);
    const weights = modelCostWeights(model.pricing);
    const webReservation = webSearchReservationTokens(model, webSearch);
    const budget = await reserveAiTokenBudget(
      access.identity,
      estimateModelTokenReservation(
        systemPromptText.length + apiMessages.reduce((total, message) => total + message.content.length, 0),
        effectiveMaxTokens,
        1,
        { weights, webSearchCalls: webReservation.webSearchCalls }
      ) + webReservation.extraTokens
    );
    if (!budget.allowed) {
      await releaseAiConcurrency(concurrency.lease);
      return rateLimitResponse(budget);
    }
    const modelCallStartedAt = Date.now();
    const usageRecord = {
      route: 'claude',
      model: plan.transport === 'direct-anthropic' ? plan.wireModel : model.id,
      provider: model.provider,
      reasoningEffort,
      weights,
      userId: access.identity.userId,
      reservation: budget.reservation,
      startedAt: modelCallStartedAt,
    };
    let web: WebSearchPreparation = WEB_SEARCH_OFF;
    const completion: AiCompletion = await (async () => {
      try {
        // Web search runs only when the request asked for it — the grounded
        // Accounting Hub path included.
        web = await prepareWebSearch({
          model,
          webSearch,
          question: prompt || apiMessages[apiMessages.length - 1].content,
          contextSummary: grounding ? `Accounting standards question${grounding.topic ? ` (ASC ${grounding.topic})` : ''}.` : null,
          signal: req.signal,
        });
        const result = await complete({
          model: model.id,
          system: withWebAddendum(systemPromptText, web.systemAddendum),
          messages: apiMessages,
          maxTokens: effectiveMaxTokens,
          reasoningEffort,
          webSearch: web.nativeSearch,
          maxWebSearches: NATIVE_WEB_SEARCH_MAX_USES,
          // Prompt caching: the static research prompt is cached at Anthropic
          // for a 90% input token discount. The grounded prompt changes with
          // every question's excerpt set, and so does a prompt carrying
          // retrieved web results, so caching those would only add entries.
          cacheSystemPrompt: !groundedExcerpts && web.report.mode !== 'retrieval' && web.report.mode !== 'unavailable',
          signal: req.signal,
        });
        // Settle the reservation against what the API actually billed.
        await recordAiUsage({
          ...usageRecord,
          usage: modelUsageFromAiUsage(result.usage),
          outcome: 'completed',
          additionalBillableTokens: web.retrievalBillableTokens,
        });
        return result;
      } catch (error) {
        await recordAiUsage({
          ...usageRecord,
          usage: modelUsageFromAiUsage((error as { usage?: AiCompletion['usage'] | null }).usage),
          outcome: classifyAiFailure(error),
          additionalBillableTokens: web.retrievalBillableTokens,
        });
        throw error;
      } finally {
        await releaseAiConcurrency(concurrency.lease);
      }
    })();

    const answer: CachedAnswer = { text: completion.text, ...answerMetadata(completion, reasoningEffort, web) };

    // Sonnet 5 rejects caller-selected temperatures, so every generation uses
    // the model default. Keep these variable outputs briefly rather than using
    // a fictitious request temperature to select or partition the cache.
    await cacheService.set(cacheKey, answer, { ex: 3600 });

    return new Response(JSON.stringify({ ...answer, cached: false, ...(groundingReport ? { grounding: groundingReport } : {}) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error: unknown) {
    if (req.signal.aborted) {
      return Response.json({ error: 'Request cancelled.' }, { status: 499 });
    }
    const mapped = aiErrorResponse(error);
    if (mapped) return mapped;
    console.error('Claude API Route Error:', error);
    return new Response(JSON.stringify({ error: 'An error occurred processing your request' }), { status: 500 });
  }
}

export const POST = withRouteObservability('claude', handlePost);
