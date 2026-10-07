import { describe, expect, it } from 'vitest';
import { kanbanNewCount, type KanbanBoard, type KanbanCard } from '../src';

const card = (over: Partial<KanbanCard>): KanbanCard => ({
  id: 'p1',
  url: 'https://notion.so/p1',
  title: 'task',
  status: 'Not started',
  priority: [],
  projects: [],
  dueDate: null,
  requestedBy: null,
  taskId: null,
  createdTime: '2026-08-19T10:00:00.000Z',
  source: null,
  ...over,
});

const board = (cards: KanbanCard[]): KanbanBoard => ({
  columns: [{ status: 'mixed', cards }],
  fetchedAt: 0,
});

const BEFORE = Date.parse('2026-08-19T09:00:00.000Z');
const AFTER = Date.parse('2026-08-19T11:00:00.000Z');

describe('kanbanNewCount', () => {
  it('counts Requests-column and request-sourced cards created after seenAt', () => {
    const b = board([
      card({ id: 'a', status: 'Requests' }),
      card({ id: 'b', source: 'email' }),
      card({ id: 'c', source: 'sdgtc', status: 'Approved' }),
      card({ id: 'd' }), // plain task: never counts
    ]);
    expect(kanbanNewCount(b, BEFORE)).toBe(3);
  });

  it('ignores cards created before seenAt and handles a missing board', () => {
    const b = board([card({ status: 'Requests' }), card({ source: 'fable' })]);
    expect(kanbanNewCount(b, AFTER)).toBe(0);
    expect(kanbanNewCount(null, 0)).toBe(0);
  });
});
