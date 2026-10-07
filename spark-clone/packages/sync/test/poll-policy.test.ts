import { describe, expect, it } from 'vitest';
import { shouldSkipFolderSync, type FolderStatusSnapshot } from '../src/poll-policy';

const snap = (over: Partial<FolderStatusSnapshot> = {}): FolderStatusSnapshot => ({
  uidValidity: 7,
  uidNext: 100,
  exists: 42,
  modseq: '555',
  ...over,
});

describe('shouldSkipFolderSync', () => {
  const base = {
    cursorUidValidity: 7,
    prev: snap(),
    now: snap(),
    hasCondstore: true,
    msSinceFullSync: 60_000,
  };

  it('skips when nothing moved on a CONDSTORE server', () => {
    expect(shouldSkipFolderSync(base)).toBe(true);
  });

  it('never skips the first pass of a session', () => {
    expect(shouldSkipFolderSync({ ...base, prev: null, msSinceFullSync: Infinity })).toBe(false);
  });

  it('runs on new mail (uidNext advanced)', () => {
    expect(shouldSkipFolderSync({ ...base, now: snap({ uidNext: 101 }) })).toBe(false);
  });

  it('runs on expunge (exists dropped)', () => {
    expect(shouldSkipFolderSync({ ...base, now: snap({ exists: 41 }) })).toBe(false);
  });

  it('runs on flag change (modseq moved)', () => {
    expect(shouldSkipFolderSync({ ...base, now: snap({ modseq: '556' }) })).toBe(false);
  });

  it('runs on uidvalidity change', () => {
    expect(shouldSkipFolderSync({ ...base, cursorUidValidity: 6 })).toBe(false);
  });

  it('without CONDSTORE, still refreshes flags every 15 minutes', () => {
    const noCond = {
      ...base,
      hasCondstore: false,
      now: snap({ modseq: null }),
      prev: snap({ modseq: null }),
    };
    expect(shouldSkipFolderSync({ ...noCond, msSinceFullSync: 5 * 60_000 })).toBe(true);
    expect(shouldSkipFolderSync({ ...noCond, msSinceFullSync: 16 * 60_000 })).toBe(false);
  });

  it('forces a periodic full pass so the 3-month window keeps advancing', () => {
    expect(shouldSkipFolderSync({ ...base, msSinceFullSync: 7 * 60 * 60_000 })).toBe(false);
  });
});
