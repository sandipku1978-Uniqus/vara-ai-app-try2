import { describe, expect, it } from 'vitest';
import { sanitizeSearchReturnTo } from '../lib/internalNavigation';

describe('sanitizeSearchReturnTo', () => {
  it.each([
    '/search',
    '/search?q=materiality',
    '/search?tab=session-1#result-3',
    '/search#saved-results',
  ])('preserves a valid first-party search destination: %s', destination => {
    expect(sanitizeSearchReturnTo(destination)).toBe(destination);
  });

  it.each([
    '//evil.example',
    '/\\evil.example',
    '/search\\@evil.example',
    '/search/../dashboard',
    '/searching?next=/search',
    '%2F%2Fevil.example',
    '%2F%5Cevil.example',
    '%252F%252Fevil.example',
    '/%5Cevil.example',
  ])('rejects a non-search or ambiguous destination: %s', destination => {
    expect(sanitizeSearchReturnTo(destination)).toBe('');
  });
});
