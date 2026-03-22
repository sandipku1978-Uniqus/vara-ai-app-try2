import { beforeEach } from 'vitest';
import '@testing-library/jest-dom';

// Mock import.meta.env
Object.defineProperty(import.meta, 'env', {
  value: {
    DEV: true,
    VITE_EDGAR_USER_AGENT: 'Test App test@test.com',
    VITE_CLERK_PUBLISHABLE_KEY: '',
  },
  writable: true,
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

// Clean storage between tests
beforeEach(() => {
  localStorageMock.clear();
  sessionStorageMock.clear();
});
