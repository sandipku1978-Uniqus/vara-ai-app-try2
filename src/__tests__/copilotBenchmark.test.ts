import { describe, expect, test } from 'vitest';
import { buildHeuristicAgentPlan } from '../services/agentPlanner';
import type { AgentContextSnapshot } from '../types/agent';

const EMPTY_CONTEXT: AgentContextSnapshot = {
  pagePath: '/search',
  pageLabel: 'Research',
  filing: null,
  search: null,
  compare: null,
  conversation: [],
};

describe('Copilot Heuristic Planner Benchmark', () => {
  // Test entity extraction
  test('resolves company + form type', () => {
    const plan = buildHeuristicAgentPlan("Open Apple's latest 10-K", EMPTY_CONTEXT);
    expect(plan.actions.some(a => a.type === 'resolve_company')).toBe(true);
    expect(plan.actions.some(a => a.type === 'find_latest_filing')).toBe(true);
  });

  test('detects comparison intent', () => {
    const plan = buildHeuristicAgentPlan('Compare risk factors for AAPL and MSFT', EMPTY_CONTEXT);
    expect(plan.actions.some(a => a.type === 'set_compare_cohort')).toBe(true);
  });

  test('detects comment letter search', () => {
    const plan = buildHeuristicAgentPlan('Find SEC comment letters on revenue recognition', EMPTY_CONTEXT);
    expect(plan.actions.some(a => a.type === 'search_comment_letters')).toBe(true);
  });

  test('detects alert intent', () => {
    const plan = buildHeuristicAgentPlan('Alert me when Tesla files a new 10-K', EMPTY_CONTEXT);
    expect(plan.actions.some(a => a.type === 'draft_alert')).toBe(true);
  });

  test('detects filing search intent', () => {
    const plan = buildHeuristicAgentPlan('Search for goodwill impairment disclosures in 10-K filings', EMPTY_CONTEXT);
    expect(plan.actions.some(a => a.type === 'search_filings')).toBe(true);
  });

  test('handles S-1 filing type', () => {
    const plan = buildHeuristicAgentPlan("Analyze the S-1 for Stripe's IPO", EMPTY_CONTEXT);
    expect(plan.actions.some(a => a.type === 'resolve_company' || a.type === 'find_latest_filing')).toBe(true);
  });

  test('detects boolean search syntax', () => {
    const plan = buildHeuristicAgentPlan('"revenue recognition" AND "ASC 606" w/5 "performance obligation"', EMPTY_CONTEXT);
    const searchAction = plan.actions.find(a => a.type === 'search_filings');
    expect(searchAction).toBeDefined();
  });

  test('detects peer comparison intent', () => {
    const plan = buildHeuristicAgentPlan('Compare AAPL, MSFT, and GOOGL on cybersecurity disclosures', EMPTY_CONTEXT);
    expect(plan.actions.some(a => a.type === 'set_compare_cohort')).toBe(true);
  });

  test('detects important parts / summary request', () => {
    const plan = buildHeuristicAgentPlan("Show me the important parts of Microsoft's 10-K", EMPTY_CONTEXT);
    expect(plan.actions.some(a => a.type === 'summarize_filing')).toBe(true);
  });

  test('detects export intent', () => {
    const plan = buildHeuristicAgentPlan('Export a clean PDF of this filing', EMPTY_CONTEXT);
    expect(plan.actions.some(a => a.type === 'export_clean_pdf')).toBe(true);
  });

  // More edge cases
  test('handles ambiguous query with general search', () => {
    const plan = buildHeuristicAgentPlan('revenue recognition', EMPTY_CONTEXT);
    expect(plan.actions.some(a => a.type === 'search_filings' || a.type === 'apply_filters')).toBe(true);
  });

  test('detects section navigation hint', () => {
    const plan = buildHeuristicAgentPlan('Show me the risk factors section', {
      ...EMPTY_CONTEXT,
      filing: {
        cik: '0000320193',
        accessionNumber: '000032019324000123',
        formType: '10-K',
        companyName: 'Apple Inc.',
        filingDate: '2024-11-01',
        primaryDocument: 'aapl-20240928.htm',
        sections: [],
      },
    });
    expect(plan.actions.some(a => a.type === 'jump_to_section')).toBe(true);
  });

  test('handles "same auditor" peer request', () => {
    const plan = buildHeuristicAgentPlan('Find peers with the same auditor', {
      ...EMPTY_CONTEXT,
      filing: {
        cik: '0000320193',
        accessionNumber: '000032019324000123',
        formType: '10-K',
        companyName: 'Apple Inc.',
        filingDate: '2024-11-01',
        primaryDocument: 'aapl-20240928.htm',
        sections: [],
      },
    });
    expect(plan.actions.some(a => a.type === 'find_peers')).toBe(true);
  });

  test('handles DEF 14A request', () => {
    const plan = buildHeuristicAgentPlan("Open Apple's latest DEF 14A proxy", EMPTY_CONTEXT);
    expect(plan.actions.some(a => a.type === 'resolve_company')).toBe(true);
    expect(plan.actions.some(a => a.type === 'find_latest_filing')).toBe(true);
  });

  test('handles date range extraction', () => {
    const plan = buildHeuristicAgentPlan('Material weaknesses in the last 3 years', EMPTY_CONTEXT);
    expect(plan.actions.some(a => a.type === 'search_filings' || a.type === 'apply_filters')).toBe(true);
  });
});
