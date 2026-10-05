import { describe, expect, it } from 'vitest';
import {
  ENFORCEMENT_LANDING_CAPABILITY,
  ENFORCEMENT_ROUTE_DESCRIPTION,
  ENFORCEMENT_ROUTE_LABEL,
  ENFORCEMENT_ROUTE_LIMITATION,
  ENFORCEMENT_ROUTE_LOADING_LABEL,
  ENFORCEMENT_SCOPE_DESCRIPTION,
  ENFORCEMENT_SCOPE_LABEL,
  ENFORCEMENT_SCOPE_LIMITATION,
} from '../config/enforcement';
import { PRODUCT_ROUTES } from '../config/routes';

describe('enforcement source scope', () => {
  it('labels the litigation tab as SEC litigation releases and civil actions', () => {
    expect(ENFORCEMENT_SCOPE_LABEL).toBe('SEC Litigation Releases');
    expect(ENFORCEMENT_SCOPE_DESCRIPTION).toContain('litigation releases');
    expect(ENFORCEMENT_SCOPE_DESCRIPTION).toContain('civil actions');
    expect(ENFORCEMENT_SCOPE_LIMITATION).toContain('does not include administrative proceedings or trading suspensions');
  });

  it('names both implemented indexes at route level: litigation releases and AAERs', () => {
    const route = PRODUCT_ROUTES.find(item => item.path === '/enforcement');
    expect(route).toMatchObject({ label: 'SEC Litigation Releases & AAERs' });
    expect(ENFORCEMENT_ROUTE_LABEL).toBe('SEC Litigation Releases & AAERs');
    expect(route?.keywords).toMatch(/litigation releases/);
    expect(route?.keywords).toMatch(/civil actions/);
    expect(route?.keywords).toMatch(/\baaer\b/);
    expect(route?.keywords).toMatch(/accounting and auditing enforcement releases/);
    // Neither index is a penalties database.
    expect(route?.keywords).not.toMatch(/penalt/i);
    expect(ENFORCEMENT_ROUTE_DESCRIPTION).toContain('litigation releases');
    expect(ENFORCEMENT_ROUTE_DESCRIPTION).toContain('Accounting and Auditing Enforcement Releases (AAERs)');
    expect(ENFORCEMENT_ROUTE_LOADING_LABEL).toBe('Loading SEC litigation releases and AAERs');
    expect(ENFORCEMENT_ROUTE_LIMITATION).toContain('litigation-release and AAER indexes');
    expect(ENFORCEMENT_ROUTE_LIMITATION).toContain('trading suspensions are not included');
  });

  it('uses page title and loading label that name both indexes', async () => {
    const { metadata } = await import('../app/enforcement/layout');
    expect(metadata.title).toBe('SEC Litigation Releases & AAERs - Uniqus Research Center');
    expect(metadata.description).toBe(ENFORCEMENT_ROUTE_DESCRIPTION);
  });

  it('names both indexes in landing-page capability copy', () => {
    expect(ENFORCEMENT_LANDING_CAPABILITY).toBe('SEC litigation releases, civil actions and AAERs');
    expect(ENFORCEMENT_LANDING_CAPABILITY).not.toMatch(/^SEC enforcement tracking$/i);
  });
});
