import { describe, expect, it } from 'vitest';
import { compileBooleanQuery, extractAuditorFilterToken, parseBooleanQuery } from '../utils/booleanSearch';

/**
 * Readiness-audit R1 regression corpus: the auditor field as a PARSER-LEVEL
 * operand. Every case here reproduced as a live defect on 2026-08-04 while
 * auditor extraction was still a regex over raw text — quoted phrases were
 * mutated, precedence silently rewritten, malformed fields silently accepted,
 * and one retrieval branch silently dropped. These tests are the contract
 * that none of that can come back.
 */

describe('audit R1 corpus — precedence and grouping', () => {
  it('rejects "lease OR goodwill AND auditor:KPMG" instead of silently regrouping it', () => {
    // The old extraction produced (lease OR goodwill) AND auditor:KPMG —
    // auditor-filtering the lease branch the user never scoped.
    const result = compileBooleanQuery('lease OR goodwill AND auditor:KPMG');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('auditor-composition');
      expect(result.message).toMatch(/applies to only part of this query/i);
      // The remedy is in the message, verbatim enough to paste.
      expect(result.message).toContain('(lease OR goodwill) AND auditor:KPMG');
    }
  });

  it('accepts the explicitly grouped form and lifts the firm', () => {
    const result = compileBooleanQuery('(lease OR goodwill) AND auditor:KPMG');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auditor).toBe('KPMG');
      expect(result.residual).toBe('lease OR goodwill');
      expect(result.branches).toEqual(['lease', 'goodwill']);
    }
  });
});

describe('audit R1 corpus — negative branch anchoring', () => {
  it('accepts the mixed form now that the firm lane covers the negative branch (slice 2)', () => {
    // Slice 1 rejected this with a remedy; slice 2 made it EXECUTABLE: the
    // firm-scoped lane fetches PwC candidates and full-expression validation
    // enforces (impairment OR NOT goodwill). Without a firm the same shape
    // stays rejected — see the no-auditor case below.
    const result = compileBooleanQuery('auditor:PwC AND (impairment OR NOT goodwill)');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auditor).toBe('PwC');
      expect(result.branches).toEqual(['impairment']);
    }
  });

  it('still rejects the same shape without a firm to fetch by', () => {
    const result = compileBooleanQuery('impairment OR NOT goodwill');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unanchored-branch');
  });

  it('accepts the firm-anchored pure-negative form in either conjunct order', () => {
    for (const q of ['auditor:PwC AND NOT goodwill', 'NOT goodwill AND auditor:PwC']) {
      const result = compileBooleanQuery(q);
      expect(result.ok, q).toBe(true);
      if (result.ok) expect(result.auditor).toBe('PwC');
    }
  });
});

describe('audit R1 corpus — quoted literal protection', () => {
  it('never extracts a firm from inside a quoted phrase', () => {
    const result = compileBooleanQuery('"the auditor:KPMG engagement letter"');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auditor).toBe('');
      expect(result.residual).toBe('"the auditor:KPMG engagement letter"');
    }
  });

  it('parses the phrase literally at the AST level too', () => {
    const parsed = parseBooleanQuery('"the auditor:KPMG engagement letter"');
    expect(parsed.expression).toEqual({ type: 'PHRASE', value: 'the auditor:KPMG engagement letter' });
  });
});

describe('audit R1 corpus — malformed fields are rejected precisely', () => {
  it('duplicate auditor fields', () => {
    const result = compileBooleanQuery('auditor:PwC AND auditor:EY');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('auditor-composition');
      expect(result.message).toMatch(/one auditor: filter per query/i);
    }
  });

  it('empty firm — including the bare trailing-colon form', () => {
    for (const q of ['auditor: AND lease', 'auditor:']) {
      const result = compileBooleanQuery(q);
      expect(result.ok, q).toBe(false);
      if (!result.ok) expect(result.code).toBe('auditor-malformed');
    }
  });

  it('unterminated quoted firm falls to the unbalanced-quote error', () => {
    const result = compileBooleanQuery('auditor:"Ernst & Young');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unbalanced-quote');
  });

  it('wildcard firm', () => {
    const result = compileBooleanQuery('lease AND auditor:*');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('auditor-malformed');
  });

  it('numeric-only firm', () => {
    const result = compileBooleanQuery('auditor:123');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('auditor-malformed');
  });
});

describe('audit R1 corpus — valid forms keep working', () => {
  it('quoted multi-word firm', () => {
    const result = compileBooleanQuery('auditor:"Ernst & Young" AND lease');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.auditor).toBe('Ernst & Young');
      expect(result.residual).toBe('lease');
    }
  });

  it('plain root-AND composition', () => {
    const result = compileBooleanQuery('weakness AND auditor:EY');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.auditor).toBe('EY');
  });

  it('auditor-only firm-scoped browse', () => {
    const result = compileBooleanQuery('auditor:KPMG');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ast).toBeNull();
      expect(result.branches).toEqual([]);
      expect(result.auditor).toBe('KPMG');
    }
  });

  it('field aliases still resolve', () => {
    for (const field of ['accountant', 'auditfirm', 'audited_by', 'audited-by']) {
      const result = compileBooleanQuery(`weakness AND ${field}:BDO`);
      expect(result.ok, field).toBe(true);
      if (result.ok) expect(result.auditor).toBe('BDO');
    }
  });
});

describe('audit R1 corpus — extraction shim refuses to rewrite rejected queries', () => {
  it('passes rejected compositions through untouched', () => {
    const { auditor, residual } = extractAuditorFilterToken('auditor:KPMG OR restructuring');
    expect(auditor).toBe('');
    expect(residual).toBe('auditor:KPMG OR restructuring');
  });

  it('still lifts valid root-AND compositions', () => {
    const { auditor, residual } = extractAuditorFilterToken('weakness AND auditor:EY');
    expect(auditor).toBe('EY');
    expect(residual).toBe('weakness');
  });
});

describe('snippet truth-gate (audit R1 slice 5)', () => {
  it('returns no snippet for text the full expression rejects', async () => {
    const { extractBooleanMatchSnippet } = await import('../utils/booleanSearch');
    // Text contains the positive term but violates NOT goodwill — an excerpt
    // here would read as evidence for a claim the engine did not make.
    const text = 'impairment charges rose while goodwill balances remained flat';
    expect(extractBooleanMatchSnippet('impairment AND NOT goodwill', text)).toBeNull();
  });

  it('still yields the excerpt when the full expression matches', async () => {
    const { extractBooleanMatchSnippet } = await import('../utils/booleanSearch');
    const text = 'impairment charges rose across reporting units this year';
    const snippet = extractBooleanMatchSnippet('impairment AND NOT goodwill', text);
    expect(snippet?.excerpt).toContain('impairment');
  });
});
