/**
 * Search-job persistence: thin, typed wrappers over the migration-028 RPCs.
 *
 * Every owner-facing call passes the owner id the route took from its
 * verified session; the worker's calls are scoped by the lease token the
 * claim returned. Responses are validated before they are trusted.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parseSearchJobCursor,
  parseSearchJobSummary,
  type SearchJobHit,
  type SearchJobHitWrite,
  type SearchJobPlan,
  type SearchJobStatus,
  type SearchJobSummary,
  type StoredSearchJobCursor,
} from '../../../../services/searchJobs';
import type { CandidateCoverageNotice } from '../../../../services/searchCoverage';

export interface ClaimedSearchJob extends SearchJobSummary {
  ownerUserId: string;
  orgId: string | null;
  cursor: StoredSearchJobCursor | null;
  leaseToken: string;
}

export interface SearchJobHitsPage {
  total: number;
  hits: SearchJobHit[];
}

export interface SearchJobAdvance {
  id: string;
  leaseToken: string;
  cursor: StoredSearchJobCursor;
  status: Exclude<SearchJobStatus, 'cancelled'>;
  statusReason: string | null;
  examined: number;
  upstreamTotal: number;
  upstreamTotalIsFloor: boolean;
  coverage: CandidateCoverageNotice;
  hits: SearchJobHitWrite[];
}

export type CreateSearchJobOutcome =
  | { status: 'created'; job: SearchJobSummary }
  | { status: 'active-job-exists'; job: SearchJobSummary | null };

export interface SearchJobStore {
  create(input: {
    ownerUserId: string;
    orgId: string | null;
    plan: SearchJobPlan;
    cursor: StoredSearchJobCursor;
    ttlSeconds: number;
  }): Promise<CreateSearchJobOutcome>;
  get(ownerUserId: string, id: string): Promise<SearchJobSummary | null>;
  list(ownerUserId: string, limit: number): Promise<SearchJobSummary[]>;
  hitsPage(ownerUserId: string, id: string, offset: number, limit: number): Promise<SearchJobHitsPage | null>;
  cancel(ownerUserId: string, id: string): Promise<SearchJobSummary | null>;
  claim(input: { id: string | null; ownerUserId: string | null; leaseSeconds: number }): Promise<ClaimedSearchJob | null>;
  lookupHits(id: string, leaseToken: string, accessions: string[]): Promise<SearchJobHit[]>;
  advance(input: SearchJobAdvance): Promise<SearchJobSummary | 'lease-lost'>;
  release(id: string, leaseToken: string, reason: string, failed: boolean): Promise<SearchJobSummary | 'lease-lost'>;
}

export class SearchJobStoreError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requireSummary(value: unknown, label: string): SearchJobSummary {
  const summary = parseSearchJobSummary(value);
  if (!summary) throw new SearchJobStoreError(`${label} returned an invalid job.`);
  return summary;
}

function parseHits(value: unknown): SearchJobHit[] {
  if (!Array.isArray(value)) return [];
  return value.filter((hit): hit is SearchJobHit =>
    isRecord(hit) &&
    typeof hit.id === 'string' &&
    typeof hit.accessionNumber === 'string' &&
    Array.isArray(hit.jobDocuments)
  );
}

export function createSupabaseSearchJobStore(db: SupabaseClient): SearchJobStore {
  const call = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
    const { data, error } = await db.rpc(fn, args);
    if (error) throw new SearchJobStoreError(`${fn} failed: ${error.message}`);
    return data;
  };

  return {
    async create({ ownerUserId, orgId, plan, cursor, ttlSeconds }) {
      const data = await call('urc_search_job_create', {
        p_owner_user_id: ownerUserId,
        p_org_id: orgId,
        p_plan: plan,
        p_cursor: cursor,
        p_ttl_seconds: ttlSeconds,
      });
      if (isRecord(data) && data.error === 'active-job-exists') {
        return { status: 'active-job-exists', job: parseSearchJobSummary(data.job) };
      }
      if (!isRecord(data)) throw new SearchJobStoreError('urc_search_job_create returned nothing.');
      return { status: 'created', job: requireSummary(data.job, 'urc_search_job_create') };
    },

    async get(ownerUserId, id) {
      const data = await call('urc_search_job_get', { p_owner_user_id: ownerUserId, p_id: id });
      return data ? requireSummary(data, 'urc_search_job_get') : null;
    },

    async list(ownerUserId, limit) {
      const data = await call('urc_search_job_list', { p_owner_user_id: ownerUserId, p_limit: limit });
      return (Array.isArray(data) ? data : [])
        .map(item => parseSearchJobSummary(item))
        .filter((item): item is SearchJobSummary => item !== null);
    },

    async hitsPage(ownerUserId, id, offset, limit) {
      const data = await call('urc_search_job_hits_page', {
        p_owner_user_id: ownerUserId,
        p_id: id,
        p_offset: offset,
        p_limit: limit,
      });
      if (!isRecord(data)) return null;
      return {
        total: Number.isSafeInteger(data.total) ? Number(data.total) : 0,
        hits: parseHits(data.hits),
      };
    },

    async cancel(ownerUserId, id) {
      const data = await call('urc_search_job_cancel', { p_owner_user_id: ownerUserId, p_id: id });
      return data ? requireSummary(data, 'urc_search_job_cancel') : null;
    },

    async claim({ id, ownerUserId, leaseSeconds }) {
      const data = await call('urc_search_job_claim', {
        p_id: id,
        p_owner_user_id: ownerUserId,
        p_lease_seconds: leaseSeconds,
      });
      if (!isRecord(data)) return null;
      const summary = requireSummary(data, 'urc_search_job_claim');
      if (typeof data.ownerUserId !== 'string' || typeof data.leaseToken !== 'string') {
        throw new SearchJobStoreError('urc_search_job_claim returned no lease.');
      }
      return {
        ...summary,
        ownerUserId: data.ownerUserId,
        orgId: typeof data.orgId === 'string' ? data.orgId : null,
        // A malformed cursor is reported to the worker as null, which fails
        // the job with a clear reason instead of resuming from garbage.
        cursor: parseSearchJobCursor(data.cursor),
        leaseToken: data.leaseToken,
      };
    },

    async lookupHits(id, leaseToken, accessions) {
      if (accessions.length === 0) return [];
      const data = await call('urc_search_job_hits_lookup', {
        p_id: id,
        p_lease_token: leaseToken,
        p_accessions: accessions,
      });
      return parseHits(data);
    },

    async advance(input) {
      const data = await call('urc_search_job_advance', {
        p_id: input.id,
        p_lease_token: input.leaseToken,
        p_cursor: input.cursor,
        p_status: input.status,
        p_status_reason: input.statusReason,
        p_examined: input.examined,
        p_upstream_total: input.upstreamTotal,
        p_upstream_total_is_floor: input.upstreamTotalIsFloor,
        p_coverage: input.coverage,
        p_hits: input.hits,
      });
      if (isRecord(data) && data.error === 'lease-lost') return 'lease-lost';
      if (!isRecord(data)) throw new SearchJobStoreError('urc_search_job_advance returned nothing.');
      return requireSummary(data.job, 'urc_search_job_advance');
    },

    async release(id, leaseToken, reason, failed) {
      const data = await call('urc_search_job_release', {
        p_id: id,
        p_lease_token: leaseToken,
        p_reason: reason,
        p_failed: failed,
      });
      if (isRecord(data) && data.error === 'lease-lost') return 'lease-lost';
      if (!isRecord(data)) throw new SearchJobStoreError('urc_search_job_release returned nothing.');
      return requireSummary(data.job, 'urc_search_job_release');
    },
  };
}
