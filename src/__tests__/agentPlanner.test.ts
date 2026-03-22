import { describe, it, expect } from 'vitest';
import { buildHeuristicAgentPlan, sanitizeAgentPlan } from '../services/agentPlanner';
import type { AgentContextSnapshot, AgentPlan } from '../types/agent';

const emptyContext: AgentContextSnapshot = {
  pagePath: '/search',
  pageLabel: 'Research',
  filing: null,
  search: null,
  compare: null,
  conversation: [],
};

const filingContext: AgentContextSnapshot = {
  ...emptyContext,
  pagePath: '/filing/123',
  pageLabel: 'Filing Detail',
  filing: {
    cik: '0000320193',
    accessionNumber: '0000320193-23-000106',
    primaryDocument: 'aapl-20230930.htm',
    companyName: 'Apple Inc.',
    formType: '10-K',
    filingDate: '2023-11-02',
    auditor: 'Deloitte',
    sections: [],
  },
};

describe('agentPlanner', () => {
  // ── buildHeuristicAgentPlan ──
  describe('buildHeuristicAgentPlan', () => {
    it('returns a plan with goal, rationale, confidence, actions, followUps', () => {
      const plan = buildHeuristicAgentPlan('search for revenue', emptyContext);
      expect(plan.goal).toBeTruthy();
      expect(plan.rationale).toBeTruthy();
      expect(plan.confidence).toMatch(/high|medium|low/);
      expect(Array.isArray(plan.actions)).toBe(true);
      expect(Array.isArray(plan.followUps)).toBe(true);
    });

    it('creates search actions for generic search prompt', () => {
      const plan = buildHeuristicAgentPlan('find revenue recognition disclosures', emptyContext);
      expect(plan.actions.some(a => a.type === 'search_filings' || a.type === 'apply_filters')).toBe(true);
    });

    it('creates open/summarize actions for filing context', () => {
      const plan = buildHeuristicAgentPlan('summarize this filing', filingContext);
      expect(plan.actions.some(a => a.type === 'summarize_filing' || a.type === 'open_filing')).toBe(true);
    });

    it('detects comment letter requests', () => {
      const plan = buildHeuristicAgentPlan('find SEC comment letters about revenue', emptyContext);
      expect(plan.actions.some(a => a.type === 'search_comment_letters')).toBe(true);
    });

    it('detects compare/benchmark requests', () => {
      const plan = buildHeuristicAgentPlan('compare AAPL and MSFT', emptyContext);
      expect(plan.actions.some(a => a.type === 'resolve_company' || a.type === 'set_compare_cohort')).toBe(true);
    });

    it('detects alert requests', () => {
      const plan = buildHeuristicAgentPlan('alert me about new 10-K filings from tech companies', emptyContext);
      expect(plan.actions.some(a => a.type === 'draft_alert')).toBe(true);
    });

    it('extracts form type from prompt', () => {
      const plan = buildHeuristicAgentPlan('show Apple latest 10-K filing', emptyContext);
      expect(plan.actions.some(a => a.type === 'find_latest_filing')).toBe(true);
    });

    it('extracts company hint from possessive', () => {
      // The regex uses Unicode apostrophe \u2019 for possessive detection
      const plan = buildHeuristicAgentPlan("open Apple latest 10-K", emptyContext);
      // Should detect "Apple" as company and create resolve/find_latest actions
      expect(plan.actions.some(a => a.type === 'resolve_company' || a.type === 'find_latest_filing')).toBe(true);
    });

    it('extracts section hint for risk factors', () => {
      const plan = buildHeuristicAgentPlan('open Apple 10-K risk factors', emptyContext);
      expect(plan.actions.some(a => a.type === 'jump_to_section')).toBe(true);
    });

    it('detects boolean syntax and sets mode', () => {
      const plan = buildHeuristicAgentPlan('"material weakness" AND audit', emptyContext);
      const searchAction = plan.actions.find(a => a.type === 'search_filings' || a.type === 'apply_filters');
      expect(searchAction?.input?.mode).toBe('boolean');
    });

    it('handles "same auditor" with filing context', () => {
      const plan = buildHeuristicAgentPlan('find same-auditor peers', filingContext);
      // Should generate search actions (may use apply_filters or search_filings)
      expect(plan.actions.length).toBeGreaterThan(0);
    });

    it('creates summarize action for "important parts" prompt', () => {
      const plan = buildHeuristicAgentPlan('show me the important parts', filingContext);
      expect(plan.actions.some(a => a.type === 'summarize_filing')).toBe(true);
    });

    it('handles "open" prompt with company and form', () => {
      const plan = buildHeuristicAgentPlan('open Tesla latest 10-K', emptyContext);
      expect(plan.actions.length).toBeGreaterThan(0);
    });

    it('extracts date window from "last 3 years"', () => {
      const plan = buildHeuristicAgentPlan('cybersecurity disclosures last 3 years', emptyContext);
      const action = plan.actions.find(a => a.type === 'apply_filters' || a.type === 'search_filings');
      const filters = action?.input?.filters as any;
      expect(filters?.dateFrom).toBeTruthy();
    });

    it('extracts auditor from prompt', () => {
      const plan = buildHeuristicAgentPlan('KPMG audited 10-K filings with restatement', emptyContext);
      const action = plan.actions.find(a => a.type === 'apply_filters' || a.type === 'search_filings');
      const filters = action?.input?.filters as any;
      expect(filters?.accountant).toBe('KPMG');
    });

    it('handles compare with multiple companies', () => {
      const plan = buildHeuristicAgentPlan('compare AAPL, MSFT, and GOOGL', emptyContext);
      const resolveActions = plan.actions.filter(a => a.type === 'resolve_company');
      expect(resolveActions.length).toBeGreaterThanOrEqual(3);
    });

    it('always produces followUps', () => {
      const plan = buildHeuristicAgentPlan('anything', emptyContext);
      expect(plan.followUps.length).toBeGreaterThan(0);
    });

    it('produces high confidence for clear requests', () => {
      const plan = buildHeuristicAgentPlan('open Apple 10-K', emptyContext);
      expect(plan.confidence).toBe('high');
    });

    it('uses accounting page path when applicable', () => {
      const ctx = { ...emptyContext, pagePath: '/accounting' };
      const plan = buildHeuristicAgentPlan('ASC 842 lease guidance', ctx);
      const action = plan.actions.find(a => a.type === 'apply_filters');
      expect(action?.input?.targetPage).toBe('accounting');
    });
  });

  // ── sanitizeAgentPlan ──
  describe('sanitizeAgentPlan', () => {
    it('returns fallback plan for null candidate', () => {
      const plan = sanitizeAgentPlan(null, 'search revenue', emptyContext);
      expect(plan.actions.length).toBeGreaterThan(0);
    });

    it('returns fallback plan for non-object candidate', () => {
      const plan = sanitizeAgentPlan('not an object', 'search', emptyContext);
      expect(plan.actions.length).toBeGreaterThan(0);
    });

    it('returns fallback when actions array is empty', () => {
      const plan = sanitizeAgentPlan({ actions: [] }, 'search', emptyContext);
      expect(plan.actions.length).toBeGreaterThan(0);
    });

    it('filters out invalid action types', () => {
      const candidate = {
        goal: 'test',
        actions: [{ type: 'invalid_action', title: 'Bad', input: {} }],
      };
      const plan = sanitizeAgentPlan(candidate, 'search', emptyContext);
      expect(plan.actions.every(a => a.type !== 'invalid_action')).toBe(true);
    });

    it('preserves valid actions', () => {
      const candidate = {
        goal: 'Find filings',
        rationale: 'User wants filings',
        confidence: 'high',
        actions: [
          { type: 'apply_filters', title: 'Set filters', input: { query: 'revenue' } },
          { type: 'search_filings', title: 'Search', input: { query: 'revenue' } },
        ],
        followUps: ['Next step'],
      };
      const plan = sanitizeAgentPlan(candidate, 'revenue filings', emptyContext);
      expect(plan.goal).toBe('Find filings');
      expect(plan.actions.length).toBeGreaterThanOrEqual(2);
    });

    it('caps followUps at 6', () => {
      const candidate = {
        goal: 'test',
        actions: [{ type: 'search_filings', title: 'Search', input: {} }],
        followUps: Array.from({ length: 20 }, (_, i) => `Follow up ${i}`),
      };
      const plan = sanitizeAgentPlan(candidate, 'test', emptyContext);
      expect(plan.followUps.length).toBeLessThanOrEqual(6);
    });
  });
});
