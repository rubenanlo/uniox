import { describe, expect, it } from 'vitest';
import {
  ago,
  bucketOf,
  dayKey,
  keywords,
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
