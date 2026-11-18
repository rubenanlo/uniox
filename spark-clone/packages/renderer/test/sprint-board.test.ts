import { describe, expect, it } from 'vitest';
import type { KanbanCard } from '@app/shared';
import {
  buildColumns,
  DEFAULT_PREFS,
  matchesFilters,
  matchesQuery,
  matchesView,
  NO_FILTERS,
  readPrefs,
  sortCards,
} from '../src/components/kanban/boardModel';

const NOW = Date.parse('2026-11-18T10:00:00Z');
const card = (id: number, o: Partial<KanbanCard> = {}): KanbanCard => ({
  id: `p${id}`,
  url: '',
  title: `Task ${id}`,
  status: 'In progress',
  priority: [],
  projects: [],
  dueDate: null,
  requestedBy: null,
  taskId: id,
  createdTime: '2026-11-01T00:00:00Z',
  source: null,
  ...o,
});

describe('sprint board views', () => {
  it('keeps high priority, due soon, requests and project views apart', () => {
    const high = card(1, { priority: ['High'] });
    const soon = card(2, { dueDate: '2026-11-20' });
    const later = card(3, { dueDate: '2026-12-20' });
    const mail = card(4, { source: 'email' });
    const web = card(5, { projects: ['FABLE'] });
    expect(matchesView(high, 'high', NOW)).toBe(true);
    expect(matchesView(soon, 'high', NOW)).toBe(false);
    expect(matchesView(soon, 'week', NOW)).toBe(true);
    expect(matchesView(later, 'week', NOW)).toBe(false);
    expect(matchesView(mail, 'requests', NOW)).toBe(true);
    expect(matchesView(card(6, { status: 'Requests' }), 'requests', NOW)).toBe(true);
    expect(matchesView(web, 'project:FABLE', NOW)).toBe(true);
    expect(matchesView(high, 'project:FABLE', NOW)).toBe(false);
  });
});

describe('sprint board filters', () => {
  it('passes everything with no filters', () => {
    expect(matchesFilters(card(1), NO_FILTERS)).toBe(true);
  });
  it('matches priority, project and source, with "none" buckets', () => {
    const c = card(1, { priority: ['High'], projects: ['FABLE'], source: 'fable' });
    expect(matchesFilters(c, { ...NO_FILTERS, priority: ['High'] })).toBe(true);
    expect(matchesFilters(c, { ...NO_FILTERS, priority: ['Low'] })).toBe(false);
    expect(matchesFilters(card(2), { ...NO_FILTERS, priority: ['No priority'] })).toBe(true);
    expect(matchesFilters(card(2), { ...NO_FILTERS, projects: ['No project'] })).toBe(true);
    expect(matchesFilters(c, { ...NO_FILTERS, sources: ['web'] })).toBe(true);
    expect(matchesFilters(c, { ...NO_FILTERS, sources: ['email', 'none'] })).toBe(false);
    // groups AND together
    expect(matchesFilters(c, { priority: ['High'], projects: ['SDG TC'], sources: [] })).toBe(
      false,
    );
  });
  it('searches titles, #ids, projects and requesters', () => {
    const c = card(131, { title: 'Country PDFs', projects: ['SDG Index'], requestedBy: 'Ana' });
    expect(matchesQuery(c, 'pdf')).toBe(true);
    expect(matchesQuery(c, '#131')).toBe(true);
    expect(matchesQuery(c, 'index')).toBe(true);
    expect(matchesQuery(c, 'ana')).toBe(true);
    expect(matchesQuery(c, 'nope')).toBe(false);
  });
});

describe('sprint board sorting and grouping', () => {
  const a = card(1, { dueDate: '2026-11-25', priority: ['Low'], createdTime: '2026-11-03' });
  const b = card(2, { dueDate: '2026-11-21', priority: ['High'], createdTime: '2026-11-01' });
  const c = card(3, { priority: ['Medium'], createdTime: '2026-11-05' });

  it('keeps board order by default and sorts by due, priority, newest and id', () => {
    expect(sortCards([a, b, c], 'board').map((x) => x.taskId)).toEqual([1, 2, 3]);
    expect(sortCards([a, b, c], 'due').map((x) => x.taskId)).toEqual([2, 1, 3]);
    expect(sortCards([a, b, c], 'priority').map((x) => x.taskId)).toEqual([2, 3, 1]);
    expect(sortCards([a, b, c], 'newest').map((x) => x.taskId)).toEqual([3, 1, 2]);
    expect(sortCards([a, b, c], 'id').map((x) => x.taskId)).toEqual([3, 2, 1]);
  });

  it('groups by status, priority and project without losing cards', () => {
    const odd = card(4, { priority: ['Urgent'], projects: ['FABLE', 'SDG TC'] });
    const cards = [a, b, c, odd];
    const byStatus = buildColumns(cards, 'status', (x) => x.status);
    expect(byStatus.map((col) => col.key)).toContain('In progress');
    const byPriority = buildColumns(cards, 'priority', (x) => x.status);
    expect(byPriority.map((col) => col.key)).toEqual(['High', 'Medium', 'Low', 'No priority']);
    expect(byPriority.find((col) => col.key === 'No priority')!.cards).toEqual([odd]);
    const byProject = buildColumns(cards, 'project', (x) => x.status);
    expect(byProject.map((col) => col.key)).toEqual(['FABLE', 'SDG TC', 'No project']);
    expect(byProject.flatMap((col) => col.cards)).toHaveLength(cards.length);
  });
});

describe('sprint board prefs', () => {
  it('falls back to defaults and drops malformed values', () => {
    expect(readPrefs(null)).toEqual(DEFAULT_PREFS);
    const p = readPrefs({
      groupBy: 'nope',
      sort: 'due',
      compact: 'yes',
      hidden: { status: [1, 'Approved'] },
    });
    expect(p.groupBy).toBe('status');
    expect(p.sort).toBe('due');
    expect(p.compact).toBe(false);
    expect(p.hidden.status).toEqual(['Approved']);
  });
});
