import { describe, it, expect, beforeEach } from 'vitest';
import { loadResearchSessions, saveResearchSessions, type ResearchSearchSession } from '../services/researchSessions';
import { setActiveBrowserStorageScope } from '../services/storageNamespace';
import { BOOLEAN_ENGINE_VERSION } from '../utils/booleanSearch';
import { defaultSearchFilters } from '../components/filters/SearchFilterBar';

function session(overrides: Partial<ResearchSearchSession> = {}): ResearchSearchSession {
  return {
    id: 's1',
    title: 'lease OR sublease',
    query: 'lease OR sublease',
    mode: 'boolean',
    filters: { ...defaultSearchFilters },
    results: [{ id: 'r1', accessionNumber: '0000000000-26-000001' }] as unknown as ResearchSearchSession['results'],
    isRefining: false,
    searched: true,
    errorMsg: '',
    interpretation: [],
    resolvedSearch: { query: 'lease OR sublease', mode: 'boolean', filters: { ...defaultSearchFilters } },
    selectedResultId: 'r1',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('Boolean engine migration', () => {
  beforeEach(() => {
    setActiveBrowserStorageScope('test-user');
    window.sessionStorage.clear();
  });

  it('retires Boolean rows produced by an older engine but keeps the query and filters', () => {
    // Simulate a session persisted before versioning (no engineVersion).
    const legacy = session();
    delete (legacy as { engineVersion?: number }).engineVersion;
    window.sessionStorage.setItem(
      'urc.identity.test-user.vara.research.sessions.v1',
      JSON.stringify([legacy])
    );

    const [restored] = loadResearchSessions();
    expect(restored.query).toBe('lease OR sublease');       // query preserved
    expect(restored.mode).toBe('boolean');
    expect(restored.results).toEqual([]);                    // stale rows dropped
    expect(restored.selectedResultId).toBeNull();
    expect(restored.errorMsg).toMatch(/run the search again/i);
    expect(restored.isRefining).toBe(false);                 // never auto-reruns
  });

  it('keeps rows produced by the current engine', () => {
    saveResearchSessions([session()]);
    const [restored] = loadResearchSessions();
    expect(restored.results).toHaveLength(1);
    expect(restored.errorMsg).toBe('');
  });

  it('stamps the current engine version when persisting', () => {
    saveResearchSessions([session()]);
    const raw = window.sessionStorage.getItem('urc.identity.test-user.vara.research.sessions.v1') || '[]';
    expect(JSON.parse(raw)[0].engineVersion).toBe(BOOLEAN_ENGINE_VERSION);
  });

  it('leaves non-Boolean sessions untouched', () => {
    const legacy = session({ mode: 'semantic' });
    delete (legacy as { engineVersion?: number }).engineVersion;
    window.sessionStorage.setItem(
      'urc.identity.test-user.vara.research.sessions.v1',
      JSON.stringify([legacy])
    );
    const [restored] = loadResearchSessions();
    expect(restored.results).toHaveLength(1);
  });
});
