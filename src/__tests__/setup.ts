import { beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom';

vi.mock('@clerk/nextjs', async importOriginal => {
  const actual = await importOriginal<typeof import('@clerk/nextjs')>();
  return {
    ...actual,
    useAuth: () => (
      globalThis as typeof globalThis & {
        __urcTestAuth?: { isLoaded: boolean; userId: string | null; orgId: string | null };
      }
    ).__urcTestAuth || { isLoaded: true, userId: 'user_test', orgId: null },
  };
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

Object.defineProperty(window, 'localStorage', { value: localStorageMock });

// Mock sessionStorage
const sessionStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();

Object.defineProperty(window, 'sessionStorage', { value: sessionStorageMock });

// Mock matchMedia — jsdom doesn't implement it; AppState reads it for theme mode
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Clean storage between tests
beforeEach(() => {
  localStorageMock.clear();
  sessionStorageMock.clear();
  (
    globalThis as typeof globalThis & {
      __urcTestAuth?: { isLoaded: boolean; userId: string | null; orgId: string | null };
    }
  ).__urcTestAuth = { isLoaded: true, userId: 'user_test', orgId: null };
});
