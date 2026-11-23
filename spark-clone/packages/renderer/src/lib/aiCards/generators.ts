import type { CalendarEvent, KanbanCard, ThreadSummary } from '@app/shared';
import { useKanban } from '../../state/kanban';
import { api } from '../api';
import type {
  MeetingPrep,
  MeetingsCard,
  NewsCard,
  NewsStory,
  PrepPerson,
  PrepResource,
  PrepThread,
  ReplyCard,
  TaskBucket,
  TaskItem,
  TasksCard,
} from './types';
import {
  bucketOf,
  DAY_MS,
  askJson,
  byNewest,
  latestEditions,
  newsSenderTerms,
  clock,
  keywords,
  lastInbound,
  messageText,
  myAddresses,
  personName,
  resourceKind,
  resourceLabel,
  startOfDay,
  urlsIn,
} from './util';

/* ───────────── Needs reply ───────────── */

const REPLY_WINDOW_MS = 14 * DAY_MS;

export async function makeReplyCard(): Promise<ReplyCard> {
  const now = Date.now();
  const mine = await myAddresses();
  const threads = await api.query('threads:list', { view: 'inbox', limit: 120, offset: 0 });
  // The newest message is someone else's (we haven't answered, no draft yet),
  // it's recent, and it's a conversation rather than bulk or notifications.
  const candidates = threads
    .filter(
      (t) =>
        t.category === 'personal' &&
        !t.hasDraft &&
        (t.lastInboundDate ?? 0) > 0 &&
        (t.lastInboundDate ?? 0) >= t.lastMessageDate - 60_000 &&
        now - (t.lastInboundDate ?? 0) < REPLY_WINDOW_MS,
    )
    .slice(0, 25);
  if (!candidates.length) return { items: [] };

  const rows = await Promise.all(
    candidates.map(async (t, i) => {
      const m = await lastInbound(t.id, mine);
      const body = m ? await messageText(m, 1200) : { text: t.snippet };
      return { key: `t${i}`, t, who: personName(t.lastInboundFrom ?? m?.from), text: body.text };
    }),
  );

  const prompt =
    'These are the latest unanswered emails in my inbox. Pick the ones where the sender is ' +
    'asking me something or clearly waiting for my reply. Skip announcements, FYIs, thank-yous, ' +
    'receipts and anything that needs no answer. Order by urgency, most urgent first, at most 8.\n' +
    'For each, write what they are waiting on in at most 6 words, phrased as a short question ' +
    'or ask (e.g. "confirm ingest by the 20th?").\n' +
    'Return {"items":[{"id":"t0","ask":"..."}]}\n\n' +
    rows
      .map((r) => `[${r.key}] From ${r.who} · ${r.t.subject || '(no subject)'}\n${r.text}`)
      .join('\n\n---\n\n');
  const out = await askJson<{ items?: { id: string; ask: string }[] }>(
    prompt,
    'You triage email for a busy person. Be strict: only include mail that needs their reply.',
  );
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return {
    items: (out.items ?? [])
      .map((x) => {
        const r = byKey.get(x.id);
        return r
          ? {
              threadId: r.t.id,
              who: r.who,
              ask: x.ask,
              at: r.t.lastInboundDate || r.t.lastMessageDate,
            }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .slice(0, 8),
  };
}

/* ───────────── On your plate (Notion) ───────────── */

async function loadBoard() {
  const k = useKanban.getState();
  if (!k.configured) throw new Error('Connect your Notion board in Settings first.');
  const board = await api.query('notion:board', undefined);
  if (!board) throw new Error('Could not load your Notion board.');
  useKanban.setState({ board });
  return board;
}

export async function makeTasksCard(): Promise<TasksCard> {
  const board = await loadBoard();
  const assignee = ((await api.query('settings:get', { key: 'aiNotionAssignee' })) as string) || '';
  const today = startOfDay();
  const all: (KanbanCard & { bucket: TaskBucket })[] = board.columns
    .flatMap((c) => c.cards)
    .filter((c) => !assignee || (c.assignees ?? []).includes(assignee))
    .map((c) => ({ ...c, bucket: bucketOf(c.dueDate, today) }));
  const overdue = all.filter((c) => c.bucket === 'overdue').length;
  const dueToday = all.filter((c) => c.bucket === 'today').length;
  if (!all.length)
    return { overdue: 0, today: 0, total: 0, top: [], assignee: assignee || undefined };

  // How much of the day is left outside meetings, so the picks are realistic.
  const events = await api
    .query('calendar:events', { startMs: today, endMs: today + DAY_MS })
    .catch(() => [] as CalendarEvent[]);
  const now = Date.now();
  const meetingsLeft = events.filter((e) => !e.allDay && e.endMs > now);
  const busyMin = meetingsLeft.reduce(
    (s, e) => s + (Math.min(e.endMs, today + DAY_MS) - Math.max(e.startMs, now)) / 60_000,
    0,
  );

  const list = all
    .slice(0, 80)
    .map(
      (c, i) =>
        `[k${i}] ${c.title} · status ${c.status}` +
        (c.priority[0] ? ` · priority ${c.priority[0]}` : '') +
        (c.dueDate ? ` · due ${c.dueDate} (${c.bucket})` : ' · no due date') +
        (c.projects.length ? ` · project ${c.projects.join(', ')}` : ''),
    )
    .join('\n');
  const out = await askJson<{ top?: { id: string; why: string }[] }>(
    `It is ${new Date().toDateString()}, ${clock(now)}. I have ${meetingsLeft.length} meetings ` +
      `left today (about ${Math.round(busyMin / 60)}h). From my open tasks below, pick the 3 I ` +
      'should do today: overdue and due-today first, then high priority and in-progress work. ' +
      'For each give a reason in at most 6 words.\n' +
      'Return {"top":[{"id":"k0","why":"..."}]}\n\n' +
      list,
    'You help a busy person plan their day from their task list. Never invent tasks.',
  );
  const byKey = new Map(all.slice(0, 80).map((c, i) => [`k${i}`, c]));
  const top: TaskItem[] = (out.top ?? [])
    .map((x): TaskItem | null => {
      const c = byKey.get(x.id);
      return c
        ? { id: c.id, title: c.title, url: c.url, due: c.dueDate, bucket: c.bucket, why: x.why }
        : null;
    })
    .filter((x): x is TaskItem => !!x)
    .slice(0, 3);
  return { overdue, today: dueToday, total: all.length, top, assignee: assignee || undefined };
}

/* ───────────── News digest ───────────── */

const NEWS_LOOKBACK_MS = 4 * DAY_MS;

export async function makeNewsCard(): Promise<NewsCard> {
  const senders = newsSenderTerms(await api.query('settings:get', { key: 'aiNewsSenders' }));
  const hits = await api
    .query('threads:fromSenders', {
      terms: senders,
      sinceMs: Date.now() - NEWS_LOOKBACK_MS,
      limit: 40,
    })
    .catch(() => [] as ThreadSummary[]);
  const threads = latestEditions(hits);
  if (!threads.length) {
    throw new Error(`No newsletters from ${senders.join(', ')} in the last few days.`);
  }

  const mine = await myAddresses();
  const editions: string[] = [];
  const parts: string[] = [];
  for (const t of threads) {
    const m = await lastInbound(t.id, mine);
    if (!m) continue;
    const edition = personName(m.from);
    if (!editions.includes(edition)) editions.push(edition);
    const body = await messageText(m, 10_000);
    parts.push(`=== Edition: ${edition} · ${t.subject}\n${body.text}`);
  }
  if (!parts.length) throw new Error('Couldn’t read the newsletter emails.');

  const out = await askJson<{ stories?: NewsStory[]; merged?: number }>(
    'Below are the latest newsletter emails. Make one digest: pull out the real stories (skip ' +
      'sponsors, ads, job posts, referral and subscription blurbs), merge the same story covered ' +
      'by several editions into one, group them under short themes (e.g. "AI", "Web & frontend", ' +
      '"Startups & climate"), and keep the 15 most interesting. For each story: a short title, a ' +
      'one-sentence blurb, the article URL exactly as given in <...> (omit if none), its theme, ' +
      'and the edition names that covered it.\n' +
      'Return {"stories":[{"title":"","blurb":"","url":"","theme":"","sources":[""]}],"merged":0} ' +
      'where merged is how many duplicate stories you merged.\n\n' +
      parts.join('\n\n'),
    'You edit a daily news digest. Use only what is in the emails; never invent stories or links.',
  );
  return {
    day: startOfDay(threads[0]!.lastMessageDate),
    editions,
    threads: threads.map((t) => ({ id: t.id, accountId: t.accountId })),
    stories: (out.stories ?? []).filter((s) => s?.title).slice(0, 15),
    merged: out.merged ?? 0,
  };
}

/* ───────────── Meeting prep ───────────── */

const PREP_LOOKBACK_MS = 60 * DAY_MS;

async function searchThreads(query: string, limit: number): Promise<ThreadSummary[]> {
  return api.query('search:threads', { query, limit }).catch(() => [] as ThreadSummary[]);
}

export async function makeMeetingsCard(): Promise<MeetingsCard> {
  const now = Date.now();
  const today = startOfDay(now);
  const events = await api.query('calendar:events', { startMs: today, endMs: today + DAY_MS });
  // A meeting has other people or a call link; solo blocks (Lunch, focus) don't need prep.
  const seen = new Set<string>();
  const meetings = events
    .filter(
      (e) =>
        !e.allDay &&
        e.eventType !== 'outOfOffice' &&
        e.endMs > now &&
        ((e.attendees?.length ?? 0) > 0 || !!e.meetingUrl),
    )
    .filter((e) => {
      const key = `${e.title}|${e.startMs}`; // the same invite on two calendars
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.startMs - b.startMs)
    .slice(0, 8);
  if (!meetings.length) return { meetings: [] };

  const mine = await myAddresses();
  const board = useKanban.getState().configured ? await loadBoard().catch(() => null) : null;
  const tasks = board ? board.columns.flatMap((c) => c.cards) : [];

  const packs = await Promise.all(meetings.map((e) => gatherMeeting(e, mine, tasks, now)));

  const out = await askJson<{
    meetings?: { id: string; about: string; open: string; bring: string }[];
  }>(
    'Prepare me for each meeting below. For each write three short lines (at most 25 words each):\n' +
      '- about: what the meeting is about, from the invite and the related email\n' +
      '- open: what is still open or unanswered that touches me\n' +
      '- bring: what I should bring, check or decide beforehand\n' +
      'If there is not enough context, say so briefly instead of guessing.\n' +
      'Return {"meetings":[{"id":"m0","about":"","open":"","bring":""}]}\n\n' +
      packs.map((p, i) => `=== [m${i}] ${p.context}`).join('\n\n'),
    'You brief a busy person before their meetings. Ground every line in the context given; ' +
      'never invent facts, names or dates.',
  );
  const briefs = new Map((out.meetings ?? []).map((m) => [m.id, m]));
  return {
    meetings: packs.map((p, i) => {
      const b = briefs.get(`m${i}`);
      return {
        ...p.prep,
        about: b?.about ?? '',
        open: b?.open ?? '',
        bring: b?.bring ?? '',
      };
    }),
  };
}

async function gatherMeeting(
  e: CalendarEvent,
  mine: Set<string>,
  tasks: KanbanCard[],
  now: number,
): Promise<{ prep: Omit<MeetingPrep, 'about' | 'open' | 'bring'>; context: string }> {
  const attendees = (e.attendees ?? []).filter((a) => !mine.has(a.email.toLowerCase()));
  const recent = (t: ThreadSummary) => now - t.lastMessageDate < PREP_LOOKBACK_MS;

  // Each person's latest thread, plus a couple more for context.
  const related = new Map<string, ThreadSummary>();
  const people: PrepPerson[] = [];
  for (const a of attendees.slice(0, 8)) {
    const hits = (await searchThreads(`from:${a.email}`, 4)).filter(recent).sort(byNewest);
    const last = hits[0];
    const name = a.name || last?.senders?.find((s) => s.email === a.email)?.name || a.email;
    people.push({
      name,
      email: a.email,
      lastSubject: last?.subject,
      lastAt: last?.lastMessageDate,
      threadId: last?.id,
    });
    for (const t of hits.slice(0, 2)) related.set(t.id, t);
  }
  // Threads that share the meeting's distinctive words.
  const words = keywords(e.title).slice(0, 3);
  if (words.length) {
    for (const t of (await searchThreads(words.join(' '), 5)).filter(recent)) related.set(t.id, t);
  }
  const threads = [...related.values()].sort(byNewest).slice(0, 6);

  // Read the newest few for context and for the documents they link to.
  const resources = new Map<string, PrepResource>();
  const addLink = (url: string, text: string, from: string) => {
    const kind = resourceKind(url);
    if (!kind) return;
    const key = url.split(/[?#]/)[0]!;
    if (!resources.has(key)) {
      resources.set(key, { url, kind, title: text || resourceLabel(kind), from });
    }
  };
  const descText = e.description ?? '';
  for (const url of urlsIn(descText)) addLink(url, '', 'In the invite');
  for (const m of descText.matchAll(/<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi)) {
    addLink(m[1]!, m[2]!.trim(), 'In the invite');
  }

  const excerpts: string[] = [];
  for (const t of threads.slice(0, 3)) {
    const m = await lastInbound(t.id, mine);
    if (!m) continue;
    const body = await messageText(m, 1500);
    const who = personName(m.from);
    for (const l of body.links)
      addLink(l.url, l.text, `${resourceLabel(resourceKind(l.url) ?? 'link')} · ${who}'s email`);
    excerpts.push(`Email "${t.subject}" from ${who}:\n${body.text}`);
  }

  const titleWords = new Set(keywords(e.title));
  for (const task of tasks) {
    const taskWords = keywords(`${task.title} ${task.projects.join(' ')}`);
    if (taskWords.some((w) => titleWords.has(w))) {
      resources.set(task.url || task.id, {
        url: task.url,
        kind: 'task',
        title: task.title,
        from: `Notion · ${task.status}${task.dueDate ? ` · due ${task.dueDate}` : ''}`,
      });
    }
  }

  const prepThreads: PrepThread[] = threads.map((t) => ({
    id: t.id,
    subject: t.subject || '(no subject)',
    who: personName(t.lastInboundFrom ?? t.senders?.[0] ?? t.participants[0]),
    count: t.messageCount,
    at: t.lastMessageDate,
  }));

  const description = descText
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500);
  const context =
    `${e.title} · ${clock(e.startMs)}–${clock(e.endMs)}\n` +
    `Attendees: ${people.map((p) => p.name).join(', ') || 'none listed'}\n` +
    (description ? `Invite description: ${description}\n` : '') +
    (excerpts.length ? `\n${excerpts.join('\n\n')}` : '\n(No related email found.)') +
    ([...resources.values()].some((r) => r.kind === 'task')
      ? `\nRelated Notion tasks: ${[...resources.values()]
          .filter((r) => r.kind === 'task')
          .map((r) => `${r.title} (${r.from})`)
          .join('; ')}`
      : '');

  return {
    prep: {
      eventId: e.id,
      title: e.title || '(no title)',
      startMs: e.startMs,
      endMs: e.endMs,
      meetingUrl: e.meetingUrl,
      attendeeCount: attendees.length,
      people,
      resources: [...resources.values()].slice(0, 10),
      threads: prepThreads,
    },
    context,
  };
}
