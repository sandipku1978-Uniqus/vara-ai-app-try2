/**
 * Request validation for the /api/user/* routes (migration 026), in the
 * style of ai-input.ts: bounded body reads, a stable 4xx envelope, and a
 * strict field whitelist per object kind.
 *
 * Identity is never read from the body. Any key that names an identity
 * (owner/user/org) is rejected outright rather than silently ignored, so a
 * client bug or a forged request fails loudly; every other unknown key is
 * rejected too. The validated output is snake_case rows the RPC writes
 * exactly as given — the route adds the session identity separately.
 */

import { readJsonBody, type ValidationResult } from './ai-input';
import {
  USER_DATA_DELETE_BODY_BYTES,
  USER_DATA_FIELDS,
  USER_DATA_LIMITS,
  USER_DATA_MAX_DELETE_KEYS,
  CLIENT_KEY_PATTERN,
  type FieldSpec,
  type UserDataKind,
} from './user-data-kinds';

export type UserDataRow = Record<string, unknown>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Keys that would claim an identity. Checked case-insensitively, ignoring separators. */
const IDENTITY_KEYS = new Set([
  'owneruserid', 'owner', 'ownerid', 'userid', 'user', 'orgid', 'org', 'organizationid',
  'orgscope', 'organization', 'identity', 'sub',
]);

export function isIdentityKey(key: string): boolean {
  return IDENTITY_KEYS.has(key.toLowerCase().replace(/[^a-z]/g, ''));
}

function badRequest(error: string, status = 400): ValidationResult<never> {
  return {
    response: Response.json({ ok: false, error, errorClass: 'invalid-request' }, {
      status,
      headers: { 'Cache-Control': 'no-store' },
    }),
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: Set<string>, label: string): string | null {
  for (const key of Object.keys(record)) {
    if (isIdentityKey(key)) {
      return `${label}: "${key}" is not accepted. The account is taken from the signed-in session.`;
    }
    if (!allowed.has(key)) return `${label}: unknown field "${key}".`;
  }
  return null;
}

/** Validates one field value; returns the column value or an error string. */
function validateField(name: string, spec: FieldSpec, raw: unknown, label: string): { value: unknown } | { error: string } {
  const where = `${label}.${name}`;
  if (raw === undefined || raw === null) {
    if (spec.required) return { error: `${where} is required.` };
    if (raw === null && spec.nullable) return { value: null };
    if (raw === null && !spec.nullable) return { error: `${where} may not be null.` };
    return { value: spec.nullable ? null : JSON.parse(JSON.stringify(spec.fallback ?? null)) };
  }

  switch (spec.type) {
    case 'text': {
      if (typeof raw !== 'string') return { error: `${where} must be a string.` };
      if (spec.minLength !== undefined && raw.length < spec.minLength) return { error: `${where} is too short.` };
      if (spec.maxLength !== undefined && raw.length > spec.maxLength) {
        return { error: `${where} exceeds ${spec.maxLength} characters.` };
      }
      if (spec.oneOf && !spec.oneOf.includes(raw)) return { error: `${where} must be one of ${spec.oneOf.join(', ')}.` };
      if (spec.nullable && raw === '') return { value: null };
      if (spec.pattern && !spec.pattern.test(raw)) return { error: `${where} has an invalid format.` };
      return { value: raw };
    }
    case 'uuid':
      if (typeof raw !== 'string' || !UUID_PATTERN.test(raw)) return { error: `${where} must be a UUID.` };
      return { value: raw.toLowerCase() };
    case 'timestamp': {
      if (typeof raw !== 'string' || raw.length > 40 || Number.isNaN(Date.parse(raw))) {
        return { error: `${where} must be an ISO timestamp.` };
      }
      return { value: new Date(raw).toISOString() };
    }
    case 'boolean':
      if (typeof raw !== 'boolean') return { error: `${where} must be a boolean.` };
      return { value: raw };
    case 'integer': {
      if (typeof raw !== 'number' || !Number.isInteger(raw)) return { error: `${where} must be an integer.` };
      if (spec.min !== undefined && raw < spec.min) return { error: `${where} is below ${spec.min}.` };
      if (spec.max !== undefined && raw > spec.max) return { error: `${where} is above ${spec.max}.` };
      return { value: raw };
    }
    case 'json': {
      if (spec.shape === 'object' && !asRecord(raw)) return { error: `${where} must be an object.` };
      if (spec.shape === 'array' && !Array.isArray(raw)) return { error: `${where} must be an array.` };
      if (Array.isArray(raw)) {
        if (spec.maxElements !== undefined && raw.length > spec.maxElements) {
          return { error: `${where} exceeds ${spec.maxElements} entries.` };
        }
        if (spec.elementPattern) {
          const pattern = spec.elementPattern;
          if (!raw.every(element => typeof element === 'string' && pattern.test(element))) {
            return { error: `${where} contains an invalid entry.` };
          }
        }
      }
      let serialized: string;
      try {
        serialized = JSON.stringify(raw);
      } catch {
        return { error: `${where} is not serializable.` };
      }
      if (spec.maxBytes !== undefined && utf8Bytes(serialized) > spec.maxBytes) {
        return { error: `${where} exceeds ${spec.maxBytes} bytes.` };
      }
      return { value: raw };
    }
  }
}

/** Validates one wire item (camelCase) into an RPC row (snake_case). Pure; exported for tests. */
export function validateUserDataItem(
  kind: UserDataKind,
  raw: unknown,
  label = 'item',
): { row: UserDataRow } | { error: string } {
  const item = asRecord(raw);
  if (!item) return { error: `${label} must be an object.` };
  const fields = USER_DATA_FIELDS[kind];
  const unknown = rejectUnknownKeys(item, new Set(Object.keys(fields)), label);
  if (unknown) return { error: unknown };

  const row: UserDataRow = {};
  for (const [name, spec] of Object.entries(fields)) {
    const result = validateField(name, spec, item[name], label);
    if ('error' in result) return { error: result.error };
    row[spec.column] = result.value;
  }
  return { row };
}

/** Validates a PUT body `{ items: [...] }` into deduplicated rows (last write per clientKey wins). */
export function validateUserDataItems(kind: UserDataKind, body: unknown): { rows: UserDataRow[] } | { error: string } {
  const record = asRecord(body);
  if (!record) return { error: 'Request body must be a JSON object.' };
  const unknown = rejectUnknownKeys(record, new Set(['items']), 'body');
  if (unknown) return { error: unknown };
  if (!Array.isArray(record.items)) return { error: 'body.items must be an array.' };
  const limit = USER_DATA_LIMITS[kind].maxItemsPerRequest;
  if (record.items.length > limit) return { error: `Too many items (max ${limit} per request).` };

  const byKey = new Map<string, UserDataRow>();
  for (let index = 0; index < record.items.length; index += 1) {
    const result = validateUserDataItem(kind, record.items[index], `items[${index}]`);
    if ('error' in result) return { error: result.error };
    const key = String(result.row.client_key);
    byKey.delete(key);
    byKey.set(key, result.row);
  }
  return { rows: [...byKey.values()] };
}

/** Validates a DELETE body `{ clientKeys: [...] }`. */
export function validateUserDataDelete(body: unknown): { clientKeys: string[] } | { error: string } {
  const record = asRecord(body);
  if (!record) return { error: 'Request body must be a JSON object.' };
  const unknown = rejectUnknownKeys(record, new Set(['clientKeys']), 'body');
  if (unknown) return { error: unknown };
  if (!Array.isArray(record.clientKeys)) return { error: 'body.clientKeys must be an array.' };
  if (record.clientKeys.length > USER_DATA_MAX_DELETE_KEYS) {
    return { error: `Too many client keys (max ${USER_DATA_MAX_DELETE_KEYS} per request).` };
  }
  const keys: string[] = [];
  for (const key of record.clientKeys) {
    if (typeof key !== 'string' || !CLIENT_KEY_PATTERN.test(key)) {
      return { error: 'Each client key must be a non-empty string without control characters (max 300).' };
    }
    keys.push(key);
  }
  return { clientKeys: [...new Set(keys)] };
}

export async function readUserDataPut(request: Request, kind: UserDataKind): Promise<ValidationResult<UserDataRow[]>> {
  const parsed = await readJsonBody(request, USER_DATA_LIMITS[kind].maxBodyBytes);
  if (parsed.response) return parsed;
  const result = validateUserDataItems(kind, parsed.value);
  if ('error' in result) return badRequest(result.error);
  return { value: result.rows };
}

export async function readUserDataDelete(request: Request): Promise<ValidationResult<string[]>> {
  const parsed = await readJsonBody(request, USER_DATA_DELETE_BODY_BYTES);
  if (parsed.response) return parsed;
  const result = validateUserDataDelete(parsed.value);
  if ('error' in result) return badRequest(result.error);
  return { value: result.clientKeys };
}

/**
 * Converts a listed database row (snake_case, identity columns already
 * stripped by the RPC) to the wire item (camelCase). Only known columns plus
 * the server-managed id/created_at/updated_at are passed through, so a
 * future column never leaks by accident.
 */
export function rowToWireItem(kind: UserDataKind, row: Record<string, unknown>): Record<string, unknown> {
  const item: Record<string, unknown> = {};
  for (const [name, spec] of Object.entries(USER_DATA_FIELDS[kind])) {
    if (spec.column in row) item[name] = row[spec.column];
  }
  if ('id' in row) item.id = row.id;
  if ('created_at' in row) item.createdAt = row.created_at;
  if ('updated_at' in row) item.updatedAt = row.updated_at;
  return item;
}
