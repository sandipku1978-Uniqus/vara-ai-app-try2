/**
 * Curated research library (Intelligize-benchmark C5): saved searches by
 * category, each one a real, runnable request — and deliberately a tour of
 * the engine's capabilities (numeric operands, section scoping, standards
 * citations, the auditor field), because a library entry is how a new user
 * discovers what the platform can do.
 *
 * Every entry is contract-tested: Boolean queries must compile, citation
 * filters must parse, section scopes must resolve. A library that suggests a
 * search the engine rejects is worse than none.
 */

import type { SearchFilters } from '../components/filters/SearchFilterBar';

export interface ResearchLibraryEntry {
  title: string;
  /** What the search demonstrates or answers — shown as hover context. */
  hint: string;
  query: string;
  mode: 'semantic' | 'boolean';
  filters?: Partial<SearchFilters>;
}

export interface ResearchLibraryCategory {
  name: string;
  entries: ResearchLibraryEntry[];
}

export const RESEARCH_LIBRARY: ResearchLibraryCategory[] = [
  {
    name: 'Cybersecurity',
    entries: [
      {
        title: 'Material cyber incidents',
        hint: 'Filings disclosing a material cybersecurity incident',
        query: '"material cybersecurity incident"',
        mode: 'boolean',
      },
      {
        title: 'Cyber risk, in Risk Factors only',
        hint: 'Breach discussion scoped to the Risk Factors section of each filing',
        query: 'cybersecurity AND breach',
        mode: 'boolean',
        filters: { sectionScope: 'risk factors' },
      },
    ],
  },
  {
    name: 'Finance & Accounting',
    entries: [
      {
        title: 'Goodwill impairments, quantified',
        hint: 'Every filing that puts a dollar amount beside a goodwill impairment',
        query: '"goodwill impairment" W/10 $#',
        mode: 'boolean',
      },
      {
        title: 'Segment reporting under ASU 2023-07',
        hint: 'Adoption discussion in filings citing the segment-reporting update',
        query: 'segment',
        mode: 'boolean',
        filters: { ascReference: 'ASU 2023-07' },
      },
      {
        title: 'Effective tax rates, quantified',
        hint: 'Tax-rate disclosures with the percentage stated',
        query: '"effective tax rate" W/5 %#',
        mode: 'boolean',
      },
    ],
  },
  {
    name: 'Internal Controls',
    entries: [
      {
        title: 'Material weakness remediation, Item 9A',
        hint: 'Remediation discussion inside Controls and Procedures',
        query: '"material weakness" AND remediation',
        mode: 'boolean',
        filters: { sectionScope: '9A' },
      },
      {
        title: 'Material weaknesses at PwC clients',
        hint: 'Auditor of record from PCAOB Form AP',
        query: '"material weakness" AND auditor:PwC',
        mode: 'boolean',
      },
    ],
  },
  {
    name: 'Governance & ESG',
    entries: [
      {
        title: 'Climate risk, in Risk Factors only',
        hint: 'Climate discussion scoped to the Risk Factors section',
        query: 'climate',
        mode: 'boolean',
        filters: { sectionScope: 'risk factors' },
      },
      {
        title: 'Board diversity disclosures',
        hint: 'Exact-phrase search across filings and exhibits',
        query: '"board diversity"',
        mode: 'boolean',
      },
    ],
  },
  {
    name: 'Current Events',
    entries: [
      {
        title: 'AI risk, in Risk Factors only',
        hint: 'Artificial-intelligence risk language, section-scoped',
        query: '"artificial intelligence"',
        mode: 'boolean',
        filters: { sectionScope: 'risk factors' },
      },
      {
        title: 'Tariff impacts, quantified',
        hint: 'Tariff discussion with a dollar amount nearby',
        query: 'tariff W/12 $#',
        mode: 'boolean',
      },
    ],
  },
];
