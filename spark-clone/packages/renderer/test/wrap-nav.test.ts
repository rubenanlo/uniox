import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/api', () => ({
  api: { query: vi.fn(), command: vi.fn(), onTriageUndo: vi.fn(() => () => {}) },
}));
const gatekeeper = vi.hoisted(() => ({ present: false }));
vi.mock('../src/lib/panels', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  focusGatekeeper: () => gatekeeper.present,
}));

import type { ThreadSummary } from '@app/shared';
import { moveSelection } from '../src/actions/registry';
import { useUi } from '../src/state/store';

const row = (id: string) =>
  ({ kind: 'thread', thread: { id, accountId: 'a1' } as ThreadSummary }) as const;

describe('↑/↓ wrap around the email list', () => {
  beforeEach(() => {
    gatekeeper.present = false;
    useUi.setState({ selectedThreadId: null, hoveredThreadId: null });
    useUi.getState().setVisibleRows([row('t1'), row('t2'), row('t3')]);
  });

  it('↓ on the last email lands on the first', () => {
    useUi.getState().selectThread('t3', true);
    moveSelection(1);
    expect(useUi.getState().selectedThreadId).toBe('t1');
  });

  it('↑ on the first email lands on the last', () => {
    useUi.getState().selectThread('t1', true);
    moveSelection(-1);
    expect(useUi.getState().selectedThreadId).toBe('t3');
  });

  it('↑ on the first email still climbs into new-sender cards when they are shown', () => {
    gatekeeper.present = true;
    useUi.getState().selectThread('t1', true);
    moveSelection(-1);
    expect(useUi.getState().selectedThreadId).toBe('t1');
  });

  it('moves normally in the middle', () => {
    useUi.getState().selectThread('t2', true);
    moveSelection(1);
    expect(useUi.getState().selectedThreadId).toBe('t3');
  });
});
