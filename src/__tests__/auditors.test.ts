import { describe, it, expect } from 'vitest';
import {
  canonicalizeAuditorInput,
  findAuditorMention,
  stripAuditorMentions,
  buildAuditorSearchTerms,
  matchesAuditorSelection,
  detectAuditorInText,
  AUDITOR_OPTIONS,
} from '../services/auditors';

describe('auditors', () => {
  // ── canonicalizeAuditorInput ──
  describe('canonicalizeAuditorInput', () => {
    it('returns empty string for empty input', () => {
      expect(canonicalizeAuditorInput('')).toBe('');
    });

    it('returns empty string for whitespace', () => {
      expect(canonicalizeAuditorInput('   ')).toBe('');
    });

    it('canonicalizes "Deloitte & Touche LLP" to "Deloitte"', () => {
      expect(canonicalizeAuditorInput('Deloitte & Touche LLP')).toBe('Deloitte');
    });

    it('canonicalizes "PricewaterhouseCoopers" to "PwC"', () => {
      expect(canonicalizeAuditorInput('PricewaterhouseCoopers')).toBe('PwC');
    });

    it('canonicalizes "PricewaterhouseCoopers LLP" to "PwC"', () => {
      expect(canonicalizeAuditorInput('PricewaterhouseCoopers LLP')).toBe('PwC');
    });

    it('canonicalizes "Ernst & Young" to "EY"', () => {
      expect(canonicalizeAuditorInput('Ernst & Young')).toBe('EY');
    });

    it('canonicalizes "Ernst and Young LLP" to "EY"', () => {
      expect(canonicalizeAuditorInput('Ernst and Young LLP')).toBe('EY');
    });

    it('canonicalizes "KPMG LLP" to "KPMG"', () => {
      expect(canonicalizeAuditorInput('KPMG LLP')).toBe('KPMG');
    });

    it('canonicalizes "Big 4" input', () => {
      expect(canonicalizeAuditorInput('big 4')).toBe('Big 4');
    });

    it('canonicalizes "Big Four" input', () => {
      expect(canonicalizeAuditorInput('big four')).toBe('Big 4');
    });

    it('canonicalizes "BDO USA LLP" to "BDO"', () => {
      expect(canonicalizeAuditorInput('BDO USA LLP')).toBe('BDO');
    });

    it('canonicalizes "Grant Thornton LLP" to "Grant Thornton"', () => {
      expect(canonicalizeAuditorInput('Grant Thornton LLP')).toBe('Grant Thornton');
    });

    it('canonicalizes "RSM US LLP" to "RSM"', () => {
      expect(canonicalizeAuditorInput('RSM US LLP')).toBe('RSM');
    });

    it('canonicalizes "Crowe LLP" to "Crowe"', () => {
      expect(canonicalizeAuditorInput('Crowe LLP')).toBe('Crowe');
    });

    it('canonicalizes Baker Tilly alias', () => {
      expect(canonicalizeAuditorInput('Baker Tilly Virchow Krause')).toBe('Baker Tilly');
    });

    it('canonicalizes "Moss Adams LLP" to "Moss Adams"', () => {
      expect(canonicalizeAuditorInput('Moss Adams LLP')).toBe('Moss Adams');
    });

    it('canonicalizes "CBIZ Marcum"', () => {
      expect(canonicalizeAuditorInput('CBIZ Marcum')).toBe('Marcum');
    });

    it('returns input as-is for unknown auditor', () => {
      expect(canonicalizeAuditorInput('Unknown Firm')).toBe('Unknown Firm');
    });

    it('handles case-insensitive matching', () => {
      expect(canonicalizeAuditorInput('deloitte')).toBe('Deloitte');
    });

    it('handles mixed case with whitespace', () => {
      expect(canonicalizeAuditorInput('  pwc  ')).toBe('PwC');
    });
  });

  // ── findAuditorMention ──
  describe('findAuditorMention', () => {
    it('returns null for empty string', () => {
      expect(findAuditorMention('')).toBeNull();
    });

    it('finds Deloitte mention', () => {
      expect(findAuditorMention('audited by Deloitte & Touche LLP')?.label).toBe('Deloitte');
    });

    it('finds PwC mention', () => {
      expect(findAuditorMention('PricewaterhouseCoopers performed the audit')?.label).toBe('PwC');
    });

    it('finds EY mention in text', () => {
      expect(findAuditorMention('Ernst & Young LLP is the auditor')?.label).toBe('EY');
    });

    it('finds KPMG mention', () => {
      expect(findAuditorMention('KPMG LLP audited the statements')?.label).toBe('KPMG');
    });

    it('returns null for unknown text', () => {
      expect(findAuditorMention('some random company name')).toBeNull();
    });

    it('finds mention by alias inclusion', () => {
      expect(findAuditorMention('Price Waterhouse Coopers conducted the audit')?.label).toBe('PwC');
    });
  });

  // ── stripAuditorMentions ──
  describe('stripAuditorMentions', () => {
    it('removes auditor name from text', () => {
      const option = AUDITOR_OPTIONS.find(o => o.label === 'Deloitte')!;
      const result = stripAuditorMentions('filings audited by Deloitte', option);
      expect(result.trim()).not.toContain('Deloitte');
    });

    it('removes "auditor:" pattern', () => {
      const option = AUDITOR_OPTIONS.find(o => o.label === 'KPMG')!;
      const result = stripAuditorMentions('auditor: KPMG filings', option);
      expect(result.trim()).not.toContain('KPMG');
    });

    it('preserves other text', () => {
      const option = AUDITOR_OPTIONS.find(o => o.label === 'EY')!;
      const result = stripAuditorMentions('revenue growth audited by EY in 2023', option);
      expect(result).toContain('revenue');
      expect(result).toContain('growth');
    });
  });

  // ── buildAuditorSearchTerms ──
  describe('buildAuditorSearchTerms', () => {
    it('returns empty for empty input', () => {
      expect(buildAuditorSearchTerms('')).toEqual([]);
    });

    it('returns query terms for known auditor', () => {
      const terms = buildAuditorSearchTerms('Deloitte');
      expect(terms).toContain('Deloitte');
      expect(terms.some(t => t.includes('Deloitte'))).toBe(true);
    });

    it('returns Big 4 terms for "Big 4" input', () => {
      const terms = buildAuditorSearchTerms('Big 4');
      expect(terms.length).toBeGreaterThanOrEqual(4);
      expect(terms.some(t => t.includes('Deloitte'))).toBe(true);
      expect(terms.some(t => /pwc|pricewaterhousecoopers/i.test(t))).toBe(true);
    });

    it('returns the input for unknown auditor', () => {
      const terms = buildAuditorSearchTerms('Unknown Firm');
      expect(terms).toContain('Unknown Firm');
    });
  });

  // ── matchesAuditorSelection ──
  describe('matchesAuditorSelection', () => {
    it('returns true when filter is empty', () => {
      expect(matchesAuditorSelection('Deloitte', '')).toBe(true);
    });

    it('returns false when result auditor is empty', () => {
      expect(matchesAuditorSelection('', 'Deloitte')).toBe(false);
    });

    it('matches same canonical auditor', () => {
      expect(matchesAuditorSelection('Deloitte & Touche LLP', 'Deloitte')).toBe(true);
    });

    it('matches Big 4 filter against Deloitte', () => {
      expect(matchesAuditorSelection('Deloitte', 'Big 4')).toBe(true);
    });

    it('matches Big 4 filter against PwC', () => {
      expect(matchesAuditorSelection('PricewaterhouseCoopers', 'Big 4')).toBe(true);
    });

    it('rejects non-Big 4 auditor for Big 4 filter', () => {
      expect(matchesAuditorSelection('BDO', 'Big 4')).toBe(false);
    });

    it('matches case insensitively', () => {
      expect(matchesAuditorSelection('kpmg', 'KPMG')).toBe(true);
    });
  });

  // ── detectAuditorInText ──
  describe('detectAuditorInText', () => {
    it('returns empty for empty text', () => {
      expect(detectAuditorInText('')).toBe('');
    });

    it('returns empty for whitespace', () => {
      expect(detectAuditorInText('   ')).toBe('');
    });

    it('detects Deloitte in text', () => {
      expect(detectAuditorInText('Report of Deloitte & Touche LLP')).toBe('Deloitte');
    });

    it('detects PwC in text', () => {
      expect(detectAuditorInText('Audited by PricewaterhouseCoopers LLP')).toBe('PwC');
    });

    it('detects EY in text', () => {
      expect(detectAuditorInText('Ernst & Young LLP performed the audit')).toBe('EY');
    });

    it('detects KPMG in text', () => {
      expect(detectAuditorInText('KPMG LLP is the independent auditor')).toBe('KPMG');
    });

    it('returns empty for text with no auditor', () => {
      expect(detectAuditorInText('This is a regular filing with no auditor mentioned')).toBe('');
    });
  });

  // ── AUDITOR_OPTIONS ──
  describe('AUDITOR_OPTIONS', () => {
    it('contains at least 10 auditors', () => {
      expect(AUDITOR_OPTIONS.length).toBeGreaterThanOrEqual(10);
    });

    it('each option has label, aliases, queryTerms, patterns', () => {
      for (const option of AUDITOR_OPTIONS) {
        expect(option.label).toBeTruthy();
        expect(Array.isArray(option.aliases)).toBe(true);
        expect(Array.isArray(option.queryTerms)).toBe(true);
        expect(Array.isArray(option.patterns)).toBe(true);
      }
    });

    it('includes all Big 4 firms', () => {
      const labels = AUDITOR_OPTIONS.map(o => o.label);
      expect(labels).toContain('Deloitte');
      expect(labels).toContain('PwC');
      expect(labels).toContain('EY');
      expect(labels).toContain('KPMG');
    });
  });
});
