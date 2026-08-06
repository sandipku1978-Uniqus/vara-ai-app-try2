/**
 * Synthetic 10-K fixtures for the Filing AI engine.
 *
 * Deliberately synthetic. The back-test harness runs against real EDGAR
 * filings paired with the amendments that corrected them; these fixtures do a
 * different job — they pin the *behaviour* of the normalizer, the gates and
 * each predicate, including the failure paths a real filing rarely exhibits
 * (a defective certification, a broken exhibit index, a balance sheet that
 * does not balance). Building them by hand is what makes those paths testable
 * without waiting for a registrant to make the mistake.
 */

export interface FixtureOptions {
  /** Omit the EX-19 insider trading policy from the submitted document set. */
  dropExhibit19?: boolean;
  /** Break the balance sheet by understating total assets. */
  breakBalanceSheet?: boolean;
  /** Remove the prescribed paragraph 2 wording from the certification. */
  defectiveCertification?: boolean;
  /** Remove the disclosure controls conclusion from Item 9A. */
  dropControlsConclusion?: boolean;
  /** State a period end on the cover that disagrees with the submission. */
  coverPeriodMismatch?: boolean;
  /** Emit no inline XBRL at all. */
  stripInlineXbrl?: boolean;
  /** Remove the signature page. */
  dropSignatures?: boolean;
}

const PERIOD = '2025-12-31';

function ix(
  name: string,
  contextRef: string,
  value: string,
  extra: Record<string, string> = {},
): string {
  const attributes = Object.entries({ contextRef, ...extra })
    .map(([key, entry]) => `${key}="${entry}"`)
    .join(' ');
  const tag = extra.unitRef || extra.decimals ? 'ix:nonFraction' : 'ix:nonNumeric';
  return `<${tag} name="${name}" ${attributes}>${value}</${tag}>`;
}

function money(name: string, contextRef: string, value: string): string {
  return ix(name, contextRef, value, { unitRef: 'usd', decimals: '-3' });
}

const PRESCRIBED_CERTIFICATION = `
  <p>I, Dana Whitfield, certify that:</p>
  <p>1. I have reviewed this Annual Report on Form 10-K of Meridian Industries, Inc. for the fiscal year ended December 31, 2025;</p>
  <p>2. Based on my knowledge, this report does not contain any untrue statement of a material fact or omit to state a material fact necessary to make the statements made, in light of the circumstances under which such statements were made, not misleading with respect to the period covered by this report;</p>
  <p>3. Based on my knowledge, the financial statements, and other financial information included in this report, fairly present in all material respects the financial condition, results of operations and cash flows of the registrant as of, and for, the periods presented in this report;</p>
  <p>4. The registrant's other certifying officer and I are responsible for establishing and maintaining disclosure controls and procedures and internal control over financial reporting for the registrant and have:</p>
  <p>(a) Designed such disclosure controls and procedures, or caused such disclosure controls and procedures to be designed under our supervision;</p>
  <p>(b) Designed such internal control over financial reporting, or caused such internal control over financial reporting to be designed under our supervision;</p>
  <p>(c) Evaluated the effectiveness of the registrant's disclosure controls and procedures;</p>
  <p>(d) Disclosed in this report any change in the registrant's internal control over financial reporting;</p>
  <p>5. The registrant's other certifying officer and I have disclosed, based on our most recent evaluation, to the registrant's auditors and the audit committee: all significant deficiencies and material weaknesses in the design or operation of internal control over financial reporting; and any fraud, whether or not material, that involves management or other employees who have a significant role in the registrant's internal control over financial reporting.</p>
  <p>Date: February 20, 2026</p>
  <p>/s/ Dana Whitfield</p>
  <p>Dana Whitfield, Chief Executive Officer</p>
`;

const DEFECTIVE_CERTIFICATION = PRESCRIBED_CERTIFICATION.replace(
  /<p>2\..*?<\/p>/s,
  '<p>2. Based on my knowledge, this report is materially correct in all respects;</p>',
);

export function certificationHtml(options: FixtureOptions = {}): string {
  return `<html><body>${options.defectiveCertification ? DEFECTIVE_CERTIFICATION : PRESCRIBED_CERTIFICATION}</body></html>`;
}

export function financialOfficerCertificationHtml(): string {
  return `<html><body>${PRESCRIBED_CERTIFICATION
    .replace(/Dana Whitfield/g, 'Priya Raman')
    .replace('Chief Executive Officer', 'Chief Financial Officer')}</body></html>`;
}

export function section1350Html(): string {
  return `<html><body>
    <p>In connection with the Annual Report on Form 10-K of Meridian Industries, Inc. for the fiscal year ended December 31, 2025, each of the undersigned certifies pursuant to 18 U.S.C. Section 1350.</p>
    <p>/s/ Dana Whitfield</p><p>Dana Whitfield, Chief Executive Officer</p>
    <p>/s/ Priya Raman</p><p>Priya Raman, Chief Financial Officer</p>
  </body></html>`;
}

/** A complete, well-formed 10-K primary document, mutated by the options. */
export function primaryDocumentHtml(options: FixtureOptions = {}): string {
  const coverPeriod = options.coverPeriodMismatch ? '2025-09-30' : PERIOD;
  const assets = options.breakBalanceSheet ? '4,100,000' : '5,200,000';

  const inline = options.stripInlineXbrl
    ? {
        header: '',
        cover: 'Meridian Industries, Inc.',
        assets,
        equity: '',
      }
    : {
        header: `
      <ix:header>
        <ix:hidden>
          <xbrli:context id="c-fy">
            <xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0001234567</xbrli:identifier></xbrli:entity>
            <xbrli:period><xbrli:startDate>2025-01-01</xbrli:startDate><xbrli:endDate>${PERIOD}</xbrli:endDate></xbrli:period>
          </xbrli:context>
          <xbrli:context id="c-instant">
            <xbrli:entity><xbrli:identifier scheme="http://www.sec.gov/CIK">0001234567</xbrli:identifier></xbrli:entity>
            <xbrli:period><xbrli:instant>${PERIOD}</xbrli:instant></xbrli:period>
          </xbrli:context>
          <xbrli:context id="c-segment">
            <xbrli:entity>
              <xbrli:identifier scheme="http://www.sec.gov/CIK">0001234567</xbrli:identifier>
              <xbrli:segment>
                <xbrldi:explicitMember dimension="us-gaap:StatementBusinessSegmentsAxis">mrd:IndustrialMember</xbrldi:explicitMember>
              </xbrli:segment>
            </xbrli:entity>
            <xbrli:period><xbrli:instant>${PERIOD}</xbrli:instant></xbrli:period>
          </xbrli:context>
          <xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>
          <xbrli:unit id="shares"><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unit>
        </ix:hidden>
      </ix:header>`,
        cover: `
      ${ix('dei:DocumentType', 'c-fy', '10-K')}
      ${ix('dei:DocumentPeriodEndDate', 'c-fy', coverPeriod)}
      ${ix('dei:DocumentFiscalYearFocus', 'c-fy', '2025')}
      ${ix('dei:DocumentFiscalPeriodFocus', 'c-fy', 'FY')}
      ${ix('dei:EntityRegistrantName', 'c-fy', 'Meridian Industries, Inc.')}
      ${ix('dei:EntityCentralIndexKey', 'c-fy', '0001234567')}
      ${ix('dei:AmendmentFlag', 'c-fy', 'false')}
      ${ix('dei:EntityFilerCategory', 'c-fy', 'Large Accelerated Filer')}
      ${ix('dei:EntityIncorporationStateCountryCode', 'c-fy', 'DE')}
      ${ix('dei:EntityFileNumber', 'c-fy', '001-38856')}
      ${ix('dei:EntityTaxIdentificationNumber', 'c-fy', '84-1234567')}
      ${ix('dei:EntityShellCompany', 'c-fy', 'false')}
      ${ix('dei:EntitySmallBusiness', 'c-fy', 'false')}
      ${ix('dei:EntityEmergingGrowthCompany', 'c-fy', 'false')}
      ${ix('dei:EntityCurrentReportingStatus', 'c-fy', 'Yes')}
      ${ix('dei:EntityInteractiveDataCurrent', 'c-fy', 'Yes')}
      ${ix('dei:EntityWellKnownSeasonedIssuer', 'c-fy', 'Yes')}
      ${ix('dei:Security12bTitle', 'c-fy', 'Common Stock, par value $0.01')}
      ${ix('dei:TradingSymbol', 'c-fy', 'MRDN')}
      ${ix('dei:SecurityExchangeName', 'c-fy', 'NYSE')}
      ${ix('dei:CurrentFiscalYearEndDate', 'c-fy', '--12-31')}
      ${ix('dei:DocumentFinStmtErrorCorrectionFlag', 'c-fy', 'false')}
      ${ix('dei:DocumentFinStmtRestatementRecoveryAnalysisFlag', 'c-fy', 'false')}
      ${money('dei:EntityPublicFloat', 'c-instant', '3,400,000')}
      ${ix('dei:EntityCommonStockSharesOutstanding', 'c-instant', '120,000,000', { unitRef: 'shares', decimals: '0' })}`,
        assets: money('us-gaap:Assets', 'c-instant', assets),
        equity: `
      ${money('us-gaap:Liabilities', 'c-instant', '3,000,000')}
      ${money('us-gaap:StockholdersEquity', 'c-instant', '2,200,000')}
      ${money('us-gaap:LiabilitiesAndStockholdersEquity', 'c-instant', '5,200,000')}
      ${money('us-gaap:Assets', 'c-segment', '1,800,000')}
      ${money('us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax', 'c-fy', '4,000,000')}
      ${money('us-gaap:CostOfGoodsAndServicesSold', 'c-fy', '2,500,000')}
      ${money('us-gaap:GrossProfit', 'c-fy', '1,500,000')}
      ${money('us-gaap:NetIncomeLoss', 'c-fy', '600,000')}
      ${ix('us-gaap:WeightedAverageNumberOfSharesOutstandingBasic', 'c-fy', '120,000,000', { unitRef: 'shares', decimals: '0' })}
      ${ix('us-gaap:EarningsPerShareBasic', 'c-fy', '0.005', { unitRef: 'usdPerShare', decimals: '3' })}
      ${ix('us-gaap:CommonStockSharesOutstanding', 'c-instant', '120,000,000', { unitRef: 'shares', decimals: '0' })}`,
      };

  const signatures = options.dropSignatures
    ? ''
    : `
    <p>SIGNATURES</p>
    <p>Pursuant to the requirements of Section 13 of the Securities Exchange Act of 1934, the registrant, Meridian Industries, Inc., has duly caused this report to be signed on its behalf.</p>
    <p>/s/ Dana Whitfield</p><p>Chief Executive Officer</p><p>February 20, 2026</p>
    <p>/s/ Priya Raman</p><p>Chief Financial Officer</p><p>February 20, 2026</p>
    <p>/s/ Marcus Oyelaran</p><p>Chief Accounting Officer</p><p>February 20, 2026</p>
    <p>/s/ Helen Vasquez</p><p>Director</p><p>February 20, 2026</p>
    <p>/s/ Tomas Berg</p><p>Director</p><p>February 20, 2026</p>`;

  const controlsConclusion = options.dropControlsConclusion
    ? '<p>Our management evaluated our disclosure controls and procedures as of the end of the period.</p>'
    : '<p>Based on that evaluation, our principal executive officer and principal financial officer concluded that our disclosure controls and procedures were effective as of December 31, 2025.</p>';

  return `<?xml version="1.0"?>
<html xmlns:ix="http://www.xbrl.org/2013/inlineXBRL" xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
<body>
${inline.header}
<p>UNITED STATES SECURITIES AND EXCHANGE COMMISSION</p>
<p>FORM ${inline.cover ? '' : ''}10-K</p>
<p>Annual report for the fiscal year ended December 31, 2025</p>
<p>Commission File Number 001-38856</p>
<p>State or other jurisdiction of incorporation: Delaware</p>
<p>I.R.S. Employer Identification No. 84-1234567</p>
<p>Aggregate market value of common equity held by non-affiliates: $3.4 billion</p>
<p>Shell company: No. Emerging growth company: No. Well-known seasoned issuer: Yes.</p>
<p>Interactive Data File: Yes. Error corrections: No. Recovery analysis: No.</p>
${inline.cover}

<p>Item 1. Business</p>
<p>Meridian Industries designs and manufactures precision industrial components across three operating segments. The company operates twelve facilities and employs approximately 4,200 people worldwide, serving customers in aerospace, energy and transportation end markets.</p>

<p>Item 1A. Risk Factors</p>
<p>${'Our results depend on demand in cyclical end markets and on our ability to pass through input cost inflation. '.repeat(20)}</p>

<p>Item 1C. Cybersecurity</p>
<p>${'We maintain a cybersecurity risk management programme aligned to a recognised framework, overseen by the audit committee, with quarterly reporting from the chief information security officer and an annual independent assessment. '.repeat(6)}</p>

<p>Item 2. Properties</p>
<p>The company owns eight manufacturing facilities and leases four distribution centres.</p>

<p>Item 3. Legal Proceedings</p>
<p>The company is party to routine litigation incidental to its business. No proceeding is expected to have a material adverse effect on the financial statements.</p>

<p>Item 5. Market for Registrant's Common Equity</p>
<p>Common stock trades on the New York Stock Exchange under the symbol MRDN. There were 412 holders of record. The board declared quarterly dividends totalling $0.48 per share. No unregistered sales of equity securities occurred during the period. During the fourth quarter no director or officer adopted or terminated a Rule 10b5-1 trading arrangement.</p>

<p>Item 7. Management's Discussion and Analysis</p>
<p>Revenue increased on stronger aerospace volumes. Liquidity remains adequate and there are no conditions raising substantial doubt about the company's ability to continue as a going concern.</p>

<p>Item 7A. Quantitative and Qualitative Disclosures About Market Risk</p>
<p>The company is exposed to interest rate risk on floating rate borrowings and to foreign currency risk on euro and sterling denominated sales.</p>

<p>Item 8. Financial Statements and Supplementary Data</p>
<p>Report of Independent Registered Public Accounting Firm (PCAOB ID 42). We have served as the company's auditor since 2011.</p>
<p>Critical Audit Matter — valuation of long-lived assets in the transportation reporting unit.</p>
<p>Consolidated Balance Sheets</p>
<p>Total assets ${inline.assets}</p>
${inline.equity}
<p>Note 1 — Basis of presentation. Note 2 — Disaggregation of revenue by geography and product line. Note 3 — Segment reporting: the chief operating decision maker evaluates performance using segment operating profit, and significant segment expenses are disclosed. Note 4 — Income taxes, including the effective income tax rate reconciliation and income taxes paid, net, by jurisdiction. Note 5 — Fair value hierarchy, including Level 1, Level 2 and Level 3 measurements. Note 6 — Leases: operating lease cost and weighted-average remaining lease term. Note 7 — Concentrations of credit risk. Note 8 — Related party transactions. Note 9 — Subsequent events evaluated through February 20, 2026.</p>

<p>Item 9A. Controls and Procedures</p>
${controlsConclusion}
<p>Management's report on internal control over financial reporting: management is responsible for establishing and maintaining adequate internal control over financial reporting.</p>
<p>Attestation report of the registered public accounting firm on internal control over financial reporting is included in Item 8.</p>
<p>There were no changes in internal control over financial reporting during the fourth quarter that materially affected internal control over financial reporting.</p>

<p>Item 9B. Other Information</p>
<p>The company maintains an insider trading policy governing transactions by directors, officers and employees. None of the directors or officers adopted or terminated a Rule 10b5-1 trading arrangement during the fourth quarter.</p>

<p>Item 10. Directors, Executive Officers and Corporate Governance</p>
<p>The information required by this item is incorporated by reference from the company's definitive proxy statement to be filed within 120 days of the fiscal year end.</p>

<p>Item 11. Executive Compensation</p>
<p>Incorporated by reference from the definitive proxy statement.</p>

<p>Item 12. Security Ownership</p>
<p>Incorporated by reference from the definitive proxy statement.</p>

<p>Item 13. Certain Relationships and Related Transactions</p>
<p>Incorporated by reference from the definitive proxy statement.</p>

<p>Item 14. Principal Accountant Fees and Services</p>
<p>Incorporated by reference from the definitive proxy statement.</p>

<p>Item 15. Exhibits and Financial Statement Schedules</p>
<p>EXHIBIT INDEX</p>
<p>3.1 Restated certificate of incorporation (incorporated by reference to Exhibit 3.1 of the Form 8-K filed May 4, 2021)</p>
<p>4.1 Description of the registrant's securities registered under Section 12</p>
<p>10.4 Amended and restated credit agreement</p>
<p>19 Insider trading policy</p>
<p>21.1 Subsidiaries of the registrant</p>
<p>23.1 Consent of independent registered public accounting firm</p>
<p>31.1 Certification of the principal executive officer</p>
<p>31.2 Certification of the principal financial officer</p>
<p>32.1 Section 1350 statement, furnished not filed</p>
<p>97 Executive compensation recovery policy</p>
<p>101 Inline XBRL instance document</p>
<p>104 Cover page interactive data file</p>
${signatures}
</body></html>`;
}

export interface FixtureDocument {
  name: string;
  type: string;
  description: string;
  size: number;
  url: string;
}

const BASE_URL = 'https://www.sec.gov/Archives/edgar/data/1234567/000123456726000011';

export function submissionDocuments(options: FixtureOptions = {}): FixtureDocument[] {
  const documents: Array<[string, string, string]> = [
    ['mrdn-20251231.htm', '10-K', 'Annual report'],
    ['ex-41.htm', 'EX-4.1', 'Description of securities'],
    ['ex-104.htm', 'EX-10.4', 'Credit agreement'],
    ['ex-19.htm', 'EX-19', 'Insider trading policy'],
    ['ex-211.htm', 'EX-21.1', 'Subsidiaries'],
    ['ex-231.htm', 'EX-23.1', 'Consent'],
    ['ex-311.htm', 'EX-31.1', 'Certification of the principal executive officer'],
    ['ex-312.htm', 'EX-31.2', 'Certification of the principal financial officer'],
    ['ex-321.htm', 'EX-32.1', 'Section 1350 statement'],
    ['ex-97.htm', 'EX-97', 'Recovery policy'],
    ['mrdn-20251231.xsd', 'EX-101.SCH', 'Taxonomy schema'],
    ['mrdn-20251231_cal.xml', 'EX-101.CAL', 'Calculation linkbase'],
    ['cover.htm', 'EX-104', 'Cover page interactive data'],
  ];

  return documents
    .filter(([, type]) => !(options.dropExhibit19 && type === 'EX-19'))
    .map(([name, type, description]) => ({
      name,
      type,
      description,
      size: 4096,
      url: `${BASE_URL}/${name}`,
    }));
}

export const FIXTURE_PERIOD = PERIOD;
export const FIXTURE_ACCESSION = '0001234567-26-000011';
export const FIXTURE_CIK = '0001234567';
