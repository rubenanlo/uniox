import { describe, expect, it } from 'vitest';
import { parseMailto } from '../src/mailto';

describe('parseMailto', () => {
  it('reads a bare address', () => {
    expect(parseMailto('mailto:ana@example.com')).toEqual({
      to: ['ana@example.com'],
      cc: [],
      bcc: [],
      subject: '',
      body: '',
    });
  });

  it('reads several recipients and the cc/bcc/subject/body headers', () => {
    const d = parseMailto(
      'mailto:a@x.com,b@y.com?CC=c@z.com&bcc=d@z.com&subject=Hello%20there&body=Line%201%0D%0ALine%202',
    );
    expect(d).toEqual({
      to: ['a@x.com', 'b@y.com'],
      cc: ['c@z.com'],
      bcc: ['d@z.com'],
      subject: 'Hello there',
      body: 'Line 1\nLine 2',
    });
  });

  it('accumulates to= headers onto the path addresses', () => {
    expect(parseMailto('mailto:a@x.com?to=b@y.com')?.to).toEqual(['a@x.com', 'b@y.com']);
    expect(parseMailto('mailto:?to=b@y.com')?.to).toEqual(['b@y.com']);
  });

  it('decodes percent-encoded addresses and keeps + literal', () => {
    expect(parseMailto('mailto:ana%2Btag@example.com?subject=1+1')).toMatchObject({
      to: ['ana+tag@example.com'],
      subject: '1+1',
    });
  });

  it('tolerates malformed escapes', () => {
    expect(parseMailto('mailto:a@x.com?subject=100%')?.subject).toBe('100%');
  });

  it('rejects other schemes', () => {
    expect(parseMailto('https://example.com')).toBeNull();
  });
});
