import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/api', () => ({
  api: {
    query: vi.fn(),
    command: vi.fn(),
    onTriageUndo: vi.fn(() => () => {}),
  },
}));

import type { ThreadSummary } from '@app/shared';
import { ACTIONS, matchCombo } from '../src/actions/registry';
import { api } from '../src/lib/api';
import { useUi } from '../src/state/store';

const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods }) as KeyboardEvent;

/** Mirror of KeymapProvider's dispatch: the first action whose binding matches wins. */
const dispatchTarget = (e: KeyboardEvent) =>
  ACTIONS.find((a) => matchCombo(e, a.combo) || matchCombo(e, a.altCombo ?? null)) ?? null;

const matches = (e: KeyboardEvent) =>
  ACTIONS.filter((a) => matchCombo(e, a.combo) || matchCombo(e, a.altCombo ?? null));

const thread = (over: Partial<ThreadSummary>): ThreadSummary =>
  ({ id: 't1', accountId: 'a1', unreadCount: 0, ...over }) as ThreadSummary;

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('toggle-read shortcut (U)', () => {
  beforeEach(() => {
    vi.mocked(api.query).mockReset();
    vi.mocked(api.command).mockReset();
    useUi.setState({ hoveredThreadId: null, visibleRows: [] });
  });

  it('plain U dispatches to toggle-read and nothing shadows or collides with it', () => {
    const e = key('u');
    expect(dispatchTarget(e)?.id).toBe('toggle-read');
    expect(matches(e)).toHaveLength(1);
  });

  it('⌘U still dispatches to toggle-read via the secondary binding', () => {
    const e = key('u', { metaKey: true });
    expect(dispatchTarget(e)?.id).toBe('toggle-read');
    expect(matches(e)).toHaveLength(1);
  });

  it('marks a read thread unread (enqueues set-seen false for its messages)', async () => {
    const t = thread({ unreadCount: 0 });
    useUi.setState({ visibleThreads: [t], selectedThreadId: t.id });
    vi.mocked(api.query).mockResolvedValue([
      { id: 'm1', seen: true },
      { id: 'm2', seen: true },
    ] as never);

    dispatchTarget(key('u'))!.perform(t.id);
    await flush();

    expect(api.command).toHaveBeenCalledWith('task:enqueue', {
      type: 'set-seen',
      accountId: 'a1',
      messageIds: ['m1', 'm2'],
      seen: false,
    });
  });

  it('marks an unread thread read (enqueues set-seen true for unseen messages only)', async () => {
    const t = thread({ unreadCount: 1 });
    useUi.setState({ visibleThreads: [t], selectedThreadId: t.id });
    vi.mocked(api.query).mockResolvedValue([
      { id: 'm1', seen: false },
      { id: 'm2', seen: true },
    ] as never);

    dispatchTarget(key('u'))!.perform(t.id);
    await flush();

    expect(api.command).toHaveBeenCalledWith('task:enqueue', {
      type: 'set-seen',
      accountId: 'a1',
      messageIds: ['m1'],
      seen: true,
    });
  });

  it('acts on the hovered row over the selected one (Spark semantics)', async () => {
    const hovered = thread({ id: 'hov', unreadCount: 0 });
    const selected = thread({ id: 'sel', unreadCount: 0 });
    useUi.setState({
      visibleThreads: [hovered, selected],
      selectedThreadId: 'sel',
      hoveredThreadId: 'hov',
    });
    vi.mocked(api.query).mockResolvedValue([{ id: 'm1', seen: true }] as never);

    // KeymapProvider passes keyboardTargetId() (hovered ?? selected) as null-id fallback;
    // performing with no explicit id must resolve to the hovered row.
    dispatchTarget(key('u'))!.perform(null);
    await flush();

    expect(api.query).toHaveBeenCalledWith('thread:messages', { threadId: 'hov' });
  });
});
