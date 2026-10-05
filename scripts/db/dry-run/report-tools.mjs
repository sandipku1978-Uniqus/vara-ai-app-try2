// Local report comparisons only; no environment loading or network calls.
import { readFileSync } from 'node:fs';
const [mode, ...files] = process.argv.slice(2);
const read = path => readFileSync(path,'utf8');
if (mode === 'compat') {
  const [before,after]=files.slice(0,2).map(path=>JSON.parse(read(path)));
  const head=files[2];
  for (const field of ['letters','filings']) {
    if (!before[field]?.length) throw new Error(`pre-upgrade ${field} is empty`);
    if (JSON.stringify(before[field])!==JSON.stringify(after[field])) throw new Error(`${field} accession order/results/totals changed`);
  }
  if (before.stats == null || after.stats == null) throw new Error('urc_data_stats did not return data');
  if (before.version!=='025' || after.version!==head) throw new Error(`wrong upgrade boundary: ${before.version} -> ${after.version}, expected ${head}`);
} else if (mode === 'writer') {
  // Files are ordered snapshots: after each upgrade migration (026, 027, ...),
  // then the head after the retry. Between any two, the only permitted change
  // is an ADDITION on the objects later migrations document granting the
  // writer role: the search-job tables/functions (028) and the alert-hit
  // table/functions (029). Any removed line or other addition is a failure.
  const snapshots=files.map(path=>new Set(read(path).trim().split('\n')));
  const allowed=/^(relation|column|function)\tpublic\.(urc_search_job|urc_user_alert)/;
  const problems=[];
  for (let i=1;i<snapshots.length;i++) {
    const label=`snapshot ${i-1} -> ${i}`;
    for (const line of snapshots[i-1]) if (!snapshots[i].has(line)) problems.push(`${label} REMOVED: ${line}`);
    for (const line of snapshots[i]) if (!snapshots[i-1].has(line) && !allowed.test(line)) problems.push(`${label} UNEXPECTED ADDITION: ${line}`);
  }
  if(problems.length) { process.stderr.write(problems.join('\n')+'\n'); process.exit(1); }
} else if (mode === 'contract') {
  const report=JSON.parse(read(files[0]));
  if (report.pass!==true || !Array.isArray(report.problems) || report.problems.length!==0) {
    for (const problem of report.problems || []) process.stderr.write(String(problem)+'\n');
    throw new Error('schema contract requires pass: true and empty problems array');
  }
} else if (mode === 'audit') {
  const lines=read(files[0]).trim().split('\n').filter(Boolean);
  let failed=false;
  for(const line of lines) {
    const fields=line.split('\t');
    if(fields.length!==5 || !/^(OK|NOTE: .+|FLAG: .+)$/.test(fields[4])) {process.stderr.write(`Malformed grant-audit row: ${line}\n`);failed=true;}
    else if(fields[4].startsWith('FLAG:')) {process.stderr.write(line+'\n');failed=true;}
  }
  if(!lines.length) throw new Error('grant audit emitted no rows');
  if(failed) process.exit(1);
} else throw new Error('unknown comparison mode');
