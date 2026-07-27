import { describe, it, expect } from 'vitest';
import { extractHeadingSection } from '../utils/sectionPath';
import { extractResolvedSection, formFamily, resolveSectionScope } from '../utils/sectionTaxonomy';

/**
 * Registration statements name sections by heading, not item number. The
 * slicer's precision rules: cross-references never start a slice, prose
 * phrases never END one early (determiner/possessive guard on boundaries),
 * TOC entries lose to the body by slice length, and an absent section yields
 * nothing rather than a guess.
 */

const PROSPECTUS = [
  'TABLE OF CONTENTS',
  'Prospectus Summary 1',
  'Risk Factors 14',
  'Use of Proceeds 55',
  'Legal Proceedings 120',
  'PROSPECTUS SUMMARY',
  'We operate a marketplace platform. For a discussion of risks, see Risk Factors.',
  'RISK FACTORS',
  'Investing in our common stock involves substantial risk.',
  'Our management will have broad discretion in the use of proceeds from this offering.',
  'Competition from larger platforms could reduce our margins substantially over time.',
  'USE OF PROCEEDS',
  'We intend to use the net proceeds for working capital and general corporate purposes.',
  'LEGAL PROCEEDINGS',
  'A patent dispute is pending in the Northern District of California.',
].join('\n');

const VOCAB = ['prospectus summary', 'risk factors', 'use of proceeds', 'legal proceedings'];

describe('extractHeadingSection', () => {
  it('slices from the body heading to the next vocabulary heading', () => {
    const slice = extractHeadingSection(PROSPECTUS, ['risk factors'], VOCAB);
    expect(slice).toContain('substantial risk');
    expect(slice).toContain('competition from larger platforms');
    expect(slice).not.toContain('net proceeds for working capital');
  });

  it('a prose "use of proceeds" does not end Risk Factors early', () => {
    // "the use of proceeds" appears INSIDE the risk factor about management
    // discretion; the section must run past it to the real heading.
    const slice = extractHeadingSection(PROSPECTUS, ['risk factors'], VOCAB);
    expect(slice).toContain('broad discretion in the use of proceeds');
  });

  it('a cross-reference does not become the section', () => {
    // "see Risk Factors" inside the summary is guarded; the body heading wins.
    const slice = extractHeadingSection(PROSPECTUS, ['risk factors'], VOCAB);
    expect(slice.startsWith('risk factors investing')).toBe(true);
  });

  it('returns nothing for a section the document does not have', () => {
    expect(extractHeadingSection(PROSPECTUS, ['executive compensation'], VOCAB)).toBe('');
    expect(extractHeadingSection('', ['risk factors'], VOCAB)).toBe('');
  });
});

describe('taxonomy integration for the registration family', () => {
  it('roots S-1, F-1 and 424B prospectuses to the S-1 family', () => {
    expect(formFamily('S-1')).toBe('S-1');
    expect(formFamily('S-1/A')).toBe('S-1');
    expect(formFamily('F-1')).toBe('S-1');
    expect(formFamily('424B4')).toBe('S-1');
    expect(formFamily('424B10' as string)).toBeNull(); // only single-digit 424B variants exist
  });

  it('resolves risk factors on an S-1 to a heading scope and slices it', () => {
    const resolved = resolveSectionScope('risk factors', 'S-1');
    expect(resolved).toMatchObject({ kind: 'heading', label: 'Risk Factors' });
    const slice = extractResolvedSection(PROSPECTUS, resolved!);
    expect(slice).toContain('substantial risk');
  });

  it('still refuses concepts with no mapping on the family', () => {
    expect(resolveSectionScope('controls', 'S-1')).toBeNull();
    expect(resolveSectionScope('business', 'S-1')).toBeNull();
  });

  it('item scopes still resolve for item-numbered forms', () => {
    expect(resolveSectionScope('risk factors', '10-K')).toMatchObject({ kind: 'item', item: '1a' });
    expect(resolveSectionScope('9A', '10-K')).toMatchObject({ kind: 'item', item: '9a' });
  });
});
