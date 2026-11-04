import { describe, expect, it } from 'vitest';
import { planPage } from '../src/lib/listPager';

// A header (30px) then ten 100px emails: header 0–30, email i at 30+100(i-1).
const spans = [{ start: 0, end: 30 }];
for (let i = 0; i < 10; i++) spans.push({ start: 30 + i * 100, end: 130 + i * 100 });
const nav = spans.map((_, i) => i > 0);
const VIEW = 350; // total 1030 → maxTop 680

describe('list paging', () => {
  it('Page Down brings the email cut at the bottom to the top and selects it', () => {
    // Viewport 0–350 cuts email 4 (330–430).
    expect(planPage('page-down', spans, nav, 0, VIEW)).toEqual({ scrollTo: 330, select: 4 });
  });

  it('Page Down near the end clamps the scroll but still moves the selection on', () => {
    // Viewport 500–850 cuts email 9 (830–930); scroll clamps to 680.
    expect(planPage('page-down', spans, nav, 500, VIEW)).toEqual({ scrollTo: 680, select: 9 });
  });

  it('Page Down on the last page stops on the last email', () => {
    expect(planPage('page-down', spans, nav, 680, VIEW)).toEqual({ scrollTo: null, select: 10 });
  });

  it('Page Up goes back a page and selects the email at the new top', () => {
    const plan = planPage('page-up', spans, nav, 680, VIEW)!;
    expect(plan.scrollTo).toBe(330);
    expect(plan.select).toBe(4);
  });

  it('Page Up at the top stops on the first email', () => {
    expect(planPage('page-up', spans, nav, 0, VIEW)).toEqual({ scrollTo: 0, select: 1 });
    expect(planPage('page-up', spans, nav, 200, VIEW)).toEqual({ scrollTo: 0, select: 1 });
  });

  it('Home and End jump to the first and last email', () => {
    expect(planPage('first', spans, nav, 400, VIEW)).toEqual({ scrollTo: 0, select: 1 });
    expect(planPage('last', spans, nav, 0, VIEW)).toEqual({ scrollTo: 680, select: 10 });
  });

  it('does nothing on an empty list', () => {
    expect(planPage('page-down', [], [], 0, VIEW)).toBeNull();
  });
});
