/**
 * Elasticsearch search endpoint — drop-in replacement for SEC EDGAR EFTS.
 *
 * Accepts the same query params as EDGAR EFTS and returns the same response
 * shape (EdgarSearchResult), so the frontend searchEdgarFilings() function
 * can switch to this endpoint without changes.
 *
 * Additional params beyond EFTS:
 *   - auditor: filter by pre-indexed auditor name (e.g. "Deloitte", "EY")
 *   - acceleratedStatus: comma-separated filer status filter
 *   - sicCode: filter by SIC code
 *
 * GET /api/es-search?q=revenue&forms=10-K&startdt=2022-01-01&enddt=2024-12-31&from=0&size=100
 */

export const config = { runtime: 'edge' };

export default async function handler(request) {
  const url = new URL(request.url);
  const params = url.searchParams;

  const esUrl = process.env.ELASTICSEARCH_URL;
  const esApiKey = process.env.ELASTICSEARCH_API_KEY;
  const esIndex = process.env.ELASTICSEARCH_INDEX || 'sec-filings';

  if (!esUrl || !esApiKey) {
    return new Response(
      JSON.stringify({
        error: 'Elasticsearch not configured. Set ELASTICSEARCH_URL and ELASTICSEARCH_API_KEY.',
        hits: { hits: [], total: { value: 0 } },
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // ── Parse query params (same as EFTS) ──
  const q = params.get('q') || '';
  const forms = params.get('forms') || '';
  const startdt = params.get('startdt') || '';
  const enddt = params.get('enddt') || '';
  const entityName = params.get('entityName') || '';
  const from = parseInt(params.get('from') || '0', 10);
  const size = Math.min(parseInt(params.get('size') || '100', 10), 500);

  // ── Extended filters (not in EFTS) ──
  const auditor = params.get('auditor') || '';
  const acceleratedStatus = params.get('acceleratedStatus') || '';
  const sicCode = params.get('sicCode') || '';

  // ── Build ES query ──
  const must = [];
  const filter = [];

  // Full-text query
  if (q) {
    must.push({
      multi_match: {
        query: q,
        fields: ['content', 'entity_name^3', 'display_names^2', 'file_description^2'],
        type: 'best_fields',
        fuzziness: 'AUTO',
        minimum_should_match: '75%',
      },
    });
  }

  // Form type filter
  if (forms) {
    const formList = forms.split(',').map(f => f.trim()).filter(Boolean);
    if (formList.length > 0) {
      // Include /A variants automatically
      const expanded = new Set();
      for (const f of formList) {
        expanded.add(f);
        expanded.add(`${f}/A`);
      }
      filter.push({ terms: { form: Array.from(expanded) } });
    }
  }

  // Date range
  const dateRange = {};
  if (startdt) dateRange.gte = startdt;
  if (enddt) dateRange.lte = enddt;
  if (Object.keys(dateRange).length > 0) {
    filter.push({ range: { file_date: dateRange } });
  }

  // Entity name
  if (entityName) {
    must.push({
      bool: {
        should: [
          { match: { entity_name: { query: entityName, boost: 3 } } },
          { match: { 'display_names': { query: entityName, boost: 2 } } },
          { term: { tickers: entityName.toUpperCase() } },
          { term: { cik: entityName.replace(/^0+/, '') } },
        ],
        minimum_should_match: 1,
      },
    });
  }

  // Auditor filter (instant — pre-indexed at ingestion time)
  if (auditor) {
    if (auditor.toLowerCase() === 'big 4') {
      filter.push({ terms: { auditor: ['Deloitte', 'PwC', 'EY', 'KPMG'] } });
    } else {
      filter.push({ term: { auditor: auditor } });
    }
  }

  // Accelerated status filter
  if (acceleratedStatus) {
    const statuses = acceleratedStatus.split(',').map(s => s.trim()).filter(Boolean);
    filter.push({ terms: { accelerated_status: statuses } });
  }

  // SIC code filter
  if (sicCode) {
    filter.push({ term: { sics: sicCode } });
  }

  const esQuery = {
    query: {
      bool: {
        ...(must.length > 0 ? { must } : { must: [{ match_all: {} }] }),
        ...(filter.length > 0 ? { filter } : {}),
      },
    },
    from,
    size,
    sort: q ? [{ _score: 'desc' }, { file_date: 'desc' }] : [{ file_date: 'desc' }],
    _source: {
      excludes: ['content'], // Don't return full text in search results
    },
    track_total_hits: true,
  };

  try {
    const esResponse = await fetch(`${esUrl}/${esIndex}/_search`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `ApiKey ${esApiKey}`,
      },
      body: JSON.stringify(esQuery),
    });

    if (!esResponse.ok) {
      const errorText = await esResponse.text();
      console.error('ES search error:', esResponse.status, errorText);
      return new Response(
        JSON.stringify({
          error: `Elasticsearch error: ${esResponse.status}`,
          hits: { hits: [], total: { value: 0 } },
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const esResult = await esResponse.json();

    // Return in the exact EdgarSearchResult shape
    return new Response(JSON.stringify(esResult), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60',
      },
    });
  } catch (error) {
    console.error('ES search failed:', error);
    return new Response(
      JSON.stringify({
        error: 'Search service unavailable',
        hits: { hits: [], total: { value: 0 } },
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
