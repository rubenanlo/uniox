import { describe, expect, it } from 'vitest';
import { parseDateInput } from '../src/lib/parseDate';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day).getTime();
// Tuesday 27 Oct 2026, mid-afternoon.
const NOW = new Date(2026, 9, 27, 15, 30).getTime();
const p = (s: string, dayFirst = true) => parseDateInput(s, NOW, dayFirst);

describe('parseDateInput', () => {
  it('reads today / tomorrow / yesterday', () => {
    expect(p('Today')).toBe(d(2026, 10, 27));
    expect(p('tomorrow')).toBe(d(2026, 10, 28));
    expect(p('yesterday')).toBe(d(2026, 10, 26));
  });
  it('reads relative offsets', () => {
    expect(p('+3')).toBe(d(2026, 10, 30));
    expect(p('-2')).toBe(d(2026, 10, 25));
    expect(p('+2w')).toBe(d(2026, 11, 10));
    expect(p('in 3 days')).toBe(d(2026, 10, 30));
    expect(p('2 weeks ago')).toBe(d(2026, 10, 13));
    expect(p('next week')).toBe(d(2026, 11, 3));
    expect(p('next month')).toBe(d(2026, 11, 27));
    expect(p('+1m')).toBe(d(2026, 11, 27));
  });
  it('reads weekdays as the next / last occurrence', () => {
    expect(p('fri')).toBe(d(2026, 10, 30));
    expect(p('next tuesday')).toBe(d(2026, 11, 3)); // never today
    expect(p('last friday')).toBe(d(2026, 10, 23));
    expect(p('mon')).toBe(d(2026, 11, 2));
  });
  it('reads ISO and numeric dates in the locale order', () => {
    expect(p('2026-11-15')).toBe(d(2026, 11, 15));
    expect(p('15/11/2026')).toBe(d(2026, 11, 15));
    expect(p('15.11')).toBe(d(2026, 11, 15));
    expect(p('3/4/27')).toBe(d(2027, 4, 3));
    expect(p('11/15/2026', false)).toBe(d(2026, 11, 15));
  });
  it('reads month names either way round', () => {
    expect(p('15 nov')).toBe(d(2026, 11, 15));
    expect(p('Nov 15')).toBe(d(2026, 11, 15));
    expect(p('15th of November 2027')).toBe(d(2027, 11, 15));
    expect(p('november 15th, 2027')).toBe(d(2027, 11, 15));
    expect(p('Sept 3')).toBe(d(2026, 9, 3));
    expect(p('december')).toBe(d(2026, 12, 1));
    expect(p('may 2027')).toBe(d(2027, 5, 1));
  });
  it('rejects text that is not a real date', () => {
    expect(p('')).toBeNull();
    expect(p('31/2/2026')).toBeNull();
    expect(p('hello')).toBeNull();
    expect(p('13/13')).toBeNull();
  });
});
