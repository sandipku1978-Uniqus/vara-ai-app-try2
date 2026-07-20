import { describe, expect, it } from 'vitest';
import {
  FASB_CODIFICATION_URL,
  ascTopicUrl,
  filterCuratedAscTopics,
} from '../config/accountingTopics';

describe('curated ASC topic directory', () => {
  it.each([
    ['606', 'Revenue from Contracts with Customers'],
    ['ASC 842', 'Leases'],
    ['stock compensation', 'Compensation — Stock Compensation'],
    ['credit losses', 'Financial Instruments — Credit Losses'],
  ])('finds %s in the curated directory', (query, expectedName) => {
    expect(filterCuratedAscTopics(query).map(topic => topic.name)).toContain(expectedName);
  });

  it('builds an official FASB Codification topic link', () => {
    expect(ascTopicUrl('606')).toBe(`${FASB_CODIFICATION_URL}606/`);
  });
});
