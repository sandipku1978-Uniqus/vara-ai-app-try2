import type { SearchFilters } from '../components/filters/SearchFilterBar';
import type { ResearchSearchMode } from './filingResearch';
import { buildCandidateQueryFromBoolean } from '../utils/booleanSearch';

export interface SearchInterpretation {
  query: string;
  filters: SearchFilters;
  appliedHints: string[];
}

const AUDITORS = ['Deloitte', 'PwC', 'EY', 'KPMG', 'BDO', 'Grant Thornton', 'RSM'];
const FORM_PATTERNS: Array<{ form: string; re: RegExp }> = [
  { form: '10-K', re: /\b10[\s-]?k\b/gi },
  { form: '10-Q', re: /\b10[\s-]?q\b/gi },
  { form: '8-K', re: /\b8[\s-]?k(?:\/a)?\b/gi },
  { form: 'DEF 14A', re: /\bdef[\s-]?14a\b/gi },
  { form: '20-F', re: /\b20[\s-]?f\b/gi },
  { form: '6-K', re: /\b6[\s-]?k\b/gi },
  { form: 'S-1', re: /\bs[\s-]?1\b/gi },
];
const STOPWORDS = new Set([
  'a', 'an', 'and', 'as', 'at', 'be', 'by', 'companies', 'company', 'filed', 'filings',
  'find', 'for', 'from', 'had', 'has', 'i', 'in', 'is', 'it', 'its', 'last', 'me', 'of',
  'on', 'or', 'please', 'search', 'show', 'that', 'the', 'their', 'these', 'this', 'to',
  'trying', 'under', 'was', 'were', 'with', 'within', 'years',
]);

function cloneFilters(filters: SearchFilters): SearchFilters {
  return {
    ...filters,
    formTypes: [...filters.formTypes],
    exchange: [...filters.exchange],
    acceleratedStatus: [...filters.acceleratedStatus],
  };
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferPhraseCandidates(value: string): string[] {
  const tokens = value
    .split(/\s+/)
    .map(token => token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''))
    .filter(Boolean);
  const phrases: string[] = [];
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length >= 2) {
      const longest = buffer.slice(0, Math.min(buffer.length, 4)).join(' ');
      phrases.push(longest);
      if (buffer.length >= 3) {
        phrases.push(buffer.slice(Math.max(0, buffer.length - 4)).join(' '));
      }
    }
    buffer = [];
  };

  for (const token of tokens) {
    const normalized = normalize(token);
    if (
      normalized &&
      /[A-Za-z]/.test(token) &&
      normalized.length > 2 &&
      !STOPWORDS.has(normalized)
    ) {
      buffer.push(token);
    } else {
      flush();
    }
  }

  flush();
  return Array.from(new Set(phrases));
}

function buildKeywordQuery(value: string): string {
  const quotedPhrases = Array.from(value.matchAll(/"([^"]+)"/g))
    .map(match => match[1].replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const inferredPhrases = inferPhraseCandidates(value);

  const remaining = value.replace(/"([^"]+)"/g, ' ');
  const tokens = remaining
    .split(/[\s,/]+/)
    .map(token => token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''))
    .filter(token => {
      if (!token) return false;
      const normalized = normalize(token);
      if (!normalized) return false;
      if (!/[A-Za-z]/.test(token)) return false;
      if (normalized.length <= 2 && !/\d/.test(normalized)) return false;
      return !STOPWORDS.has(normalized);
    });

  const phraseTerms = Array.from(new Set([...quotedPhrases, ...inferredPhrases]))
    .slice(0, 3)
    .map(term => `"${term}"`);
  const unique = Array.from(new Set([...phraseTerms, ...tokens]));
  return unique.slice(0, 10).join(' ').trim();
}

export function interpretSearchPrompt(rawPrompt: string, filters: SearchFilters): SearchInterpretation {
  const prompt = rawPrompt.trim();
  const nextFilters = cloneFilters(filters);
  const appliedHints: string[] = [];

  if (!prompt) {
    return { query: '', filters: nextFilters, appliedHints };
  }

  let working = ` ${prompt} `;

  const yearsMatch = working.match(/\b(?:in|during|over|within)?\s*(?:the\s+)?(?:last|past)\s+(\d{1,2})\s+years?\b/i);
  if (yearsMatch) {
    const years = Number(yearsMatch[1]);
    if (Number.isFinite(years) && years > 0) {
      const end = new Date();
      const start = new Date();
      start.setFullYear(end.getFullYear() - years);
      nextFilters.dateFrom = start.toISOString().split('T')[0];
      nextFilters.dateTo = end.toISOString().split('T')[0];
      appliedHints.push(`Window: last ${years} year${years === 1 ? '' : 's'}`);
    }
    working = working.replace(yearsMatch[0], ' ');
  }

  const detectedForms = FORM_PATTERNS
    .filter(item => item.re.test(working))
    .map(item => item.form);
  if (detectedForms.length > 0) {
    nextFilters.formTypes = Array.from(new Set(detectedForms));
    appliedHints.push(`Forms: ${nextFilters.formTypes.join(', ')}`);
    for (const pattern of FORM_PATTERNS) {
      working = working.replace(pattern.re, ' ');
    }
  }

  const auditor = AUDITORS.find(name => new RegExp(`\\b${name.replace(/\s+/g, '\\s+')}\\b`, 'i').test(working));
  if (auditor) {
    nextFilters.accountant = auditor;
    appliedHints.push(`Auditor: ${auditor}`);
    working = working
      .replace(new RegExp(`\\baudited\\s+by\\s+${auditor.replace(/\s+/g, '\\s+')}`, 'ig'), ' ')
      .replace(new RegExp(`\\bauditor\\s*:?\\s*${auditor.replace(/\s+/g, '\\s+')}`, 'ig'), ' ')
      .replace(new RegExp(`\\b${auditor.replace(/\s+/g, '\\s+')}\\b`, 'ig'), ' ');
  } else if (/\bbig\s+4\b|\bbig\s+four\b/i.test(working)) {
    nextFilters.accountant = 'Big 4';
    appliedHints.push('Auditor: Big 4');
    working = working.replace(/\bbig\s+4\b|\bbig\s+four\b/gi, ' ');
  }

  working = working
    .replace(/\b(?:i am trying to search for|i'm trying to search for|show me|find me|search for|look for|companies that had|companies with|filings about|filings with|results for)\b/gi, ' ')
    .replace(/\b(?:audited by|filed by|forms?|issues?|issuers?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const query = buildKeywordQuery(working) || buildKeywordQuery(prompt) || prompt;
  if (query && normalize(query) !== normalize(prompt)) {
    appliedHints.unshift(`Topic: ${query}`);
  }

  return {
    query,
    filters: nextFilters,
    appliedHints,
  };
}

export function buildHighlightTerms(query: string, mode: ResearchSearchMode, sectionKeywords = ''): string[] {
  const terms = new Set<string>();

  function addCandidate(value: string) {
    const trimmed = value.replace(/\s+/g, ' ').trim();
    if (!trimmed) return;
    if (trimmed.split(/\s+/).length > 1) {
      terms.add(trimmed);
    }

    for (const token of trimmed.split(/\s+/)) {
      const normalized = normalize(token);
      if (!normalized || STOPWORDS.has(normalized) || normalized.length < 3) continue;
      terms.add(token);
    }
  }

  const querySource = mode === 'boolean' ? buildCandidateQueryFromBoolean(query) : query;
  Array.from(query.matchAll(/"([^"]+)"/g))
    .map(match => match[1])
    .forEach(addCandidate);

  addCandidate(querySource);
  sectionKeywords
    .split(/[,\n;|]+/)
    .map(item => item.trim())
    .filter(Boolean)
    .forEach(addCandidate);

  return Array.from(terms)
    .sort((a, b) => {
      const wordDelta = b.split(/\s+/).length - a.split(/\s+/).length;
      if (wordDelta !== 0) return wordDelta;
      return b.length - a.length;
    })
    .slice(0, 12);
}
