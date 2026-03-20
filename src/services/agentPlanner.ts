import { defaultSearchFilters, type SearchFilters } from '../components/filters/SearchFilterBar';
import type { AgentAction, AgentContextSnapshot, AgentPlan, AgentToolName } from '../types/agent';
import type { ResearchSearchMode } from './filingResearch';

const FORM_TYPES = ['10-K', '10-Q', '8-K', 'DEF 14A', '20-F', '6-K', 'S-1'] as const;
const AUDITORS = ['Deloitte', 'PwC', 'EY', 'KPMG', 'BDO', 'Grant Thornton', 'RSM'];
const LATEST_FILING_PATTERN = '(?:latest|most\\s+recent|newest|current)';

function makeAction(type: AgentToolName, title: string, input: Record<string, unknown>, reason?: string): AgentAction {
  return {
    id: `${type}-${Math.random().toString(36).slice(2, 9)}`,
    type,
    title,
    input,
    reason,
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function cleanCompanyHint(value: string): string {
  return value
    .replace(/^(?:can you\s+|please\s+)?(?:open|show|summarize|find|search|compare|benchmark)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findFormType(prompt: string): string | null {
  const matchers: Array<{ form: (typeof FORM_TYPES)[number]; re: RegExp }> = [
    { form: '10-K', re: /\b10[\s-]?k\b/i },
    { form: '10-Q', re: /\b10[\s-]?q\b/i },
    { form: '8-K', re: /\b8[\s-]?k\b/i },
    { form: 'DEF 14A', re: /\bdef[\s-]?14a\b/i },
    { form: '20-F', re: /\b20[\s-]?f\b/i },
    { form: '6-K', re: /\b6[\s-]?k\b/i },
    { form: 'S-1', re: /\bs[\s-]?1\b/i },
  ];

  return matchers.find(item => item.re.test(prompt))?.form || null;
}

function hasBooleanSyntax(prompt: string): boolean {
  return /\b(AND|OR|NOT)\b/i.test(prompt) || /(?:w|within|near)\/\d+/i.test(prompt) || /"/.test(prompt);
}

function extractDateWindow(prompt: string): { dateFrom?: string; dateTo?: string } {
  const match = prompt.match(/last\s+(\d{1,2})\s+years?/i);
  if (!match) return {};

  const years = Number(match[1]);
  if (!Number.isFinite(years) || years <= 0) return {};

  const end = new Date();
  const start = new Date();
  start.setFullYear(end.getFullYear() - years);

  return {
    dateFrom: start.toISOString().split('T')[0],
    dateTo: end.toISOString().split('T')[0],
  };
}

function extractAuditor(prompt: string, context: AgentContextSnapshot): string {
  const sameAuditor = /same[-\s]?auditor|same big 4|same big four/i.test(prompt);
  if (sameAuditor && context.filing?.auditor) {
    return context.filing.auditor;
  }

  const explicit = AUDITORS.find(auditor => new RegExp(`\\b${auditor.replace(/\s+/g, '\\s+')}\\b`, 'i').test(prompt));
  return explicit || '';
}

function extractSic(prompt: string, context: AgentContextSnapshot): string {
  const match = prompt.match(/\bSIC\s*(\d{4})\b/i);
  if (match) return match[1];
  if (/custom peer group|peer group|industry code|sic peers?/i.test(prompt) && context.compare?.sicCode) {
    return context.compare.sicCode;
  }
  return '';
}

function extractSectionHint(prompt: string): string {
  const hints: Array<{ re: RegExp; label: string }> = [
    { re: /\brisk factors?\b/i, label: 'Item 1A. Risk Factors' },
    { re: /\bmd&a\b|\bmanagement discussion\b/i, label: 'Item 7. MD&A' },
    { re: /\bfinancial statements?\b/i, label: 'Item 8. Financial Statements' },
    { re: /\bbusiness overview\b|\bbusiness\b/i, label: 'Item 1. Business' },
    { re: /\bcontrols?\b/i, label: 'Item 9A. Controls & Procedures' },
    { re: /\baccountants?\b|\bauditor\b/i, label: 'Item 9. Changes in Accountants' },
    { re: /\buse of proceeds\b/i, label: 'Use of Proceeds' },
  ];

  return hints.find(item => item.re.test(prompt))?.label || '';
}

function extractCompareCompanies(prompt: string): string[] {
  const compareMatch = prompt.match(/compare\s+(.+)/i);
  if (!compareMatch) return [];

  const tail = compareMatch[1]
    .replace(/\b(latest|most recent|newest|current|filings?|10-k|10-q|same auditor|same-auditor|peers?|companies|company|for me)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return tail
    .split(/\s*(?:,| and | vs\.? | versus )\s*/i)
    .map(item => item.trim().replace(/[.?!]+$/, ''))
    .filter(item => item.length > 1)
    .slice(0, 8);
}

function extractCompanyHint(prompt: string, context: AgentContextSnapshot): string {
  const compareCompanies = extractCompareCompanies(prompt);
  if (compareCompanies.length > 0) return cleanCompanyHint(compareCompanies[0]);

  const possessiveMatch = prompt.match(new RegExp(`([A-Za-z][A-Za-z0-9.&\\- ]+?)(?:'s|\\u2019s)\\s+${LATEST_FILING_PATTERN}`, 'i'));
  if (possessiveMatch) return cleanCompanyHint(possessiveMatch[1]);

  const openMatch = prompt.match(
    new RegExp(`open\\s+([A-Za-z][A-Za-z0-9.&\\- ]+?)\\s+(?:(?:${LATEST_FILING_PATTERN})\\s+)?(?:10-k|10 q|10-q|8-k|8 k|def 14a|def-14a|20-f|20 f|6-k|6 k|s-1|s 1)`, 'i')
  );
  if (openMatch) return cleanCompanyHint(openMatch[1]);

  const latestFormMatch = prompt.match(
    new RegExp(`([A-Za-z][A-Za-z0-9.&\\- ]+?)\\s+${LATEST_FILING_PATTERN}\\s+(?:10-k|10 q|10-q|8-k|8 k|def 14a|def-14a|20-f|20 f|6-k|6 k|s-1|s 1)`, 'i')
  );
  if (latestFormMatch) return cleanCompanyHint(latestFormMatch[1]);

  if (/this filing|current filing|this company/i.test(prompt) && context.filing?.companyName) {
    return context.filing.companyName;
  }

  return '';
}

function buildSearchQuery(prompt: string, companyHints: string[], formType: string | null): string {
  let query = prompt;

  for (const companyHint of companyHints) {
    if (!companyHint) continue;
    query = query.replace(new RegExp(companyHint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
  }

  if (formType) {
    query = query.replace(new RegExp(formType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), ' ');
  }

  query = query
    .replace(/\b(can you|please|open|show|find|search|summarize|compare|benchmark|build|create|draft|save|set up|setup|alert|latest|most recent|newest|current|important parts|important|for me|it|the|a|an)\b/gi, ' ')
    .replace(/\b(comment letters?|sec comment letters?|same[-\s]?auditor|same big 4|same big four|peer groups?|peers?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return query;
}

function buildSearchFilters(prompt: string, formType: string | null, context: AgentContextSnapshot): SearchFilters {
  const filters: SearchFilters = { ...defaultSearchFilters };
  const auditor = extractAuditor(prompt, context);
  const sicCode = extractSic(prompt, context);
  const dates = extractDateWindow(prompt);

  if (auditor) filters.accountant = auditor;
  if (sicCode) filters.sicCode = sicCode;
  if (dates.dateFrom) filters.dateFrom = dates.dateFrom;
  if (dates.dateTo) filters.dateTo = dates.dateTo;
  if (formType) filters.formTypes = [formType];

  return filters;
}

export function buildHeuristicAgentPlan(prompt: string, context: AgentContextSnapshot): AgentPlan {
  const normalizedPrompt = normalize(prompt);
  const formType = findFormType(prompt);
  const companyHint = extractCompanyHint(prompt, context);
  const compareCompanies = extractCompareCompanies(prompt);
  const sectionHint = extractSectionHint(prompt);
  const mode: ResearchSearchMode = hasBooleanSyntax(prompt) ? 'boolean' : 'semantic';
  const filters = buildSearchFilters(prompt, formType, context);
  const query = buildSearchQuery(prompt, compareCompanies.length > 0 ? compareCompanies : [companyHint], formType);
  const actions: AgentAction[] = [];
  const followUps = [
    'Compare same-auditor peers on this issue.',
    'Show related SEC comment letters.',
    'Draft an alert for future filings on this topic.',
  ];

  const isAlertRequest = /\b(alert|notify|monitor|watch)\b/i.test(prompt);
  const isCommentLetterRequest = /\bcomment letters?\b|\bsec comments?\b/i.test(prompt);
  const isCompareRequest = /\bcompare\b|\bbenchmark\b|\bpeer\b/i.test(prompt);
  const isSummaryRequest = /\bsummarize\b|\bimportant parts\b|\bkey points?\b/i.test(prompt);
  const isOpenRequest = /\bopen\b|\bshow\b/i.test(prompt);
  const hasDirectFilingIntent =
    !isCommentLetterRequest &&
    !isCompareRequest &&
    (Boolean(context.filing) || ((isOpenRequest || isSummaryRequest) && Boolean(formType) && Boolean(companyHint)));

  if (hasDirectFilingIntent) {
    const targetCompany = companyHint || context.filing?.companyName || '';
    const targetForm = formType || context.filing?.formType || '10-K';

    if (targetCompany) {
      actions.push(
        makeAction('resolve_company', `Resolve ${targetCompany}`, { companyHint: targetCompany }, 'Identify the requested issuer.'),
        makeAction('find_latest_filing', `Find latest ${targetForm}`, { companyHint: targetCompany, formType: targetForm }, 'Locate the latest filing that matches the requested form.')
      );
    }

    if (sectionHint) {
      actions.push(makeAction('open_filing', 'Open filing', { useLatestResolvedFiling: true }, 'Open the filing inside Vara.'));
      actions.push(makeAction('jump_to_section', `Jump to ${sectionHint}`, { sectionLabel: sectionHint }, 'Navigate to the most relevant section automatically.'));
    } else if (targetCompany || context.filing) {
      actions.push(makeAction('open_filing', 'Open filing', { useLatestResolvedFiling: true }, 'Open the filing inside Vara.'));
    }

    if (isSummaryRequest || normalizedPrompt.includes('important parts')) {
      actions.push(
        makeAction(
          'summarize_filing',
          'Summarize filing',
          { mode: normalizedPrompt.includes('important parts') ? 'important-parts' : 'default', sectionLabel: sectionHint || undefined },
          'Create a cited summary of the filing.'
        )
      );
    }

    if (isAlertRequest) {
      actions.push(
        makeAction(
          'draft_alert',
          'Draft alert',
          { nameHint: `${targetCompany} ${targetForm}`.trim(), query: query || targetCompany, mode, filters, defaultForms: targetForm },
          'Prepare a filing alert for review.'
        )
      );
    }

    return {
      goal: 'Open the requested filing and return a cited summary.',
      rationale: 'The prompt asks for direct navigation into a filing plus a practical summary.',
      confidence: 'high',
      actions,
      followUps,
    };
  }

  if (isCommentLetterRequest) {
    actions.push(
      makeAction(
        'search_comment_letters',
        'Search SEC comment letters',
        {
          query: query || 'comment',
          filters,
          mode,
          targetPage: 'comment-letters',
        },
        'Look for SEC staff correspondence tied to the requested issue.'
      )
    );

    if (isSummaryRequest || isCompareRequest) {
      actions.push(makeAction('summarize_result_set', 'Summarize comment-letter results', { mode: 'comment-letters' }, 'Turn the results into an evidence packet.'));
    }

    if (isAlertRequest) {
      actions.push(
        makeAction(
          'draft_alert',
          'Draft comment-letter alert',
          { nameHint: `Comment letter: ${query || 'custom search'}`, query: query || 'comment', mode, filters, defaultForms: 'CORRESP,UPLOAD' },
          'Prepare a comment-letter alert for review.'
        )
      );
    }

    return {
      goal: 'Find relevant SEC comment letters and connect them to the issue the user asked about.',
      rationale: 'The request is centered on SEC correspondence rather than filing search.',
      confidence: 'high',
      actions,
      followUps,
    };
  }

  if (isCompareRequest && compareCompanies.length > 0) {
    actions.push(
      ...compareCompanies.map(company =>
        makeAction('resolve_company', `Resolve ${company}`, { companyHint: company }, 'Identify the issuer for the compare cohort.')
      )
    );
    actions.push(
      makeAction(
        'set_compare_cohort',
        'Set compare cohort',
        {
          companyHints: compareCompanies,
          viewMode: sectionHint ? 'text-diff' : 'financials',
          selectedSection: sectionHint || 'Item 1A. Risk Factors',
        },
        'Open the benchmarking workspace with the requested cohort.'
      )
    );
    actions.push(
      makeAction(
        'summarize_result_set',
        'Summarize compare cohort',
        { mode: 'compare' },
        'Return a concise evidence-backed comparison.'
      )
    );

    return {
      goal: 'Build the requested compare cohort and summarize the differences.',
      rationale: 'The prompt explicitly asks for a cross-company comparison.',
      confidence: 'high',
      actions,
      followUps,
    };
  }

  actions.push(
    makeAction(
      'apply_filters',
      'Prepare research filters',
      {
        targetPage: context.pagePath.startsWith('/accounting') ? 'accounting' : 'search',
        query,
        mode,
        filters,
        defaultForms: formType || '10-K,10-Q,8-K,DEF 14A,20-F,S-1',
      },
      'Translate the request into a research-ready search.'
    ),
    makeAction(
      'search_filings',
      'Search filings',
      {
        query,
        mode,
        filters,
        targetPage: context.pagePath.startsWith('/accounting') ? 'accounting' : 'search',
        limit: 20,
      },
      'Search EDGAR using the requested issue, filters, and time window.'
    )
  );

  if (isCompareRequest) {
    actions.push(
      makeAction(
        'set_compare_cohort',
        'Set compare cohort from search results',
        { fromSearchResults: true, maxCompanies: 5, viewMode: sectionHint ? 'text-diff' : 'financials', selectedSection: sectionHint || 'Item 1A. Risk Factors' },
        'Open the top matched issuers in benchmarking.'
      )
    );
  }

  if (isSummaryRequest || isCompareRequest || !isAlertRequest) {
    actions.push(
      makeAction(
        'summarize_result_set',
        'Summarize filing results',
        { mode: 'filings' },
        'Turn the results into a concise evidence packet.'
      )
    );
  }

  if (isAlertRequest) {
    actions.push(
      makeAction(
        'draft_alert',
        'Draft alert',
        {
          nameHint: query || companyHint || 'Custom research alert',
          query,
          mode,
          filters,
          defaultForms: formType || '10-K,10-Q,8-K,DEF 14A,20-F,S-1',
        },
        'Prepare a filing alert for review before saving.'
      )
    );
  }

  return {
    goal: isCompareRequest ? 'Find evidence and set up a comparable peer workflow.' : 'Find the most relevant filings and return an evidence-backed answer.',
    rationale: 'The request maps most naturally to a filing research workflow.',
    confidence: query ? 'high' : 'medium',
    actions,
    followUps,
  };
}

function isAllowedActionType(value: string): value is AgentToolName {
  return [
    'resolve_company',
    'find_latest_filing',
    'open_filing',
    'jump_to_section',
    'search_filings',
    'search_comment_letters',
    'find_peers',
    'apply_filters',
    'set_compare_cohort',
    'summarize_filing',
    'summarize_result_set',
    'draft_alert',
    'save_alert',
    'export_clean_pdf',
  ].includes(value);
}

function hasAction(actions: AgentAction[], type: AgentToolName): boolean {
  return actions.some(action => action.type === type);
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0;
  return value !== undefined && value !== null;
}

function mergeActionInput(
  generatedInput: Record<string, unknown>,
  fallbackInput: Record<string, unknown>
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...fallbackInput };

  for (const [key, value] of Object.entries(generatedInput)) {
    if (hasMeaningfulValue(value)) {
      merged[key] = value;
    } else if (!(key in merged)) {
      merged[key] = value;
    }
  }

  return merged;
}

function repairActionsWithFallback(actions: AgentAction[], fallbackActions: AgentAction[]): AgentAction[] {
  const typeCounts = new Map<AgentToolName, number>();

  return actions.map(action => {
    const occurrenceIndex = typeCounts.get(action.type) || 0;
    typeCounts.set(action.type, occurrenceIndex + 1);

    const fallbackAction = fallbackActions.filter(item => item.type === action.type)[occurrenceIndex];
    if (!fallbackAction) {
      return action;
    }

    return {
      ...action,
      title: action.title.trim() || fallbackAction.title,
      reason: action.reason || fallbackAction.reason,
      input: mergeActionInput(action.input, fallbackAction.input),
    };
  });
}

export function sanitizeAgentPlan(candidate: unknown, prompt: string, context: AgentContextSnapshot): AgentPlan {
  const fallback = buildHeuristicAgentPlan(prompt, context);
  if (!candidate || typeof candidate !== 'object') return fallback;

  const record = candidate as Record<string, unknown>;
  const rawActions = Array.isArray(record.actions) ? record.actions : [];
  const actions = rawActions
    .map(action => {
      if (!action || typeof action !== 'object') return null;
      const item = action as Record<string, unknown>;
      const type = typeof item.type === 'string' ? item.type : '';
      if (!isAllowedActionType(type)) return null;
      const title = typeof item.title === 'string' && item.title.trim() ? item.title.trim() : type;
      const input = item.input && typeof item.input === 'object' ? (item.input as Record<string, unknown>) : {};
      const reason = typeof item.reason === 'string' ? item.reason : undefined;
      return makeAction(type, title, input, reason);
    })
    .filter((action): action is AgentAction => Boolean(action));

  if (actions.length === 0) {
    return fallback;
  }

  const repairedActions = repairActionsWithFallback(actions, fallback.actions);

  const fallbackRequiresDirectFilingWorkflow =
    hasAction(fallback.actions, 'find_latest_filing') ||
    hasAction(fallback.actions, 'open_filing') ||
    hasAction(fallback.actions, 'summarize_filing');

  if (fallbackRequiresDirectFilingWorkflow) {
    const missingCriticalAction =
      (hasAction(fallback.actions, 'find_latest_filing') && !hasAction(repairedActions, 'find_latest_filing')) ||
      (hasAction(fallback.actions, 'open_filing') && !hasAction(repairedActions, 'open_filing')) ||
      (hasAction(fallback.actions, 'summarize_filing') && !hasAction(repairedActions, 'summarize_filing'));

    if (missingCriticalAction) {
      return fallback;
    }
  }

  return {
    goal: typeof record.goal === 'string' && record.goal.trim() ? record.goal : fallback.goal,
    rationale: typeof record.rationale === 'string' && record.rationale.trim() ? record.rationale : fallback.rationale,
    confidence: record.confidence === 'high' || record.confidence === 'medium' || record.confidence === 'low' ? record.confidence : fallback.confidence,
    actions: repairedActions,
    followUps: Array.isArray(record.followUps)
      ? record.followUps.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 6)
      : fallback.followUps,
  };
}
