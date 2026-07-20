import { describe, expect, it } from 'vitest';
import { selectFilingText } from '../utils/filingTextSelection';

describe('selectFilingText', () => {
  it('returns short filings without sampling', () => {
    const result = selectFilingText('complete filing text', ['filing']);
    expect(result.complete).toBe(true);
    expect(result.text).toBe('complete filing text');
  });

  it('selects relevant evidence near the end of a long filing', () => {
    const source = `${'opening '.repeat(12_000)}USE OF PROCEEDS: repay debt and fund working capital.${' tail'.repeat(2_000)}`;
    const result = selectFilingText(source, ['use of proceeds'], 12_000);
    expect(result.complete).toBe(false);
    expect(result.text).toContain('USE OF PROCEEDS: repay debt');
    expect(result.text).toContain('source characters');
    expect(result.text.length).toBeLessThanOrEqual(12_000);
  });

  it('samples the full document when no keyword is present', () => {
    const source = Array.from({ length: 80_000 }, (_, index) => String(index % 10)).join('');
    const result = selectFilingText(source, ['not present'], 10_000);
    expect(result.text).toContain('intervening filing text omitted');
    expect(result.selectedLength).toBeGreaterThan(7_000);
  });
});
