/**
 * The user-owned research objects (migration 026), shared by the API routes
 * and the browser client. Pure data — no server-only imports — so the client
 * bundle can use the same field contract the routes validate against.
 *
 * Each field maps a camelCase wire name to its snake_case column. The column
 * set per kind must match the writable-column whitelist in
 * `urc_user_kind()` (db/migrations/026_user_research_objects.sql); a test
 * holds the two together. Identity columns (owner_user_id, org_id) are never
 * fields: the route takes them from the Clerk session.
 */

export const USER_DATA_KINDS = [
  'projects',
  'saved-searches',
  'alerts',
  'peer-sets',
  'memo',
  'annotations',
  'research-tabs',
  'watchlist',
  'checklists',
] as const;

export type UserDataKind = typeof USER_DATA_KINDS[number];

export function isUserDataKind(value: string): value is UserDataKind {
  return (USER_DATA_KINDS as readonly string[]).includes(value);
}

export type FieldType = 'text' | 'uuid' | 'timestamp' | 'boolean' | 'integer' | 'json';

export interface FieldSpec {
  column: string;
  type: FieldType;
  /** Must be present (and, for text, non-empty after trimming is NOT applied). */
  required?: boolean;
  /** May be null. Fields that are neither required nor nullable get `fallback`. */
  nullable?: boolean;
  fallback?: unknown;
  /** text: maximum characters. */
  maxLength?: number;
  minLength?: number;
  pattern?: RegExp;
  oneOf?: readonly string[];
  /** integer bounds. */
  min?: number;
  max?: number;
  /** json: required top-level shape and serialized byte cap. */
  shape?: 'object' | 'array';
  maxBytes?: number;
  /** json arrays: element cap and, when set, every element must be a string matching it. */
  maxElements?: number;
  elementPattern?: RegExp;
}

/** No control characters; long enough for memo citation ids with section scopes. */
export const CLIENT_KEY_PATTERN = /^[^\u0000-\u001f\u007f]{1,300}$/;
export const TICKER_PATTERN = /^[A-Z0-9./-]{1,15}$/;
export const CIK_PATTERN = /^[0-9]{1,10}$/;
export const ACCESSION_PATTERN = /^[0-9-]{1,25}$/;

const clientKey: FieldSpec = { column: 'client_key', type: 'text', required: true, pattern: CLIENT_KEY_PATTERN, maxLength: 300 };
const projectId: FieldSpec = { column: 'project_id', type: 'uuid', nullable: true };
const position: FieldSpec = { column: 'position', type: 'integer', fallback: 0, min: -1_000_000, max: 1_000_000 };
const createdAt: FieldSpec = { column: 'created_at', type: 'timestamp', nullable: true };
const searchMode: FieldSpec = { column: 'mode', type: 'text', fallback: 'semantic', oneOf: ['semantic', 'boolean'] };
const searchFilters: FieldSpec = { column: 'filters', type: 'json', shape: 'object', maxBytes: 16_384, fallback: {} };

export const USER_DATA_FIELDS: Record<UserDataKind, Record<string, FieldSpec>> = {
  projects: {
    id: { column: 'id', type: 'uuid', nullable: true },
    clientKey,
    name: { column: 'name', type: 'text', required: true, minLength: 1, maxLength: 120 },
    question: { column: 'question', type: 'text', fallback: '', maxLength: 2000 },
    position,
    archivedAt: { column: 'archived_at', type: 'timestamp', nullable: true },
    createdAt,
  },
  'saved-searches': {
    id: { column: 'id', type: 'uuid', nullable: true },
    clientKey,
    projectId,
    label: { column: 'label', type: 'text', fallback: '', maxLength: 200 },
    query: { column: 'query', type: 'text', fallback: '', maxLength: 4000 },
    mode: searchMode,
    filters: searchFilters,
    position,
    createdAt,
  },
  alerts: {
    clientKey,
    projectId,
    savedSearchId: { column: 'saved_search_id', type: 'uuid', nullable: true },
    name: { column: 'name', type: 'text', fallback: '', maxLength: 200 },
    query: { column: 'query', type: 'text', fallback: '', maxLength: 4000 },
    mode: searchMode,
    filters: searchFilters,
    defaultForms: { column: 'default_forms', type: 'text', fallback: '', maxLength: 400 },
    cadence: { column: 'cadence', type: 'text', fallback: 'daily', oneOf: ['daily', 'weekly'] },
    enabled: { column: 'enabled', type: 'boolean', fallback: true },
    lastCheckedAt: { column: 'last_checked_at', type: 'timestamp', nullable: true },
    lastHitCount: { column: 'last_hit_count', type: 'integer', fallback: 0, min: 0, max: 10_000_000 },
    lastSeenAccessions: {
      column: 'last_seen_accessions', type: 'json', shape: 'array', fallback: [],
      maxElements: 5000, elementPattern: ACCESSION_PATTERN, maxBytes: 200_000,
    },
    latestNewAccessions: {
      column: 'latest_new_accessions', type: 'json', shape: 'array', fallback: [],
      maxElements: 5000, elementPattern: ACCESSION_PATTERN, maxBytes: 200_000,
    },
    engineVersion: { column: 'engine_version', type: 'integer', nullable: true, min: 0, max: 10_000 },
    lastCheckCoverage: { column: 'last_check_coverage', type: 'json', shape: 'object', nullable: true, maxBytes: 65_536 },
    position,
    createdAt,
  },
  'peer-sets': {
    clientKey,
    projectId,
    name: { column: 'name', type: 'text', required: true, minLength: 1, maxLength: 120 },
    tickers: {
      column: 'tickers', type: 'json', shape: 'array', fallback: [],
      maxElements: 200, elementPattern: TICKER_PATTERN, maxBytes: 8_192,
    },
    ciks: {
      column: 'ciks', type: 'json', shape: 'array', fallback: [],
      maxElements: 200, elementPattern: CIK_PATTERN, maxBytes: 8_192,
    },
    asOf: { column: 'as_of', type: 'timestamp', nullable: true },
    position,
    createdAt,
  },
  memo: {
    clientKey,
    projectId,
    itemKind: { column: 'item_kind', type: 'text', required: true, oneOf: ['citation', 'draft'] },
    accession: { column: 'accession', type: 'text', nullable: true, pattern: ACCESSION_PATTERN, maxLength: 25 },
    cik: { column: 'cik', type: 'text', nullable: true, pattern: CIK_PATTERN, maxLength: 10 },
    payload: { column: 'payload', type: 'json', shape: 'object', required: true, maxBytes: 262_144 },
    position,
    createdAt,
  },
  annotations: {
    clientKey,
    projectId,
    filingKey: { column: 'filing_key', type: 'text', required: true, minLength: 1, maxLength: 400 },
    accession: { column: 'accession', type: 'text', nullable: true, pattern: ACCESSION_PATTERN, maxLength: 25 },
    anchor: { column: 'anchor', type: 'json', shape: 'object', fallback: {}, maxBytes: 16_384 },
    note: { column: 'note', type: 'text', required: true, minLength: 1, maxLength: 8000 },
    position,
    createdAt,
  },
  'research-tabs': {
    clientKey,
    projectId,
    title: { column: 'title', type: 'text', fallback: '', maxLength: 200 },
    payload: { column: 'payload', type: 'json', shape: 'object', required: true, maxBytes: 524_288 },
    position,
    createdAt,
  },
  watchlist: {
    clientKey,
    projectId,
    ticker: { column: 'ticker', type: 'text', required: true, pattern: TICKER_PATTERN, maxLength: 15 },
    position,
    createdAt,
  },
  checklists: {
    clientKey,
    projectId,
    name: { column: 'name', type: 'text', fallback: '', maxLength: 200 },
    items: { column: 'items', type: 'json', shape: 'array', fallback: [], maxBytes: 65_536, maxElements: 500 },
    position,
    createdAt,
  },
};

export interface UserDataKindLimits {
  /** Items accepted in one PUT (mirrors max_items in urc_user_kind). */
  maxItemsPerRequest: number;
  /** Request body cap for PUT, enforced while reading the stream. */
  maxBodyBytes: number;
}

export const USER_DATA_LIMITS: Record<UserDataKind, UserDataKindLimits> = {
  projects: { maxItemsPerRequest: 100, maxBodyBytes: 256 * 1024 },
  'saved-searches': { maxItemsPerRequest: 100, maxBodyBytes: 1024 * 1024 },
  alerts: { maxItemsPerRequest: 100, maxBodyBytes: 2 * 1024 * 1024 },
  'peer-sets': { maxItemsPerRequest: 100, maxBodyBytes: 512 * 1024 },
  memo: { maxItemsPerRequest: 200, maxBodyBytes: 2 * 1024 * 1024 },
  annotations: { maxItemsPerRequest: 200, maxBodyBytes: 2 * 1024 * 1024 },
  // Eight tabs of up to 512 KB each, inside Vercel's 4.5 MB request ceiling.
  'research-tabs': { maxItemsPerRequest: 8, maxBodyBytes: 4 * 1024 * 1024 + 256 * 1024 },
  watchlist: { maxItemsPerRequest: 200, maxBodyBytes: 128 * 1024 },
  checklists: { maxItemsPerRequest: 50, maxBodyBytes: 1024 * 1024 },
};

/** DELETE accepts at most this many client keys per request (urc_user_delete). */
export const USER_DATA_MAX_DELETE_KEYS = 500;
export const USER_DATA_DELETE_BODY_BYTES = 256 * 1024;

export function userDataRoutePath(kind: UserDataKind): string {
  return `/api/user/${kind}`;
}

/** Server-managed fields every listed item carries in addition to its writable fields. */
export interface UserDataServerFields {
  id: string;
  createdAt: string;
  updatedAt: string;
}
