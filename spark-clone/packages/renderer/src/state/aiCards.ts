import { create } from 'zustand';
import { toast } from 'sonner';
import { api } from '../lib/api';
import {
  makeMeetingsCard,
  makeNewsCard,
  makeReplyCard,
  makeTasksCard,
} from '../lib/aiCards/generators';
import type { AiCardData, AiCardKind, SavedCards, SavedCardsDay } from '../lib/aiCards/types';
import { dayKey } from '../lib/aiCards/util';

const SETTING = 'aiCards';

const MAKERS: { [K in AiCardKind]: () => Promise<AiCardData[K]> } = {
  meetings: makeMeetingsCard,
  tasks: makeTasksCard,
  reply: makeReplyCard,
  news: makeNewsCard,
};

const BUSY: Record<AiCardKind, string> = {
  meetings: 'Preparing your meetings…',
  tasks: 'Checking your tasks…',
  reply: 'Finding what needs a reply…',
  news: 'Making today’s news digest…',
};

export type AiPanel = { kind: 'meetings'; eventId: string } | { kind: 'news' } | null;

interface AiCardsState {
  day: string;
  cards: SavedCards;
  running: Partial<Record<AiCardKind, boolean>>;
  panel: AiPanel;
  loaded: boolean;
  load(): Promise<void>;
  /** Make (or remake) one card. Only ever called from an explicit user action. */
  run(kind: AiCardKind): Promise<void>;
  dismiss(kind: AiCardKind): void;
  setPanel(panel: AiPanel): void;
}

function persist(day: string, cards: SavedCards) {
  const value: SavedCardsDay = { day, cards };
  void api.command('settings:set', { key: SETTING, value }).catch(() => {});
}

export const useAiCards = create<AiCardsState>((set, get) => ({
  day: dayKey(),
  cards: {},
  running: {},
  panel: null,
  loaded: false,

  load: async () => {
    const saved = (await api
      .query('settings:get', { key: SETTING })
      .catch(() => null)) as SavedCardsDay | null;
    const today = dayKey();
    // Yesterday's cards are dropped: Home starts clean each morning.
    set({ day: today, cards: saved?.day === today ? (saved.cards ?? {}) : {}, loaded: true });
  },

  run: async (kind) => {
    if (get().running[kind]) return;
    set((s) => ({ running: { ...s.running, [kind]: true } }));
    const id = toast.loading(BUSY[kind]);
    try {
      const data = await MAKERS[kind]();
      const today = dayKey();
      const base = get().day === today ? get().cards : {};
      const cards = { ...base, [kind]: { madeAt: Date.now(), data } } as SavedCards;
      set({ day: today, cards });
      persist(today, cards);
      toast.dismiss(id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'The assistant could not make that card.', {
        id,
      });
    } finally {
      set((s) => ({ running: { ...s.running, [kind]: false } }));
    }
  },

  dismiss: (kind) => {
    const cards = { ...get().cards };
    delete cards[kind];
    const panel = get().panel;
    set({ cards, panel: panel?.kind === kind ? null : panel });
    persist(get().day, cards);
  },

  setPanel: (panel) => set({ panel }),
}));

/** The cards still valid today (a card made yesterday is never shown). */
const NO_CARDS: SavedCards = {};

export function useTodayCards(): SavedCards {
  return useAiCards((s) => (s.day === dayKey() ? s.cards : NO_CARDS));
}
