import { describe, expect, it } from 'vitest';
import { NO_RECENT, nextRecentIndex } from '../src/lib/searchNav';

describe('nextRecentIndex', () => {
  it('highlights the first recent on the way down from the input', () => {
    expect(nextRecentIndex('ArrowDown', NO_RECENT, 3)).toBe(0);
  });

  it('highlights the last recent on the way up from the input', () => {
    expect(nextRecentIndex('ArrowUp', NO_RECENT, 3)).toBe(2);
  });

  it('steps down through the list', () => {
    expect(nextRecentIndex('ArrowDown', 0, 3)).toBe(1);
    expect(nextRecentIndex('ArrowDown', 1, 3)).toBe(2);
  });

  it('steps back up through the list', () => {
    expect(nextRecentIndex('ArrowUp', 2, 3)).toBe(1);
  });

  it('returns to the input past the end of the list', () => {
    expect(nextRecentIndex('ArrowDown', 2, 3)).toBe(NO_RECENT);
  });

  it('returns to the input before the start of the list', () => {
    expect(nextRecentIndex('ArrowUp', 0, 3)).toBe(NO_RECENT);
  });

  it('has nothing to highlight when there are no recents', () => {
    expect(nextRecentIndex('ArrowDown', NO_RECENT, 0)).toBe(NO_RECENT);
    expect(nextRecentIndex('ArrowUp', NO_RECENT, 0)).toBe(NO_RECENT);
  });

  it('recovers from an index left over from a longer list', () => {
    // A stale index falls back to "nothing highlighted", so the keypress still
    // moves somewhere visible rather than appearing to do nothing.
    expect(nextRecentIndex('ArrowDown', 9, 3)).toBe(0);
    expect(nextRecentIndex('ArrowUp', 9, 3)).toBe(2);
  });
});
