import { describe, expect, it } from 'vitest';
import { computeFinancialRatios } from '../services/secApi';

const metric = (value: number) => ({ value, unit: 'USD' });

describe('computeFinancialRatios methodology', () => {
  it('uses average balance-sheet denominators for returns and turnover', () => {
    const ratios = computeFinancialRatios({
      Revenues: metric(300),
      NetIncome: metric(30),
      TotalAssets: metric(200),
      StockholdersEquity: metric(100),
    }, {
      TotalAssets: metric(100),
      StockholdersEquity: metric(50),
    });

    expect(ratios.returnOnAssets).toBe(20);
    expect(ratios.returnOnEquity).toBe(40);
    expect(ratios.assetTurnover).toBe(2);
  });

  it('falls back to ending balances when prior-period units are unavailable', () => {
    const ratios = computeFinancialRatios({
      Revenues: metric(300),
      NetIncome: metric(30),
      TotalAssets: metric(200),
      StockholdersEquity: metric(100),
    });

    expect(ratios.returnOnAssets).toBe(15);
    expect(ratios.returnOnEquity).toBe(30);
    expect(ratios.assetTurnover).toBe(1.5);
  });
});
