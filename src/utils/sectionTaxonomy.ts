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
 * v1 covers the concepts researchers actually scope to, across the
 * item-numbered form families (10-K, 10-Q, 20-F). Registration statements
 * (S-1, 424B) name sections by heading, not item number — heading-based
 * slicing is the next increment, and an unmapped form yields no slice rather
 * than a wrong one.
 */

import type { SectionSliceOptions } from './sectionPath';
import { normalizeItemNumber } from './sectionPath';

export interface SectionConcept {
  key: string;
  label: string;
  aliases: string[];
  /** Per form family: which Item, and which part when numbers repeat. */
  forms: Record<string, { item: string; part?: 1 | 2 }>;
}

/** Form families: the root form decides the mapping; amendments follow it. */
export function formFamily(formType: string): '10-K' | '10-Q' | '20-F' | null {
  const root = (formType || '').toUpperCase().replace(/\/A$/, '').trim();
  if (root === '10-K' || root === '10-KT' || root === '10-K405') return '10-K';
  if (root === '10-Q' || root === '10-QT') return '10-Q';
  if (root === '20-F') return '20-F';
  return null;
}

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

function conceptFor(input: string): SectionConcept | null {
  const needle = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!needle) return null;
  return CONCEPTS.find(concept => concept.key === needle || concept.aliases.includes(needle)) || null;
}

export interface ResolvedSectionScope {
  item: string;
  options: SectionSliceOptions;
  /** What the UI should call it: "Risk Factors" or "Item 1A". */
  label: string;
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
    return { item: explicit, options: {}, label: `Item ${explicit.toUpperCase()}` };
  }

  const concept = conceptFor(raw);
  if (!concept) return null;
  const family = formFamily(formType);
  const mapping = family ? concept.forms[family] : undefined;
  if (!mapping) return null;
  return {
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
