import { describe, it, expect, vi } from 'vitest';
import {
  filingBlockPath,
  filingSummaryPath,
  locateTopicInBlocks,
  parseFilingSummary,
  rankTopicBlocks,
  stripSgmlEnvelope,
  stripXbrlReportChrome,
} from '../services/filingStructure';
import { findDisclosureTopic, locateTopicPassage } from '../services/disclosureTopics';

const leases = findDisclosureTopic('leases')!;
const revenue = findDisclosureTopic('revenue-recognition')!;

const SUMMARY = `<?xml version="1.0"?>
<FilingSummary>
  <MyReports>
    <Report><ShortName>Cover Page</ShortName><HtmlFileName>R1.htm</HtmlFileName></Report>
    <Report><ShortName>LEASES</ShortName><HtmlFileName>R23.htm</HtmlFileName></Report>
    <Report><ShortName>ACCOUNTING POLICIES (Policies)</ShortName><HtmlFileName>R29.htm</HtmlFileName></Report>
    <Report><ShortName>LEASES (Tables)</ShortName><HtmlFileName>R41.htm</HtmlFileName></Report>
    <Report><ShortName>Maturities of Lease Liabilities (Detail)</ShortName><HtmlFileName>R91.htm</HtmlFileName></Report>
    <Report><ShortName>Leases - Additional Information (Detail)</ShortName><HtmlFileName>R87.htm</HtmlFileName></Report>
    <Report><ShortName>XBRL only</ShortName><XmlFileName>R99.xml</XmlFileName></Report>
  </MyReports>
</FilingSummary>`;

describe('parseFilingSummary', () => {
  it('reads the registrant-tagged report index', () => {
    const reports = parseFilingSummary(SUMMARY);
    expect(reports.map(r => r.file)).toContain('R23.htm');
    // A report with no HTML rendering cannot be read as a document.
    expect(reports.some(r => r.shortName === 'XBRL only')).toBe(false);
  });

  it('returns nothing for a filing with no summary rather than throwing', () => {
    expect(parseFilingSummary('')).toEqual([]);
    expect(parseFilingSummary('<html>404</html>')).toEqual([]);
  });
});

describe('stripSgmlEnvelope', () => {
  it('cuts EDGAR’s DOCUMENT wrapper so a DOM parser can find <body>', () => {
    // Left in place, the parser treats <DOCUMENT> as the root, finds no body,
    // and every block extracts as an empty string.
    const wrapped = '<DOCUMENT>\n<TYPE>XML\n<TEXT>\n<html><body><p>Leases</p></body></html>';
    expect(stripSgmlEnvelope(wrapped).startsWith('<html>')).toBe(true);
  });

  it('leaves ordinary html untouched', () => {
    expect(stripSgmlEnvelope('<html><body>x</body></html>')).toBe('<html><body>x</body></html>');
  });
});

describe('stripXbrlReportChrome', () => {
  it('removes the generated header so the reader gets the disclosure', () => {
    // Verbatim shape of Apple's tagged Revenue block.
    const block = [
      'v3.25.3', '', 'Revenue', '', '12 Months Ended', '', 'Sep. 27, 2025', '',
      'Revenue from Contract with Customer [Abstract]', '',
      'Revenue', 'Revenue',
      'The Company recognizes revenue at the amount to which it expects to be entitled when control of products or services is transferred to its customers.',
    ].join('\n');

    const cleaned = stripXbrlReportChrome(block);
    expect(cleaned).not.toContain('v3.25.3');
    expect(cleaned).not.toContain('12 Months Ended');
    expect(cleaned).not.toContain('Sep. 27, 2025');
    expect(cleaned).not.toContain('[Abstract]');
    expect(cleaned).toContain('The Company recognizes revenue');
    // The title is repeated twice in the source; one survives as the note's
    // own heading, which is what a reader expects above the prose.
    expect(cleaned.match(/^Revenue$/gm)).toHaveLength(1);
  });

  it('keeps a note heading that is not merely the repeated block title', () => {
    const block = [
      'v3.25.2', '', 'LEASES', '', '12 Months Ended', '', 'Jun. 30, 2025',
      'Leases [Abstract]', '', 'LEASES', '', 'NOTE 13 — LEASES', '',
      'We have operating and finance leases for datacenters, corporate offices and certain equipment.',
    ].join('\n');

    const cleaned = stripXbrlReportChrome(block);
    expect(cleaned).toContain('NOTE 13');
    expect(cleaned).toContain('We have operating and finance leases');
    expect(cleaned).not.toContain('Jun. 30, 2025');
  });

  it('returns the original when the shape is unexpected, rather than nothing', () => {
    const plain = 'A policy paragraph with no XBRL rendering header at all, long enough to keep.';
    expect(stripXbrlReportChrome(plain)).toBe(plain);
    expect(stripXbrlReportChrome('v3.25.3\nRevenue\n[Abstract]\ntiny')).toContain('tiny');
  });
});

describe('rankTopicBlocks', () => {
  const reports = parseFilingSummary(SUMMARY);

  it('puts the topic-named note ahead of the combined policies block', () => {
    const ranked = rankTopicBlocks(reports, leases);
    expect(ranked[0]).toMatchObject({ file: 'R23.htm', kind: 'note' });
    expect(ranked.map(r => r.file)).toContain('R29.htm');
  });

  it('excludes the numeric renderings of a note', () => {
    // (Tables), (Details) and parentheticals hold the tagged figures, not the
    // narrative a reader is asking for.
    const files = rankTopicBlocks(reports, leases).map(r => r.file);
    expect(files).not.toContain('R41.htm');
    expect(files).not.toContain('R91.htm');
    expect(files).not.toContain('R87.htm');
  });

  it('still offers the policies block when no note is named for the topic', () => {
    const ranked = rankTopicBlocks(reports, revenue);
    expect(ranked.every(r => r.kind === 'policy')).toBe(true);
    expect(ranked[0].file).toBe('R29.htm');
  });
});

describe('locateTopicInBlocks', () => {
  const reports = parseFilingSummary(SUMMARY);
  const leaseNote = [
    'We lease office space under operating leases.',
    'Operating lease right-of-use assets and lease liabilities are recognized at',
    'commencement based on the present value of lease payments over the lease term.',
    'We use our incremental borrowing rate when the rate implicit in the lease is not known.',
  ].join(' ');

  it('reads a topic-named block from the top rather than searching inside it', async () => {
    // The block IS the disclosure. Hunting for a heading within it is what
    // returned maturity tables titled "Leases".
    const match = await locateTopicInBlocks({
      reports,
      topic: leases,
      loadBlock: async () => leaseNote,
      locate: () => { throw new Error('the prose locator must not run on a tagged note'); },
    });

    expect(match?.blockName).toBe('LEASES');
    expect(match?.passage.text).toContain('right-of-use');
    expect(match?.passage.matchReason).toMatch(/tagged by the registrant/i);
  });

  it('searches within the combined policies block, which covers many topics', async () => {
    const locate = vi.fn(locateTopicPassage);
    await locateTopicInBlocks({
      reports,
      topic: revenue,
      loadBlock: async () => 'x'.repeat(500),
      locate,
    });
    expect(locate).toHaveBeenCalled();
  });

  it('returns null when nothing tagged covers the topic, so the caller can fall back', async () => {
    const match = await locateTopicInBlocks({
      reports: [],
      topic: leases,
      loadBlock: async () => leaseNote,
      locate: locateTopicPassage,
    });
    expect(match).toBeNull();
  });

  it('treats an unloadable block as unknown, not as an answer', async () => {
    const match = await locateTopicInBlocks({
      reports,
      topic: leases,
      loadBlock: async () => { throw new Error('network'); },
      locate: locateTopicPassage,
    });
    expect(match).toBeNull();
  });

  it('stops fetching once a block is plainly on topic', async () => {
    const loadBlock = vi.fn(async () => leaseNote);
    await locateTopicInBlocks({ reports, topic: leases, loadBlock, locate: locateTopicPassage });
    // The named note answered; the policies block must not be fetched too.
    expect(loadBlock).toHaveBeenCalledTimes(1);
  });
});

describe('paths', () => {
  it('builds proxy-safe paths with a padded CIK stripped and dashes removed', () => {
    expect(filingSummaryPath('0000320193', '0000320193-25-000079'))
      .toBe('Archives/edgar/data/320193/000032019325000079/FilingSummary.xml');
    expect(filingBlockPath('320193', '000032019325000079', 'R29.htm'))
      .toBe('Archives/edgar/data/320193/000032019325000079/R29.htm');
  });
});
