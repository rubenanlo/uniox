import { beforeEach, describe, expect, it } from 'vitest';
import { useUi } from '../src/state/store';

/**
 * Selection intent drives read-marking: deliberate opens (click / Enter /
 * notification) mark a thread read, auto selections (arrow browsing,
 * post-triage advance) only preview it. ThreadView reads `selectionAuto`
 * to decide — these tests pin the store side of that contract.
 */
describe('selectThread intent', () => {
  beforeEach(() => {
    useUi.setState({ selectedThreadId: null, selectionAuto: false });
  });

  it('defaults to a deliberate selection (click / notification)', () => {
    useUi.getState().selectThread('t1');
    expect(useUi.getState().selectedThreadId).toBe('t1');
    expect(useUi.getState().selectionAuto).toBe(false);
  });

  it('keeps auto selections marked as previews (arrow browsing)', () => {
    useUi.getState().selectThread('t1', true);
    expect(useUi.getState().selectionAuto).toBe(true);
  });

  it('upgrades an auto selection to deliberate when re-selected (Enter on the browsed row)', () => {
    useUi.getState().selectThread('t1', true);
    useUi.getState().selectThread('t1');
    expect(useUi.getState().selectedThreadId).toBe('t1');
    expect(useUi.getState().selectionAuto).toBe(false);
  });

  it('does not let a previous deliberate open leak into the next arrow move', () => {
    useUi.getState().selectThread('t1');
    useUi.getState().selectThread('t2', true);
    expect(useUi.getState().selectionAuto).toBe(true);
  });
});
