import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../utils/markdownRenderer';

describe('markdownRenderer', () => {
  describe('renderMarkdown', () => {
    it('returns empty string for empty input', () => {
      expect(renderMarkdown('')).toBe('');
    });

    it('returns empty string for null/undefined-like', () => {
      expect(renderMarkdown(undefined as any)).toBe('');
    });

    it('renders bold text with **', () => {
      expect(renderMarkdown('**bold**')).toContain('<strong>bold</strong>');
    });

    it('renders italic text with *', () => {
      expect(renderMarkdown('*italic*')).toContain('<em>italic</em>');
    });

    it('renders bold+italic with ***', () => {
      const result = renderMarkdown('***bolditalic***');
      expect(result).toContain('<strong><em>bolditalic</em></strong>');
    });

    it('renders inline code with backticks', () => {
      expect(renderMarkdown('use `console.log`')).toContain('<code class="md-inline-code">console.log</code>');
    });

    it('renders code blocks with triple backticks', () => {
      const md = '```js\nconst x = 1;\n```';
      expect(renderMarkdown(md)).toContain('<pre class="md-code-block">');
    });

    it('renders h2 from # heading', () => {
      expect(renderMarkdown('# Heading')).toContain('<h2 class="md-h2">Heading</h2>');
    });

    it('renders h3 from ## heading', () => {
      expect(renderMarkdown('## Subheading')).toContain('<h3 class="md-h3">Subheading</h3>');
    });

    it('renders h4 from ### heading', () => {
      expect(renderMarkdown('### Detail')).toContain('<h4 class="md-h4">Detail</h4>');
    });

    it('renders unordered list items with -', () => {
      expect(renderMarkdown('- Item one')).toContain('<li>Item one</li>');
    });

    it('renders unordered list items with bullet', () => {
      expect(renderMarkdown('• Bullet item')).toContain('<li>Bullet item</li>');
    });

    it('renders numbered list items', () => {
      expect(renderMarkdown('1. First\n2. Second')).toContain('<li>First</li>');
      expect(renderMarkdown('1. First\n2. Second')).toContain('<li>Second</li>');
    });

    it('wraps list items in <ul>', () => {
      expect(renderMarkdown('- A\n- B')).toContain('<ul class="md-list">');
    });

    it('renders horizontal rule', () => {
      expect(renderMarkdown('---')).toContain('<hr class="md-hr" />');
    });

    it('wraps non-block text in paragraphs', () => {
      expect(renderMarkdown('Hello world')).toContain('<p>Hello world</p>');
    });

    it('does not double-wrap headings in <p>', () => {
      const result = renderMarkdown('# Title');
      expect(result).not.toContain('<p><h');
    });

    it('escapes HTML entities', () => {
      const result = renderMarkdown('<script>alert("xss")</script>');
      expect(result).toContain('&lt;script&gt;');
      expect(result).not.toContain('<script>');
    });

    it('handles multiple paragraphs', () => {
      const result = renderMarkdown('Para one\n\nPara two');
      expect(result).toContain('<p>Para one</p>');
      expect(result).toContain('<p>Para two</p>');
    });

    it('converts single newlines to <br/> within paragraphs', () => {
      const result = renderMarkdown('Line one\nLine two');
      expect(result).toContain('<br/>');
    });

    it('handles text with mixed formatting', () => {
      const md = '**Bold** and *italic* with `code`';
      const result = renderMarkdown(md);
      expect(result).toContain('<strong>Bold</strong>');
      expect(result).toContain('<em>italic</em>');
      expect(result).toContain('<code');
    });
  });
});
