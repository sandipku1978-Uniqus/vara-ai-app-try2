import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('memo PDF print window isolation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('opens a usable same-origin window and removes its opener before returning it', async () => {
    const mockWindow = {
      opener: window,
      close: vi.fn(),
    } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(mockWindow);
    const { createMemoPrintWindow } = await import('../services/docExport');

    expect(createMemoPrintWindow()).toBe(mockWindow);
    expect(window.open).toHaveBeenCalledWith('', '_blank');
    expect(mockWindow.opener).toBeNull();
    expect(mockWindow.close).not.toHaveBeenCalled();
  });

  it('closes and rejects a window when opener isolation cannot be verified', async () => {
    const close = vi.fn();
    const mockWindow = {
      get opener() { return window; },
      set opener(_value: Window | null) { /* simulate a browser ignoring the assignment */ },
      close,
    } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(mockWindow);
    const { createMemoPrintWindow } = await import('../services/docExport');

    expect(createMemoPrintWindow()).toBeNull();
    expect(close).toHaveBeenCalledOnce();
  });
});
