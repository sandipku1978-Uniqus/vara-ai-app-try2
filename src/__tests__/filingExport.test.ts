import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('filingExport', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('createPrintWindow', () => {
    it('returns null when window.open returns null', async () => {
      vi.spyOn(window, 'open').mockReturnValue(null);
      const { createPrintWindow } = await import('../services/filingExport');
      const result = createPrintWindow('Test Filing');
      expect(result).toBeNull();
    });

    it('returns a window object when popup succeeds', async () => {
      const mockWindow = {
        document: {
          write: vi.fn(),
          close: vi.fn(),
        },
      } as any;
      vi.spyOn(window, 'open').mockReturnValue(mockWindow);
      const { createPrintWindow } = await import('../services/filingExport');
      const result = createPrintWindow('Test Filing');
      expect(result).toBe(mockWindow);
    });

    it('writes loading shell HTML to the new window', async () => {
      const mockWindow = {
        document: {
          write: vi.fn(),
          close: vi.fn(),
        },
      } as any;
      vi.spyOn(window, 'open').mockReturnValue(mockWindow);
      const { createPrintWindow } = await import('../services/filingExport');
      createPrintWindow('Apple 10-K');
      expect(mockWindow.document.write).toHaveBeenCalled();
      const html = mockWindow.document.write.mock.calls[0][0];
      expect(html).toContain('Apple 10-K');
    });
  });

  describe('openCleanPrintView', () => {
    it('returns false when popup is blocked', async () => {
      vi.spyOn(window, 'open').mockReturnValue(null);
      const { openCleanPrintView } = await import('../services/filingExport');
      const result = openCleanPrintView('Title', '<p>content</p>', 'https://sec.gov/filing');
      expect(result).toBe(false);
    });

    it('returns true when popup succeeds', async () => {
      const mockWindow = {
        document: {
          write: vi.fn(),
          close: vi.fn(),
          open: vi.fn(),
        },
        focus: vi.fn(),
        print: vi.fn(),
      } as any;
      vi.spyOn(window, 'open').mockReturnValue(mockWindow);
      const { openCleanPrintView } = await import('../services/filingExport');
      const result = openCleanPrintView('Title', '<p>Hello</p>', 'https://sec.gov/filing');
      expect(result).toBe(true);
    });
  });

  describe('renderCleanPrintView', () => {
    it('writes sanitized HTML to print window', async () => {
      const mockWindow = {
        document: {
          write: vi.fn(),
          close: vi.fn(),
          open: vi.fn(),
        },
        focus: vi.fn(),
        print: vi.fn(),
      } as any;
      const { renderCleanPrintView } = await import('../services/filingExport');
      renderCleanPrintView(mockWindow, 'Test', '<p>Content</p>', 'https://sec.gov');
      expect(mockWindow.document.write).toHaveBeenCalled();
      const html = mockWindow.document.write.mock.calls[0][0];
      expect(html).toContain('Content');
    });

    it('escapes HTML in title', async () => {
      const mockWindow = {
        document: {
          write: vi.fn(),
          close: vi.fn(),
          open: vi.fn(),
        },
        focus: vi.fn(),
        print: vi.fn(),
      } as any;
      const { renderCleanPrintView } = await import('../services/filingExport');
      renderCleanPrintView(mockWindow, '<script>alert("xss")</script>', '<p>OK</p>', 'https://sec.gov');
      const html = mockWindow.document.write.mock.calls[0][0];
      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;script&gt;');
    });

    it('removes script tags from content', async () => {
      const mockWindow = {
        document: {
          write: vi.fn(),
          close: vi.fn(),
          open: vi.fn(),
        },
        focus: vi.fn(),
        print: vi.fn(),
      } as any;
      const { renderCleanPrintView } = await import('../services/filingExport');
      renderCleanPrintView(
        mockWindow,
        'Test',
        '<p>Good</p><script>evil()</script><p>Also good</p>',
        'https://sec.gov'
      );
      const html = mockWindow.document.write.mock.calls[0][0];
      expect(html).toContain('Good');
      expect(html).not.toContain('evil()');
    });

    it('removes style tags from content', async () => {
      const mockWindow = {
        document: {
          write: vi.fn(),
          close: vi.fn(),
          open: vi.fn(),
        },
        focus: vi.fn(),
        print: vi.fn(),
      } as any;
      const { renderCleanPrintView } = await import('../services/filingExport');
      renderCleanPrintView(
        mockWindow,
        'Test',
        '<style>body{color:red}</style><p>Content</p>',
        'https://sec.gov'
      );
      const html = mockWindow.document.write.mock.calls[0][0];
      expect(html).toContain('Content');
    });

    it('includes source URL in print view', async () => {
      const mockWindow = {
        document: {
          write: vi.fn(),
          close: vi.fn(),
          open: vi.fn(),
        },
        focus: vi.fn(),
        print: vi.fn(),
      } as any;
      const { renderCleanPrintView } = await import('../services/filingExport');
      renderCleanPrintView(mockWindow, 'Test', '<p>OK</p>', 'https://sec.gov/filing/123');
      const html = mockWindow.document.write.mock.calls[0][0];
      expect(html).toContain('https://sec.gov/filing/123');
    });

    it('removes inline styles from content elements', async () => {
      const mockWindow = {
        document: {
          write: vi.fn(),
          close: vi.fn(),
          open: vi.fn(),
        },
        focus: vi.fn(),
        print: vi.fn(),
      } as any;
      const { renderCleanPrintView } = await import('../services/filingExport');
      renderCleanPrintView(
        mockWindow,
        'Test',
        '<p style="color:red">Content</p>',
        'https://sec.gov'
      );
      const html = mockWindow.document.write.mock.calls[0][0];
      expect(html).toContain('Content');
    });

    it('removes iframes from content', async () => {
      const mockWindow = {
        document: {
          write: vi.fn(),
          close: vi.fn(),
          open: vi.fn(),
        },
        focus: vi.fn(),
        print: vi.fn(),
      } as any;
      const { renderCleanPrintView } = await import('../services/filingExport');
      renderCleanPrintView(
        mockWindow,
        'Test',
        '<iframe src="https://evil.com"></iframe><p>OK</p>',
        'https://sec.gov'
      );
      const html = mockWindow.document.write.mock.calls[0][0];
      expect(html).not.toContain('iframe');
    });

    it('removes form elements from content', async () => {
      const mockWindow = {
        document: {
          write: vi.fn(),
          close: vi.fn(),
          open: vi.fn(),
        },
        focus: vi.fn(),
        print: vi.fn(),
      } as any;
      const { renderCleanPrintView } = await import('../services/filingExport');
      renderCleanPrintView(
        mockWindow,
        'Test',
        '<form action="/hack"><input type="text"></form><p>OK</p>',
        'https://sec.gov'
      );
      const html = mockWindow.document.write.mock.calls[0][0];
      expect(html).not.toContain('<form');
    });
  });
});
