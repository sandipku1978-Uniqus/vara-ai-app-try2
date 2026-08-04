import { describe, expect, it } from 'vitest';
import {
  extractFinancials,
  type CompanyFacts,
  type XbrlFact,
} from '../services/secApi';

type ConceptFixture = {
  label: string;
  description: string;
  units: Record<string, XbrlFact[]>;
};

function annualFact(overrides: Partial<XbrlFact> & Pick<XbrlFact, 'val' | 'end'>): XbrlFact {
  return {
    accn: '0000000000-25-000001',
    fy: Number(overrides.end.slice(0, 4)),
    fp: 'FY',
    form: '10-K',
    filed: `${Number(overrides.end.slice(0, 4)) + 1}-01-31`,
    start: `${Number(overrides.end.slice(0, 4)) - 1}-01-01`,
    ...overrides,
  };
}

function companyFacts(
  entityName: string,
  concepts: Record<string, ConceptFixture>
): CompanyFacts {
  return {
    cik: 1,
    entityName,
    facts: { 'us-gaap': concepts },
  };
}

function revenueConcept(label: string, facts: XbrlFact[]): ConceptFixture {
  return { label, description: label, units: { USD: facts } };
}

describe('extractFinancials annual alias selection', () => {
  it('selects the latest annual period across aliases instead of the first alias with data', () => {
    const facts = companyFacts('Alias Transition Corp', {
      Revenues: revenueConcept('Legacy revenues', [
        annualFact({ val: 18, start: '2017-01-01', end: '2017-12-31', fy: 2017 }),
      ]),
      RevenueFromContractWithCustomerExcludingAssessedTax: revenueConcept('Current revenues', [
        annualFact({ val: 25, start: '2024-01-01', end: '2024-12-31', fy: 2024 }),
      ]),
    });

    expect(extractFinancials(facts).Revenues).toMatchObject({
      label: 'Current revenues',
      value: 25,
      year: 2024,
      periodEnd: '2024-12-31',
    });
  });

  it('does not let a newer quarter displace the latest complete annual period', () => {
    const facts = companyFacts('Quarter Guard Corp', {
      Revenues: revenueConcept('Legacy revenues', [
        annualFact({ val: 18, start: '2017-01-01', end: '2017-12-31', fy: 2017 }),
        annualFact({
          val: 99,
          start: '2025-01-01',
          end: '2025-03-31',
          fy: 2025,
          // SEC comparative rows can carry a 10-K/FY filing label even when
          // the fact itself covers only one quarter. Duration must still win.
          fp: 'FY',
          form: '10-K',
          filed: '2025-04-30',
        }),
      ]),
      RevenueFromContractWithCustomerExcludingAssessedTax: revenueConcept('Current revenues', [
        annualFact({ val: 25, start: '2024-01-01', end: '2024-12-31', fy: 2024 }),
      ]),
    });

    expect(extractFinancials(facts).Revenues).toMatchObject({
      value: 25,
      period: 'FY',
      periodEnd: '2024-12-31',
    });
  });

  it('keeps explicit fiscal-year lookup working across alias transitions', () => {
    const facts = companyFacts('Historical Lookup Corp', {
      Revenues: revenueConcept('Legacy revenues', [
        annualFact({ val: 18, start: '2017-01-01', end: '2017-12-31', fy: 2017 }),
      ]),
      RevenueFromContractWithCustomerExcludingAssessedTax: revenueConcept('Current revenues', [
        annualFact({ val: 24, start: '2023-01-01', end: '2023-12-31', fy: 2023 }),
        annualFact({ val: 25, start: '2024-01-01', end: '2024-12-31', fy: 2024 }),
      ]),
    });

    expect(extractFinancials(facts, 2017).Revenues).toMatchObject({
      label: 'Legacy revenues',
      value: 18,
      year: 2017,
    });
    expect(extractFinancials(facts, 2023).Revenues).toMatchObject({
      label: 'Current revenues',
      value: 24,
      year: 2023,
    });
  });

  it('uses the latest filed restatement for the selected period', () => {
    const facts = companyFacts('Restatement Corp', {
      Revenues: revenueConcept('Revenues', [
        annualFact({
          val: 100,
          start: '2023-01-01',
          end: '2023-12-31',
          fy: 2023,
          filed: '2024-02-01',
          form: '10-K',
        }),
        annualFact({
          val: 105,
          start: '2023-01-01',
          end: '2023-12-31',
          fy: 2023,
          filed: '2024-03-01',
          form: '10-K/A',
        }),
      ]),
    });

    expect(extractFinancials(facts).Revenues).toMatchObject({
      value: 105,
      periodEnd: '2023-12-31',
    });
  });

  it('matches the real-shaped Apple concept transition instead of stopping at FY2018', () => {
    const facts = companyFacts('Apple Inc.', {
      Revenues: revenueConcept('Revenues', [
        annualFact({
          val: 265_595_000_000,
          start: '2017-10-01',
          end: '2018-09-29',
          fy: 2018,
          filed: '2018-11-05',
        }),
      ]),
      RevenueFromContractWithCustomerExcludingAssessedTax: revenueConcept(
        'Revenue from Contract with Customer, Excluding Assessed Tax',
        [annualFact({
          val: 416_161_000_000,
          start: '2024-09-29',
          end: '2025-09-27',
          fy: 2025,
          filed: '2025-10-31',
        })]
      ),
      SalesRevenueNet: revenueConcept('Revenue, Net (Deprecated 2018-01-31)', [
        annualFact({
          val: 229_234_000_000,
          start: '2016-09-25',
          end: '2017-09-30',
          fy: 2017,
          filed: '2017-11-03',
        }),
      ]),
    });

    expect(extractFinancials(facts).Revenues).toMatchObject({
      value: 416_161_000_000,
      year: 2025,
      periodEnd: '2025-09-27',
    });
  });

  it('matches the real-shaped Microsoft concept transition instead of stopping at FY2010', () => {
    const facts = companyFacts('MICROSOFT CORPORATION', {
      Revenues: revenueConcept('Revenues', [
        annualFact({
          val: 62_484_000_000,
          start: '2009-07-01',
          end: '2010-06-30',
          fy: 2010,
          filed: '2010-07-30',
        }),
      ]),
      RevenueFromContractWithCustomerExcludingAssessedTax: revenueConcept(
        'Revenue from Contract with Customer, Excluding Assessed Tax',
        [annualFact({
          val: 331_839_000_000,
          start: '2025-07-01',
          end: '2026-06-30',
          fy: 2026,
          filed: '2026-07-29',
        })]
      ),
      SalesRevenueNet: revenueConcept('Revenue, Net (Deprecated 2018-01-31)', [
        annualFact({
          val: 89_950_000_000,
          start: '2016-07-01',
          end: '2017-06-30',
          fy: 2017,
          filed: '2017-08-02',
        }),
      ]),
    });

    expect(extractFinancials(facts).Revenues).toMatchObject({
      value: 331_839_000_000,
      year: 2026,
      periodEnd: '2026-06-30',
    });
  });
});
