/**
 * GET /api/es-search — enriched SEC filing search.
 *
 * Historically backed by an Elastic Cloud full-text index; that account was
 * retired (cost). Same request/response contract, new engine:
 *
 *   text queries  → EDGAR EFTS full-text search (free, always current)
 *   facets/enrich → Supabase Postgres metadata layer (urc_sec_filings,
 *                   urc_current_auditors from PCAOB Form AP, urc_sec_companies)
 *
 * With a text query: EFTS supplies candidates, Postgres supplies exact
 * auditor/SIC facets and enrichment. Without a text query: pure facet browse
 * straight from Postgres via the urc_search_filings function.
 *
 * Returns EFTS-shaped { hits: { total, hits } } so the frontend treats every
 * backend uniformly. 503 when Supabase env is absent — the client falls back
 * to its plain-EFTS path (see searchEdgarFilings).
 */

import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { canonicalizeAuditorInput } from '../../../services/auditors';

const EFTS_URL = 'https://efts.sec.gov/LATEST/search-index';
const USER_AGENT =
  process.env.NEXT_PUBLIC_EDGAR_USER_AGENT || 'Uniqus Research Center contact@uniqus.com';

/** Extra candidates fetched beyond the requested page so post-filtering by
 *  auditor/SIC still fills the page. */
const CANDIDATE_CAP = 300;

let supabase: SupabaseClient | null = null;

function getSupabase(): SupabaseClient | null {
  if (supabase) return supabase;
  const url = process.env.URC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.URC_SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  supabase = createClient(url, key, { auth: { persistSession: false } });
  return supabase;
}

interface EftsHit {
  _id: string;
  _score?: number;
  _source: Record<string, unknown> & { ciks?: string[] };
}

async function fetchEftsCandidates(params: {
  q: string;
  forms?: string;
  startdt?: string;
  enddt?: string;
  entityName?: string;
  cap: number;
}): Promise<{ total: number; hits: EftsHit[] }> {
  const base = new URLSearchParams({ q: params.q });
  if (params.forms) base.set('forms', params.forms);
  if (params.startdt || params.enddt) {
    base.set('dateRange', 'custom');
    if (params.startdt) base.set('startdt', params.startdt);
    if (params.enddt) base.set('enddt', params.enddt);
  }
  if (params.entityName) base.set('entityName', params.entityName);

  const collected: EftsHit[] = [];
  const seen = new Set<string>();
  let total = 0;
  let offset = 0;

  // EFTS controls its own page size; stride by hits actually received.
  while (collected.length < params.cap && offset < 9_900) {
    const pageParams = new URLSearchParams(base);
    pageParams.set('from', String(offset));
    const response = await fetch(`${EFTS_URL}?${pageParams.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000),
      next: { revalidate: 300 },
    });
    if (!response.ok) {
      if (collected.length > 0) break; // return what we have
      throw new Error(`EFTS ${response.status}`);
    }
    const data = await response.json();
    const pageHits: EftsHit[] = data?.hits?.hits ?? [];
    total = data?.hits?.total?.value ?? total;
    for (const hit of pageHits) {
      if (seen.has(hit._id)) continue;
      seen.add(hit._id);
      collected.push(hit);
      if (collected.length >= params.cap) break;
    }
    if (pageHits.length === 0) break;
    offset += pageHits.length;
    if (offset >= total) break;
  }

  return { total, hits: collected };
}

function hitCiks(hit: EftsHit): number[] {
  const raw = hit._source?.ciks;
  if (!Array.isArray(raw)) return [];
  return raw.map(value => Number(String(value).replace(/\D/g, ''))).filter(Number.isFinite);
}

export async function GET(request: Request) {
  const db = getSupabase();
  if (!db) {
    return NextResponse.json(
      { error: 'Enriched search is not configured (Supabase env missing)' },
      { status: 503 }
    );
  }

  const params = new URL(request.url).searchParams;
  const q = (params.get('q') || '').trim();
  const forms = params.get('forms') || undefined;
  const startdt = params.get('startdt') || undefined;
  const enddt = params.get('enddt') || undefined;
  const entityName = params.get('entityName') || undefined;
  const auditorParam = (params.get('auditor') || '').trim();
  const auditor = auditorParam ? canonicalizeAuditorInput(auditorParam) : '';
  const sicCode = (params.get('sicCode') || '').trim();
  const from = Math.max(0, Number(params.get('from') || 0) || 0);
  const size = Math.min(Math.max(Number(params.get('size') || 10) || 10, 1), 100);

  // Facet entity matching is a trigram-assisted ILIKE. Corporate suffixes
  // (", Inc.", "Corp") are made of ultra-common trigrams that blow the GIN
  // index up into multi-second scans ("BlackRock, Inc." 36s vs "BlackRock"
  // 0.3s at 4M rows), and stray backslashes in EDGAR names ("CORP \DE\")
  // are LIKE escape chars that silently break the pattern. Strip both.
  const facetEntity = (() => {
    if (!entityName) return null;
    let e = entityName.trim();
    const suffix = /[,.]?\s+(incorporated|inc|corp|corporation|company|co|ltd|llc|llp|lp|plc|nv|sa|se|ag)\.?$/i;
    for (let i = 0; i < 2; i++) {
      const stripped = e.replace(suffix, '');
      if (stripped === e || stripped.length < 4) break;
      e = stripped;
    }
    return e.replace(/[\\%_]/g, (m) => `\\${m}`) || null;
  })();

  try {
    // ── Facet browse: no text query — serve straight from Postgres ─────────
    if (!q) {
      const { data, error } = await db.rpc('urc_search_filings', {
        p_forms: forms ? forms.split(',').map(f => f.trim().toUpperCase()).filter(Boolean) : null,
        p_start: startdt ?? null,
        p_end: enddt ?? null,
        p_auditor: auditor || null,
        p_entity: facetEntity,
        p_sic: sicCode || null,
        p_limit: size,
        p_offset: from,
      });
      if (error) throw new Error(`urc_search_filings: ${error.message}`);

      const rows = (data ?? []) as Array<Record<string, unknown>>;
      const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
      return NextResponse.json({
        hits: {
          total: { value: total, relation: 'eq' },
          hits: rows.map(row => ({
            _id: `${row.accession}:${row.filename}`,
            _score: 0,
            _source: {
              adsh: row.accession,
              ciks: [String(row.cik).padStart(10, '0')],
              display_names: [`${row.company_name} (CIK ${String(row.cik).padStart(10, '0')})`],
              form: row.form,
              root_forms: [row.root_form],
              is_amendment: row.is_amendment,
              file_date: row.date_filed,
              file_type: row.form,
              auditor: row.auditor ?? '',
              sic: row.sic ?? '',
              sic_description: row.sic_description ?? '',
              tickers: row.tickers ?? [],
            },
          })),
        },
      });
    }

    // ── Text search: EFTS candidates + Postgres facets/enrichment ──────────
    const needed = from + size;
    const cap = Math.min(CANDIDATE_CAP, Math.max(needed * 3, 60));
    const efts = await fetchEftsCandidates({ q, forms, startdt, enddt, entityName, cap });

    const allCiks = Array.from(new Set(efts.hits.flatMap(hitCiks)));
    const auditorByCik = new Map<number, string>();
    const companyByCik = new Map<number, { sic: string | null; sic_description: string | null; tickers: string[] }>();

    if (allCiks.length > 0) {
      const [auditorsResult, companiesResult] = await Promise.all([
        db.from('urc_current_auditors').select('issuer_cik, firm_canonical').in('issuer_cik', allCiks),
        db.from('urc_sec_companies').select('cik, sic, sic_description, tickers').in('cik', allCiks),
      ]);
      for (const row of auditorsResult.data ?? []) {
        auditorByCik.set(Number(row.issuer_cik), String(row.firm_canonical));
      }
      for (const row of companiesResult.data ?? []) {
        companyByCik.set(Number(row.cik), {
          sic: row.sic ?? null,
          sic_description: row.sic_description ?? null,
          tickers: row.tickers ?? [],
        });
      }
    }

    const enriched = efts.hits.map(hit => {
      const ciks = hitCiks(hit);
      const hitAuditor = ciks.map(cik => auditorByCik.get(cik)).find(Boolean) || '';
      const company = ciks.map(cik => companyByCik.get(cik)).find(Boolean);
      return {
        ...hit,
        _source: {
          ...hit._source,
          auditor: hitAuditor,
          sic: company?.sic ?? hit._source.sic ?? '',
          sic_description: company?.sic_description ?? '',
          tickers: company?.tickers?.length ? company.tickers : hit._source.tickers ?? [],
        },
      };
    });

    const matchesAuditor = (value: string) =>
      auditor === 'Big 4'
        ? ['Deloitte', 'PwC', 'EY', 'KPMG'].includes(value)
        : value === auditor;

    const filtered = enriched.filter(hit => {
      if (auditor && !matchesAuditor(String(hit._source.auditor || ''))) return false;
      if (sicCode && String(hit._source.sic || '') !== sicCode) return false;
      return true;
    });

    const facetsApplied = Boolean(auditor || sicCode);
    const page = filtered.slice(from, from + size);
    return NextResponse.json({
      hits: {
        // When facets filtered the candidate pool we only know the filtered
        // count within the fetched window — report it as a lower bound.
        total: facetsApplied
          ? { value: filtered.length, relation: filtered.length >= cap ? 'gte' : 'eq' }
          : { value: efts.total, relation: 'eq' },
        hits: page,
      },
    });
  } catch (error) {
    console.error('[es-search] enriched search failed:', error);
    return NextResponse.json({ error: 'Enriched search failed' }, { status: 502 });
  }
}
