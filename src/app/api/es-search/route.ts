/**
 * GET /api/es-search — server-side Elasticsearch search over the sec-filings
 * index. Returns an EFTS-shaped payload ({ hits: { total, hits } }) so the
 * frontend can treat ES and EDGAR EFTS results uniformly.
 *
 * Returns 503 when ES env vars are absent so the client falls back to live
 * EDGAR EFTS instead of hard-failing (see searchEdgarFilings).
 */

import { NextResponse } from 'next/server';
import { Client } from '@elastic/elasticsearch';
import { buildEsQuery, type EsSearchRequest } from '../../../lib/es-search';

const ES_INDEX = process.env.ELASTICSEARCH_INDEX || 'sec-filings';

let client: Client | null = null;

function getClient(): Client | null {
  if (client) return client;
  const url = process.env.ELASTICSEARCH_URL;
  const apiKey = process.env.ELASTICSEARCH_API_KEY;
  if (!url || !apiKey) return null;
  client = new Client({
    node: url,
    auth: { apiKey },
    requestTimeout: 30_000,
  });
  return client;
}

export async function GET(request: Request) {
  const es = getClient();
  if (!es) {
    return NextResponse.json(
      { error: 'Elasticsearch is not configured (ELASTICSEARCH_URL / ELASTICSEARCH_API_KEY)' },
      { status: 503 }
    );
  }

  const url = new URL(request.url);
  const params = url.searchParams;
  const modeParam = params.get('mode');

  const req: EsSearchRequest = {
    q: params.get('q') ?? '',
    forms: params.get('forms') ?? undefined,
    startdt: params.get('startdt') ?? undefined,
    enddt: params.get('enddt') ?? undefined,
    entityName: params.get('entityName') ?? undefined,
    auditor: params.get('auditor') ?? undefined,
    acceleratedStatus: params.get('acceleratedStatus') ?? undefined,
    sicCode: params.get('sicCode') ?? undefined,
    mode: modeParam === 'boolean' || modeParam === 'semantic' ? modeParam : undefined,
    from: Number(params.get('from') ?? 0) || 0,
    size: Number(params.get('size') ?? 10) || 10,
  };

  if (!req.q && !req.entityName) {
    return NextResponse.json(
      { error: "One of 'q' or 'entityName' is required" },
      { status: 400 }
    );
  }

  try {
    const body = buildEsQuery(req);
    const result = await es.search({
      index: ES_INDEX,
      ...body,
    });

    return NextResponse.json({
      hits: {
        total: result.hits.total,
        hits: result.hits.hits,
      },
    });
  } catch (error) {
    console.error('[es-search] query failed:', error);
    return NextResponse.json(
      { error: 'Elasticsearch query failed' },
      { status: 502 }
    );
  }
}
