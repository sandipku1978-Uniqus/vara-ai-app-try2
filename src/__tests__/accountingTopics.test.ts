import { describe, expect, it } from 'vitest';
import {
  ACCOUNTING_ISSUES,
  FASB_CODIFICATION_URL,
  accountingIssueForAsu,
  ascTopicUrl,
  benchmarkingIssueHref,
  checklistItemLinks,
  filterCuratedAscTopics,
  issueAscReference,
} from '../config/accountingTopics';
import { DISCLOSURE_TOPICS } from '../services/disclosureTopics';
import { describeBooleanQueryIssue } from '../utils/booleanSearch';
import { parseAccountingReference } from '../utils/accountingReference';
import { resolveSectionScope } from '../utils/sectionTaxonomy';
import { accountingPaletteItems } from '../components/layout/CommandPalette';

describe('curated ASC topic directory', () => {
  it.each([
    ['606', 'Revenue from Contracts with Customers'],
    ['ASC 842', 'Leases'],
    ['stock compensation', 'Compensation — Stock Compensation'],
    ['credit losses', 'Financial Instruments — Credit Losses'],
  ])('finds %s in the curated directory', (query, expectedName) => {
    expect(filterCuratedAscTopics(query).map(topic => topic.name)).toContain(expectedName);
  });

  it('builds an official FASB Codification topic link', () => {
    expect(ascTopicUrl('606')).toBe(`${FASB_CODIFICATION_URL}606/`);
  });
});

describe('accounting issue pages', () => {
  it('has one issue per disclosure topic, in the same order', () => {
    expect(ACCOUNTING_ISSUES.map(issue => issue.id)).toEqual(DISCLOSURE_TOPICS.map(topic => topic.id));
  });

  it.each(ACCOUNTING_ISSUES.map(issue => [issue.id, issue] as const))('%s precedent search is runnable as written', (_id, issue) => {
    if (issue.precedent.mode === 'boolean') expect(describeBooleanQueryIssue(issue.precedent.query), issue.precedent.query).toBeNull();
    if (issue.precedent.filters?.ascReference) expect(parseAccountingReference(issue.precedent.filters.ascReference)).not.toBeNull();
    if (issue.precedent.filters?.sectionScope) expect(resolveSectionScope(issue.precedent.filters.sectionScope, '10-K')).not.toBeNull();
    expect(issue.letterQuery.trim().length).toBeGreaterThan(3);
    for (const reference of issue.references) expect(reference.url).toMatch(/^https:\/\/(www\.sec\.gov|pcaobus\.org|www\.ecfr\.gov)\//);
  });

  it('maps issues to the ASC reference their ASU lookup uses', () => {
    const byId = Object.fromEntries(ACCOUNTING_ISSUES.map(issue => [issue.id, issue]));
    expect(issueAscReference(byId['revenue-recognition'])).toBe('ASC 606');
    expect(issueAscReference(byId['going-concern'])).toBe('ASC 205-40');
    expect(issueAscReference(byId['use-of-estimates'])).toBe('ASC 275');
    expect(issueAscReference(byId['critical-audit-matters'])).toBeNull();
    expect(benchmarkingIssueHref('leases')).toBe('/compare?topic=leases');
  });

  it('maps an ASU to its issue page, and a subtopic issue only on its subtopic', () => {
    expect(accountingIssueForAsu({ ascTopics: ['280'], ascSubtopics: [] })?.id).toBe('segment-reporting');
    expect(accountingIssueForAsu({ ascTopics: ['205'], ascSubtopics: ['205-40'] })?.id).toBe('going-concern');
    expect(accountingIssueForAsu({ ascTopics: ['205'], ascSubtopics: [] })).toBeUndefined();
    expect(accountingIssueForAsu({ ascTopics: ['999'], ascSubtopics: [] })).toBeUndefined();
  });
});

describe('checklist item links', () => {
  it('links the ASU a checklist item cites, and its issue page through the ASU index', () => {
    const links = checklistItemLinks('Confirm early adopters of ASU 2023-07 disclose significant segment expenses', number => (
      number === '2023-07' ? { ascTopics: ['280'], ascSubtopics: [] } : undefined
    ));
    expect(links.asu).toEqual({ number: '2023-07', href: '/accounting?tab=asu&asu=2023-07#asu-2023-07' });
    expect(links.issue).toEqual({ id: 'segment-reporting', label: 'Segment reporting', href: '/accounting/segment-reporting' });
  });

  it('links an issue page from an ASC citation or the issue’s own phrase', () => {
    expect(checklistItemLinks('Tie out ASC 842 maturity tables').issue?.id).toBe('leases');
    expect(checklistItemLinks('Review SEC comments on material weakness remediation').issue?.id).toBe('material-weakness');
    expect(checklistItemLinks('Compare peer accounting policy wording for the same arrangement')).toEqual({});
  });
});

describe('command palette accounting entries', () => {
  it('offers issue pages by label, ASC number, or heading, and ASU rows by number', () => {
    expect(accountingPaletteItems('lease').map(item => item.href)).toContain('/accounting/leases');
    expect(accountingPaletteItems('asc 606').map(item => item.href)).toEqual(['/accounting/revenue-recognition']);
    expect(accountingPaletteItems('going concern').map(item => item.href)).toEqual(['/accounting/going-concern']);
    expect(accountingPaletteItems('2023-07')[0]).toMatchObject({ label: 'ASU 2023-07', href: '/accounting?tab=asu&asu=2023-07#asu-2023-07' });
    expect(accountingPaletteItems('asu')[0]).toMatchObject({ label: 'ASU Index', href: '/accounting?tab=asu' });
    expect(accountingPaletteItems('x')).toEqual([]);
  });
});
