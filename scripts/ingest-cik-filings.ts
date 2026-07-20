/**
 * Targeted per-CIK filing ingest from EDGAR submissions JSON.
 *
 * The quarterly master.idx pipeline only keeps CORE_FORMS; issuers whose
 * entire post-2010 activity falls outside that set end up unsearchable
 * (found by scripts/ticker-coverage-test.ts). This tool backfills every
 * post-floor filing for specific CIKs so directory coverage stays complete.
 *
 *   npx tsx scripts/ingest-cik-filings.ts --ciks 1114859,2126221 [--floor 2010-01-01] [--dry]
 */
import { chunkedUpsert, createServiceClient } from '../data-pipeline/supabase';

const USER_AGENT = 'Uniqus Research Center contact@uniqus.com';

// Platform-wide exclusions (insider forms, notice-of-sale, 13F) stay excluded
// here too — they are served from the submissions API, not the facet store.
const EXCLUDED_FORMS = new Set([
  '3', '3/A', '4', '4/A', '5', '5/A', '144', '144/A',
  '13F-HR', '13F-HR/A', '13F-NT', '13F-NT/A',
]);

interface FilingRow {
  accession: string;
  cik: number;
  company_name: string;
  form: string;
  root_form: string;
  is_amendment: boolean;
  date_filed: string;
  filename: string;
}

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

async function fetchSubmissions(cik: number): Promise<Record<string, unknown>> {
  const padded = String(cik).padStart(10, '0');
  const response = await fetch(`https://data.sec.gov/submissions/CIK${padded}.json`, {
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!response.ok) throw new Error(`submissions fetch failed for CIK ${cik}: ${response.status}`);
  return response.json() as Promise<Record<string, unknown>>;
}

async function main() {
  const ciksArg = getArg('ciks');
  if (!ciksArg) {
    console.error('Usage: tsx scripts/ingest-cik-filings.ts --ciks <cik,cik,...> [--floor YYYY-MM-DD] [--dry]');
    process.exit(2);
  }
  const floor = getArg('floor') || '2010-01-01';
  const dryRun = process.argv.includes('--dry');
  const ciks = ciksArg.split(',').map(value => Number(value.trim())).filter(Number.isSafeInteger);

  const client = dryRun ? null : createServiceClient();
  let total = 0;

  for (const cik of ciks) {
    const data = await fetchSubmissions(cik);
    const companyName = String(data.name || '');
    const recent = (data.filings as { recent: Record<string, string[]> }).recent;
    const rows: FilingRow[] = [];

    for (let i = 0; i < recent.form.length; i++) {
      const form = recent.form[i];
      const dateFiled = recent.filingDate[i];
      if (dateFiled < floor || EXCLUDED_FORMS.has(form)) continue;
      const accession = recent.accessionNumber[i];
      const rootForm = form.replace(/\/A$/, '');
      rows.push({
        accession,
        cik,
        company_name: companyName,
        form,
        root_form: rootForm,
        is_amendment: rootForm !== form,
        date_filed: dateFiled,
        filename: `edgar/data/${cik}/${accession}.txt`,
      });
    }

    console.log(`CIK ${cik} (${companyName}): ${rows.length} filings since ${floor}`);
    if (!dryRun && rows.length > 0) {
      await chunkedUpsert(client!, 'urc_sec_filings', rows as unknown as Record<string, unknown>[], 'accession,cik', 500,
        () => {});
    }
    total += rows.length;
    await new Promise(resolve => setTimeout(resolve, 200));
  }

  console.log(`Done. ${total} rows ${dryRun ? 'inspected (dry run)' : 'upserted to urc_sec_filings'}.`);
}

main().catch(error => { console.error(error); process.exit(1); });
