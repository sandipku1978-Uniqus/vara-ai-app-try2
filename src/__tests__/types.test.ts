import { describe, it, expect } from 'vitest';
import type {
  Company,
  Filing,
  FilingSection,
  ChatMessage,
  EsgDataPoint,
  GlobalState,
} from '../types/index';
import type {
  AgentToolName,
  AgentRunStatus,
  AgentActionStatus,
  AgentConfidence,
  AgentPlan,
  AgentRun,
  AgentCitation,
  AgentAction,
  AgentEvidencePacket,
  AgentContextSnapshot,
  FilingSectionReference,
  FilingLocator,
  FilingSectionSnippet,
  PendingSearchIntent,
  PendingCompareIntent,
  PendingAlertDraft,
  ResolvedCompany,
} from '../types/agent';

describe('types', () => {
  // These tests verify that types can be instantiated correctly

  describe('Core types', () => {
    it('Company type is structurally sound', () => {
      const company: Company = {
        id: '1',
        name: 'Apple Inc.',
        ticker: 'AAPL',
        cik: '0000320193',
        industry: 'Technology',
        marketCap: '$3T',
      };
      expect(company.ticker).toBe('AAPL');
    });

    it('Filing type supports all form types', () => {
      const types: Filing['type'][] = ['10-K', '10-Q', '8-K', 'S-1', 'DEF 14A'];
      expect(types.length).toBe(5);
    });

    it('FilingSection has required fields', () => {
      const section: FilingSection = { id: '1', title: 'Risk Factors', content: 'Risk content' };
      expect(section.title).toBe('Risk Factors');
    });

    it('ChatMessage supports user and ai roles', () => {
      const msg: ChatMessage = { id: '1', role: 'user', content: 'Hello', timestamp: '2023-01-01' };
      expect(msg.role).toBe('user');
      const aiMsg: ChatMessage = { id: '2', role: 'ai', content: 'Hi', timestamp: '2023-01-01' };
      expect(aiMsg.role).toBe('ai');
    });

    it('EsgDataPoint has score in range', () => {
      const dp: EsgDataPoint = { companyId: '1', year: 2023, score: 85 };
      expect(dp.score).toBe(85);
    });

    it('GlobalState has correct shape', () => {
      const state: GlobalState = { watchlist: ['AAPL'], chatHistory: [], searchQuery: '' };
      expect(state.watchlist).toContain('AAPL');
    });
  });

  describe('Agent types', () => {
    it('AgentToolName covers all expected tools', () => {
      const tools: AgentToolName[] = [
        'resolve_company', 'find_latest_filing', 'open_filing', 'jump_to_section',
        'search_filings', 'search_comment_letters', 'find_peers', 'apply_filters',
        'set_compare_cohort', 'summarize_filing', 'summarize_result_set',
        'draft_alert', 'save_alert', 'export_clean_pdf',
      ];
      expect(tools.length).toBe(14);
    });

    it('AgentRunStatus covers all states', () => {
      const statuses: AgentRunStatus[] = ['idle', 'running', 'completed', 'failed'];
      expect(statuses.length).toBe(4);
    });

    it('AgentActionStatus covers all states', () => {
      const statuses: AgentActionStatus[] = ['pending', 'running', 'completed', 'failed', 'skipped'];
      expect(statuses.length).toBe(5);
    });

    it('AgentConfidence covers all levels', () => {
      const levels: AgentConfidence[] = ['high', 'medium', 'low'];
      expect(levels.length).toBe(3);
    });

    it('AgentPlan has required fields', () => {
      const plan: AgentPlan = {
        goal: 'Find filing',
        rationale: 'User wants to find a filing',
        confidence: 'high',
        actions: [],
        followUps: [],
      };
      expect(plan.confidence).toBe('high');
    });

    it('AgentRun has required fields', () => {
      const run: AgentRun = {
        id: 'run-1',
        prompt: 'Find Apple 10-K',
        status: 'running',
        startedAt: '2023-01-01',
        actionLog: [],
        answer: '',
        evidence: null,
      };
      expect(run.status).toBe('running');
    });

    it('AgentCitation has required fields', () => {
      const citation: AgentCitation = {
        id: 'c1',
        kind: 'filing',
        title: 'Apple 10-K',
      };
      expect(citation.kind).toBe('filing');
    });

    it('AgentCitation supports all kinds', () => {
      const kinds: AgentCitation['kind'][] = [
        'filing', 'section', 'comment-letter', 'search-result', 'compare-cohort', 'alert-draft',
      ];
      expect(kinds.length).toBe(6);
    });

    it('FilingSectionReference has required fields', () => {
      const ref: FilingSectionReference = { label: 'Risk Factors', elementId: null, anchorName: 'rf' };
      expect(ref.label).toBe('Risk Factors');
    });

    it('FilingLocator has required fields', () => {
      const locator: FilingLocator = {
        cik: '320193',
        accessionNumber: '123',
        filingDate: '2023-01-01',
        formType: '10-K',
        primaryDocument: 'doc.htm',
        companyName: 'Apple',
      };
      expect(locator.cik).toBe('320193');
    });

    it('PendingSearchIntent has required fields', () => {
      const intent: PendingSearchIntent = {
        id: 'i1',
        surface: 'research',
        query: 'revenue',
        mode: 'semantic',
        filters: {} as any,
      };
      expect(intent.surface).toBe('research');
    });

    it('ResolvedCompany has required fields', () => {
      const company: ResolvedCompany = { cik: '320193', ticker: 'AAPL', title: 'Apple Inc.' };
      expect(company.ticker).toBe('AAPL');
    });
  });
});
