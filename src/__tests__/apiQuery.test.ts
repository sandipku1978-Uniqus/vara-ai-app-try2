import { describe, expect, it } from 'vitest';

import { isValidIsoDate, parseBoundedInteger, parseCik } from '../lib/api-query';

describe('API query primitives', () => {
  it('accepts only bounded whole-number pagination values', () => {
    expect(parseBoundedInteger(null, 20, 1, 100)).toBe(20);
    expect(parseBoundedInteger('100', 20, 1, 100)).toBe(100);
    for (const value of ['1.5', '-1', '101', 'Infinity', '1e2']) {
      expect(parseBoundedInteger(value, 20, 1, 100), value).toBeNull();
    }
  });

  it('accepts real ISO calendar dates only', () => {
    expect(isValidIsoDate('2024-02-29')).toBe(true);
    expect(isValidIsoDate('2023-02-29')).toBe(false);
    expect(isValidIsoDate('2026-13-01')).toBe(false);
  });

  it('accepts positive 1-to-10 digit CIKs only', () => {
    expect(parseCik('0000320193')).toBe(320193);
    for (const value of ['', '0', '-1', '1.5', '12345678901', '32O193']) {
      expect(parseCik(value), value).toBeNull();
    }
  });
});
