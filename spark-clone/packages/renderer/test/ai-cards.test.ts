import { describe, expect, it } from 'vitest';
import {
  ago,
  bucketOf,
  dayKey,
  keywords,
  latestEditions,
  newsLabel,
  newsSenderTerms,
  parseJson,
  resourceKind,
  urlsIn,
} from '../src/lib/aiCards/text';

describe('parseJson', () => {
  it('reads a bare object', () => {
    expect(parseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });
  it('tolerates a fence and a preamble', () => {
    expect(parseJson<{ items: string[] }>('Here you go:\n```json\n{"items":["x"]}\n```')).toEqual({
      items: ['x'],
    });
  });
  it('stops at the end of the first object, braces in strings included', () => {
    expect(parseJson<{ a: string }>('{"a":"x}{y"} and more {"b":2}')).toEqual({ a: 'x}{y' });
  });
  it('throws when there is no object', () => {
    expect(() => parseJson('sorry, no')).toThrow();
  });
});

describe('bucketOf', () => {
  const today = new Date(2026, 10, 18).getTime();
  it('buckets due dates around today', () => {
    expect(bucketOf(null, today)).toBe('none');
    expect(bucketOf('2026-11-17', today)).toBe('overdue');
    expect(bucketOf('2026-11-18', today)).toBe('today');
    expect(bucketOf('2026-11-18T15:00:00.000+01:00', today)).toBe('today');
    expect(bucketOf('2026-11-22', today)).toBe('week');
    expect(bucketOf('2026-12-30', today)).toBe('later');
  });
});

describe('resourceKind', () => {
  it('recognises documents worth prepping with', () => {
    expect(resourceKind('https://docs.google.com/document/d/abc/edit')).toBe('doc');
    expect(resourceKind('https://docs.google.com/spreadsheets/d/abc')).toBe('sheet');
    expect(resourceKind('https://docs.google.com/presentation/d/abc')).toBe('slides');
    expect(resourceKind('https://drive.google.com/file/d/abc')).toBe('drive');
    expect(resourceKind('https://www.notion.so/team/Page-123')).toBe('notion');
    expect(resourceKind('https://meet.google.com/abc-defg-hij')).toBeNull();
    expect(resourceKind('https://example.com/unsubscribe')).toBeNull();
  });
});

describe('helpers', () => {
  it('finds URLs in plain text', () => {
    expect(urlsIn('see https://a.com/x, and (https://b.org/y) twice https://a.com/x.')).toEqual([
      'https://a.com/x',
      'https://b.org/y',
    ]);
  });
  it('keeps distinctive title words', () => {
    expect(keywords('Weekly sync: SDG Index & Data Team')).toEqual(['index', 'data']);
    expect(keywords('Uzbekistan report review 2027')).toEqual(['uzbekistan', 'report']);
  });
  it('formats waiting time and day keys', () => {
    const now = new Date(2026, 10, 18, 12, 0).getTime();
    expect(ago(now - 5 * 60_000, now)).toBe('5m');
    expect(ago(now - 2 * 3_600_000, now)).toBe('2h');
    expect(ago(now - 26 * 3_600_000, now)).toBe('1d');
    expect(dayKey(now)).toBe('2026-11-18');
  });
});

describe('news digest helpers', () => {
  it('defaults to tldr and upgrades the old tldrnewsletter default', () => {
    expect(newsSenderTerms(undefined)).toEqual(['tldr']);
    expect(newsSenderTerms([])).toEqual(['tldr']);
    expect(newsSenderTerms(['tldrnewsletter'])).toEqual(['tldr']);
    expect(newsSenderTerms(['TLDRnewsletter', 'tldr', ' morningbrew '])).toEqual([
      'tldr',
      'morningbrew',
    ]);
  });

  const at = (d: number, h: number) => new Date(2026, 10, d, h).getTime();
  const t = (id: string, ms: number) => ({ id, lastMessageDate: ms }) as never;

  it("keeps only the newest day's editions", () => {
    // Monday morning before the new edition: Friday's two editions, not Thursday's.
    const out = latestEditions([
      t('thu', at(19, 12)),
      t('fri-ai', at(20, 13)),
      t('fri', at(20, 12)),
    ]);
    expect(out.map((x: { id: string }) => x.id)).toEqual(['fri-ai', 'fri']);
    expect(latestEditions([])).toEqual([]);
  });

  it('labels the card by the day the editions came from', () => {
    const now = at(23, 9);
    expect(newsLabel(undefined, now)).toBe('Today’s news');
    expect(newsLabel(new Date(2026, 10, 23).getTime(), now)).toBe('Today’s news');
    expect(newsLabel(new Date(2026, 10, 22).getTime(), now)).toBe('Yesterday’s news');
    expect(newsLabel(new Date(2026, 10, 20).getTime(), now)).toMatch(/’s news$/);
  });
});
