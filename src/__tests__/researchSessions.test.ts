import { describe, it, expect, beforeEach } from 'vitest';
import {
  cloneSearchFilters,
  createResearchSessionId,
  buildResearchSessionTitle,
  buildSearchSignature,
  loadResearchSessions,
  saveResearchSessions,
  type ResearchSearchSession,
} from '../services/researchSessions';

const makeFilters = () => ({
  keyword: '',
  dateFrom: '',
  dateTo: '',
  entityName: '',
  formTypes: [] as string[],
  sectionKeywords: '',
  sicCode: '',
  stateOfInc: '',
  headquarters: '',
  exchange: [] as string[],
  acceleratedStatus: [] as string[],
  accountant: '',
  accessionNumber: '',
  fileNumber: '',
  fiscalYearEnd: '',
});

const makeSession = (overrides: Partial<ResearchSearchSession> = {}): ResearchSearchSession => ({
  id: 'test-session-1',
  title: 'Test Search',
  query: 'revenue',
  mode: 'semantic' as const,
  filters: makeFilters(),
  results: [],
  isRefining: false,
  searched: true,
  errorMsg: '',
  interpretation: [],
  resolvedSearch: { query: 'revenue', mode: 'semantic' as const, filters: makeFilters() },
  selectedResultId: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

describe('researchSessions', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
  });

  // ── cloneSearchFilters ──
  describe('cloneSearchFilters', () => {
    it('creates a deep copy of filters', () => {
      const filters = makeFilters();
      filters.formTypes = ['10-K'];
      const cloned = cloneSearchFilters(filters);
      cloned.formTypes.push('10-Q');
      expect(filters.formTypes).toEqual(['10-K']);
    });

    it('copies exchange array independently', () => {
      const filters = makeFilters();
      filters.exchange = ['NYSE'];
      const cloned = cloneSearchFilters(filters);
      cloned.exchange.push('NASDAQ');
      expect(filters.exchange).toEqual(['NYSE']);
    });

    it('copies acceleratedStatus array independently', () => {
      const filters = makeFilters();
      filters.acceleratedStatus = ['Large Accelerated Filer'];
      const cloned = cloneSearchFilters(filters);
      cloned.acceleratedStatus.push('Accelerated Filer');
      expect(filters.acceleratedStatus).toEqual(['Large Accelerated Filer']);
    });

    it('preserves scalar values', () => {
      const filters = makeFilters();
      filters.keyword = 'test';
      filters.accountant = 'Deloitte';
      const cloned = cloneSearchFilters(filters);
      expect(cloned.keyword).toBe('test');
      expect(cloned.accountant).toBe('Deloitte');
    });
  });

  // ── createResearchSessionId ──
  describe('createResearchSessionId', () => {
    it('returns a string starting with "research-"', () => {
      const id = createResearchSessionId();
      expect(id.startsWith('research-')).toBe(true);
    });

    it('generates unique IDs', () => {
      const ids = Array.from({ length: 100 }, () => createResearchSessionId());
      const unique = new Set(ids);
      expect(unique.size).toBe(100);
    });

    it('contains a timestamp component', () => {
      const id = createResearchSessionId();
      const parts = id.split('-');
      expect(parts.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ── buildResearchSessionTitle ──
  describe('buildResearchSessionTitle', () => {
    it('uses query as title when available', () => {
      const title = buildResearchSessionTitle('revenue recognition', makeFilters());
      expect(title).toBe('revenue recognition');
    });

    it('truncates long queries', () => {
      const longQuery = 'a'.repeat(100);
      const title = buildResearchSessionTitle(longQuery, makeFilters());
      expect(title.length).toBeLessThanOrEqual(50);
      expect(title).toContain('...');
    });

    it('uses entity name when query is empty', () => {
      const filters = makeFilters();
      filters.entityName = 'Apple Inc';
      const title = buildResearchSessionTitle('', filters);
      expect(title).toBe('Apple Inc');
    });

    it('uses SIC code when query and entity are empty', () => {
      const filters = makeFilters();
      filters.sicCode = '7372';
      const title = buildResearchSessionTitle('', filters);
      expect(title).toBe('SIC 7372');
    });

    it('returns "New search" when everything is empty', () => {
      const title = buildResearchSessionTitle('', makeFilters());
      expect(title).toBe('New search');
    });

    it('trims whitespace from query', () => {
      const title = buildResearchSessionTitle('  revenue  ', makeFilters());
      expect(title).toBe('revenue');
    });
  });

  // ── buildSearchSignature ──
  describe('buildSearchSignature', () => {
    it('returns a JSON string', () => {
      const sig = buildSearchSignature('revenue', 'semantic', makeFilters());
      expect(() => JSON.parse(sig)).not.toThrow();
    });

    it('produces same signature for same inputs', () => {
      const filters = makeFilters();
      const sig1 = buildSearchSignature('test', 'semantic', filters);
      const sig2 = buildSearchSignature('test', 'semantic', filters);
      expect(sig1).toBe(sig2);
    });

    it('produces different signatures for different queries', () => {
      const filters = makeFilters();
      const sig1 = buildSearchSignature('revenue', 'semantic', filters);
      const sig2 = buildSearchSignature('income', 'semantic', filters);
      expect(sig1).not.toBe(sig2);
    });

    it('produces different signatures for different modes', () => {
      const filters = makeFilters();
      const sig1 = buildSearchSignature('test', 'semantic', filters);
      const sig2 = buildSearchSignature('test', 'boolean', filters);
      expect(sig1).not.toBe(sig2);
    });

    it('trims filter values', () => {
      const f1 = makeFilters();
      f1.entityName = 'Apple';
      const f2 = makeFilters();
      f2.entityName = '  Apple  ';
      const sig1 = buildSearchSignature('q', 'semantic', f1);
      const sig2 = buildSearchSignature('q', 'semantic', f2);
      expect(sig1).toBe(sig2);
    });
  });

  // ── loadResearchSessions / saveResearchSessions ──
  describe('load/save sessions', () => {
    it('returns empty array when no sessions stored', () => {
      expect(loadResearchSessions()).toEqual([]);
    });

    it('saves and loads a session', () => {
      const session = makeSession();
      saveResearchSessions([session]);
      const loaded = loadResearchSessions();
      expect(loaded.length).toBe(1);
      expect(loaded[0].id).toBe('test-session-1');
    });

    it('limits to 8 sessions max', () => {
      const sessions = Array.from({ length: 12 }, (_, i) =>
        makeSession({ id: `session-${i}` })
      );
      saveResearchSessions(sessions);
      const loaded = loadResearchSessions();
      expect(loaded.length).toBeLessThanOrEqual(8);
    });

    it('handles corrupted storage gracefully', () => {
      window.sessionStorage.setItem('vara.research.sessions.v1', 'not valid json');
      expect(loadResearchSessions()).toEqual([]);
    });

    it('handles non-array storage gracefully', () => {
      window.sessionStorage.setItem('vara.research.sessions.v1', '{"not": "array"}');
      expect(loadResearchSessions()).toEqual([]);
    });

    it('preserves session data through save/load cycle', () => {
      const session = makeSession({ query: 'revenue recognition', searched: true });
      saveResearchSessions([session]);
      const loaded = loadResearchSessions();
      expect(loaded[0].query).toBe('revenue recognition');
      expect(loaded[0].searched).toBe(true);
    });
  });
});
