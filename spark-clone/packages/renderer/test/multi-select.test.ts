import type { ThreadSummary } from '@app/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  advancePastMultiSelection,
  extendSelection,
  multiSelectedThreads,
  toggleInSelection,
} from '../src/lib/multiSelect';
import { useUi } from '../src/state/store';

const t = (id: string) => ({ id, accountId: 'a' }) as ThreadSummary;
const rows = ['t1', 't2', 't3', 't4'].map((id) => ({ kind: 'thread' as const, thread: t(id) }));

describe('multi-select', () => {
  beforeEach(() => {
    useUi.getState().setVisibleRows(rows);
    useUi.getState().selectThread('t2', true);
  });

  it('⇧↓ grows a range from the anchor and ⇧↑ shrinks it back', () => {
    extendSelection(1);
    extendSelection(1);
    expect(useUi.getState().multiSelected).toEqual(['t2', 't3', 't4']);
    expect(useUi.getState().selectedThreadId).toBe('t4');
    extendSelection(-1);
    expect(useUi.getState().multiSelected).toEqual(['t2', 't3']);
    expect(multiSelectedThreads()?.map((x) => x.id)).toEqual(['t2', 't3']);
  });

  it('a range can grow upward past the anchor', () => {
    extendSelection(-1);
    expect(useUi.getState().multiSelected).toEqual(['t1', 't2']);
  });

  it('a plain selection ends the multi-pick', () => {
    extendSelection(1);
    useUi.getState().selectThread('t1', true);
    expect(useUi.getState().multiSelected).toEqual([]);
    expect(multiSelectedThreads()).toBeNull();
  });

  it('⌘-click toggles single rows in list order', () => {
    toggleInSelection('t4');
    expect(useUi.getState().multiSelected).toEqual(['t2', 't4']);
    toggleInSelection('t2');
    expect(useUi.getState().multiSelected).toEqual([]);
    expect(useUi.getState().selectedThreadId).toBe('t4');
  });

  it('after a bulk move the cursor lands below the picked rows', () => {
    extendSelection(1); // t2..t3
    advancePastMultiSelection();
    expect(useUi.getState().selectedThreadId).toBe('t4');
    expect(useUi.getState().multiSelected).toEqual([]);
  });

  it('rows leaving the list drop out of the pick', () => {
    extendSelection(1);
    useUi.getState().setVisibleRows(rows.filter((r) => r.thread.id !== 't3'));
    expect(useUi.getState().multiSelected).toEqual(['t2']);
  });
});
