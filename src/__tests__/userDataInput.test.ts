import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isIdentityKey,
  rowToWireItem,
  validateUserDataDelete,
  validateUserDataItem,
  validateUserDataItems,
} from '../lib/user-data-input';
import { USER_DATA_FIELDS, USER_DATA_KINDS, USER_DATA_LIMITS } from '../lib/user-data-kinds';
import {
  USER_DATA_ASSERTION_TTL_SECONDS,
  signUserDataAssertion,
  userDataAssertionMessage,
} from '../lib/user-data-auth';

const migration = readFileSync(resolve(process.cwd(), 'db', 'migrations', '026_user_research_objects.sql'), 'utf8');

function sqlKindBlock(kind: string): { columns: string[]; maxItems: number } {
  const start = migration.indexOf(`when '${kind}' then`);
  expect(start, `urc_user_kind has no branch for ${kind}`).toBeGreaterThan(0);
  const rest = migration.slice(start + 10);
  const end = rest.search(/\n\s+(when '|else\n)/);
  const block = rest.slice(0, end);
  const columns = [...(block.match(/writable_columns := array\[([\s\S]*?)\]/)?.[1] || '').matchAll(/'([a-z_]+)'/g)].map(match => match[1]);
  const maxItems = Number(block.match(/max_items := (\d+)/)?.[1]);
  return { columns, maxItems };
}

describe('user-data field contract matches migration 026', () => {
  it.each(USER_DATA_KINDS.map(kind => [kind]))('%s: TS fields and the SQL write whitelist name the same columns', kind => {
    const sql = sqlKindBlock(kind);
    const tsColumns = Object.values(USER_DATA_FIELDS[kind]).map(spec => spec.column);
    expect([...tsColumns].sort()).toEqual([...sql.columns].sort());
    expect(USER_DATA_LIMITS[kind].maxItemsPerRequest).toBe(sql.maxItems);
  });

  it('never lets an identity column into a write whitelist', () => {
    for (const kind of USER_DATA_KINDS) {
      const columns = Object.values(USER_DATA_FIELDS[kind]).map(spec => spec.column);
      expect(columns).not.toContain('owner_user_id');
      expect(columns).not.toContain('org_id');
      expect(columns).not.toContain('org_scope');
      expect(sqlKindBlock(kind).columns).not.toContain('owner_user_id');
      expect(sqlKindBlock(kind).columns).not.toContain('org_id');
    }
  });
});

describe('identity assertion format', () => {
  it('signs exactly the message urc_user_assume() recomputes', () => {
    expect(migration).toContain(
      "concat_ws(E'\\n', 'urc-user-v1', p_operation, p_kind, p_user_id, coalesce(p_org_id, ''), p_expires_at::text)",
    );
    const nowMs = Date.UTC(2026, 9, 4, 12, 0, 0);
    const assertion = signUserDataAssertion({
      operation: 'upsert', kind: 'watchlist', userId: 'user_abc', orgId: null, secret: 's'.repeat(40), nowMs,
    });
    const expiresAt = nowMs / 1000 + USER_DATA_ASSERTION_TTL_SECONDS;
    expect(assertion).toMatchObject({ p_user_id: 'user_abc', p_org_id: null, p_expires_at: expiresAt });
    const message = `urc-user-v1\nupsert\nwatchlist\nuser_abc\n\n${expiresAt}`;
    expect(userDataAssertionMessage('upsert', 'watchlist', 'user_abc', null, expiresAt)).toBe(message);
    expect(assertion.p_signature).toBe(createHmac('sha256', 's'.repeat(40)).update(message).digest('hex'));
  });

  it('compares fixed-length digests of the presented and expected signatures, never the strings', () => {
    const assume = migration.slice(migration.indexOf('function public.urc_user_assume('));
    const body = assume.slice(0, assume.indexOf('end $$;'));
    expect(body).not.toMatch(/p_signature\)?\s*<>\s*v_expected/);
    expect(body).toContain("extensions.digest(lower(p_signature), 'sha256') <> extensions.digest(v_expected, 'sha256')");
  });

  it('binds the org, the operation and the kind', () => {
    const base = { userId: 'user_abc', secret: 'k'.repeat(40), nowMs: 0 } as const;
    const personal = signUserDataAssertion({ ...base, operation: 'list', kind: 'alerts', orgId: null });
    const org = signUserDataAssertion({ ...base, operation: 'list', kind: 'alerts', orgId: 'org_1' });
    const deleting = signUserDataAssertion({ ...base, operation: 'delete', kind: 'alerts', orgId: null });
    const otherKind = signUserDataAssertion({ ...base, operation: 'list', kind: 'memo', orgId: null });
    expect(new Set([personal, org, deleting, otherKind].map(item => item.p_signature)).size).toBe(4);
    expect(org.p_org_id).toBe('org_1');
  });
});

describe('validateUserDataItem', () => {
  it('maps camelCase wire fields to snake_case columns with fallbacks', () => {
    const result = validateUserDataItem('alerts', {
      clientKey: 'alert-1',
      name: 'Material weakness',
      query: 'material weakness',
      mode: 'boolean',
      filters: { formTypes: ['10-K'] },
      lastSeenAccessions: ['0000320193-24-000123'],
      lastCheckedAt: '2026-10-01T00:00:00Z',
    });
    expect('row' in result && result.row).toMatchObject({
      client_key: 'alert-1',
      project_id: null,
      mode: 'boolean',
      cadence: 'daily',
      enabled: true,
      last_hit_count: 0,
      last_checked_at: '2026-10-01T00:00:00.000Z',
      last_seen_accessions: ['0000320193-24-000123'],
      latest_new_accessions: [],
      position: 0,
    });
  });

  it.each([
    ['ownerUserId'], ['owner_user_id'], ['userId'], ['user_id'], ['orgId'], ['org_id'], ['organizationId'], ['orgScope'],
  ])('rejects the identity key %s instead of ignoring it', key => {
    const result = validateUserDataItem('watchlist', { clientKey: 'AAPL', ticker: 'AAPL', [key]: 'user_someone_else' });
    expect(result).toEqual({ error: expect.stringContaining('taken from the signed-in session') });
    expect(isIdentityKey(key)).toBe(true);
  });

  it('rejects unknown fields, bad shapes and oversize values', () => {
    expect(validateUserDataItem('watchlist', { clientKey: 'AAPL', ticker: 'AAPL', colour: 'red' }))
      .toEqual({ error: 'item: unknown field "colour".' });
    expect(validateUserDataItem('watchlist', { clientKey: 'AAPL', ticker: 'aapl!' }))
      .toEqual({ error: 'item.ticker has an invalid format.' });
    expect(validateUserDataItem('peer-sets', { clientKey: 'p', name: 'P', tickers: ['AAPL', 7] }))
      .toEqual({ error: 'item.tickers contains an invalid entry.' });
    expect(validateUserDataItem('memo', { clientKey: 'm', itemKind: 'citation', payload: [] }))
      .toEqual({ error: 'item.payload must be an object.' });
    expect(validateUserDataItem('memo', { clientKey: 'm', itemKind: 'note', payload: {} }))
      .toEqual({ error: 'item.itemKind must be one of citation, draft.' });
    expect(validateUserDataItem('research-tabs', { clientKey: 't', payload: { blob: 'x'.repeat(600_000) } }))
      .toEqual({ error: 'item.payload exceeds 524288 bytes.' });
    expect(validateUserDataItem('projects', { clientKey: 'p', name: '' })).toEqual({ error: 'item.name is too short.' });
    expect(validateUserDataItem('projects', { clientKey: 'p', name: 'x', id: 'not-a-uuid' }))
      .toEqual({ error: 'item.id must be a UUID.' });
    expect(validateUserDataItem('watchlist', { clientKey: 'a\u0000b', ticker: 'AAPL' }))
      .toEqual({ error: 'item.clientKey has an invalid format.' });
    expect(validateUserDataItem('alerts', { clientKey: 'a', lastHitCount: 1.5 }))
      .toEqual({ error: 'item.lastHitCount must be an integer.' });
  });

  it('treats an empty optional accession as null', () => {
    const result = validateUserDataItem('annotations', { clientKey: 'k', filingKey: 'f', accession: '', note: 'n' });
    expect('row' in result && result.row.accession).toBeNull();
  });
});

describe('validateUserDataItems / validateUserDataDelete', () => {
  it('requires { items } and keeps the last write per clientKey', () => {
    const result = validateUserDataItems('watchlist', {
      items: [
        { clientKey: 'AAPL', ticker: 'AAPL', position: 0 },
        { clientKey: 'AAPL', ticker: 'AAPL', position: 3 },
      ],
    });
    expect(result).toEqual({ rows: [expect.objectContaining({ client_key: 'AAPL', position: 3 })] });
    expect(validateUserDataItems('watchlist', [])).toEqual({ error: 'Request body must be a JSON object.' });
    expect(validateUserDataItems('watchlist', { items: [], userId: 'user_x' }))
      .toEqual({ error: expect.stringContaining('taken from the signed-in session') });
  });

  it('caps items per request at the database bound', () => {
    const items = Array.from({ length: 9 }, (_, index) => ({ clientKey: `t${index}`, payload: { id: `t${index}` } }));
    expect(validateUserDataItems('research-tabs', { items })).toEqual({ error: 'Too many items (max 8 per request).' });
  });

  it('validates delete keys', () => {
    expect(validateUserDataDelete({ clientKeys: ['a', 'a', 'b'] })).toEqual({ clientKeys: ['a', 'b'] });
    expect(validateUserDataDelete({ clientKeys: [''] })).toEqual({ error: expect.stringContaining('client key') });
    expect(validateUserDataDelete({ clientKeys: ['a'], orgId: 'org_x' }))
      .toEqual({ error: expect.stringContaining('taken from the signed-in session') });
    expect(validateUserDataDelete({ clientKeys: Array.from({ length: 501 }, (_, index) => `k${index}`) }))
      .toEqual({ error: 'Too many client keys (max 500 per request).' });
  });
});

describe('rowToWireItem', () => {
  it('passes only contract columns plus server fields', () => {
    expect(rowToWireItem('watchlist', {
      id: 'id-1', client_key: 'AAPL', ticker: 'AAPL', position: 0, project_id: null,
      created_at: 'c', updated_at: 'u', owner_user_id: 'user_x', org_id: 'org_x', surprise: 1,
    })).toEqual({
      id: 'id-1', clientKey: 'AAPL', ticker: 'AAPL', position: 0, projectId: null, createdAt: 'c', updatedAt: 'u',
    });
  });
});
