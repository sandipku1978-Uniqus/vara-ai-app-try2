import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const supportSource = readFileSync(resolve(process.cwd(), 'src/views/SupportCenter.tsx'), 'utf8');
const landingSource = readFileSync(resolve(process.cwd(), 'src/views/LandingPage.tsx'), 'utf8');

describe('product copy truth contracts', () => {
  it('does not document capabilities absent from the current specialist views', () => {
    for (const unsupportedClaim of [
      'trending topics in the overview cards',
      'meeting attendance scores',
      'quantitative trend analysis across filing populations',
      'Search for ESG-related keywords',
      'SPAC filings',
      'merger proxies',
      'Review transaction patterns',
      'clicking a company name in search results',
      'Click any filing to open it in the Filing Detail viewer',
      'search by company or insider name',
      'committee memberships, tenure',
    ]) {
      expect(supportSource).not.toContain(unsupportedClaim);
    }
    expect(supportSource).toContain('those fields are not parsed into the platform table');
    expect(supportSource).toContain('Use View to open a recent source document on SEC.gov');
  });

  it('labels every hard-coded hero-data panel illustrative and avoids collaboration claims', () => {
    expect(landingSource.match(/Illustrative /g)).toHaveLength(4);
    for (const unsupportedClaim of [
      'Live Signal',
      'Operationalize research across the team',
      'repeatable team workflow',
      'without rebuilding your analysis from scratch',
      'with context intact',
      'covers the whole SEC workflow',
      'every major research lane',
      'keep teams in flow',
      'without resetting your work',
      'enterprise research environment',
    ]) {
      expect(landingSource).not.toContain(unsupportedClaim);
    }
    expect(landingSource).toContain('Saved research state remains browser-local');
  });
});
