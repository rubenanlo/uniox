import type { KanbanBoard, KanbanCard, KanbanSource, NotionBlock } from '@app/shared';

/**
 * The Sprint board is a multi-source database (Tasks + Sprints), which the
 * legacy /databases endpoints can't address — use the 2025 data-source API
 * and talk to the Tasks data source directly.
 */
const TASKS_DATA_SOURCE = '256c2d31-3cb0-45d1-a17a-7dd477f911db';
const API = 'https://api.notion.com/v1';
const NOTION_VERSION = '2025-09-03';

/** Board order, left to right; Done and Dropped are excluded at the query. */
const COLUMN_ORDER = [
  'Requests',
  'Not started',
  'In progress',
  'Review requested',
  'Approved',
];

const PRIORITY_RANK: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

/** Request-pipeline relations on a task, in badge precedence order. */
const SOURCE_PROPS: { prop: string; source: KanbanSource }[] = [
  { prop: 'Email request', source: 'email' },
  { prop: 'FABLE Consortium Website', source: 'fable' },
  { prop: 'UNSDSN Site | Requests', source: 'unsdsn' },
  { prop: 'SDG TC | Requests | Blog Posts', source: 'sdgtc' },
  { prop: 'SDG TC | Requests | New article', source: 'sdgtc' },
  { prop: 'SDG TC | Requests | Previous events', source: 'sdgtc' },
  { prop: 'SDG TC | Requests | Publication', source: 'sdgtc' },
  { prop: 'SDG TC | Requests | Report Card', source: 'sdgtc' },
];

// Notion API payloads are loosely typed on purpose; every access is guarded.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

async function notionFetch(token: string, path: string, init?: RequestInit): Promise<Json> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });
  const body = (await res.json()) as Json;
  if (!res.ok) throw new Error(body?.message || `Notion API ${res.status}`);
  return body;
}

/** Cheap validation for the settings flow: can this token see the board? */
export async function validateToken(token: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await notionFetch(token, `/data_sources/${TASKS_DATA_SOURCE}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const richText = (arr: unknown): string =>
  Array.isArray(arr) ? arr.map((t: Json) => t?.plain_text ?? '').join('') : '';

// Project titles change rarely; cache them for the process lifetime.
const projectTitleCache = new Map<string, string>();

async function projectTitle(token: string, pageId: string): Promise<string> {
  const cached = projectTitleCache.get(pageId);
  if (cached) return cached;
  try {
    const page = await notionFetch(token, `/pages/${pageId}`);
    const props = (page['properties'] ?? {}) as Json;
    const titleProp = Object.values(props).find((p: Json) => p?.type === 'title') as
      | Json
      | undefined;
    const title = richText(titleProp?.['title']) || 'Untitled';
    projectTitleCache.set(pageId, title);
    return title;
  } catch {
    return 'Untitled';
  }
}

function cardSource(props: Json): KanbanSource | null {
  for (const { prop, source } of SOURCE_PROPS) {
    const rel = props[prop]?.relation;
    if (Array.isArray(rel) && rel.length > 0) return source;
  }
  return null;
}

// The board rarely changes second-to-second; a short cache absorbs the
// renderer's poll + open-view refetches without hammering the API.
let boardCache: { board: KanbanBoard; at: number } | null = null;
const BOARD_CACHE_MS = 60_000;

export async function fetchBoard(token: string): Promise<KanbanBoard> {
  if (boardCache && Date.now() - boardCache.at < BOARD_CACHE_MS) return boardCache.board;

  const pages: Json[] = [];
  let cursor: string | undefined;
  do {
    const body: Json = await notionFetch(token, `/data_sources/${TASKS_DATA_SOURCE}/query`, {
      method: 'POST',
      body: JSON.stringify({
        filter: {
          and: [
            { property: 'Status', status: { does_not_equal: 'Done' } },
            { property: 'Status', status: { does_not_equal: 'Dropped' } },
          ],
        },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    pages.push(...((body['results'] as Json[]) ?? []));
    cursor = body['has_more'] ? (body['next_cursor'] as string) : undefined;
  } while (cursor);

  const cards: KanbanCard[] = [];
  for (const page of pages) {
    const props = (page['properties'] ?? {}) as Json;
    const projectIds: string[] = ((props['Projects']?.relation as Json[]) ?? []).map(
      (r) => r['id'] as string,
    );
    cards.push({
      id: page['id'] as string,
      url: (page['url'] as string) ?? '',
      title: richText(props['Name']?.title) || 'Untitled',
      status: (props['Status']?.status?.name as string) ?? 'Not started',
      priority: ((props['Priority']?.multi_select as Json[]) ?? []).map(
        (o) => o['name'] as string,
      ),
      projects: await Promise.all(projectIds.map((id) => projectTitle(token, id))),
      dueDate: (props['Due Date']?.date?.start as string) ?? null,
      requestedBy: (props['Requested by']?.email as string) ?? null,
      taskId: (props['ID']?.unique_id?.number as number) ?? null,
      createdTime: (page['created_time'] as string) ?? '',
      source: cardSource(props),
    });
  }

  const columns = COLUMN_ORDER.map((status) => ({
    status,
    cards: cards
      .filter((c) => c.status === status)
      .sort(
        (a, b) =>
          (PRIORITY_RANK[a.priority[0] ?? ''] ?? 3) - (PRIORITY_RANK[b.priority[0] ?? ''] ?? 3),
      ),
  }));
  // Statuses added later in Notion still show up, appended after the known ones.
  for (const c of cards) {
    if (!COLUMN_ORDER.includes(c.status)) {
      const col = columns.find((x) => x.status === c.status);
      if (col) col.cards.push(c);
      else columns.push({ status: c.status, cards: [c] });
    }
  }

  const board: KanbanBoard = { columns, fetchedAt: Date.now() };
  boardCache = { board, at: Date.now() };
  return board;
}

/** Write a task's Status back to Notion; the board cache is invalidated. */
export async function setPageStatus(token: string, pageId: string, status: string): Promise<void> {
  await notionFetch(token, `/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ properties: { Status: { status: { name: status } } } }),
  });
  boardCache = null;
}

function blockOf(b: Json): NotionBlock | null {
  const type = b['type'] as string;
  const data = (b[type] ?? {}) as Json;
  const text = richText(data['rich_text']);
  switch (type) {
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
      return { type: 'heading', text };
    case 'paragraph':
      return text ? { type: 'paragraph', text } : null;
    case 'bulleted_list_item':
      return { type: 'bullet', text };
    case 'numbered_list_item':
      return { type: 'number', text };
    case 'to_do':
      return { type: 'todo', text, checked: !!data['checked'] };
    case 'quote':
    case 'callout':
      return { type: 'quote', text };
    case 'code':
      return { type: 'code', text };
    case 'divider':
      return { type: 'divider', text: '' };
    default:
      return null;
  }
}

export async function fetchPageBlocks(token: string, pageId: string): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = [];
  let cursor: string | undefined;
  do {
    const qs = cursor ? `?page_size=100&start_cursor=${cursor}` : '?page_size=100';
    const body = await notionFetch(token, `/blocks/${pageId}/children${qs}`);
    for (const raw of (body['results'] as Json[]) ?? []) {
      const b = blockOf(raw);
      if (b) blocks.push(b);
    }
    cursor = body['has_more'] ? (body['next_cursor'] as string) : undefined;
  } while (cursor);
  return blocks;
}
