import { describe, it, expect } from 'vitest';
import { RESEARCH_LIBRARY } from '../config/researchLibrary';
import { describeBooleanQueryIssue } from '../utils/booleanSearch';
import { parseAccountingReference } from '../utils/accountingReference';
import { resolveSectionScope } from '../utils/sectionTaxonomy';

/**
 * Contract for the curated library (benchmark C5): a library that suggests a
 * search the engine rejects is worse than none. Every entry must be runnable
 * exactly as written — Boolean queries compile, citation filters parse,
 * section scopes resolve for at least the 10-K family.
 */

const ALL_ENTRIES = RESEARCH_LIBRARY.flatMap(category =>
  category.entries.map(entry => ({ category: category.name, ...entry }))
);

describe('research library entries are runnable as written', () => {
  it('has several categories with entries', () => {
    expect(RESEARCH_LIBRARY.length).toBeGreaterThanOrEqual(4);
    expect(ALL_ENTRIES.length).toBeGreaterThanOrEqual(8);
  });

  it.each(ALL_ENTRIES.map(entry => [`${entry.category}: ${entry.title}`, entry] as const))(
    '%s',
    (_label, entry) => {
      if (entry.mode === 'boolean') {
        expect(describeBooleanQueryIssue(entry.query), entry.query).toBeNull();
      }
      if (entry.filters?.ascReference) {
        expect(parseAccountingReference(entry.filters.ascReference), entry.filters.ascReference).not.toBeNull();
      }
      if (entry.filters?.sectionScope) {
        expect(resolveSectionScope(entry.filters.sectionScope, '10-K'), entry.filters.sectionScope).not.toBeNull();
      }
    }
  );
});
