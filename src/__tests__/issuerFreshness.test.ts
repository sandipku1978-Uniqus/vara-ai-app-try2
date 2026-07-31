import { describe, it, expect } from 'vitest';
import { buildIssuerFreshnessNotice } from '../services/issuerFreshness';
import type { SecSubmission } from '../services/secApi';

/**
 * The freshness notice exists to explain a real difference between the live
 * submissions feed and the research-scoped results — never to manufacture
 * one. Observed live: Alphabet's dashboard row said Form 4 2026-07-30 while
 * the workbench's newest hit was the 7/23 10-Q, and it read as a data bug.
 */

function submission(forms: Array<[string, string]>): SecSubmission {
  return {
    filings: {
      recent: {
        form: forms.map(([form]) => form),
        filingDate: forms.map(([, date]) => date),
      },
    },
  } as unknown as SecSubmission;
}

describe('buildIssuerFreshnessNotice', () => {
  it('explains a newer ownership filing and points to Insider Trading', () => {
    const notice = buildIssuerFreshnessNotice(
      submission([['4', '2026-07-30'], ['144', '2026-07-30'], ['10-Q', '2026-07-23']]),
      '2026-07-23',
      'Alphabet Inc.'
    );
    expect(notice).not.toBeNull();
    expect(notice!.insider).toBe(true);
    expect(notice!.message).toContain('Form 4 (Insider transaction report)');
    expect(notice!.message).toContain('2026-07-30');
    expect(notice!.message).toContain('Alphabet Inc.');
    expect(notice!.message).toContain('Insider Trading');
  });

  it('suggests filter changes for a newer non-ownership filing', () => {
    const notice = buildIssuerFreshnessNotice(
      submission([['S-8', '2026-07-29'], ['10-Q', '2026-07-23']]),
      '2026-07-23',
      'ExampleCo'
    );
    expect(notice).not.toBeNull();
    expect(notice!.insider).toBe(false);
    expect(notice!.message).toContain('Adjust Form Types or date filters');
  });

  it('stays silent when the newest shown result IS the newest filing', () => {
    expect(
      buildIssuerFreshnessNotice(submission([['10-Q', '2026-07-23']]), '2026-07-23', 'ExampleCo')
    ).toBeNull();
    expect(
      buildIssuerFreshnessNotice(submission([['10-Q', '2026-07-23']]), '2026-07-30', 'ExampleCo')
    ).toBeNull();
  });

  it('stays silent on missing data — it explains differences, never invents them', () => {
    expect(buildIssuerFreshnessNotice(null, '2026-07-23', 'X')).toBeNull();
    expect(buildIssuerFreshnessNotice(submission([]), '2026-07-23', 'X')).toBeNull();
    expect(buildIssuerFreshnessNotice(submission([['4', '2026-07-30']]), '', 'X')).toBeNull();
  });
});
