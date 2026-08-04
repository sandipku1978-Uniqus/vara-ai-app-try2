import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useResizablePanel } from '../components/useResizablePanel';

describe('useResizablePanel', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1000 });
  });

  it('supports bounded keyboard resizing', () => {
    const { result } = renderHook(() => useResizablePanel());
    const preventDefault = vi.fn();

    act(() => result.current.handleResizeKeyDown({ key: 'ArrowLeft', preventDefault } as never));
    expect(result.current.panelWidth).toBe(560);
    act(() => result.current.handleResizeKeyDown({ key: 'Home', preventDefault } as never));
    expect(result.current.panelWidth).toBe(800);
    act(() => result.current.handleResizeKeyDown({ key: 'End', preventDefault } as never));
    expect(result.current.panelWidth).toBe(320);
    expect(preventDefault).toHaveBeenCalledTimes(3);
  });

  it('tracks mouse movement and restores document styles when dragging ends', () => {
    const { result } = renderHook(() => useResizablePanel());

    act(() => result.current.handleResizeStart({ clientX: 800, preventDefault: vi.fn() } as never));
    expect(document.body.style.cursor).toBe('col-resize');
    act(() => document.dispatchEvent(new MouseEvent('mousemove', { clientX: 700 })));
    expect(result.current.panelWidth).toBe(620);
    act(() => document.dispatchEvent(new MouseEvent('mouseup')));
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });

  it('reclamps a stored desktop width when the viewport narrows', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    const { result } = renderHook(() => useResizablePanel());
    const preventDefault = vi.fn();

    act(() => result.current.handleResizeKeyDown({ key: 'Home', preventDefault } as never));
    expect(result.current.panelWidth).toBe(960);

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 900 });
    act(() => window.dispatchEvent(new Event('resize')));
    expect(result.current.panelWidth).toBe(720);
  });

  it('removes the inline width on mobile resize and orientation changes', () => {
    const { result } = renderHook(() => useResizablePanel());
    const preventDefault = vi.fn();

    act(() => result.current.handleResizeKeyDown({ key: 'Home', preventDefault } as never));
    expect(result.current.panelWidth).toBe(800);

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    act(() => window.dispatchEvent(new Event('orientationchange')));
    expect(result.current.panelWidth).toBeNull();
  });
});
