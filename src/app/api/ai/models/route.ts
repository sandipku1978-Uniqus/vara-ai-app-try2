/**
 * GET /api/ai/models — the AI model registry filtered to the models this
 * deployment can actually run right now, so the selector never offers a
 * model that is not available.
 *
 * With the AI Gateway configured, that is every registry model the gateway
 * currently lists (`GET /v1/models`, cached in KV for an hour). If the
 * listing cannot be read, the answer says so (`gateway.listing:
 * 'unavailable'`, `checkedAt: null`) and offers the last listing that was
 * read, or the full registry when none was: availability is then unknown,
 * not "only the default" (AI routes still validate the requested model
 * against the registry). A failure is remembered for five minutes so
 * each panel open does not wait out another listing deadline. Without the
 * gateway, only the default model runs (directly against Anthropic), and
 * without any key nothing does.
 */

import { NextResponse } from 'next/server';
import { requireApiAccess } from '../../../../lib/api-auth';
import { cacheService } from '../../../../lib/cache';
import {
  AI_GATEWAY_BASE_URL,
  defaultAiModelId,
  isAiGatewayConfigured,
  isAiServiceConfigured,
  registryModelsListedBy,
} from '../../../../lib/ai-gateway';
import { AI_MODELS, findAiModel, type AiModelDefinition } from '../../../../lib/ai-models';
import { fetchWithDeadline } from '../../../../lib/fetch-with-deadline';
import { checkResourceRateLimit, rateLimitResponse } from '../../../../lib/rate-limit';
import { withRouteObservability } from '../../../../lib/route-observability';

/** Platform budget (seconds): one KV read, at most one bounded listing fetch. */
export const maxDuration = 15;

const GATEWAY_LISTING_CACHE_KEY = 'ai-gateway:listed-models:v1';
/** The last listing that was read, kept past the hour so a failure can still serve it. */
const LAST_GOOD_LISTING_CACHE_KEY = 'ai-gateway:listed-models:last-good:v1';
/** Set when a listing read fails; while present no new read is attempted. */
const LISTING_FAILURE_CACHE_KEY = 'ai-gateway:listed-models:failed:v1';
const LISTING_TTL_SECONDS = 60 * 60;
const LAST_GOOD_TTL_SECONDS = 7 * 24 * 60 * 60;
const LISTING_FAILURE_TTL_SECONDS = 5 * 60;
const LISTING_DEADLINE_MS = 8_000;

interface CachedListing {
  ids: string[];
  checkedAt: string;
}

type ListingStatus = 'live' | 'cached' | 'unavailable' | 'not-configured';

function isCachedListing(value: unknown): value is CachedListing {
  return Boolean(value && typeof value === 'object'
    && Array.isArray((value as CachedListing).ids)
    && typeof (value as CachedListing).checkedAt === 'string');
}

async function readGatewayListing(): Promise<CachedListing> {
  // The model listing is public; no key is sent with it.
  const response = await fetchWithDeadline(LISTING_DEADLINE_MS)(`${AI_GATEWAY_BASE_URL}/v1/models`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`gateway listing HTTP ${response.status}`);
  const body = await response.json() as { data?: Array<{ id?: unknown }> };
  const ids = (Array.isArray(body.data) ? body.data : [])
    .map(entry => entry.id)
    .filter((id): id is string => typeof id === 'string');
  if (ids.length === 0) throw new Error('gateway listing was empty');
  return { ids, checkedAt: new Date().toISOString() };
}

/**
 * The gateway's listing: fresh from cache, or read now. When it cannot be
 * read (or failed within the last five minutes), the last listing that was
 * read, if any, with status 'unavailable'.
 */
async function gatewayListing(): Promise<{ listing: CachedListing | null; status: ListingStatus }> {
  const cached = await cacheService.get<unknown>(GATEWAY_LISTING_CACHE_KEY);
  if (isCachedListing(cached)) return { listing: cached, status: 'cached' };
  const failedRecently = await cacheService.get<unknown>(LISTING_FAILURE_CACHE_KEY);
  if (!failedRecently) {
    try {
      const listing = await readGatewayListing();
      await Promise.all([
        cacheService.set(GATEWAY_LISTING_CACHE_KEY, listing, { ex: LISTING_TTL_SECONDS }),
        cacheService.set(LAST_GOOD_LISTING_CACHE_KEY, listing, { ex: LAST_GOOD_TTL_SECONDS }),
      ]);
      return { listing, status: 'live' };
    } catch (error) {
      console.error('[ai/models] gateway listing unavailable:', error);
      await cacheService.set(LISTING_FAILURE_CACHE_KEY, { failedAt: new Date().toISOString() }, { ex: LISTING_FAILURE_TTL_SECONDS });
    }
  }
  const lastGood = await cacheService.get<unknown>(LAST_GOOD_LISTING_CACHE_KEY);
  return { listing: isCachedListing(lastGood) ? lastGood : null, status: 'unavailable' };
}

async function handleGet(request: Request): Promise<Response> {
  const access = await requireApiAccess();
  if (access.response) return access.response;
  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'ai-models', userLimit: 60, ipLimit: 120 });
  if (!rate.allowed) return rateLimitResponse(rate);

  const configuredDefault = defaultAiModelId();
  const defaultModel = findAiModel(configuredDefault);
  let models: AiModelDefinition[] = [];
  let status: ListingStatus = 'not-configured';
  let checkedAt: string | null = null;

  if (isAiGatewayConfigured()) {
    const result = await gatewayListing();
    status = result.status;
    const listed = result.listing
      ? registryModelsListedBy(result.listing.ids).map(id => findAiModel(id)!)
      : [];
    if (status === 'unavailable') {
      // Unknown, not unavailable: the last listing read, else every model.
      // checkedAt stays null so the client does not present it as current.
      models = listed.length > 0 ? listed : [...AI_MODELS];
    } else {
      checkedAt = result.listing?.checkedAt ?? null;
      models = listed;
    }
  } else if (isAiServiceConfigured() && defaultModel) {
    models = [defaultModel];
  }

  const defaultModelId = models.some(model => model.id === configuredDefault)
    ? configuredDefault
    : models[0]?.id ?? null;

  return NextResponse.json({
    models,
    defaultModelId,
    gateway: { configured: isAiGatewayConfigured(), listing: status, checkedAt },
  }, { headers: { 'Cache-Control': 'private, max-age=300' } });
}

export const GET = withRouteObservability('ai/models', handleGet);
