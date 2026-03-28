import { describe, expect, it } from 'vitest';
import { buildEsQuery } from '../../api/es-search.js';

describe('api/es-search', () => {
  it('keeps quoted semantic queries on the semantic multi-match path', () => {
    const query = buildEsQuery({
      q: '"Temporary equity"',
      forms: '10-K,10-Q',
      startdt: '2023-01-01',
      enddt: '2026-03-27',
      auditor: 'Deloitte',
      mode: 'semantic',
      size: 25,
    });

    expect(query.query.bool.must[0]).toHaveProperty('multi_match');
    expect(query.query.bool.must[0].multi_match.query).toBe('"Temporary equity"');
  });

  it('builds highlight-enabled semantic queries for plain text searches', () => {
    const query = buildEsQuery({
      q: 'temporary equity',
      forms: '10-K,10-Q',
      startdt: '2023-01-01',
      enddt: '2026-03-27',
      auditor: 'Deloitte',
      size: 25,
    });

    expect(query.query.bool.must[0]).toHaveProperty('multi_match');
    expect(query.query.bool.filter).toContainEqual({ term: { auditor: 'Deloitte' } });
    expect(query.highlight?.fields.content).toBeTruthy();
  });

  it('translates Boolean AND queries into Elasticsearch bool clauses', () => {
    const query = buildEsQuery({
      q: '"material weakness" AND cybersecurity',
      forms: '10-K',
      startdt: '2021-01-01',
      enddt: '2026-03-27',
      mode: 'boolean',
      size: 25,
    });

    const booleanClause = query.query.bool.must[0];
    expect(booleanClause).toHaveProperty('bool.must');
    expect(booleanClause.bool.must).toHaveLength(2);
  });

  it('translates proximity queries into Elasticsearch intervals clauses', () => {
    const query = buildEsQuery({
      q: 'ASC 842 adoption W/10 lease',
      forms: '10-K,10-Q',
      startdt: '2021-01-01',
      enddt: '2026-03-27',
      mode: 'boolean',
      size: 25,
    });

    const proximityClause = query.query.bool.must[0];
    expect(proximityClause).toHaveProperty('intervals.content.all_of.max_gaps', 10);
    expect(proximityClause.intervals.content.all_of.intervals).toHaveLength(2);
  });
});
