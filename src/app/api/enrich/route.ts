/**
 * GET /api/enrich?ciks=320193,789019 — batch issuer-profile enrichment from
 * the facet store: current issuer auditor (PCAOB Form AP) plus company data.
 * This current-state auditor must never be applied to a historical filing.
 *
 * POST /api/enrich with { filings: [{ key, cik, fileDate }] } resolves the
 * filing-date Form AP evidence used by search. The explicit split prevents an
 * issuer's firm today from silently relabelling its old filings.
 */

import { NextResponse } from 'next/server';
import { requireApiAccess } from '../../../lib/api-auth';
import { isValidIsoDate, parseCik } from '../../../lib/api-query';
import { checkResourceRateLimit, rateLimitResponse } from '../../../lib/rate-limit';
import { getWebSupabase } from '../../../lib/supabase-web';
import { withRouteObservability } from '../../../lib/route-observability';

const MAX_CIKS = 200;
const MAX_FILINGS = 200;

async function handleGet(request: Request) {
  const access = await requireApiAccess(true, '/api/enrich', 'GET');
  if (access.response) return access.response;

  const raw = new URL(request.url).searchParams.get('ciks') || '';
  if (raw.length > 2400) return NextResponse.json({ error: 'CIK list is too large.' }, { status: 413 });
  const parsedCiks = raw.split(',').map(parseCik);
  if (parsedCiks.some(cik => cik === null)) {
    return NextResponse.json({ error: 'Every CIK must contain 1 to 10 digits.' }, { status: 400 });
  }
  const ciks = Array.from(new Set(parsedCiks as number[]));
  if (ciks.length === 0) {
    return NextResponse.json({ error: "Provide 'ciks' as a comma-separated list" }, { status: 400 });
  }
  if (ciks.length > MAX_CIKS) {
    return NextResponse.json({ error: `Maximum ${MAX_CIKS} CIKs per request.` }, { status: 400 });
  }

  const db = getWebSupabase();
  if (!db) return NextResponse.json({ error: 'Enrichment store not configured with a restricted database role.' }, { status: 503 });
  const rate = await checkResourceRateLimit(request, access.identity, { operation: 'enrich' });
  if (!rate.allowed) return rateLimitResponse(rate);

  try {
    const [auditorsResult, companiesResult] = await Promise.all([
      db.from('urc_current_auditors').select('issuer_cik, firm_canonical, fiscal_period_end').in('issuer_cik', ciks),
      db.from('urc_sec_companies').select('cik, sic, sic_description, tickers, exchanges, state_of_incorporation').in('cik', ciks),
    ]);

    // A database outage must be visible, not returned as "every issuer has a
    // blank auditor and SIC" — the client's degrade path exists for exactly
    // this and only fires on a non-200.
    if (auditorsResult.error || companiesResult.error) {
      console.error('[enrich] read failed:', auditorsResult.error || companiesResult.error);
      return NextResponse.json({ error: 'Enrichment store temporarily unavailable' }, { status: 503 });
    }

    const result: Record<string, Record<string, unknown>> = {};
    for (const cik of ciks) result[String(cik)] = {};
    for (const row of auditorsResult.data ?? []) {
      result[String(row.issuer_cik)] = {
        ...result[String(row.issuer_cik)],
        auditor: row.firm_canonical,
        auditor_period_end: row.fiscal_period_end,
        auditor_scope: 'current_issuer_latest_form_ap',
      };
    }
    for (const row of companiesResult.data ?? []) {
      result[String(row.cik)] = {
        ...result[String(row.cik)],
        sic: row.sic ?? null,
        sic_description: row.sic_description ?? null,
        tickers: row.tickers ?? [],
        exchanges: row.exchanges ?? [],
        state_of_incorporation: row.state_of_incorporation ?? null,
      };
    }

    return NextResponse.json({
      companies: result,
      meta: { auditorScope: 'current_issuer_latest_form_ap' },
    });
  } catch (error) {
    console.error('[enrich] failed:', error);
    return NextResponse.json({ error: 'Enrichment failed' }, { status: 502 });
  }
}

interface FilingEnrichmentInput {
  key?: unknown;
  cik?: unknown;
  fileDate?: unknown;
}

async function handlePost(request: Request) {
  const access = await requireApiAccess(true, '/api/enrich', 'POST');
  if (access.response) return access.response;

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > 100_000) {
    return NextResponse.json({ error: 'Filing enrichment request is too large.' }, { status: 413 });
  }

  let body: { filings?: FilingEnrichmentInput[] };
  try {
    body = await request.json() as { filings?: FilingEnrichmentInput[] };
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  if (!Array.isArray(body.filings) || body.filings.length === 0) {
    return NextResponse.json({ error: "Provide a non-empty 'filings' array." }, { status: 400 });
  }
  if (body.filings.length > MAX_FILINGS) {
    return NextResponse.json({ error: `Maximum ${MAX_FILINGS} filings per request.` }, { status: 400 });
  }

  const seenKeys = new Set<string>();
  const filings: Array<{ key: string; cik: string; file_date: string }> = [];
  for (const candidate of body.filings) {
    const key = typeof candidate?.key === 'string' ? candidate.key.trim() : '';
    const cik = parseCik(String(candidate?.cik ?? ''));
    const fileDate = typeof candidate?.fileDate === 'string' ? candidate.fileDate : '';
    if (!key || key.length > 500 || seenKeys.has(key) || cik === null || !isValidIsoDate(fileDate)) {
      return NextResponse.json(
        { error: 'Each filing needs a unique key, a 1-to-10 digit CIK, and an ISO fileDate.' },
        { status: 400 }
      );
    }
    seenKeys.add(key);
    filings.push({ key, cik: String(cik), file_date: fileDate });
  }

  const db = getWebSupabase();
  if (!db) {
    return NextResponse.json(
      { error: 'Enrichment store not configured with a restricted database role.' },
      { status: 503 }
    );
  }
  const rate = await checkResourceRateLimit(request, access.identity, {
    operation: 'filing-auditor-enrich',
  });
  if (!rate.allowed) return rateLimitResponse(rate);

  try {
    const { data, error } = await db.rpc('urc_resolve_filing_auditors', {
      p_filings: filings,
    });
    if (error) {
      console.error('[enrich] filing auditor resolution failed:', error);
      return NextResponse.json({ error: 'Filing auditor evidence temporarily unavailable' }, { status: 503 });
    }

    const result: Record<string, Record<string, unknown>> = {};
    for (const filing of filings) {
      result[filing.key] = {
        auditor: null,
        resolutionStatus: 'no_prior_form_ap_report',
      };
    }
    for (const row of data ?? []) {
      result[String(row.request_key)] = {
        auditor: row.auditor ?? null,
        auditorFirmName: row.auditor_firm_name ?? null,
        auditorCandidates: row.auditor_candidates ?? [],
        formFilingIds: row.auditor_form_filing_ids ?? [],
        auditReportDate: row.auditor_report_date ?? null,
        fiscalPeriodEnds: row.auditor_fiscal_period_ends ?? [],
        auditReportTypes: row.auditor_report_types ?? [],
        sourceRows: row.auditor_source_rows ?? [],
        resolutionStatus: row.auditor_resolution_status,
        basis: row.auditor_basis ?? null,
      };
    }

    return NextResponse.json({
      filings: result,
      meta: { auditorScope: 'filing_date_form_ap_evidence' },
    });
  } catch (error) {
    console.error('[enrich] filing auditor resolution failed:', error);
    return NextResponse.json({ error: 'Filing auditor enrichment failed' }, { status: 502 });
  }
}

export const GET = withRouteObservability('enrich', handleGet);
export const POST = withRouteObservability('enrich', handlePost);
