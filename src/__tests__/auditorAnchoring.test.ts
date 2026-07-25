import { describe, it, expect } from 'vitest';
import { detectAuditorInText } from '../services/auditors';

/**
 * Both cases are reductions of real 10-Ks, found by widening the accuracy gate
 * across sectors. Scanning slices of a filing for bare firm names attributes
 * whatever it lands on; the auditor is whoever signed the audit report.
 */

const filler = (chars: number) => 'The Company operates in many markets. '.repeat(Math.ceil(chars / 38)).slice(0, chars);

describe('auditor detection is anchored to the audit report', () => {
  it('does not read "rate stabilization mechanism (RSM)" as the audit firm (NextEra)', () => {
    // RSM appears at ~31k as an acronym in the rate-agreement discussion; the
    // real report sits past 260k, beyond the window the scanner used to read.
    const text = [
      filler(30_000),
      'FPL is authorized to implement a rate stabilization mechanism (RSM) over the term of the agreement.',
      filler(230_000),
      'Report of Independent Registered Public Accounting Firm',
      "NEE's and FPL's independent registered public accounting firm, Deloitte & Touche LLP, is engaged to express an opinion.",
    ].join('\n');

    expect(detectAuditorInText(text)).toBe('Deloitte');
  });

  it('does not read a director biography as the audit firm (Home Depot)', () => {
    // The signed report is mid-document; the EY mention is a bio near the end,
    // which is exactly what the old head/tail scan saw.
    const text = [
      filler(180_000),
      '/s/ KPMG LLP',
      "We have served as the Company's auditor since 1979. Atlanta, Georgia",
      filler(120_000),
      'Prior to joining the Company, Ms. Smith was a consultant with Ernst & Young, LLP.',
      filler(20_000),
    ].join('\n');

    expect(detectAuditorInText(text)).toBe('KPMG');
  });

  it('takes the signatory when several firms appear near the report', () => {
    const text = [
      'Report of Independent Registered Public Accounting Firm',
      'The predecessor auditor Deloitte & Touche LLP was dismissed during the year.',
      filler(2_000),
      '/s/ Ernst & Young LLP',
      "We have served as the Company's auditor since 2009.",
    ].join('\n');

    expect(detectAuditorInText(text)).toBe('EY');
  });

  it('reports the earliest firm in a window, not the first in the catalogue', () => {
    const text = [
      '/s/ KPMG LLP',
      "We have served as the Company's auditor since 2011.",
    ].join(' ');

    // Deloitte leads AUDITOR_OPTIONS; position must win over list order.
    expect(detectAuditorInText(text)).toBe('KPMG');
  });

  it('still finds an auditor in a document with no report anchors at all', () => {
    // An exhibit or a pre-2000 filing — fall back rather than report nothing.
    expect(detectAuditorInText('The financial statements were audited by KPMG LLP.')).toBe('KPMG');
  });

  it('returns nothing for text with no auditor', () => {
    expect(detectAuditorInText('We manufacture industrial fasteners.')).toBe('');
    expect(detectAuditorInText('')).toBe('');
  });

  it('is stable across repeated calls', () => {
    // Shared module-level patterns carry lastIndex when they are global; a
    // leaked lastIndex would make the second call skip the start of the text.
    const text = '/s/ PricewaterhouseCoopers LLP We have served as the Company\'s auditor since 2000.';
    const first = detectAuditorInText(text);
    expect(detectAuditorInText(text)).toBe(first);
    expect(detectAuditorInText(text)).toBe('PwC');
  });
});
