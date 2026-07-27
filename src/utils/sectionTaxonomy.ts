/**
 * Cross-form section taxonomy (Intelligize-benchmark C1) — v1.
 *
 * The asset underneath Intelligize's benchmarking matrices is a mapping from
 * section CONCEPTS to where each form family puts them: "Risk Factors" is
 * Item 1A on a 10-K, Part II Item 1A on a 10-Q, Item 3 (Key Information,
 * §D) on a 20-F. This module is that mapping's first slice, and it makes the
 * section-scope filter concept-aware: a researcher types "risk factors" and
 * every candidate is sliced at the right place FOR ITS OWN FORM.
 *
 * Covers the concepts researchers actually scope to, across the
 * item-numbered form families (10-K, 10-Q, 20-F) AND the heading-named
 * registration family (S-1, F-1, 424B prospectuses), where sections are
 * bounded by a fixed prospectus-heading vocabulary instead of "Item N".
 * An unmapped form yields no slice rather than a wrong one.
 */

import type { SectionSliceOptions } from './sectionPath';
import { extractHeadingSection, extractItemSection, normalizeItemNumber } from './sectionPath';

interface FormMapping {
  /** Item-numbered forms: which Item, and which part when numbers repeat. */
  item?: string;
  part?: 1 | 2;
  /** Heading-named forms (registration statements): section heading aliases. */
  headings?: string[];
}

export interface SectionConcept {
  key: string;
  label: string;
  aliases: string[];
  forms: Record<string, FormMapping>;
}

/** Form families: the root form decides the mapping; amendments follow it. */
export function formFamily(formType: string): '10-K' | '10-Q' | '20-F' | 'S-1' | null {
  const root = (formType || '').toUpperCase().replace(/\/A$/, '').trim();
  if (root === '10-K' || root === '10-KT' || root === '10-K405') return '10-K';
  if (root === '10-Q' || root === '10-QT') return '10-Q';
  if (root === '20-F') return '20-F';
  // Registration statements and their prospectuses name sections by heading.
  if (root === 'S-1' || root === 'F-1' || /^424B\d$/.test(root)) return 'S-1';
  return null;
}

/**
 * The prospectus heading vocabulary that bounds registration-statement
 * sections. Deliberately multi-word or distinctive: bare "summary",
 * "business" or "management" appear constantly in prose and would truncate
 * slices at random. A missing boundary makes a slice coarser (it overshoots
 * into the next section); a false boundary loses content — so the list leans
 * conservative.
 */
const REGISTRATION_BOUNDARY_HEADINGS = [
  'prospectus summary',
  'risk factors',
  'cautionary note regarding forward looking statements',
  'market and industry data',
  'use of proceeds',
  'dividend policy',
  'capitalization',
  'dilution',
  'selected financial data',
  'selected consolidated financial data',
  "management's discussion and analysis of financial condition and results of operations",
  'executive compensation',
  'certain relationships and related party transactions',
  'principal stockholders',
  'principal and selling stockholders',
  'description of capital stock',
  'shares eligible for future sale',
  'material us federal income tax considerations',
  'underwriting',
  'plan of distribution',
  'legal proceedings',
  'legal matters',
  'experts',
  'where you can find more information',
  'index to financial statements',
];

const CONCEPTS: SectionConcept[] = [
  {
    key: 'risk-factors',
    label: 'Risk Factors',
    aliases: ['risk factors', 'risks'],
    forms: {
      '10-K': { item: '1a' },
      '10-Q': { item: '1a', part: 2 },
      // 20-F Item 3 is Key Information; its §D is Risk Factors. Item-level
      // slicing is the honest v1 granularity for FPIs.
      '20-F': { item: '3' },
      'S-1': { headings: ['risk factors'] },
    },
  },
  {
    key: 'mdna',
    label: 'MD&A',
    aliases: ['mdna', 'md&a', 'md a', 'management discussion', "management's discussion"],
    forms: {
      '10-K': { item: '7' },
      '10-Q': { item: '2', part: 1 },
      '20-F': { item: '5' },
      'S-1': { headings: ["management's discussion and analysis of financial condition and results of operations", "management's discussion and analysis"] },
    },
  },
  {
    key: 'business',
    label: 'Business',
    aliases: ['business'],
    forms: {
      '10-K': { item: '1' },
      '20-F': { item: '4' },
    },
  },
  {
    key: 'legal-proceedings',
    label: 'Legal Proceedings',
    aliases: ['legal proceedings', 'legal'],
    forms: {
      '10-K': { item: '3' },
      '10-Q': { item: '1', part: 2 },
      '20-F': { item: '8' },
      'S-1': { headings: ['legal proceedings'] },
    },
  },
  {
    key: 'controls',
    label: 'Controls and Procedures',
    aliases: ['controls', 'controls and procedures', 'icfr'],
    forms: {
      '10-K': { item: '9a' },
      '10-Q': { item: '4', part: 1 },
      '20-F': { item: '15' },
    },
  },
];

/** The concepts, for consumers that iterate them (YoY change matrix). */
export const SECTION_CONCEPT_LIST: Array<{ key: string; label: string }> =
  CONCEPTS.map(concept => ({ key: concept.key, label: concept.label }));

function conceptFor(input: string): SectionConcept | null {
  const needle = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!needle) return null;
  return CONCEPTS.find(concept => concept.key === needle || concept.aliases.includes(needle)) || null;
}

export type ResolvedSectionScope =
  | {
      kind: 'item';
      item: string;
      options: SectionSliceOptions;
      /** What the UI should call it: "Risk Factors" or "Item 1A". */
      label: string;
    }
  | {
      kind: 'heading';
      headings: string[];
      label: string;
    };

/** Slice a filing's text at a resolved scope, whichever kind it is. */
export function extractResolvedSection(filingText: string, resolved: ResolvedSectionScope): string {
  if (resolved.kind === 'item') {
    return extractItemSection(filingText, resolved.item, resolved.options);
  }
  return extractHeadingSection(filingText, resolved.headings, REGISTRATION_BOUNDARY_HEADINGS);
}

/**
 * Resolve the user's section-scope input for one candidate filing.
 *
 * - An explicit item number ("1A", "9a", "2.02") applies to any form as-is —
 *   the researcher said exactly where to look.
 * - A concept name ("risk factors") resolves through the taxonomy using the
 *   candidate's OWN form; a form the concept is not mapped for returns null,
 *   and the candidate cannot match — never sliced at a guessed location.
 * - Anything else is unrecognizable: null.
 */
export function resolveSectionScope(input: string, formType: string): ResolvedSectionScope | null {
  const raw = (input || '').trim();
  if (!raw) return null;

  const explicit = normalizeItemNumber(raw);
  if (explicit) {
    return { kind: 'item', item: explicit, options: {}, label: `Item ${explicit.toUpperCase()}` };
  }

  const concept = conceptFor(raw);
  if (!concept) return null;
  const family = formFamily(formType);
  const mapping = family ? concept.forms[family] : undefined;
  if (!mapping) return null;
  if (mapping.headings) {
    return { kind: 'heading', headings: mapping.headings, label: concept.label };
  }
  if (!mapping.item) return null;
  return {
    kind: 'item',
    item: mapping.item,
    options: mapping.part ? { part: mapping.part } : {},
    label: concept.label,
  };
}

/** For UI copy: is this input a known concept (vs an item number / junk)? */
export function describeSectionScope(input: string): string {
  const raw = (input || '').trim();
  if (!raw) return '';
  const explicit = normalizeItemNumber(raw);
  if (explicit) return `Item ${explicit.toUpperCase()}`;
  return conceptFor(raw)?.label || raw;
}
