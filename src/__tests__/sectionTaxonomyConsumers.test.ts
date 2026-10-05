import { describe, it, expect } from 'vitest';
import { narrowFormsToSectionScope } from '../services/filingResearchPlan';
import { DISCLOSURE_TOPICS, topicConceptKey } from '../services/disclosureTopics';
import { SECTION_CONCEPTS, sectionScopeFamilies, sectionScopeOptions } from '../utils/sectionTaxonomy';

/**
 * Every surface that names a section reads the one taxonomy: the search
 * filter's options, its form narrowing, and the Text Redline's topics.
 */

describe('section-scope search options', () => {
  it('lists every concept, grouped Items, then Notes, then Proxy', () => {
    const options = sectionScopeOptions();
    expect(options).toHaveLength(SECTION_CONCEPTS.length);
    const groups = options.map(option => option.group);
    expect(groups.indexOf('notes')).toBeGreaterThan(groups.lastIndexOf('items'));
    expect(groups.indexOf('proxy')).toBeGreaterThan(groups.lastIndexOf('notes'));
    expect(options.find(option => option.value === 'Compensation Discussion & Analysis')).toMatchObject({ groupLabel: 'Proxy', forms: ['DEF 14A', 'S-1'] });
  });

  it('narrows default forms to those that can carry the section', () => {
    const defaults = '10-K,10-Q,8-K,DEF 14A,20-F,S-1';
    expect(narrowFormsToSectionScope(defaults, 'CD&A')).toBe('DEF 14A,S-1');
    expect(narrowFormsToSectionScope(defaults, 'leases')).toBe('10-K,10-Q,20-F,S-1');
    expect(narrowFormsToSectionScope(defaults, 'non-gaap')).toBe('10-K,10-Q,8-K,20-F,S-1');
  });

  it('keeps the defaults for item numbers, unknown text, or a narrowing that would leave nothing', () => {
    expect(narrowFormsToSectionScope('10-K,8-K', '2.02')).toBe('10-K,8-K');
    expect(narrowFormsToSectionScope('10-K,8-K', 'climate risk')).toBe('10-K,8-K');
    expect(narrowFormsToSectionScope('10-K', 'say on pay')).toBe('10-K');
    expect(sectionScopeFamilies('1A')).toBeNull();
  });
});

describe('disclosure topics come from the taxonomy', () => {
  it('shares one heading list per topic with the note slicer — no second copy', () => {
    for (const topic of DISCLOSURE_TOPICS) {
      const concept = SECTION_CONCEPTS.find(candidate => candidate.topic?.id === topic.id)!;
      expect(concept, topic.id).toBeDefined();
      expect(topic.headings).toBe(concept.headings);
      expect(topicConceptKey(topic.id)).toBe(concept.key);
    }
  });

  it('keeps the established topic order and ids (persisted "topic:<id>" values still resolve)', () => {
    expect(DISCLOSURE_TOPICS.map(topic => topic.id)).toEqual([
      'revenue-recognition', 'stock-compensation', 'leases', 'goodwill-impairment', 'income-taxes',
      'business-combinations', 'segment-reporting', 'credit-losses', 'fair-value', 'going-concern',
      'material-weakness', 'critical-audit-matters', 'use-of-estimates', 'significant-accounting-policies',
    ]);
  });
});
