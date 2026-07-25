import { describe, it, expect } from 'vitest';
import {
  DISCLOSURE_TOPICS,
  distinctiveTerms,
  findDisclosureTopic,
  locateTopicPassage,
  resolveComparisonTarget,
  topicFromFreeText,
} from '../services/disclosureTopics';

/** Filing shaped like a real 10-K: TOC first, then the notes far below. */
function filing({ toc = true, revenue = true, stock = true } = {}): string {
  const tocBlock = toc
    ? ['TABLE OF CONTENTS', 'Revenue Recognition .... 45', 'Stock-Based Compensation .... 61', ''].join('\n')
    : '';
  const filler = ('Item 1. Business\n' + 'The Company operates globally in many markets. '.repeat(60) + '\n').repeat(3);

  const revenueNote = revenue
    ? [
        'Revenue Recognition',
        'The Company recognizes revenue when a performance obligation is satisfied by transferring',
        'control of a promised good or service. The transaction price is allocated to each',
        'performance obligation based on standalone selling price. Certain arrangements include',
        'variable consideration which is estimated at contract inception. Amounts billed in advance',
        'are recorded as a contract liability.',
        '',
      ].join('\n')
    : '';

  const stockNote = stock
    ? [
        'Stock-Based Compensation',
        'The Company measures share-based awards at grant date fair value. Restricted stock unit',
        'awards vest over a four year vesting period. Stock option fair value is estimated using',
        'the Black-Scholes model. Forfeiture is recognized as it occurs.',
        '',
      ].join('\n')
    : '';

  return [tocBlock, filler, revenueNote, filler, stockNote].join('\n');
}

describe('locateTopicPassage', () => {
  const revenueTopic = findDisclosureTopic('revenue-recognition')!;
  const stockTopic = findDisclosureTopic('stock-compensation')!;

  it('finds the policy note by heading, not the table-of-contents entry', () => {
    const text = filing();
    const passage = locateTopicPassage(text, revenueTopic);

    expect(passage.matchKind).toBe('heading');
    expect(passage.text).toContain('performance obligation');
    // The TOC line ("Revenue Recognition .... 45") sits in the first 4,000
    // characters and must never be returned as the disclosure.
    expect(passage.text).not.toContain('.... 45');
    expect(passage.offset).toBeGreaterThan(4000);
  });

  it('reaches a topic that has no Item of its own', () => {
    // The whole point: stock compensation lives in a note, so Item-level
    // extraction could never return it.
    const passage = locateTopicPassage(filing(), stockTopic);
    expect(passage.matchKind).toBe('heading');
    expect(passage.text).toContain('grant date fair value');
  });

  it('reports which topic terms were actually present', () => {
    const passage = locateTopicPassage(filing(), revenueTopic);
    expect(passage.matchedTerms).toEqual(
      expect.arrayContaining(['performance obligation', 'transaction price', 'variable consideration']),
    );
  });

  it('falls back to term density when no heading exists, and says so', () => {
    const text = [
      'Item 7. Management Discussion',
      'x '.repeat(3000),
      'We recognize amounts when each performance obligation is satisfied and the transaction price',
      'has been allocated using standalone selling price estimates for variable consideration.',
      'x '.repeat(2000),
    ].join('\n');

    const passage = locateTopicPassage(text, revenueTopic);
    expect(passage.matchKind).toBe('density');
    expect(passage.matchReason).toMatch(/highest concentration/i);
    expect(passage.text).toContain('performance obligation');
  });

  it('reports absence honestly rather than returning an arbitrary passage', () => {
    const text = 'Item 1. Business\n' + 'We manufacture industrial fasteners. '.repeat(200);
    const passage = locateTopicPassage(text, stockTopic);

    expect(passage.matchKind).toBe('none');
    expect(passage.text).toBe('');
    expect(passage.matchReason).toMatch(/no passage discussing/i);
  });

  it('handles empty filing text without throwing', () => {
    const passage = locateTopicPassage('', revenueTopic);
    expect(passage.matchKind).toBe('none');
    expect(passage.text).toBe('');
  });

  it('prefers the later heading when a topic is mentioned twice', () => {
    const text = [
      'x'.repeat(5000),
      'Revenue Recognition',
      'Summary cross-reference to the policy below.',
      'y'.repeat(6000),
      'Revenue Recognition',
      'The Company recognizes revenue when a performance obligation is satisfied.',
    ].join('\n');

    const passage = locateTopicPassage(text, revenueTopic);
    expect(passage.text).toContain('performance obligation');
  });
});

describe('topic catalogue', () => {
  it('covers the policies an accountant benchmarks', () => {
    const ids = DISCLOSURE_TOPICS.map(topic => topic.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'revenue-recognition', 'stock-compensation', 'leases',
        'goodwill-impairment', 'income-taxes', 'segment-reporting',
      ]),
    );
  });

  it('gives every topic both heading and prose vocabulary', () => {
    for (const topic of DISCLOSURE_TOPICS) {
      expect(topic.headings.length, `${topic.id} needs headings`).toBeGreaterThan(0);
      expect(topic.terms.length, `${topic.id} needs terms`).toBeGreaterThan(0);
    }
  });

  it('accepts free text so the feature is not limited to the curated list', () => {
    const custom = topicFromFreeText('climate transition risk');
    expect(custom?.label).toBe('climate transition risk');
    expect(custom?.terms).toContain('climate transition risk');
  });

  it('maps free text back onto a curated topic when it names one', () => {
    expect(topicFromFreeText('Revenue recognition policy')?.id).toBe('revenue-recognition');
  });

  it('ignores input too short to search on', () => {
    expect(topicFromFreeText('ab')).toBeNull();
  });
});

describe('distinctiveTerms', () => {
  it('surfaces vocabulary unique to one peer — where they actually diverge', () => {
    const result = distinctiveTerms({
      AAPL: { text: '', matchReason: '', matchKind: 'heading', matchedTerms: ['performance obligation', 'variable consideration'], offset: 0 },
      MSFT: { text: '', matchReason: '', matchKind: 'heading', matchedTerms: ['performance obligation', 'contract liability'], offset: 0 },
    });

    expect(result.AAPL).toEqual(['variable consideration']);
    expect(result.MSFT).toEqual(['contract liability']);
  });

  it('returns nothing distinctive when peers use identical vocabulary', () => {
    const shared = { text: '', matchReason: '', matchKind: 'heading' as const, matchedTerms: ['lease liability'], offset: 0 };
    const result = distinctiveTerms({ A: shared, B: { ...shared } });
    expect(result.A).toEqual([]);
    expect(result.B).toEqual([]);
  });
});

describe('a heading names a subject; a table row carries data', () => {
  const revenueTopic = findDisclosureTopic('revenue-recognition')!;
  const leaseTopic = findDisclosureTopic('leases')!;

  it('does not treat an MD&A comparison row as the revenue heading (American Tower)', () => {
    const text = [
      'x'.repeat(5000),
      'Revenue $ — $ 911.2 (100) %',
      'Cost of operations — (473.8) (100)',
      'Depreciation, amortization and accretion — (204.1) (100)',
      'y'.repeat(3000),
      'Revenue Recognition',
      'Our revenue is derived from leasing space; we recognize revenue when control of the promised service transfers.',
      'The transaction price is allocated to each performance obligation.',
    ].join('\n');

    const passage = locateTopicPassage(text, revenueTopic);
    expect(passage.text).toContain('performance obligation');
    expect(passage.text).not.toContain('911.2');
  });

  it('does not treat a deferred-tax table line as the revenue heading (Honeywell)', () => {
    const text = [
      'x'.repeat(5000),
      'Deferred revenue (175) (244)',
      'Pension (1,339) (1,481)',
      'y'.repeat(3000),
      'Revenue Recognition',
      'We recognize revenue when the customer obtains control, using the transaction price allocated.',
    ].join('\n');

    expect(locateTopicPassage(text, revenueTopic).text).toContain('transaction price');
  });

  it('accepts a run-in heading that ends with a period (Prologis)', () => {
    // "Revenue Recognition." was rejected outright for its trailing period,
    // which sent the locator to a density match in the MD&A.
    const text = [
      'x'.repeat(5000),
      'Revenue Recognition.',
      'We recognize revenue from rentals when the tenant takes control of the space.',
      'The transaction price is allocated across each performance obligation.',
    ].join('\n');

    const passage = locateTopicPassage(text, revenueTopic);
    expect(passage.matchKind).toBe('heading');
    expect(passage.text).toContain('recognize revenue');
  });

  it('still rejects a full sentence that happens to mention the topic', () => {
    const text = [
      'x'.repeat(5000),
      'The Company recognizes revenue when a customer obtains control of the promised good or service.',
      'y'.repeat(2000),
    ].join('\n');

    // A sentence is not a heading, so this can only be a density match.
    expect(locateTopicPassage(text, revenueTopic).matchKind).not.toBe('heading');
  });

  it('keeps a numbered note heading (Deere, NextEra)', () => {
    const text = [
      'x'.repeat(5000),
      '5. REVENUE RECOGNITION',
      'We recognize revenue when control of the promised good transfers to the customer.',
    ].join('\n');

    const passage = locateTopicPassage(text, revenueTopic);
    expect(passage.matchKind).toBe('heading');
    expect(passage.heading).toBe('5. REVENUE RECOGNITION');
  });

  it('prefers the policy note over a maturity table, despite the note number (Apple)', () => {
    // "Note 8 – Leases" (13 chars) lost to "Leases Total" (12 chars) because
    // heading specificity was scored on line length.
    const text = [
      'x'.repeat(5000),
      'Note 8 – Leases',
      'The Company has operating lease arrangements. Right-of-use assets are recognised for the lease term,',
      'measured using the incremental borrowing rate. Lease liability balances follow.',
      'z'.repeat(1200),
      'Leases Total',
      '2026 $ 1,967 $ 563 $ 2,530',
      '2027 1,988 73 2,061',
      '2028 1,848 51 1,899',
    ].join('\n');

    const passage = locateTopicPassage(text, leaseTopic);
    expect(passage.heading).toBe('Note 8 – Leases');
    expect(passage.text).toContain('operating lease');
  });
});

describe('resolveComparisonTarget (reported: picking Item 2 still compared Item 1A)', () => {
  const FALLBACK = 'Item 1A. Risk Factors';

  it('makes the chosen section the section that gets compared', () => {
    // The reported bug exactly: the control read "Item 2. Properties" while the
    // heading and both columns stayed on the default Item 1A.
    const resolved = resolveComparisonTarget('section:Item 2. Properties', FALLBACK);

    expect(resolved.section).toBe('Item 2. Properties');
    expect(resolved.label).toBe('Item 2. Properties');
    expect(resolved.topic).toBeUndefined();
  });

  it('labels a topic by its own name, not by the fallback section', () => {
    const resolved = resolveComparisonTarget('topic:revenue-recognition', FALLBACK);
    expect(resolved.topic?.id).toBe('revenue-recognition');
    expect(resolved.label).toBe(resolved.topic!.label);
    expect(resolved.label).not.toBe(FALLBACK);
  });

  it('never turns an unknown topic id into an unrelated Item comparison', () => {
    const resolved = resolveComparisonTarget('topic:not-a-real-topic', FALLBACK);
    expect(resolved.topic).toBeUndefined();
    expect(resolved.label).toBe(FALLBACK);
  });

  it('accepts a bare label, so older persisted values still resolve', () => {
    expect(resolveComparisonTarget('Item 7. Management Discussion', FALLBACK).section)
      .toBe('Item 7. Management Discussion');
  });

  it('falls back rather than comparing an empty section', () => {
    expect(resolveComparisonTarget('section:   ', FALLBACK).section).toBe(FALLBACK);
  });

  it('resolves every curated topic the dropdown can emit', () => {
    for (const topic of DISCLOSURE_TOPICS) {
      const resolved = resolveComparisonTarget(`topic:${topic.id}`, FALLBACK);
      expect(resolved.topic, `${topic.id} must resolve`).toBeDefined();
      expect(resolved.label).toBe(topic.label);
    }
  });
});

describe('heading matches are confirmed, not trusted (reported: MSFT showed income-statement numbers)', () => {
  const revenueTopic = findDisclosureTopic('revenue-recognition')!;

  it('does not return the income-statement line item titled "Revenue"', () => {
    // Reproduces the reported defect: a bare "Revenue" heading over a numeric
    // block was returned as the revenue recognition POLICY.
    const text = [
      'x'.repeat(5000),
      'Revenue',
      '$ 281,724 $ 245,122 $ 198,270',
      '$ 52,229 $ 46,078 $ 39,240',
      '$ 12,441 $ 10,887 $ 9,222',
      'x'.repeat(500),
      'Revenue Recognition',
      'Revenue is recognized when a performance obligation is satisfied by transferring control.',
      'The transaction price is allocated to each performance obligation using standalone selling price.',
    ].join('\n');

    const passage = locateTopicPassage(text, revenueTopic);
    expect(passage.text).toContain('performance obligation');
    expect(passage.text).not.toContain('281,724');
  });

  it('falls through to density when every heading is a numeric table', () => {
    const text = [
      'x'.repeat(5000),
      'Revenue Recognition',
      '$ 1,234 $ 5,678 $ 9,012 $ 3,456 $ 7,890 $ 2,345 $ 6,789 $ 1,111 $ 2,222 $ 3,333',
      'x'.repeat(400),
      'We recognize amounts when each performance obligation is satisfied and the transaction price',
      'has been allocated using standalone selling price for variable consideration.',
    ].join('\n');

    const passage = locateTopicPassage(text, revenueTopic);
    // Whatever route it takes, the passage must carry the POLICY language —
    // that is what the reader came for.
    expect(passage.text).toContain('performance obligation');
  });

  it('rejects a heading whose passage is purely numeric', () => {
    // A table with no policy prose anywhere near it must not be returned as a
    // confident heading match.
    const text = [
      'x'.repeat(5000),
      'Revenue Recognition',
      Array.from({ length: 60 }, (_, i) => `$ ${i}23,456 $ ${i}78,901`).join('\n'),
    ].join('\n');

    const passage = locateTopicPassage(text, revenueTopic);
    expect(passage.matchKind).not.toBe('heading');
  });
});
