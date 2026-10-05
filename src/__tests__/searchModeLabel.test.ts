import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SEARCH_MODE_LABEL } from '../services/filingResearchPlan';
import { looksLikeBooleanQuery } from '../utils/booleanSearch';

/**
 * The `semantic` search mode is a rule-based plain-language parser, not
 * semantic retrieval (gap analysis row 9). Users see it as "Plain language"
 * everywhere; the internal id stays `semantic` for stored alerts, searches,
 * jobs and URLs. These checks keep the visible copy honest and in agreement.
 */

function source(path: string): string {
  return readFileSync(resolve(process.cwd(), 'src', path), 'utf8');
}

const SURFACES = [
  'views/SearchPage.tsx',
  'views/AccountingHub.tsx',
  'views/SupportCenter.tsx',
  'components/research/BooleanSyntaxHelp.tsx',
  'components/research/DocumentFind.tsx',
];

describe('plain-language search mode label', () => {
  it('calls the semantic-id mode "Plain language"', () => {
    expect(SEARCH_MODE_LABEL).toEqual({ semantic: 'Plain language', boolean: 'Boolean / Proximity' });
  });

  it.each(SURFACES)('%s never names the mode Filing Research, natural language search or semantic search', path => {
    const text = source(path);
    expect(text).not.toMatch(/Filing Research mode|Filing Research query|between Filing Research and Boolean/);
    expect(text).not.toMatch(/'Filing research'|Natural language search/);
    expect(text).not.toMatch(/\bsemantic search\b/i);
  });

  it('the Support Center explains the mode as a rule-based parser, not semantic retrieval', () => {
    const text = source('views/SupportCenter.tsx');
    expect(text).toContain('Plain language mode');
    expect(text).toContain('What is the difference between Plain language and Boolean search?');
    expect(text).toMatch(/rule-based parser, not semantic, conceptual or vector retrieval/);
  });

  it('the syntax help names exactly the signals that switch a plain-language query to Boolean', () => {
    const help = source('components/research/BooleanSyntaxHelp.tsx');
    expect(help).toContain('A Plain language query switches to Boolean mode only on signals prose never contains');
    for (const query of ['leases AND impairment', 'lease w/5 modification', 'weakness p/3 material', 'auditor:KPMG revenue', 'impairment $#', 'crypto*']) {
      expect(looksLikeBooleanQuery(query), query).toBe(true);
    }
    for (const query of ['increases and decreases in leases', 'what changed in revenue recognition?', '"material weakness" (restated)']) {
      expect(looksLikeBooleanQuery(query), query).toBe(false);
    }
  });
});
