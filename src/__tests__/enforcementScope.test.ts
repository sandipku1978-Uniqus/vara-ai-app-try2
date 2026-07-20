import { describe, expect, it } from 'vitest';
import {
  ENFORCEMENT_LANDING_CAPABILITY,
  ENFORCEMENT_SCOPE_DESCRIPTION,
  ENFORCEMENT_SCOPE_LABEL,
  ENFORCEMENT_SCOPE_LIMITATION,
} from '../config/enforcement';
import { PRODUCT_ROUTES } from '../config/routes';

describe('enforcement source scope', () => {
  it('labels the implemented corpus as SEC litigation releases and civil actions', () => {
    expect(ENFORCEMENT_SCOPE_LABEL).toBe('SEC Litigation Releases');
    expect(ENFORCEMENT_SCOPE_DESCRIPTION).toContain('litigation releases');
    expect(ENFORCEMENT_SCOPE_DESCRIPTION).toContain('civil actions');
    expect(ENFORCEMENT_SCOPE_LIMITATION).toContain('does not include administrative proceedings or trading suspensions');
  });

  it('keeps the shared route registry within the implemented corpus', () => {
    const route = PRODUCT_ROUTES.find(item => item.path === '/enforcement');
    expect(route).toMatchObject({
      label: 'SEC Litigation Releases',
      keywords: 'litigation releases civil actions',
    });
    expect(route?.keywords).not.toMatch(/aaer|penalt/i);
  });

  it('uses litigation-release scope in landing-page capability copy', () => {
    expect(ENFORCEMENT_LANDING_CAPABILITY).toBe('SEC litigation releases and civil-action tracking');
    expect(ENFORCEMENT_LANDING_CAPABILITY).not.toMatch(/^SEC enforcement tracking$/i);
  });
});
