/** Notion Sprint-board kanban (read-only mirror of the WebDev Hub board). */

export type KanbanSource = 'email' | 'fable' | 'unsdsn' | 'sdgtc';

export interface KanbanCard {
  /** Notion page id */
  id: string;
  /** notion.so page URL for "Open in Notion" */
  url: string;
  title: string;
  status: string;
  priority: string[];
  /** resolved Project page titles */
  projects: string[];
  dueDate: string | null;
  requestedBy: string | null;
  /** auto-increment "ID" property, the panel's eyebrow (e.g. #131) */
  taskId: number | null;
  /** ISO created time — drives the "new since last seen" badge */
  createdTime: string;
  /** which request pipeline the task came from, if any */
  source: KanbanSource | null;
}

export interface KanbanBoard {
  /** column order mirrors the Notion board; Done and Dropped are excluded upstream */
  columns: { status: string; cards: KanbanCard[] }[];
  fetchedAt: number;
}

/** Board columns, left to right. Done/Dropped never render as columns. */
export const KANBAN_COLUMNS = [
  'Requests',
  'Not started',
  'In progress',
  'Review requested',
  'Approved',
] as const;

/** Every status a task can be moved to (Done/Dropped remove it from the board). */
export const KANBAN_STATUSES = [
  'Requests',
  'Not started',
  'In progress',
  'Review requested',
  'Approved',
  'Done',
  'Dropped',
] as const;

/**
 * How many cards count as "new" for the home link, sidebar dot, and badge:
 * in the Requests column or from a request pipeline, created after seenAt.
 */
export function kanbanNewCount(board: KanbanBoard | null, seenAt: number): number {
  if (!board) return 0;
  return board.columns
    .flatMap((c) => c.cards)
    .filter(
      (c) => (c.status === 'Requests' || c.source !== null) && Date.parse(c.createdTime) > seenAt,
    ).length;
}

/** Flattened, render-ready page content for the card side panel. */
export interface NotionBlock {
  type: 'heading' | 'paragraph' | 'bullet' | 'number' | 'todo' | 'quote' | 'code' | 'divider';
  text: string;
  checked?: boolean;
}
