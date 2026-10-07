import { create } from 'zustand';
import { kanbanNewCount, type KanbanBoard } from '@app/shared';
import { api } from '../lib/api';
import { useUi } from './store';

export { kanbanNewCount };

/**
 * Notion Sprint-board state, app-level so the sidebar's new-request dot works
 * from any view (not just while Home is mounted). "New" means a card in the
 * Requests column or from a request pipeline (email / FABLE / UNSDSN / SDG TC)
 * created since the board was last opened. Notion's notification inbox is not
 * exposed by its API, so polling the board is the signal.
 */
interface KanbanState {
  configured: boolean;
  board: KanbanBoard | null;
  seenAt: number;
  refresh(): void;
  markSeen(): void;
}

export const useKanban = create<KanbanState>((set, get) => ({
  configured: false,
  board: null,
  seenAt: 0,

  refresh: () => {
    if (!get().configured) return;
    api
      .query('notion:board', undefined)
      .then((board) => board && set({ board }))
      .catch(() => {});
  },

  markSeen: () => {
    const seenAt = Date.now();
    set({ seenAt });
    void api.command('settings:set', { key: 'kanbanSeenAt', value: seenAt });
  },
}));

/** Called once from App: load persisted state, then poll every 15 minutes. */
export function wireKanban(): () => void {
  void api
    .query('settings:get', { key: 'kanbanSeenAt' })
    .then((v) => useKanban.setState({ seenAt: typeof v === 'number' ? v : 0 }));

  const checkStatus = () =>
    api.query('notion:status', undefined).then((s) => {
      const was = useKanban.getState().configured;
      useKanban.setState({ configured: s.configured });
      if (s.configured && !was) useKanban.getState().refresh();
    });
  void checkStatus();

  // Connecting Notion happens in settings — re-check whenever the sheet closes.
  const unsub = useUi.subscribe((s, prev) => {
    if (prev.settingsOpen && !s.settingsOpen) void checkStatus();
  });

  const id = window.setInterval(() => useKanban.getState().refresh(), 15 * 60_000);
  return () => {
    unsub();
    window.clearInterval(id);
  };
}
