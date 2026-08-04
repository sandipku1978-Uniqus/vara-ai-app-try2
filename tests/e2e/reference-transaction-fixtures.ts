import type { Page, Route } from '@playwright/test';

/**
 * Deterministic official-source and filing evidence for the specialist
 * reference and transaction journeys. These fixtures intentionally preserve
 * the upstream response shapes the production parsers consume: exercising a
 * generic JSON stub here would prove the test double, not the application.
 */

export const REFERENCE_RULES = [
  {
    href: '/rules-regulations/proposed-rule-33-11000',
    title: 'Climate-Related Disclosures for Investors',
    file: 'S7-10-26',
    status: 'Proposed',
    date: '2026-03-02',
  },
  {
    href: '/rules-regulations/final-rule-34-99000',
    title: 'Shortening the Settlement Cycle',
    file: 'S7-05-26',
    status: 'Final',
    date: '2026-04-14',
  },
];

export const REFERENCE_GUIDANCE = [
  {
    href: '/rules-regulations/staff-guidance/cf-disclosure-topic-11',
    title: 'Disclosure Guidance Topic No. 11: Non-GAAP Measures',
  },
  {
    href: '/rules-regulations/staff-guidance/cf-disclosure-topic-12',
    title: 'Disclosure Guidance Topic No. 12: Segment Reporting',
  },
];

export const REFERENCE_LITIGATION = [
  {
    href: '/enforcement-litigation/litigation-releases/lr-26101',
    title: 'SEC v. Halloway Capital Partners',
    number: 'LR-26101',
    date: '2026-05-11',
  },
  {
    href: '/enforcement-litigation/litigation-releases/lr-26102',
    title: 'SEC v. Trenton Ridge Advisors',
    number: 'LR-26102',
    date: '2026-05-18',
  },
];

export const REFERENCE_ADVISERS = [
  {
    crd: '145678',
    sec: '801-12345',
    name: 'Atlas Ridge Advisers LLC',
    scope: 'SEC registered',
    disclosures: 'N',
    city: 'Boston',
    state: 'MA',
    country: 'United States',
  },
  {
    crd: '267890',
    sec: '801-67890',
    name: 'Atlas Harbor Asset Management LP',
    scope: 'SEC registered',
    disclosures: 'Y',
    city: 'Chicago',
    state: 'IL',
    country: 'United States',
  },
];

function rulemakingHtml(query: string): string {
  const needle = query.trim().toLowerCase();
  const rows = REFERENCE_RULES
    .filter(rule => !needle || `${rule.title} ${rule.file} ${rule.status}`.toLowerCase().includes(needle))
    .map(rule => `
      <tr>
        <td><time>${rule.date}</time></td>
        <td>${rule.file}</td>
        <td>
          <span class="regulation-node-title">${rule.title}</span>
          <a class="info-button" href="${rule.href}"><span class="info-button__top">${rule.status} Rule</span></a>
          <span class="regulation-node-metadata">Release under the Securities Exchange Act.</span>
          <span class="division">Corporation Finance</span>
        </td>
      </tr>`)
    .join('');
  return `<html><body><table><tbody>${rows}</tbody></table></body></html>`;
}

function staffGuidanceHtml(): string {
  const links = REFERENCE_GUIDANCE
    .map(item => `<li><a href="${item.href}">${item.title}</a></li>`)
    .join('');
  return `<html><body><div class="field--name-field-text"><h2>Division of Corporation Finance</h2><ul>${links}</ul></div></body></html>`;
}

function litigationHtml(): string {
  const rows = REFERENCE_LITIGATION.map(item => `
    <tr>
      <td><time>${item.date}</time></td>
      <td>
        <span class="view-table_subfield_release_number"><span class="view-table_subfield_value">${item.number}</span></span>
        <a href="${item.href}">${item.title}</a>
      </td>
    </tr>`).join('');
  return `<html><body><table><tbody>${rows}</tbody></table></body></html>`;
}

export interface ReferenceSourceFixture {
  requests: string[];
  iapdQueries: string[];
  failures: {
    rulemaking: boolean;
    litigation: boolean;
    iapd: boolean;
  };
}

export async function installReferenceSourceFixtures(page: Page): Promise<ReferenceSourceFixture> {
  const fixture: ReferenceSourceFixture = {
    requests: [],
    iapdQueries: [],
    failures: { rulemaking: false, litigation: false, iapd: false },
  };

  await page.route('**/api/sec-proxy**', async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.searchParams.get('path') || '';
    fixture.requests.push(`${path}?${url.searchParams.toString()}`);

    if (path.includes('rulemaking-activity')) {
      if (fixture.failures.rulemaking) {
        await route.fulfill({ status: 503, contentType: 'text/plain', body: 'fixture source unavailable' });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: rulemakingHtml(url.searchParams.get('search') || ''),
      });
      return;
    }

    if (path.includes('staff-guidance')) {
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: staffGuidanceHtml() });
      return;
    }

    if (path.includes('litigation-releases')) {
      if (fixture.failures.litigation) {
        await route.fulfill({ status: 503, contentType: 'text/plain', body: 'fixture source unavailable' });
        return;
      }
      await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: litigationHtml() });
      return;
    }

    // Rulemaking follows every result to collect its effective date.
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: '<html><body><p>Effective Date: June 1, 2026.</p></body></html>',
    });
  });

  await page.route('**/api/sec-proxy?**upstream=iapd**', async (route: Route) => {
    const query = new URL(route.request().url()).searchParams.get('query') || '';
    fixture.iapdQueries.push(query);
    if (fixture.failures.iapd) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'fixture source unavailable' }) });
      return;
    }

    const needle = query.trim().toLowerCase();
    const firms = REFERENCE_ADVISERS.filter(firm => (
      `${firm.name} ${firm.crd} ${firm.sec}`.toLowerCase().includes(needle)
    ));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        hits: {
          total: firms.length,
          hits: firms.map(firm => ({
            _source: {
              firm_source_id: firm.crd,
              firm_ia_full_sec_number: firm.sec,
              firm_name: firm.name,
              firm_ia_scope: firm.scope,
              firm_ia_disclosure_fl: firm.disclosures,
              firm_ia_address_details: JSON.stringify({
                officeAddress: { city: firm.city, state: firm.state, country: firm.country },
              }),
            },
          })),
        },
      }),
    });
  });

  return fixture;
}

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

export interface TransactionFiling {
  entity: string;
  cik: string;
  accession: string;
  document: string;
  form: string;
  filed: string;
  description: string;
  text: string;
}

export const IPO_FILINGS: TransactionFiling[] = [
  {
    entity: 'Arcadia Robotics Inc',
    cik: '3000001',
    accession: '0003000001-26-000001',
    document: 'arcadia-s1.htm',
    form: 'S-1',
    filed: isoDaysAgo(12),
    description: 'Initial public offering registration statement',
    text: 'Business Overview. Arcadia Robotics designs warehouse automation systems for logistics customers. Revenue grew through recurring software subscriptions. Risk Factors include customer concentration and supply-chain disruption. Use of Proceeds includes product development and working capital. Management includes an independent audit committee. Underwriting is led by Example Securities. '.repeat(3),
  },
  {
    entity: 'Northstar Biologics plc',
    cik: '3000002',
    accession: '0003000002-26-000002',
    document: 'northstar-f1.htm',
    form: 'F-1',
    filed: isoDaysAgo(25),
    description: 'Foreign private issuer registration statement',
    text: 'Business Overview. Northstar develops clinical-stage biologic therapies. Risk Factors include clinical development and regulatory approval. Financial statements report research expense. Use of Proceeds funds clinical trials. '.repeat(4),
  },
];

export const MNA_FILINGS: TransactionFiling[] = [
  {
    entity: 'Halloway Industries Inc',
    cik: '3000003',
    accession: '0003000003-26-000003',
    document: 'halloway-merger-8k.htm',
    form: '8-K',
    filed: isoDaysAgo(8),
    description: 'Agreement and Plan of Merger with Trenton Ridge Corporation',
    text: 'Agreement and Plan of Merger. Trenton Ridge Corporation will acquire Halloway Industries Inc for $2.4 billion in an all-cash merger. Section 8.3 provides a reverse termination fee of $120 million if financing conditions are not met. The parties must operate in the ordinary course before closing. '.repeat(4),
  },
  {
    entity: 'Meridian Health Systems',
    cik: '3000004',
    accession: '0003000004-26-000004',
    document: 'meridian-13d.htm',
    form: 'SC 13D',
    filed: isoDaysAgo(18),
    description: 'Acquisition proposal and transaction disclosure',
    text: 'Meridian Health Systems disclosed a transaction proposal and related acquisition discussions. Conditions to closing include regulatory approval. '.repeat(5),
  },
];

function transactionHit(filing: TransactionFiling) {
  return {
    _id: `${filing.accession}:${filing.document}`,
    _score: 1,
    _source: {
      display_names: [`${filing.entity}  (CIK ${filing.cik})`],
      entity_name: filing.entity,
      file_date: filing.filed,
      form: filing.form,
      file_type: filing.form,
      root_forms: [filing.form],
      file_description: filing.description,
      adsh: filing.accession,
      ciks: [filing.cik],
      primary_document: filing.document,
    },
  };
}

export interface TransactionFixture {
  eftsRequests: Array<{ query: string; forms: string }>;
  filingTextRequests: string[];
  claudePrompts: string[];
  failures: { efts: boolean; filingText: boolean; claude: boolean };
}

export async function installTransactionFixtures(page: Page): Promise<TransactionFixture> {
  const fixture: TransactionFixture = {
    eftsRequests: [],
    filingTextRequests: [],
    claudePrompts: [],
    failures: { efts: false, filingText: false, claude: false },
  };

  await page.route('**/api/sec-efts**', async (route: Route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get('q') || '';
    const forms = url.searchParams.get('forms') || '';
    fixture.eftsRequests.push({ query, forms });
    if (fixture.failures.efts) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'fixture source unavailable' }) });
      return;
    }

    const requestedForms = forms.split(',').map(form => form.trim()).filter(Boolean);
    const corpus = requestedForms.some(form => ['S-1', 'S-1/A', 'F-1', 'F-1/A', '424B4'].includes(form))
      ? IPO_FILINGS
      : MNA_FILINGS;
    const matches = corpus.filter(filing => requestedForms.length === 0 || requestedForms.includes(filing.form));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        hits: {
          total: { value: matches.length, relation: 'eq' },
          hits: matches.map(transactionHit),
        },
      }),
    });
  });

  await page.route('**/api/filing-text**', async (route: Route) => {
    const url = new URL(route.request().url());
    const document = url.searchParams.get('document') || '';
    fixture.filingTextRequests.push(document);
    if (fixture.failures.filingText) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'fixture source unavailable' }) });
      return;
    }
    const filing = [...IPO_FILINGS, ...MNA_FILINGS].find(item => item.document === document);
    await route.fulfill({
      status: filing ? 200 : 404,
      contentType: 'application/json',
      body: JSON.stringify(filing
        ? { ok: true, text: filing.text, cached: true }
        : { ok: false, error: 'fixture filing not found' }),
    });
  });

  await page.route('**/api/claude', async (route: Route) => {
    const body = JSON.parse(route.request().postData() || '{}') as { prompt?: string };
    const prompt = body.prompt || '';
    fixture.claudePrompts.push(prompt);
    if (fixture.failures.claude) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'fixture AI unavailable' }) });
      return;
    }

    let text = '# Evidence-linked analysis\n- The selected filing states that Arcadia designs warehouse automation systems.';
    if (prompt.includes('Extract deal details')) {
      text = JSON.stringify({
        target: 'Halloway Industries Inc',
        acquirer: 'Trenton Ridge Corporation',
        value: '$2.4B',
        dealType: 'Merger Agreement',
        sector: 'Industrials',
      });
    } else if (prompt.includes('Clause types to find')) {
      const clauseType = prompt.match(/Clause types to find: \["([^"]+)"\]/)?.[1] || 'Termination Fee (Reverse Breakup)';
      text = JSON.stringify({
        [clauseType]: {
          text: 'A reverse termination fee of $120 million is payable if the financing conditions are not met.',
          section: 'Section 8.3',
        },
      });
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text }) });
  });

  return fixture;
}
