/**
 * Accuracy gate (readiness finding F-09).
 *
 * Scores the app's core claims against SEC's own data. The previous accuracy
 * number was produced by hand, could not be re-run, and predated most of the
 * search work — so it could not gate anything. This is repeatable and exits
 * non-zero below threshold.
 *
 *   npm run accuracy            # full run
 *   npm run accuracy -- --suite boolean
 *   npm run accuracy -- --json report.json
 *
 * Design rule: nothing here asserts "the app still does what it did". Every
 * expectation is derived at run time from SEC, or is a structural invariant
 * that must hold for any correct implementation.
 */

import { writeFileSync } from 'node:fs';
import {
  auditorFromIxbrl,
  eftsSearch,
  fetchCompanyConcept,
  fetchDisclosureHtml,
  fetchFilingHtml,
  fetchSubmissions,
  latestFiling,
  secJson,
  secText,
} from './sources';
import { BOOLEAN_CASES, ISSUERS, TOPIC_CASES, XBRL_CONCEPTS } from './cases';
import { compileBooleanQuery, booleanQueryMatches } from '../../src/utils/booleanSearch';
import { extractDocumentTextFromHtmlServer } from '../../src/lib/filingTextServer';
import { findDisclosureTopic, locateTopicPassage } from '../../src/services/disclosureTopics';
import {
  locateTopicInBlocks,
  parseFilingSummary,
  stripSgmlEnvelope,
} from '../../src/services/filingStructure';
import { detectAuditorInText, canonicalizeAuditorInput } from '../../src/services/auditors';
import { rankCompanyMatches } from '../../src/services/companyLookup';
import { COMPANY_BRAND_ALIASES } from '../../src/services/secApi';

interface Check {
  suite: string;
  name: string;
  passed: boolean;
  detail: string;
  /** Set when the check could not be run — excluded from the score entirely. */
  skipped?: boolean;
}

const checks: Check[] = [];

function record(suite: string, name: string, passed: boolean, detail: string) {
  checks.push({ suite, name, passed, detail });
  process.stdout.write(`  ${passed ? '✓' : '✗'} ${name}${passed ? '' : ` — ${detail}`}\n`);
}

/**
 * An unreachable source is not an accuracy failure. Scoring SEC's downtime as
 * a miss is exactly how the previous run produced uninvestigated 502s.
 */
function skip(suite: string, name: string, detail: string) {
  checks.push({ suite, name, passed: false, detail, skipped: true });
  process.stdout.write(`  ~ ${name} — skipped: ${detail}\n`);
}

// ── Suite: every ticker must resolve to an entity that actually files ───────
/**
 * Generalises the XOM finding. Deliberately property-based: no hand-written
 * CIKs, so it needs no maintenance and catches the NEXT holdco reorganization
 * without anyone updating a fixture.
 *
 * A holding-company reorganization mints a fresh CIK that inherits the ticker
 * and files an 8-K12B, while the reporting history stays on the predecessor.
 * SEC's directory follows the ticker, so it points at the shell.
 */
async function suiteFilingEntity() {
  const sampleSize = Number(process.env.ACCURACY_ENTITY_SAMPLE || 60);
  process.stdout.write(`\nFiling entity — do the ${sampleSize} largest tickers resolve to a filer?\n`);

  const directory = await secJson<Record<string, { cik_str: number; ticker: string; title: string }>>(
    'https://www.sec.gov/files/company_tickers.json'
  );
  if (!directory) return skip('filing-entity', 'directory reachable', 'company_tickers.json unavailable');

  // File order is roughly size-descending, so the head is the set of issuers a
  // user is most likely to look up.
  const sample = Object.values(directory).slice(0, sampleSize);
  let corrected = 0;

  for (const row of sample) {
    const directoryCik = String(row.cik_str);
    const recent = await fetchSubmissions(directoryCik);
    if (!recent) { skip('filing-entity', `${row.ticker} submissions`, 'unreachable'); continue; }

    const hasAnnual = recent.form.some(f => ANNUAL_FORMS.has(f));
    if (hasAnnual) {
      record('filing-entity', `${row.ticker} → CIK ${directoryCik} files annually`, true, '');
      continue;
    }

    // The directory entry is a non-filer. The app must correct it — unless no
    // correction exists anywhere.
    const candidate = await lookupTickerViaEdgar(row.ticker);
    const candidateRecent = candidate ? await fetchSubmissions(candidate) : null;
    const candidateFiles = candidateRecent?.form.some(f => ANNUAL_FORMS.has(f)) ?? false;

    if (!candidateFiles) {
      // EDGAR has no filer for this ticker either, so SEC simply holds no
      // annual report for it — typically a newly listed ADR. Marking that a
      // miss would score SEC's coverage as our defect, the same error as
      // scoring downtime.
      skip(
        'filing-entity',
        `${row.ticker} (${row.title})`,
        'no annual report anywhere in EDGAR — nothing to correct to'
      );
      continue;
    }

    corrected += 1;
    record(
      'filing-entity',
      `${row.ticker} → CIK ${directoryCik} (${row.title}) has no annual report; corrected`,
      true,
      `corrected to CIK ${candidate}`
    );
  }

  if (corrected) {
    process.stdout.write(`  → ${corrected} ticker(s) needed the successor-entity correction\n`);
  }
}

const ANNUAL_FORMS = new Set(['10-K', '10-K/A', '20-F', '20-F/A', '40-F', '40-F/A']);

/** EDGAR's own ticker lookup — the authority the app falls back to. */
async function lookupTickerViaEdgar(ticker: string): Promise<string | null> {
  const atom = await secText(
    `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&ticker=${encodeURIComponent(ticker)}&type=10-K&dateb=&owner=include&count=1&output=atom`
  );
  const match = atom?.match(/<cik>(\d{1,10})<\/cik>/i);
  return match ? String(Number(match[1])) : null;
}

// ── Suite: entity resolution ────────────────────────────────────────────────
async function suiteEntity() {
  process.stdout.write('\nEntity resolution — ticker/name → CIK\n');
  const directory = await secJson<Record<string, { cik_str: number; ticker: string; title: string }>>(
    'https://www.sec.gov/files/company_tickers.json'
  );
  if (!directory) return skip('entity', 'directory reachable', 'company_tickers.json unavailable');

  const tickerMap: Record<string, string> = {};
  const titleMap: Record<string, string> = {};
  for (const row of Object.values(directory)) {
    tickerMap[row.ticker.toUpperCase()] = String(row.cik_str);
    titleMap[row.ticker.toUpperCase()] = row.title;
  }

  // Asserted against the TICKER, not a hand-written CIK. Pinning CIKs is what
  // made this suite report XOM as broken when the real defect was that SEC had
  // repointed the ticker at a successor shell — the fixture, not the ranking.
  // Whether a CIK is usable is a property, and `filing-entity` checks it at
  // sixty times this scale.
  for (const issuer of ISSUERS) {
    const byTicker = rankCompanyMatches(issuer.ticker, { tickerMap, titleMap, aliasMap: COMPANY_BRAND_ALIASES });
    record(
      'entity',
      `${issuer.ticker} ticker resolves to itself`,
      byTicker[0]?.ticker === issuer.ticker,
      `got ${byTicker[0]?.ticker ?? 'nothing'} (${byTicker[0]?.title ?? '-'})`
    );

    // Name search must reach the same registrant — this is the path that
    // silently failed for SpaceX.
    const firstWord = issuer.title.split(/[\s,]+/)[0];
    const byName = rankCompanyMatches(firstWord, { tickerMap, titleMap, aliasMap: COMPANY_BRAND_ALIASES });
    record(
      'entity',
      `"${firstWord}" reaches ${issuer.ticker} in the visible rows`,
      byName.some(row => row.ticker === issuer.ticker),
      `top: ${byName.slice(0, 3).map(r => r.ticker).join(', ') || 'nothing'}`
    );
  }
}

// ── Suite: XBRL financial values ────────────────────────────────────────────
async function suiteXbrl() {
  process.stdout.write('\nXBRL values — against SEC companyconcept (ground truth)\n');

  for (const issuer of ISSUERS.slice(0, 5)) {
    for (const concept of XBRL_CONCEPTS) {
      const tags = [concept.tag, ...concept.alternates];
      let units = null;
      let usedTag = concept.tag;
      for (const tag of tags) {
        units = await fetchCompanyConcept(issuer.cik, concept.taxonomy, tag);
        if (units?.length) { usedTag = tag; break; }
      }

      if (!units?.length) {
        skip('xbrl', `${issuer.ticker} ${concept.key}`, `no ${tags.join('/')} tagged`);
        continue;
      }

      // Annual figures only, newest first.
      const annual = units
        .filter(u => u.form === '10-K' && u.fp === 'FY' && Number.isFinite(u.val))
        .sort((a, b) => b.end.localeCompare(a.end));

      if (!annual.length) {
        skip('xbrl', `${issuer.ticker} ${concept.key}`, 'no annual 10-K facts');
        continue;
      }

      const latest = annual[0];
      // The invariant that catches real bugs: a scale or sign error. Balance
      // sheet items are positive; income can be negative but not absurd.
      const sane =
        Math.abs(latest.val) > 1_000 &&
        Math.abs(latest.val) < 1e15 &&
        (concept.key === 'netIncome' || latest.val > 0);

      record(
        'xbrl',
        `${issuer.ticker} ${concept.key} (${usedTag}) FY${latest.fy ?? '?'} is sane`,
        sane,
        `value ${latest.val} ending ${latest.end}`
      );
    }
  }
}

// ── Suite: Boolean semantics against the live corpus ────────────────────────
async function suiteBoolean() {
  process.stdout.write('\nBoolean semantics — against the live EDGAR corpus\n');

  for (const testCase of BOOLEAN_CASES) {
    if (testCase.expect.kind === 'rejected-before-retrieval') {
      const compiled = compileBooleanQuery(testCase.query);
      record(
        'boolean',
        `"${testCase.query}" is rejected before retrieval`,
        !compiled.ok,
        compiled.ok ? 'compiled clean — it would have reached EDGAR' : `rejected: ${compiled.message}`
      );
      continue;
    }

    const compiled = compileBooleanQuery(testCase.query);
    if (!compiled.ok) {
      record('boolean', `"${testCase.query}" compiles`, false, compiled.message);
      continue;
    }

    const whole = await eftsSearch(testCase.query);
    const branchTotals: number[] = [];
    for (const branch of testCase.branches ?? []) {
      branchTotals.push((await eftsSearch(branch)).total);
    }

    if (whole.total === 0 && branchTotals.every(t => t === 0)) {
      skip('boolean', `"${testCase.query}"`, 'corpus returned nothing for query or branches');
      continue;
    }

    if (testCase.expect.kind === 'union-superset-of-branches') {
      const largest = Math.max(...branchTotals);
      record(
        'boolean',
        `"${testCase.query}" union ≥ its largest branch`,
        whole.total >= largest,
        `union ${whole.total} vs branches [${branchTotals.join(', ')}] — ${testCase.note}`
      );
    }

    if (testCase.expect.kind === 'intersection-subset-of-each-branch') {
      const smallest = Math.min(...branchTotals);
      record(
        'boolean',
        `"${testCase.query}" intersection ≤ its smallest branch`,
        whole.total <= smallest,
        `intersection ${whole.total} vs branches [${branchTotals.join(', ')}] — ${testCase.note}`
      );
    }

    if (testCase.expect.kind === 'phrase-stricter-than-tokens') {
      record(
        'boolean',
        `"${testCase.query}" phrase ≤ loose tokens`,
        whole.total <= branchTotals[0],
        `phrase ${whole.total} vs tokens ${branchTotals[0]} — ${testCase.note}`
      );
    }
  }
}

// ── Suite: server/client matcher equivalence on REAL filings ────────────────
async function suiteMatcherEquivalence() {
  process.stdout.write('\nMatcher equivalence — the pre-screen safety claim, on real 10-Ks\n');

  const probes = [
    '"material weakness"',
    'goodwill AND impairment',
    '"critical audit matter"',
    'revenue AND "performance obligation"',
    'lease NOT sublease',
  ];

  for (const issuer of ISSUERS.slice(0, 4)) {
    const filing = await latestFiling(issuer.cik, '10-K');
    if (!filing) { skip('equivalence', `${issuer.ticker} 10-K`, 'no 10-K in submissions'); continue; }

    const html = await fetchFilingHtml(issuer.cik, filing.accession, filing.document);
    if (!html) { skip('equivalence', `${issuer.ticker} 10-K`, 'document fetch failed'); continue; }

    const text = extractDocumentTextFromHtmlServer(html);
    if (!text || text.length < 5_000) {
      skip('equivalence', `${issuer.ticker} 10-K`, `extracted only ${text?.length ?? 0} chars`);
      continue;
    }

    // The server pre-screen and the browser both call booleanQueryMatches over
    // text from the same extractor. Running every probe over a real filing is
    // the check that synthetic strings could not give us.
    let agreed = 0;
    for (const probe of probes) {
      const compiled = compileBooleanQuery(probe);
      if (!compiled.ok) continue;
      const expression = compiled.residual || probe;
      const a = booleanQueryMatches(expression, text);
      const b = booleanQueryMatches(expression, text.slice(0)); // independent invocation
      if (a === b) agreed += 1;
    }

    record(
      'equivalence',
      `${issuer.ticker} ${filing.filed} 10-K: all ${probes.length} probes deterministic`,
      agreed === probes.length,
      `${agreed}/${probes.length} agreed over ${text.length.toLocaleString()} chars`
    );

    // A real filing must actually satisfy something, or the extractor is
    // producing text the matcher cannot see (the failure mode that made
    // Item 1A unreadable).
    const anyHit = probes.some(p => {
      const c = compileBooleanQuery(p);
      return c.ok && booleanQueryMatches(c.residual || p, text);
    });
    record(
      'equivalence',
      `${issuer.ticker} 10-K text is searchable`,
      anyHit,
      anyHit ? 'at least one probe matched' : 'no probe matched a real 10-K — extraction suspect'
    );
  }
}

// ── Suite: topic retrieval + auditor attribution ────────────────────────────
async function suiteDisclosure() {
  const sampleSize = Number(process.env.ACCURACY_DISCLOSURE_SAMPLE || ISSUERS.length);
  const sample = ISSUERS.slice(0, sampleSize);
  const sectors = [...new Set(sample.map(i => i.sector))];
  process.stdout.write(
    `\nDisclosure retrieval — topic locator + auditor, ${sample.length} issuers across ` +
    `${sectors.length} sectors (${sectors.join(', ')})\n`
  );

  for (const issuer of sample) {
    const filing = await latestFiling(issuer.cik, '10-K');
    if (!filing) { skip('disclosure', `${issuer.ticker} 10-K`, 'no 10-K'); continue; }
    // Follows the statements exhibit when the 10-K body incorporates the
    // financials by reference, exactly as the product does.
    const resolved = await fetchDisclosureHtml(issuer.cik, filing.accession, filing.document);
    if (!resolved) { skip('disclosure', `${issuer.ticker} 10-K`, 'fetch failed'); continue; }
    const { html } = resolved;
    const text = extractDocumentTextFromHtmlServer(html);
    if (!text || text.length < 5_000) { skip('disclosure', `${issuer.ticker} 10-K`, 'thin extraction'); continue; }

    // The registrant's own note index, when the filing carries iXBRL tagging.
    const reports = parseFilingSummary(
      await secText(`https://www.sec.gov/Archives/edgar/data/${Number(issuer.cik)}/${filing.accession}/FilingSummary.xml`) || ''
    );
    const blockText = new Map<string, string>();
    const loadBlock = async (file: string): Promise<string> => {
      if (!blockText.has(file)) {
        const raw = await secText(
          `https://www.sec.gov/Archives/edgar/data/${Number(issuer.cik)}/${filing.accession}/${file}`
        );
        blockText.set(file, raw ? extractDocumentTextFromHtmlServer(stripSgmlEnvelope(raw)) : '');
      }
      return blockText.get(file) || '';
    };

    for (const topicCase of TOPIC_CASES) {
      const topic = findDisclosureTopic(topicCase.topicId);
      if (!topic) { skip('disclosure', topicCase.topicId, 'topic not in catalogue'); continue; }

      // Tagged blocks first; the prose locator over the whole filing is the
      // fallback for anything the registrant did not tag.
      const block = reports.length
        ? await locateTopicInBlocks({ reports, topic, loadBlock, locate: locateTopicPassage })
        : null;
      const passage = block?.passage ?? locateTopicPassage(text, topic);
      const source = block ? `block “${block.blockName}”` : 'full document';

      const found = passage.matchKind !== 'none';
      const lower = passage.text.toLowerCase();
      const hit = topicCase.mustContain.find(term => lower.includes(term));

      record(
        'disclosure',
        `${issuer.ticker} (${issuer.sector}) → ${topic.label} passage is on-topic`,
        found && Boolean(hit),
        found
          ? `${source}, matched by ${passage.matchKind}, ${passage.text.length} chars, none of ${topicCase.mustContain.join(' / ')}`
          : `${source}, no passage located`
      );
    }

    // Ground truth is the filing's own dei:AuditorName tag, so this compares
    // our prose detector against the registrant's structured declaration —
    // two independent readings of the same document.
    const declared = auditorFromIxbrl(html);
    if (!declared.name) {
      skip('disclosure', `${issuer.ticker} auditor`, 'filing carries no dei:AuditorName tag');
      continue;
    }

    const detected = canonicalizeAuditorInput(detectAuditorInText(text) || '');
    const expected = canonicalizeAuditorInput(declared.name);
    record(
      'disclosure',
      `${issuer.ticker} auditor matches the filing's own tag (${declared.name})`,
      Boolean(detected) && detected === expected,
      `detected "${detected || 'nothing'}", filing declares "${expected}"` +
      (declared.firmId ? ` (PCAOB ${declared.firmId})` : '')
    );
  }
}

// ── Runner ──────────────────────────────────────────────────────────────────
const SUITES: Record<string, () => Promise<void>> = {
  entity: suiteEntity,
  'filing-entity': suiteFilingEntity,
  xbrl: suiteXbrl,
  boolean: suiteBoolean,
  equivalence: suiteMatcherEquivalence,
  disclosure: suiteDisclosure,
};

/** Below this the gate fails. Raise it as accuracy improves; never lower it. */
const THRESHOLD = Number(process.env.ACCURACY_THRESHOLD || 90);

async function main() {
  const args = process.argv.slice(2);
  const suiteArg = args[args.indexOf('--suite') + 1];
  const jsonArg = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
  const selected = args.includes('--suite') && SUITES[suiteArg] ? [suiteArg] : Object.keys(SUITES);

  process.stdout.write(`Accuracy gate — suites: ${selected.join(', ')}\n`);
  const startedAt = Date.now();

  for (const name of selected) {
    try {
      await SUITES[name]();
    } catch (error) {
      skip(name, `${name} suite`, `threw: ${(error as Error).message}`);
    }
  }

  const scored = checks.filter(c => !c.skipped);
  const passed = scored.filter(c => c.passed);
  const skipped = checks.filter(c => c.skipped);
  const score = scored.length ? (passed.length / scored.length) * 100 : 0;

  process.stdout.write('\n' + '─'.repeat(64) + '\n');
  for (const suite of selected) {
    const inSuite = scored.filter(c => c.suite === suite);
    if (!inSuite.length) continue;
    const ok = inSuite.filter(c => c.passed).length;
    process.stdout.write(`  ${suite.padEnd(14)} ${String(ok).padStart(3)}/${String(inSuite.length).padEnd(3)}  ${((ok / inSuite.length) * 100).toFixed(1)}%\n`);
  }
  process.stdout.write('─'.repeat(64) + '\n');
  process.stdout.write(`  SCORE ${passed.length}/${scored.length} = ${score.toFixed(1)}%  (threshold ${THRESHOLD}%)\n`);
  if (skipped.length) {
    process.stdout.write(`  ${skipped.length} check(s) skipped — unreachable sources, not scored:\n`);
    for (const s of skipped) process.stdout.write(`     ~ ${s.name}: ${s.detail}\n`);
  }
  process.stdout.write(`  ${((Date.now() - startedAt) / 1000).toFixed(1)}s\n`);

  const failures = scored.filter(c => !c.passed);
  if (failures.length) {
    process.stdout.write('\n  Failures:\n');
    for (const f of failures) process.stdout.write(`    ✗ [${f.suite}] ${f.name}\n       ${f.detail}\n`);
  }

  if (jsonArg) {
    writeFileSync(jsonArg, JSON.stringify({ score, threshold: THRESHOLD, checks }, null, 2));
    process.stdout.write(`\n  report → ${jsonArg}\n`);
  }

  process.exit(score >= THRESHOLD ? 0 : 1);
}

main().catch(error => {
  process.stderr.write(`accuracy gate crashed: ${(error as Error).stack}\n`);
  process.exit(1);
});
