import { describe, it, expect } from 'vitest';
import { computeSectionChange } from '../utils/sectionDiff';

/**
 * Benchmark C3: change classification must be deterministic and explainable —
 * a bucket is a token-change ratio with named thresholds, or an
 * appeared/vanished fact. Never a vibe.
 */

const BASE = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');

function replaceWords(text: string, count: number): string {
  const words = text.split(' ');
  for (let i = 0; i < count; i += 1) words[i] = `changed${i}`;
  return words.join(' ');
}

describe('computeSectionChange', () => {
  it('identical sections are unchanged, with zero counted tokens', () => {
    const change = computeSectionChange(BASE, BASE);
    expect(change.bucket).toBe('unchanged');
    expect(change.addedTokens).toBe(0);
    expect(change.removedTokens).toBe(0);
  });

  it('case and punctuation differences alone do not count as change', () => {
    // Measurement runs on engine-normalized text, same as search matching.
    expect(computeSectionChange('Risk Factors: supply-chain risk.', 'risk factors supply chain risk').bucket).toBe('unchanged');
  });

  it('buckets scale with the fraction of tokens replaced', () => {
    expect(computeSectionChange(BASE, replaceWords(BASE, 4)).bucket).toBe('minor');      // 8% churn
    expect(computeSectionChange(BASE, replaceWords(BASE, 10)).bucket).toBe('moderate');  // 20% churn
    expect(computeSectionChange(BASE, replaceWords(BASE, 30)).bucket).toBe('major');     // 60% churn
  });

  it('appearance and disappearance are their own facts, not ratios', () => {
    expect(computeSectionChange('', BASE)).toMatchObject({ bucket: 'new', priorTokens: 0, currentTokens: 100 });
    expect(computeSectionChange(BASE, '')).toMatchObject({ bucket: 'deleted', removedTokens: 100 });
    expect(computeSectionChange('', '')).toMatchObject({ bucket: 'unchanged', changedRatio: 0 });
  });

  it('pure growth is measured against the larger period', () => {
    const grown = `${BASE} ${Array.from({ length: 50 }, (_, i) => `extra${i}`).join(' ')}`;
    const change = computeSectionChange(BASE, grown);
    expect(change.addedTokens).toBe(50);
    expect(change.removedTokens).toBe(0);
    // Symmetric churn: 50 added over 250 combined tokens = 20%. The ratio can
    // never exceed 100% — a complete rewrite is 100%, not 200%.
    expect(change.changedRatio).toBeCloseTo(50 / 250, 5);
    expect(change.bucket).toBe('moderate');
  });

  it('a complete rewrite caps at exactly 100%', () => {
    const other = Array.from({ length: 80 }, (_, i) => `different${i}`).join(' ');
    const change = computeSectionChange(BASE, other);
    expect(change.changedRatio).toBe(1);
    expect(change.bucket).toBe('major');
  });

  it('handles realistic section sizes without blowing up', () => {
    const big = Array.from({ length: 12_000 }, (_, i) => `token${i % 900}`).join(' ');
    const edited = big.replace(/token7 /g, 'revised7 ');
    const started = Date.now();
    const change = computeSectionChange(big, edited);
    expect(Date.now() - started).toBeLessThan(2_000);
    // ~13 tokens of 12,000 — detected precisely, and correctly below the
    // 2% minor threshold.
    expect(change.addedTokens).toBeGreaterThan(0);
    expect(change.bucket).toBe('unchanged');
  });
});
