/** Client-safe validation for responses returned by SEC's EFTS search API. */

export interface EftsPayloadHit {
  _id: string;
  _source: Record<string, unknown>;
  _score?: number;
  [key: string]: unknown;
}

export interface EftsPayload {
  hits: {
    total: {
      value: number;
      relation: 'eq' | 'gte';
      [key: string]: unknown;
    };
    hits: EftsPayloadHit[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export class InvalidEftsResponseError extends Error {
  readonly status = 502;
}

const EFTS_JSON_MEDIA_TYPE = /^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/i;
const EFTS_SAFE_ID = /^[^\u0000-\u001f\u007f]{1,1024}$/u;

function invalid(message: string): never {
  throw new InvalidEftsResponseError(message);
}

/**
 * Decode and validate the minimum EFTS contract before any 2xx body is trusted
 * as search results. Extra SEC fields are retained, but the count/relation and
 * every candidate identifier/source must be structurally safe.
 */
export function parseAndValidateEftsPayload(
  contentType: string | null,
  body: string | Uint8Array,
): EftsPayload {
  const mediaType = (contentType || '').split(';', 1)[0].trim();
  if (!EFTS_JSON_MEDIA_TYPE.test(mediaType)) {
    invalid('SEC search returned a non-JSON response.');
  }

  let parsed: unknown;
  try {
    const text = typeof body === 'string' ? body : new TextDecoder().decode(body);
    parsed = JSON.parse(text);
  } catch {
    invalid('SEC search returned malformed JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    invalid('SEC search returned an invalid payload.');
  }
  const root = parsed as Record<string, unknown>;
  if (!root.hits || typeof root.hits !== 'object' || Array.isArray(root.hits)) {
    invalid('SEC search returned an invalid payload.');
  }
  const hits = root.hits as Record<string, unknown>;
  if (!hits.total || typeof hits.total !== 'object' || Array.isArray(hits.total)) {
    invalid('SEC search returned an invalid payload.');
  }
  const total = hits.total as Record<string, unknown>;
  if (
    !Number.isSafeInteger(total.value)
    || Number(total.value) < 0
    || (total.relation !== 'eq' && total.relation !== 'gte')
    || !Array.isArray(hits.hits)
  ) {
    invalid('SEC search returned an invalid payload.');
  }
  for (const candidate of hits.hits) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      invalid('SEC search returned an invalid hit.');
    }
    const hit = candidate as Record<string, unknown>;
    if (
      typeof hit._id !== 'string'
      || hit._id.trim() !== hit._id
      || !EFTS_SAFE_ID.test(hit._id)
      || !hit._source
      || typeof hit._source !== 'object'
      || Array.isArray(hit._source)
    ) {
      invalid('SEC search returned an invalid hit.');
    }
  }

  return parsed as EftsPayload;
}
