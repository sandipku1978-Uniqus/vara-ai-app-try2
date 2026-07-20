import { describe, expect, it } from 'vitest';
import { IPO_FORM_SCOPE, canAnalyzeIpoFilingEvidence, runIpoAnalysisQueue, summarizeIpoFeed } from '../views/IPOCenter';

describe('IPO Center live feed contracts', () => {
  it('queries every form promised by the IPO feed', () => {
    expect(IPO_FORM_SCOPE.split(',')).toEqual(['S-1', 'S-1/A', 'F-1', 'F-1/A', '424B4']);
  });

  it('derives form, issuer, amendment, and monthly metrics from live rows', () => {
    const summary = summarizeIpoFeed([
      { company: 'Alpha', fileDate: '2026-06-01', formType: 'S-1', cik: '1', accessionNumber: 'a', primaryDocument: 'a.htm' },
      { company: 'Alpha', fileDate: '2026-06-10', formType: 'S-1/A', cik: '1', accessionNumber: 'b', primaryDocument: 'b.htm' },
      { company: 'Beta', fileDate: '2026-07-01', formType: 'F-1', cik: '2', accessionNumber: 'c', primaryDocument: 'c.htm' },
      { company: 'Beta', fileDate: '2026-07-12', formType: '424B4', cik: '2', accessionNumber: 'd', primaryDocument: 'd.htm' },
    ]);

    expect(summary.issuerCount).toBe(2);
    expect(summary.amendmentCount).toBe(1);
    expect(summary.formCounts).toEqual([['424B4', 1], ['F-1', 1], ['S-1', 1], ['S-1/A', 1]]);
    expect(summary.monthCounts).toEqual([['2026-06', 2], ['2026-07', 2]]);
  });

  it('never treats filing-load error copy as analyzable source evidence', () => {
    const errorCopy = 'Unable to retrieve filing text. '.repeat(8);

    expect(errorCopy.length).toBeGreaterThan(100);
    expect(canAnalyzeIpoFilingEvidence('', 'The SEC filing text request failed.')).toBe(false);
    expect(canAnalyzeIpoFilingEvidence(errorCopy, 'The SEC filing text request failed.')).toBe(false);
    expect(canAnalyzeIpoFilingEvidence('A'.repeat(500), '', true)).toBe(false);
    expect(canAnalyzeIpoFilingEvidence('A'.repeat(500))).toBe(true);
  });

  it('runs batch analysis sequentially and suppresses an overlapping batch', async () => {
    const guard = { current: false };
    const events: string[] = [];
    let active = 0;
    let maxActive = 0;
    let releaseFirst: (() => void) | undefined;
    const firstSectionBlocked = new Promise<void>(resolve => { releaseFirst = resolve; });

    const firstRun = runIpoAnalysisQueue(['overview', 'risk-factors', 'financials'], async sectionKey => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push(`start:${sectionKey}`);
      if (sectionKey === 'overview') await firstSectionBlocked;
      events.push(`finish:${sectionKey}`);
      active -= 1;
    }, guard);

    expect(guard.current).toBe(true);
    await expect(runIpoAnalysisQueue(['management'], async () => undefined, guard)).resolves.toBe(false);
    releaseFirst?.();
    await expect(firstRun).resolves.toBe(true);

    expect(maxActive).toBe(1);
    expect(events).toEqual([
      'start:overview',
      'finish:overview',
      'start:risk-factors',
      'finish:risk-factors',
      'start:financials',
      'finish:financials',
    ]);
    expect(guard.current).toBe(false);
  });

  it('continues the queue after an unexpected section failure', async () => {
    const guard = { current: false };
    const attempted: string[] = [];
    const failed: string[] = [];

    await runIpoAnalysisQueue(['overview', 'risk-factors'], async sectionKey => {
      attempted.push(sectionKey);
      if (sectionKey === 'overview') throw new Error('provider failure');
    }, guard, sectionKey => failed.push(sectionKey));

    expect(attempted).toEqual(['overview', 'risk-factors']);
    expect(failed).toEqual(['overview']);
  });
});
