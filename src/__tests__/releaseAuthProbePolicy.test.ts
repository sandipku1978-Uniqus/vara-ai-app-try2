import { describe, expect, it } from 'vitest';
import {
  isExplicitReleaseGateDenial,
  RELEASE_GATE_DENIAL_STATUSES,
} from '../../scripts/accuracy/probe-auth';

describe('release credential negative probe policy', () => {
  it('accepts only explicit authentication denials', () => {
    expect([...RELEASE_GATE_DENIAL_STATUSES]).toEqual([401, 403, 404]);
    for (const status of [401, 403, 404]) expect(isExplicitReleaseGateDenial(status)).toBe(true);
  });

  it('does not mistake redirects, throttles, or server failures for scope rejection', () => {
    for (const status of [200, 204, 301, 302, 307, 308, 429, 500, 502, 503, 504]) {
      expect(isExplicitReleaseGateDenial(status), `HTTP ${status}`).toBe(false);
    }
  });
});
