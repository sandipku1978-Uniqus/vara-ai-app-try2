'use client';

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

const MIN_PANEL_WIDTH = 320;
const DEFAULT_PANEL_WIDTH = 520;
const MAX_VIEWPORT_RATIO = 0.8;
const KEYBOARD_RESIZE_STEP = 40;
const MOBILE_PANEL_BREAKPOINT = 768;

function clampPanelWidth(width: number): number {
  const maxWidth = Math.max(0, Math.min(window.innerWidth, Math.round(window.innerWidth * MAX_VIEWPORT_RATIO)));
  const minWidth = Math.min(MIN_PANEL_WIDTH, maxWidth);
  return Math.max(minWidth, Math.min(maxWidth, width));
}

export function useResizablePanel() {
  const [panelWidth, setPanelWidth] = useState<number | null>(null);
  const isResizing = useRef(false);
  const cleanupListenersRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    function handleViewportChange() {
      setPanelWidth(currentWidth => {
        if (currentWidth === null) return null;
        // Mobile uses the CSS full-viewport layout. Removing the inline width
        // lets that rule win after rotation or a desktop-to-mobile resize.
        if (window.innerWidth <= MOBILE_PANEL_BREAKPOINT) return null;
        return clampPanelWidth(currentWidth);
      });
    }

    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('orientationchange', handleViewportChange);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('orientationchange', handleViewportChange);
      cleanupListenersRef.current?.();
    };
  }, []);

  const handleResizeStart = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    cleanupListenersRef.current?.();
    isResizing.current = true;
    const startX = event.clientX;
    const startWidth = panelWidth || Math.min(window.innerWidth, DEFAULT_PANEL_WIDTH);

    function cleanup() {
      isResizing.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', cleanup);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      cleanupListenersRef.current = null;
    }

    function onMouseMove(moveEvent: globalThis.MouseEvent) {
      if (!isResizing.current) return;
      setPanelWidth(clampPanelWidth(startWidth + startX - moveEvent.clientX));
    }

    cleanupListenersRef.current = cleanup;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', cleanup);
  }, [panelWidth]);

  const handleResizeKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    const maxWidth = Math.round(window.innerWidth * MAX_VIEWPORT_RATIO);
    const currentWidth = panelWidth || Math.min(window.innerWidth, DEFAULT_PANEL_WIDTH);
    let nextWidth: number | null = null;

    if (event.key === 'ArrowLeft') nextWidth = currentWidth + KEYBOARD_RESIZE_STEP;
    else if (event.key === 'ArrowRight') nextWidth = currentWidth - KEYBOARD_RESIZE_STEP;
    else if (event.key === 'Home') nextWidth = maxWidth;
    else if (event.key === 'End') nextWidth = MIN_PANEL_WIDTH;

    if (nextWidth === null) return;
    event.preventDefault();
    setPanelWidth(clampPanelWidth(nextWidth));
  }, [panelWidth]);

  return { panelWidth, handleResizeStart, handleResizeKeyDown };
}
