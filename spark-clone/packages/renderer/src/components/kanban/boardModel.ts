import { KANBAN_COLUMNS, type KanbanCard } from '@app/shared';

/**
 * The Sprint board's pure model: which cards a view, search and filter keep,
 * how a column orders them, and how cards group into columns. Kept free of
 * React so it can be tested on its own.
 */

export type GroupBy = 'status' | 'project' | 'priority';
export type ViewId = 'all' | 'high' | 'week' | 'requests' | `project:${string}`;
export type SortKey = 'board' | 'due' | 'priority' | 'newest' | 'id';

export interface BoardFilters {
  priority: string[];
  projects: string[];
  /** 'email' | 'web' | 'none' */
  sources: string[];
}
export const NO_FILTERS: BoardFilters = { priority: [], projects: [], sources: [] };

export interface BoardPrefs {
  groupBy: GroupBy;
  sort: SortKey;
  /** hidden column keys, per grouping */
  hidden: Record<GroupBy, string[]>;
  hideEmpty: boolean;
  compact: boolean;
  showIds: boolean;
  railOpen: boolean;
}
export const DEFAULT_PREFS: BoardPrefs = {
  groupBy: 'status',
  sort: 'board',
  hidden: { status: [], project: [], priority: [] },
  hideEmpty: false,
  compact: false,
  showIds: true,
  railOpen: true,
};

/** Merge a stored value over the defaults, dropping anything malformed. */
export function readPrefs(raw: unknown): BoardPrefs {
  if (!raw || typeof raw !== 'object') return DEFAULT_PREFS;
  const r = raw as Partial<BoardPrefs>;
  const pick = <T>(v: unknown, ok: readonly T[], d: T): T => (ok.includes(v as T) ? (v as T) : d);
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const list = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return {
    groupBy: pick(r.groupBy, ['status', 'project', 'priority'] as const, 'status'),
    sort: pick(r.sort, ['board', 'due', 'priority', 'newest', 'id'] as const, 'board'),
    hidden: {
      status: list(r.hidden?.status),
      project: list(r.hidden?.project),
      priority: list(r.hidden?.priority),
    },
    hideEmpty: bool(r.hideEmpty, false),
    compact: bool(r.compact, false),
    showIds: bool(r.showIds, true),
    railOpen: bool(r.railOpen, true),
  };
}

export const PRIORITY_ORDER = ['High', 'Medium', 'Low'];
export const NO_PRIORITY = 'No priority';
export const NO_PROJECT = 'No project';
const DAY = 86_400_000;

export function matchesView(card: KanbanCard, view: ViewId, now: number): boolean {
  if (view === 'all') return true;
  if (view === 'high') return card.priority.includes('High');
  if (view === 'week') return card.dueDate !== null && Date.parse(card.dueDate) <= now + 7 * DAY;
  if (view === 'requests') return card.source !== null || card.status === 'Requests';
  return card.projects.includes(view.slice('project:'.length));
}

export function sourceKind(card: KanbanCard): 'email' | 'web' | 'none' {
  if (card.source === 'email') return 'email';
  return card.source ? 'web' : 'none';
}

export function matchesFilters(card: KanbanCard, f: BoardFilters): boolean {
  if (f.priority.length) {
    const ps = card.priority.length ? card.priority : [NO_PRIORITY];
    if (!ps.some((p) => f.priority.includes(p))) return false;
  }
  if (f.projects.length) {
    const ps = card.projects.length ? card.projects : [NO_PROJECT];
    if (!ps.some((p) => f.projects.includes(p))) return false;
  }
  if (f.sources.length && !f.sources.includes(sourceKind(card))) return false;
  return true;
}

export function filterCount(f: BoardFilters): number {
  return f.priority.length + f.projects.length + f.sources.length;
}

export function matchesQuery(card: KanbanCard, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^#/, '');
  if (!q) return true;
  return (
    card.title.toLowerCase().includes(q) ||
    String(card.taskId) === q ||
    card.projects.some((p) => p.toLowerCase().includes(q)) ||
    (card.requestedBy?.toLowerCase().includes(q) ?? false)
  );
}

const priorityRank = (c: KanbanCard) => {
  const i = PRIORITY_ORDER.indexOf(c.priority[0] ?? '');
  return i === -1 ? PRIORITY_ORDER.length : i;
};
const dueRank = (c: KanbanCard) => (c.dueDate ? Date.parse(c.dueDate) : Infinity);

/** A stable sort; 'board' keeps Notion's own order. */
export function sortCards(cards: KanbanCard[], sort: SortKey): KanbanCard[] {
  if (sort === 'board') return cards;
  const cmp: Record<Exclude<SortKey, 'board'>, (a: KanbanCard, b: KanbanCard) => number> = {
    due: (a, b) => dueRank(a) - dueRank(b) || priorityRank(a) - priorityRank(b),
    priority: (a, b) => priorityRank(a) - priorityRank(b) || dueRank(a) - dueRank(b),
    newest: (a, b) => Date.parse(b.createdTime) - Date.parse(a.createdTime),
    id: (a, b) => (b.taskId ?? -Infinity) - (a.taskId ?? -Infinity),
  };
  return [...cards].sort(cmp[sort]);
}

export interface Column {
  key: string;
  cards: KanbanCard[];
}

/** Every column the grouping could show, before hiding. */
export function columnKeys(groupBy: GroupBy, cards: KanbanCard[]): string[] {
  if (groupBy === 'status') return [...KANBAN_COLUMNS];
  if (groupBy === 'priority') return [...PRIORITY_ORDER, NO_PRIORITY];
  const names = [...new Set(cards.flatMap((c) => c.projects))].sort((a, b) => a.localeCompare(b));
  return [...names, NO_PROJECT];
}

export function buildColumns(
  cards: KanbanCard[],
  groupBy: GroupBy,
  statusOf: (c: KanbanCard) => string,
  allCards: KanbanCard[] = cards,
): Column[] {
  const keyOf = (c: KanbanCard): string =>
    groupBy === 'status'
      ? statusOf(c)
      : groupBy === 'priority'
        ? PRIORITY_ORDER.includes(c.priority[0] ?? '')
          ? c.priority[0]!
          : NO_PRIORITY
        : (c.projects[0] ?? NO_PROJECT);
  return columnKeys(groupBy, allCards).map((key) => ({
    key,
    cards: cards.filter((c) => keyOf(c) === key),
  }));
}
