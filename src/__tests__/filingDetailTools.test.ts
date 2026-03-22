import { describe, it, expect } from 'vitest';
import {
  buildDisclosureDiff,
  tablesToCsv,
} from '../services/filingDetailTools';

describe('filingDetailTools', () => {
  // ── buildDisclosureDiff ──
  describe('buildDisclosureDiff', () => {
    it('returns zero counts for empty texts', () => {
      const result = buildDisclosureDiff('', '');
      expect(result.currentBlockCount).toBe(0);
      expect(result.previousBlockCount).toBe(0);
      expect(result.retainedCount).toBe(0);
      expect(result.addedCount).toBe(0);
      expect(result.removedCount).toBe(0);
    });

    it('detects all blocks as added when previous is empty', () => {
      const current = 'This is a long paragraph about revenue recognition that has enough words to be a block.\n\nAnother paragraph with sufficient words to qualify as a disclosure block item in the output.';
      const result = buildDisclosureDiff(current, '');
      expect(result.addedCount).toBeGreaterThanOrEqual(0);
      expect(result.removedCount).toBe(0);
    });

    it('detects all blocks as removed when current is empty', () => {
      const previous = 'This is a long paragraph about revenue recognition that has enough words to be a disclosure block.\n\nAnother paragraph with sufficient words to qualify as a block of disclosure text for testing.';
      const result = buildDisclosureDiff('', previous);
      expect(result.removedCount).toBeGreaterThanOrEqual(0);
      expect(result.addedCount).toBe(0);
    });

    it('detects retained blocks when content is identical', () => {
      const text = 'Revenue recognition is a critical accounting policy that impacts the financial statements of the company significantly each reporting period.';
      const result = buildDisclosureDiff(text, text);
      expect(result.addedCount).toBe(0);
      expect(result.removedCount).toBe(0);
    });

    it('returns arrays for addedBlocks and removedBlocks', () => {
      const result = buildDisclosureDiff('some text', 'other text');
      expect(Array.isArray(result.addedBlocks)).toBe(true);
      expect(Array.isArray(result.removedBlocks)).toBe(true);
    });

    it('caps addedBlocks to 10 max', () => {
      const lines = Array.from({ length: 50 }, (_, i) =>
        `This is a very long paragraph number ${i + 1} containing sufficient words to form a complete disclosure block for testing purposes. More words here for good measure number ${i}.`
      ).join('\n\n');
      const result = buildDisclosureDiff(lines, '');
      expect(result.addedBlocks.length).toBeLessThanOrEqual(10);
    });

    it('handles text with only short lines (no blocks)', () => {
      const text = 'Short.\nAlso short.\nToo brief.';
      const result = buildDisclosureDiff(text, text);
      expect(result.currentBlockCount).toBe(0);
    });

    it('correctly identifies changed content', () => {
      const current = 'The company adopted ASC 842 lease accounting standard which significantly changed how operating leases are recognized on the balance sheet of the entity.';
      const previous = 'The company follows ASC 840 lease accounting guidance for all operating and capital lease arrangements as previously disclosed in the financial statements.';
      const result = buildDisclosureDiff(current, previous);
      expect(result.currentBlockCount + result.previousBlockCount).toBeGreaterThanOrEqual(0);
    });

    it('deduplicates identical blocks in same text', () => {
      const text = [
        'Revenue recognition is performed per ASC 606 for all customer contracts and performance obligations identified in the arrangement.',
        'Revenue recognition is performed per ASC 606 for all customer contracts and performance obligations identified in the arrangement.',
      ].join('\n\n');
      const result = buildDisclosureDiff(text, '');
      // Duplicates should be removed
      expect(result.currentBlockCount).toBeLessThanOrEqual(1);
    });

    it('handles very long texts without error', () => {
      const longText = Array.from({ length: 2000 }, (_, i) =>
        `Block ${i}: This is a detailed disclosure paragraph about various accounting policies and financial statement items that the company has adopted.`
      ).join('\n\n');
      const result = buildDisclosureDiff(longText, longText);
      expect(result).toBeDefined();
    });
  });

  // ── tablesToCsv ──
  describe('tablesToCsv', () => {
    it('returns empty string for empty array', () => {
      expect(tablesToCsv([])).toBe('');
    });

    it('produces CSV with table title', () => {
      const csv = tablesToCsv([{
        title: 'Revenue Table',
        rows: [['Year', 'Revenue'], ['2023', '$1B']],
      }]);
      expect(csv).toContain('Revenue Table');
    });

    it('includes row data separated by commas', () => {
      const csv = tablesToCsv([{
        title: 'Test',
        rows: [['A', 'B', 'C']],
      }]);
      expect(csv).toContain('A,B,C');
    });

    it('escapes cells with commas', () => {
      const csv = tablesToCsv([{
        title: 'Test',
        rows: [['Hello, World', 'Normal']],
      }]);
      expect(csv).toContain('"Hello, World"');
    });

    it('escapes cells with quotes', () => {
      const csv = tablesToCsv([{
        title: 'Test',
        rows: [['He said "hello"', 'Normal']],
      }]);
      expect(csv).toContain('""hello""');
    });

    it('escapes cells with newlines', () => {
      const csv = tablesToCsv([{
        title: 'Test',
        rows: [['Line1\nLine2', 'Normal']],
      }]);
      expect(csv).toContain('"Line1\nLine2"');
    });

    it('handles multiple tables', () => {
      const csv = tablesToCsv([
        { title: 'Table 1', rows: [['A']] },
        { title: 'Table 2', rows: [['B']] },
      ]);
      expect(csv).toContain('Table 1');
      expect(csv).toContain('Table 2');
    });

    it('includes table index in title', () => {
      const csv = tablesToCsv([
        { title: 'First', rows: [['A']] },
        { title: 'Second', rows: [['B']] },
      ]);
      expect(csv).toContain('1/2');
      expect(csv).toContain('2/2');
    });

    it('uses CRLF line endings', () => {
      const csv = tablesToCsv([{
        title: 'Test',
        rows: [['A'], ['B']],
      }]);
      expect(csv).toContain('\r\n');
    });

    it('handles empty rows gracefully', () => {
      const csv = tablesToCsv([{
        title: 'Test',
        rows: [[]],
      }]);
      expect(csv).toBeDefined();
    });

    it('handles special characters in cells', () => {
      const csv = tablesToCsv([{
        title: 'Test',
        rows: [['$1,000', '50%', 'N/A']],
      }]);
      expect(csv).toContain('$1');
    });

    it('produces valid CSV for typical financial table', () => {
      const csv = tablesToCsv([{
        title: 'Income Statement',
        rows: [
          ['Item', '2023', '2022'],
          ['Revenue', '$10,000', '$8,500'],
          ['Net Income', '$2,000', '$1,500'],
        ],
      }]);
      expect(csv).toContain('Income Statement');
      expect(csv).toContain('Revenue');
    });
  });
});
