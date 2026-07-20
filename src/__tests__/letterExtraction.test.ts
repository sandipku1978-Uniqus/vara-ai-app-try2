import { describe, expect, it } from 'vitest';
import {
  extractLetterIdentifiers,
  deriveStoredLetterIdentifierPatch,
  nextLetterRetryAt,
  shouldRethreadLetters,
  uudecode,
} from '../../data-pipeline/fetch-letter-text';

describe('data-pipeline/fetch-letter-text uudecode', () => {
  it('decodes a classic uuencoded block', () => {
    // "Cat" uuencoded: length char '#' (3), then 4 chars encoding 3 bytes
    const encoded = 'begin 644 test.txt\n#0V%T\n`\nend\n';
    expect(uudecode(encoded).toString('utf8')).toBe('Cat');
  });

  it('decodes multi-line blocks and ignores framing lines', () => {
    // "Hello Worl" (10 bytes) as one uuencoded line: '*' = 10
    const encoded = 'begin 644 x\n*2&5L;&\\@5V]R;```\n`\nend';
    expect(uudecode(encoded).toString('utf8')).toBe('Hello Worl');
  });

  it('returns empty buffer for empty/malformed input', () => {
    expect(uudecode('').length).toBe(0);
    expect(uudecode('begin 644 x\nend').length).toBe(0);
  });
});

describe('comment-letter review identity and retry policy', () => {
  it('derives the same review key from a referenced filing header', () => {
    const staff = extractLetterIdentifiers(`
      <p>Re: Example Corp</p>
      <p>Form 10-K for the Fiscal Year Ended December 31, 2025</p>
      <p>File No. 001-12345</p>
      <p>Accession Number 0000123456-26-000010</p>
    `);
    const response = extractLetterIdentifiers(`
      Re: Example Corp\nForm 10-K for Fiscal 2025\nFile Number: 001-12345\nAccession Number 0000123456-26-000010
    `);

    expect(staff).toMatchObject({
      subject: 'Example Corp',
      fileNumber: '001-12345',
      referencedAccession: '0000123456-26-000010',
    });
    expect(staff.reviewKey).toBe(response.reviewKey);
  });

  it('ignores each correspondence submission accession and uses the shared referenced filing', () => {
    const staff = extractLetterIdentifiers(`
      <SEC-HEADER><ACCESSION-NUMBER>0001111111-26-000001</ACCESSION-NUMBER></SEC-HEADER>
      <DOCUMENT><TEXT>
      Re: Example Corp
      Form 10-K for fiscal year 2025
      File No. 001-12345
      Referenced Accession Number: 0000123456-25-000099
      </TEXT></DOCUMENT>
    `);
    const response = extractLetterIdentifiers(`
      <IMS-HEADER><ACCESSION-NUMBER>0002222222-26-000777</ACCESSION-NUMBER></IMS-HEADER>
      <DOCUMENT><TEXT>
      Re: Example Corp
      Form 10-K for fiscal year 2025
      File No. 001-12345
      Accession No. 0000123456-25-000099
      </TEXT></DOCUMENT>
    `);

    expect(staff.referencedAccession).toBe('0000123456-25-000099');
    expect(response.referencedAccession).toBe('0000123456-25-000099');
    expect(staff.reviewKey).toBe(response.reviewKey);
  });

  it('does not use a bare issuer file number as a cross-review identity', () => {
    expect(extractLetterIdentifiers('Re: General correspondence\nFile No. 001-12345').reviewKey).toBeNull();
  });

  it('pairs staff and response letters by file, form, and period when no accession is quoted', () => {
    const staff = extractLetterIdentifiers(`
      Re: Example Corp
      Form 10-K
      For the fiscal year ended December 31, 2024
      File No. 001-12345
    `);
    const response = extractLetterIdentifiers(`
      Re: Example Corp Form 10-K for fiscal year 2024
      File Number: 001-12345
    `);

    expect(staff.referencedAccession).toBeNull();
    expect(staff.reviewKey).not.toBeNull();
    expect(staff.reviewKey).toBe(response.reviewKey);
  });

  it('backs transient retries off from 15 minutes to a seven-day cap', () => {
    const now = Date.parse('2026-07-19T00:00:00.000Z');
    expect(nextLetterRetryAt(1, now)).toBe('2026-07-19T00:15:00.000Z');
    expect(nextLetterRetryAt(99, now)).toBe('2026-07-26T00:00:00.000Z');
  });

  it('reconciles an already-text-populated legacy row and schedules rethreading', () => {
    const patch = deriveStoredLetterIdentifierPatch(`
      Re: Example Corp Form 10-K for fiscal year 2024
      File No. 001-12345
      Referenced Accession Number 0000123456-24-000099
    `, '2026-07-19T00:00:00.000Z');

    expect(patch).toMatchObject({
      file_number: '001-12345',
      referenced_accession: '0000123456-24-000099',
      identifier_checked_at: '2026-07-19T00:00:00.000Z',
    });
    expect(patch.review_key).toMatch(/^review-/);
    expect(shouldRethreadLetters(1, 0)).toBe(true);
    expect(shouldRethreadLetters(0, 0)).toBe(false);
  });
});
