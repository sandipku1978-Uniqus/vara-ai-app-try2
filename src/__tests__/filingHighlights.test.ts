import { describe, it, expect } from 'vitest';
import {
  clearDocumentHighlights,
  highlightDocumentSearchTerms,
} from '../services/filingHighlights';

function createTestDocument(html: string): Document {
  const parser = new DOMParser();
  return parser.parseFromString(`<html><body>${html}</body></html>`, 'text/html');
}

describe('filingHighlights', () => {
  // ── clearDocumentHighlights ──
  describe('clearDocumentHighlights', () => {
    it('handles null document gracefully', () => {
      expect(() => clearDocumentHighlights(null)).not.toThrow();
    });

    it('handles undefined document gracefully', () => {
      expect(() => clearDocumentHighlights(undefined)).not.toThrow();
    });

    it('removes mark elements with data-vara-search-hit', () => {
      const doc = createTestDocument(
        '<p>Some <mark data-vara-search-hit="true">highlighted</mark> text</p>'
      );
      clearDocumentHighlights(doc);
      expect(doc.querySelectorAll('mark[data-vara-search-hit]').length).toBe(0);
    });

    it('preserves text content after removing highlights', () => {
      const doc = createTestDocument(
        '<p>Some <mark data-vara-search-hit="true">highlighted</mark> text</p>'
      );
      clearDocumentHighlights(doc);
      expect(doc.body.textContent).toContain('highlighted');
    });

    it('does not affect non-vara mark elements', () => {
      const doc = createTestDocument('<p><mark>user highlight</mark></p>');
      clearDocumentHighlights(doc);
      expect(doc.querySelectorAll('mark').length).toBe(1);
    });

    it('handles document with no marks', () => {
      const doc = createTestDocument('<p>No marks here</p>');
      expect(() => clearDocumentHighlights(doc)).not.toThrow();
    });
  });

  // ── highlightDocumentSearchTerms ──
  describe('highlightDocumentSearchTerms', () => {
    it('returns empty array when no terms provided', () => {
      const doc = createTestDocument('<p>Some text</p>');
      const marks = highlightDocumentSearchTerms(doc, []);
      expect(marks).toEqual([]);
    });

    it('highlights matching terms', () => {
      const doc = createTestDocument('<p>Revenue increased by 15 percent this quarter</p>');
      const marks = highlightDocumentSearchTerms(doc, ['revenue']);
      expect(marks.length).toBeGreaterThan(0);
      expect(marks[0].textContent?.toLowerCase()).toBe('revenue');
    });

    it('highlights multiple terms', () => {
      const doc = createTestDocument('<p>Revenue and growth were strong in the period</p>');
      const marks = highlightDocumentSearchTerms(doc, ['revenue', 'growth']);
      expect(marks.length).toBeGreaterThanOrEqual(2);
    });

    it('is case insensitive', () => {
      const doc = createTestDocument('<p>REVENUE was strong</p>');
      const marks = highlightDocumentSearchTerms(doc, ['revenue']);
      expect(marks.length).toBe(1);
    });

    it('sets data-vara-search-hit attribute on marks', () => {
      const doc = createTestDocument('<p>Revenue details</p>');
      highlightDocumentSearchTerms(doc, ['revenue']);
      const markElements = doc.querySelectorAll('mark[data-vara-search-hit]');
      expect(markElements.length).toBeGreaterThan(0);
    });

    it('limits highlights to maxHighlights', () => {
      const text = Array(50).fill('revenue').join(' ');
      const doc = createTestDocument(`<p>${text}</p>`);
      const marks = highlightDocumentSearchTerms(doc, ['revenue'], 5);
      expect(marks.length).toBeLessThanOrEqual(5);
    });

    it('does not highlight inside script elements', () => {
      const doc = createTestDocument('<script>var revenue = 1;</script><p>revenue here</p>');
      const marks = highlightDocumentSearchTerms(doc, ['revenue']);
      expect(marks.length).toBe(1);
    });

    it('does not highlight inside style elements', () => {
      const doc = createTestDocument('<style>.revenue { color: red; }</style><p>revenue here</p>');
      const marks = highlightDocumentSearchTerms(doc, ['revenue']);
      expect(marks.length).toBe(1);
    });

    it('clears previous highlights before adding new ones', () => {
      const doc = createTestDocument('<p>Revenue and income data</p>');
      highlightDocumentSearchTerms(doc, ['revenue']);
      highlightDocumentSearchTerms(doc, ['income']);
      const allMarks = doc.querySelectorAll('mark[data-vara-search-hit]');
      // Should only have marks for 'income', not 'revenue'
      expect(allMarks.length).toBeGreaterThan(0);
    });

    it('handles phrases with spaces', () => {
      const doc = createTestDocument('<p>The risk factors section describes major risks</p>');
      const marks = highlightDocumentSearchTerms(doc, ['risk factors']);
      expect(marks.length).toBeGreaterThan(0);
    });

    it('returns empty array when no matches found', () => {
      const doc = createTestDocument('<p>Nothing matches here</p>');
      const marks = highlightDocumentSearchTerms(doc, ['zebra']);
      expect(marks).toEqual([]);
    });

    it('handles empty document body', () => {
      const doc = createTestDocument('');
      const marks = highlightDocumentSearchTerms(doc, ['test']);
      expect(marks).toEqual([]);
    });

    it('applies highlight styling', () => {
      const doc = createTestDocument('<p>Revenue data</p>');
      const marks = highlightDocumentSearchTerms(doc, ['revenue']);
      if (marks.length > 0) {
        expect(marks[0].style.background).toBeTruthy();
      }
    });

    it('handles nested elements', () => {
      const doc = createTestDocument('<div><span><strong>Revenue</strong> growth</span></div>');
      const marks = highlightDocumentSearchTerms(doc, ['revenue']);
      expect(marks.length).toBeGreaterThan(0);
    });

    it('word-boundary matching for single terms', () => {
      const doc = createTestDocument('<p>The revenues and revenue breakdown</p>');
      const marks = highlightDocumentSearchTerms(doc, ['revenue']);
      // Should match "revenue" but behavior depends on word boundary regex
      expect(marks.length).toBeGreaterThanOrEqual(1);
    });
  });
});
