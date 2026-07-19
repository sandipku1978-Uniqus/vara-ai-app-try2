import { describe, expect, it } from 'vitest';
import { uudecode } from '../../data-pipeline/fetch-letter-text';

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
