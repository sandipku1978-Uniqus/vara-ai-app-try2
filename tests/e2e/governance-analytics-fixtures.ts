import type { Page, Route } from '@playwright/test';
import { buildCompleteSecCompanyDirectory } from './sec-company-directory-fixture';

/**
 * Structure-faithful, deterministic evidence for the comparison/governance
 * workspaces. These pages combine four upstream contracts (SEC directory,
 * submissions, XBRL facts, and filing text) with AI output. A generic 200 stub
 * would let controls move while proving none of the research outcome, so each
 * fixture below carries issuer-specific values that tests can trace from the
 * request to the rendered row or column.
 */

export const GOVERNANCE_COMPANIES = [
  { ticker: 'AAPL', cik: '320193', name: 'Apple Fixture Corp', sic: '3571' },
  { ticker: 'MSFT', cik: '789019', name: 'Microsoft Fixture Corp', sic: '3571' },
  { ticker: 'NVDA', cik: '1045810', name: 'Nvidia Fixture Corp', sic: '3571' },
  { ticker: 'GOOGL', cik: '1652044', name: 'Alphabet Fixture Corp', sic: '7370' },
  { ticker: 'META', cik: '1326801', name: 'Meta Fixture Corp', sic: '7370' },
  { ticker: 'ALPH', cik: '9000010', name: 'Alpha Energy Corp', sic: '1311' },
  { ticker: 'BETA', cik: '9000020', name: 'Beta Health Inc', sic: '2834' },
] as const;

type AiKind = 'board' | 'esg' | 'financial-summary' | 'release-summary' | 'cohort-memo';

export interface GovernanceFixtureOptions {
  /** Number of complete fetchCompanyFacts calls that should fail by ticker. */
  factFailuresBeforeSuccess?: Partial<Record<string, number>>;
  /** Number of HTTP attempts to fail. callClaude spends two attempts per UI action. */
  aiFailuresBeforeSuccess?: Partial<Record<AiKind, number>>;
  /** Number of EFTS HTTP attempts to fail. searchEdgarFilings spends two per load. */
  eftsFailuresBeforeSuccess?: number;
}

export interface GovernanceFixtureStats {
  factsRequests: Record<string, number>;
  submissionRequests: Record<string, number>;
  filingTextRequests: Array<{ cik: string; document: string }>;
  claudePrompts: string[];
  eftsRequests: number;
  failNextAiAttempts: (kind: AiKind, count: number) => void;
}

function companyForCik(rawCik: string) {
  const normalized = String(Number(rawCik));
  return GOVERNANCE_COMPANIES.find(company => company.cik === normalized);
}

const GOVERNANCE_COMPANY_DIRECTORY = buildCompleteSecCompanyDirectory(
  GOVERNANCE_COMPANIES.map(company => ({
    cik_str: company.cik,
    ticker: company.ticker,
    title: company.name,
  })),
);

function accession(cik: string, sequence: number): string {
  return `${cik.padStart(10, '0')}-26-${String(sequence).padStart(6, '0')}`;
}

function submissionsPayload(cik: string) {
  const company = companyForCik(cik) ?? {
    ticker: `T${String(Number(cik)).slice(-4)}`,
    cik: String(Number(cik)),
    name: `Fixture Issuer ${Number(cik)}`,
    sic: '9999',
  };
  const accessions = [1, 2, 3, 4, 5].map(sequence => accession(company.cik, sequence));
  return {
    cik: company.cik,
    name: company.name,
    tickers: [company.ticker],
    exchanges: ['Nasdaq'],
    ein: '00-0000000',
    description: 'Deterministic Playwright issuer',
    sic: company.sic,
    sicDescription: company.sic === '3571' ? 'Electronic Computers' : 'Fixture Industry',
    stateOfIncorporation: 'DE',
    fiscalYearEnd: '1231',
    filings: {
      recent: {
        accessionNumber: accessions,
        filingDate: ['2026-04-10', '2026-02-20', '2026-07-08', '2026-06-06', '2026-05-05'],
        reportDate: ['2025-12-31', '2025-12-31', '2026-07-08', '2026-06-06', '2026-05-05'],
        acceptanceDateTime: accessions.map(() => '2026-01-01T12:00:00.000Z'),
        act: accessions.map(() => '34'),
        form: ['DEF 14A', '10-K', '4', '3', '8-K'],
        fileNumber: accessions.map(() => '001-00001'),
        primaryDocument: [
          `${company.ticker.toLowerCase()}-proxy.htm`,
          `${company.ticker.toLowerCase()}-10k.htm`,
          `${company.ticker.toLowerCase()}-form4.htm`,
          `${company.ticker.toLowerCase()}-form3.htm`,
          `${company.ticker.toLowerCase()}-8k.htm`,
        ],
        primaryDocDescription: ['Proxy statement', 'Annual report', 'Form 4', 'Form 3', 'Current report'],
      },
      files: [],
    },
  };
}

function annualFact(value: number, year: number, sequence: number) {
  return {
    val: value,
    accn: `0000000000-${String(year).slice(2)}-${String(sequence).padStart(6, '0')}`,
    fy: year,
    fp: 'FY',
    form: '10-K',
    filed: `${year + 1}-02-20`,
    start: `${year}-01-01`,
    end: `${year}-12-31`,
  };
}

function concept(label: string, latest: number, prior: number, sequence: number) {
  return {
    label,
    description: `${label} fixture`,
    units: { USD: [annualFact(latest, 2025, sequence), annualFact(prior, 2024, sequence + 100)] },
  };
}

function factsPayload(cik: string) {
  const company = companyForCik(cik);
  const scale = company?.ticker === 'MSFT' ? 1.2 : company?.ticker === 'NVDA' ? 0.8 : 1;
  const amount = (billions: number) => Math.round(billions * scale * 1_000_000_000);
  return {
    cik: Number(cik),
    entityName: company?.name ?? `Fixture Issuer ${cik}`,
    sic: Number(company?.sic ?? 9999),
    sicDescription: 'Fixture Industry',
    facts: {
      'us-gaap': {
        Revenues: concept('Revenue', amount(100), amount(90), 1),
        CostOfRevenue: concept('Cost of revenue', amount(40), amount(37), 2),
        OperatingIncomeLoss: concept('Operating income', amount(30), amount(26), 3),
        NetIncomeLoss: concept('Net income', amount(20), amount(18), 4),
        Assets: concept('Total assets', amount(200), amount(180), 5),
        StockholdersEquity: concept('Stockholders equity', amount(100), amount(90), 6),
        DebtLongtermAndShorttermCombinedAmount: concept('Total debt', amount(30), amount(32), 7),
        AssetsCurrent: concept('Current assets', amount(80), amount(72), 8),
        LiabilitiesCurrent: concept('Current liabilities', amount(40), amount(38), 9),
        NetCashProvidedByUsedInOperatingActivities: concept('Operating cash flow', amount(28), amount(24), 10),
        PaymentsToAcquirePropertyPlantAndEquipment: concept('Capital expenditure', amount(5), amount(4), 11),
        ShareBasedCompensation: concept('Stock compensation', amount(4), amount(3), 12),
        OperatingLeaseRightOfUseAsset: concept('Operating lease ROU asset', amount(6), amount(5), 13),
        ContractWithCustomerLiability: concept('Deferred revenue', amount(8), amount(7), 14),
        IncomeTaxExpenseBenefit: concept('Income tax expense', amount(5), amount(4), 15),
      },
    },
  };
}

function filingText(cik: string, document: string): string {
  const company = companyForCik(cik);
  const ticker = company?.ticker ?? 'FIXT';
  return [
    `Fixture filing evidence for ${ticker} and ${company?.name ?? 'Fixture Issuer'}.`,
    'The board of directors includes independent audit and compensation committee members.',
    'The proxy statement reports executive compensation, board diversity, and a say-on-pay vote.',
    'The annual report contains significant accounting policies and a basis of presentation.',
    'Deferred tax assets and accumulated depreciation are disclosed in the financial statement notes.',
    'The company reports quantified greenhouse-gas emissions, energy use, data privacy controls,',
    'human-capital diversity programs, supply-chain labor oversight, and climate targets.',
    document.includes('8k')
      ? 'Item 2.02 Results of Operations: quarterly revenue was $125 million and net income was $18 million.'
      : 'Revenue recognition follows the transfer of control and is described with quantitative disaggregation.',
  ].join(' ').repeat(3);
}

function boardResult(prompt: string) {
  const ticker = GOVERNANCE_COMPANIES.find(company => prompt.includes(`evidence for ${company.ticker}`))?.ticker ?? 'AAPL';
  const boardSize = ticker === 'MSFT' ? 10 : ticker === 'NVDA' ? 7 : 8;
  return {
    directors: [
      { name: `${ticker} Independent Director`, role: 'Independent Director', independent: true, committees: ['Audit'] },
      { name: `${ticker} Chief Executive`, role: 'CEO', independent: false, committees: [] },
    ],
    compensation: [
      { name: `${ticker} Chief Executive`, title: 'CEO', salary: '$1,000,000', stockAwards: '$9,000,000', total: '$10,000,000' },
    ],
    boardSize,
    independencePercent: 75,
    diversity: { malePercent: 50, femalePercent: 50 },
    ceoPayRatio: '120:1',
    sayOnPayApproval: '94.0%',
  };
}

function esgResult(prompt: string) {
  const topicMatch = prompt.match(/Topics to rate: (\[[^\n]+\])/);
  const topics = topicMatch ? JSON.parse(topicMatch[1]) as string[] : [];
  const rating = prompt.includes('evidence for MSFT') ? 'medium' : prompt.includes('evidence for META') ? 'low' : 'high';
  return Object.fromEntries(topics.map(topic => [topic, rating]));
}

function aiKind(prompt: string): AiKind {
  if (prompt.includes('Extract structured data from this DEF 14A')) return 'board';
  if (prompt.includes('Rate how thoroughly this 10-K')) return 'esg';
  if (prompt.includes('Summarize this SEC 8-K')) return 'release-summary';
  if (prompt.includes('peer benchmarking memo')) return 'cohort-memo';
  return 'financial-summary';
}

function aiText(kind: AiKind, prompt: string): string {
  if (kind === 'board') return JSON.stringify(boardResult(prompt));
  if (kind === 'esg') return JSON.stringify(esgResult(prompt));
  if (kind === 'release-summary') {
    return 'Alpha Energy reported quarterly revenue of $125 million and net income of $18 million. Review the source filing for full context.';
  }
  if (kind === 'cohort-memo') {
    return '## Cohort evidence\n\nThe loaded AAPL and MSFT metrics show positive margins and cash-flow quality. Investigate the underlying SEC disclosures next.';
  }
  return '## Evidence-grounded comparison\n\nAAPL and MSFT both report positive revenue, margins, and operating cash flow in the loaded fiscal periods.';
}

function eftsPayload() {
  const releases = [
    { company: 'Alpha Energy Corp', cik: '9000010', accession: accession('9000010', 5), document: 'alph-8k.htm', date: '2026-07-19' },
    { company: 'Beta Health Inc', cik: '9000020', accession: accession('9000020', 5), document: 'beta-8k.htm', date: '2026-07-18' },
  ];
  return {
    hits: {
      total: { value: releases.length, relation: 'eq' },
      hits: releases.map(release => ({
        _id: release.accession,
        _score: 1,
        _source: {
          display_names: [`${release.company} (CIK ${release.cik})`],
          file_date: release.date,
          file_type: '8-K',
          root_form: '8-K',
          adsh: release.accession,
          ciks: [release.cik],
          primary_document: release.document,
        },
      })),
    },
  };
}

/** Install all network boundaries used by the five target workspaces. */
export async function installGovernanceAnalyticsFixtures(
  page: Page,
  options: GovernanceFixtureOptions = {},
): Promise<GovernanceFixtureStats> {
  const stats: GovernanceFixtureStats = {
    factsRequests: {},
    submissionRequests: {},
    filingTextRequests: [],
    claudePrompts: [],
    eftsRequests: 0,
    failNextAiAttempts: (kind, count) => {
      aiFailures[kind] = Math.max(0, count);
    },
  };
  const factFailures = { ...(options.factFailuresBeforeSuccess ?? {}) };
  const aiFailures = { ...(options.aiFailuresBeforeSuccess ?? {}) };
  let eftsFailures = options.eftsFailuresBeforeSuccess ?? 0;

  await page.context().route('https://www.sec.gov/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>SEC fixture source</title>' }));
  for (const origin of ['https://sasb.ifrs.org/**', 'https://www.globalreporting.org/**', 'https://www.efrag.org/**', 'https://www.fsb-tcfd.org/**']) {
    await page.context().route(origin, route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Official framework fixture</title>' }));
  }

  await page.route('**/api/sec-proxy**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get('path') ?? '';

    if (path.includes('company_tickers.json')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GOVERNANCE_COMPANY_DIRECTORY) });
      return;
    }

    if (path.includes('standard-industrial-classification-sic-code-list')) {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<table><tr><th>Code</th><th>Office</th><th>Title</th></tr><tr><td>3571</td><td>Office of Technology</td><td>Electronic Computers</td></tr><tr><td>7370</td><td>Office of Technology</td><td>Computer Programming Services</td></tr></table>',
      });
      return;
    }

    const submissionMatch = path.match(/submissions\/CIK(\d+)\.json/i);
    if (submissionMatch) {
      const company = companyForCik(submissionMatch[1]);
      const ticker = company?.ticker ?? String(Number(submissionMatch[1]));
      stats.submissionRequests[ticker] = (stats.submissionRequests[ticker] ?? 0) + 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(submissionsPayload(submissionMatch[1])) });
      return;
    }

    const factsMatch = path.match(/companyfacts\/CIK(\d+)\.json/i);
    if (factsMatch) {
      const company = companyForCik(factsMatch[1]);
      const ticker = company?.ticker ?? String(Number(factsMatch[1]));
      stats.factsRequests[ticker] = (stats.factsRequests[ticker] ?? 0) + 1;
      if ((factFailures[ticker] ?? 0) > 0) {
        factFailures[ticker] = (factFailures[ticker] ?? 0) - 1;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'fixture XBRL outage' }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(factsPayload(factsMatch[1])) });
      }
      return;
    }

    if (/FilingSummary\.xml|index\.json/i.test(path)) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: `<html><body><h1>Item 1. Business</h1><p>${filingText('320193', path)}</p><h1>Item 2. Properties</h1><p>Fixture properties disclosure with sufficient deterministic source evidence.</p></body></html>`,
    });
  });

  await page.route('**/api/filing-text**', async (route: Route) => {
    const url = new URL(route.request().url());
    const cik = String(Number(url.searchParams.get('cik') ?? '0'));
    const document = url.searchParams.get('document') ?? '';
    stats.filingTextRequests.push({ cik, document });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, cached: true, text: filingText(cik, document) }),
    });
  });

  await page.route('**/api/claude', async (route: Route) => {
    const body = JSON.parse(route.request().postData() || '{}') as { prompt?: string };
    const prompt = body.prompt ?? '';
    const kind = aiKind(prompt);
    stats.claudePrompts.push(prompt);
    if ((aiFailures[kind] ?? 0) > 0) {
      aiFailures[kind] = (aiFailures[kind] ?? 0) - 1;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: `fixture ${kind} outage` }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: aiText(kind, prompt) }) });
  });

  await page.route('**/api/compare', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ analysis: 'The selected filing evidence supports a deterministic comparison.' }),
    });
  });

  await page.route('**/api/sec-efts**', async (route: Route) => {
    stats.eftsRequests += 1;
    if (eftsFailures > 0) {
      eftsFailures -= 1;
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'fixture EFTS outage' }) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(eftsPayload()) });
  });

  return stats;
}
