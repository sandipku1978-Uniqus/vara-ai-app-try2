import { describe, expect, it } from 'vitest';
import { buildWaveExecutionPolicy } from '../services/filingResearchExecution';

describe('buildWaveExecutionPolicy', () => {
  it('preserves the retry-inclusive production ceilings', () => {
    const policy = buildWaveExecutionPolicy(false, 2);

    expect(policy).toMatchObject({
      maxPageRequests: 60,
      maxDocAttempts: 120,
      maxDocHttpAttempts: 180,
      maxPrescreenRequests: 24,
      batchSize: 4,
      maxWaveTimeMs: 45_000,
    });
  });

  it('widens only the page ceiling for an EFTS-delegated phrase', () => {
    const standard = buildWaveExecutionPolicy(false, 1);
    const delegated = buildWaveExecutionPolicy(true, 1);

    expect(delegated.maxPageRequests).toBe(240);
    expect(delegated.maxDocAttempts).toBe(standard.maxDocAttempts);
    expect(delegated.maxDocHttpAttempts).toBe(standard.maxDocHttpAttempts);
  });

  it('reserves a fair document share for every required branch', () => {
    expect(buildWaveExecutionPolicy(false, 1).docReservePerBranch).toBe(24);
    expect(buildWaveExecutionPolicy(false, 10).docReservePerBranch).toBe(12);
    expect(buildWaveExecutionPolicy(false, 0).docReservePerBranch).toBe(24);
  });
});
