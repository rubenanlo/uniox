import { DEFAULT_SCHEDULING, type SchedulingPresets, type ThreadSummary } from '@app/shared';
import { KanbanSquare } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { arrivedAt, freshPriorityThreads, inboundSenderLabel } from '../lib/homePriority';
import { kanbanNewCount, useKanban } from '../state/kanban';
import { useAccounts, useThreads } from '../state/queries';
import { useUi } from '../state/store';
import { KanbanView } from './kanban/KanbanView';

/** Re-render every 30s — the greeting, marker, and countdown are all
 *  minute-granular, and each tick re-renders the whole Home subtree. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function useScheduling(): SchedulingPresets {
  const [p, setP] = useState<SchedulingPresets>(DEFAULT_SCHEDULING);
  useEffect(() => {
    void api.query('settings:get', { key: 'scheduling' }).then((stored) => {
      if (stored) setP({ ...DEFAULT_SCHEDULING, ...(stored as Partial<SchedulingPresets>) });
    });
  }, []);
  return p;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** "9:00" — the workday bounds as shown in the timeline label. */
const hm = (hour: number) => `${hour}:00`;

/** Hours (fractional) since midnight. */
const hourOf = (d: Date) => d.getHours() + d.getMinutes() / 60;

function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

const ARC_W = 640;
const ARC_H = 64;
const ARC_PAD = 24;
const ARC_Y = 32;

/**
 * The day as a line (Daylight arc): hour ticks from the user's workday start
 * to its end, the lived stretch drawn in the aqua → azure → violet gradient,
 * a labelled marker for "now", and a dot per priority email at its arrival
 * minute — hover a dot for the time, sender, and subject.
 */
function DaylightArc({
  now,
  start,
  end,
  marks,
}: {
  now: Date;
  start: number;
  end: number;
  marks: { at: number; unread: boolean; label: string }[];
}) {
  const span = end - start;
  const h = hourOf(now);
  const pct = clamp01((h - start) / span);
  const x = ARC_PAD + pct * (ARC_W - ARC_PAD * 2);
  const posX = (hour: number) => ARC_PAD + clamp01((hour - start) / span) * (ARC_W - ARC_PAD * 2);
  const hours: number[] = [];
  for (let t = start; t <= end; t += 1) hours.push(t);
  const nowLabel = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  return (
    <div>
      <div className="text-ink-faint flex items-baseline justify-between font-mono text-[10px] font-semibold tracking-[0.16em] uppercase">
        <span>
          Workday {hm(start)} – {hm(end)}
        </span>
        <span className="tabular-nums">{Math.round(pct * 100)}%</span>
      </div>
      <svg
        viewBox={`0 0 ${ARC_W} ${ARC_H}`}
        className="mt-3 w-full"
        role="img"
        aria-label={`Workday timeline from ${hm(start)} to ${hm(end)} with priority emails placed at their arrival time; it is ${nowLabel}.`}
      >
        <defs>
          <linearGradient id="daylight-line" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="var(--color-aqua)" />
            <stop offset="55%" stopColor="var(--color-azure)" />
            <stop offset="100%" stopColor="var(--color-violet)" />
          </linearGradient>
        </defs>
        <line
          x1={ARC_PAD}
          y1={ARC_Y}
          x2={ARC_W - ARC_PAD}
          y2={ARC_Y}
          stroke="var(--color-hairline)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line
          x1={ARC_PAD}
          y1={ARC_Y}
          x2={x}
          y2={ARC_Y}
          stroke="url(#daylight-line)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        {hours.map((t) => (
          <g key={t}>
            <line
              x1={posX(t)}
              y1={ARC_Y - 4}
              x2={posX(t)}
              y2={ARC_Y + 4}
              stroke="var(--color-hairline)"
              strokeWidth="1.5"
            />
            <text
              x={posX(t)}
              y={ARC_Y + 18}
              textAnchor="middle"
              fontSize="10"
              fill="var(--color-ink-faint)"
            >
              {t}
            </text>
          </g>
        ))}
        {marks.map((m, i) => (
          <circle
            key={i}
            cx={posX(m.at)}
            cy={ARC_Y}
            r={m.unread ? 3.5 : 2.5}
            fill={m.unread ? 'var(--color-azure)' : 'var(--color-ink-faint)'}
          >
            <title>{m.label}</title>
          </circle>
        ))}
        <circle cx={x} cy={ARC_Y} r="4" fill="var(--color-ink)" />
        <text x={x} y={ARC_Y - 12} textAnchor="middle" fontSize="11" fill="var(--color-ink)">
          {nowLabel}
        </text>
      </svg>
    </div>
  );
}

function PriorityRow({
  thread,
  accountName,
  showAccount,
}: {
  thread: ThreadSummary;
  accountName: string;
  showAccount: boolean;
}) {
  const setView = useUi((s) => s.setView);
  const setAccountFilter = useUi((s) => s.setAccountFilter);
  const selectThread = useUi((s) => s.selectThread);
  const unread = thread.unreadCount > 0;
  // Name the person who actually sent the new message, not whoever the thread
  // happens to lead with (which can be the recipient of our own draft).
  const from = inboundSenderLabel(thread);
  const at = arrivedAt(thread);
  const subject = thread.subject || '(no subject)';

  const open = () => {
    setAccountFilter(undefined);
    setView('inbox');
    selectThread(thread.id);
  };

  return (
    <button
      onClick={open}
      aria-label={`Open ${from}: ${subject}, ${clockTime(at)}`}
      className="border-hairline hover:bg-surface focus-visible:bg-surface w-full border-b py-4 text-left transition-colors last:border-b-0 focus-visible:outline-none"
    >
      <span className="flex items-center gap-2">
        <span
          className={cn('truncate text-[13.5px] text-ink', unread ? 'font-bold' : 'font-semibold')}
        >
          {from}
        </span>
        {unread && (
          <span className="bg-azure h-1.5 w-1.5 shrink-0 rounded-full" aria-label="unread" />
        )}
        <span className="text-ink-faint ml-auto shrink-0 text-[12px] tabular-nums">
          {clockTime(at)}
        </span>
      </span>
      <span className="mt-1 flex items-baseline gap-1.5">
        <span className={cn('truncate text-[13px]', unread ? 'text-ink-muted' : 'text-ink-faint')}>
          {subject}
        </span>
        {showAccount && (
          <span className="text-ink-faint shrink-0 text-[11px]">· {accountName}</span>
        )}
      </span>
    </button>
  );
}

/** First-open ask: the greeting itself wants a name; saved like any setting. */
function NameAsk() {
  const setUserName = useUi((s) => s.setUserName);
  const [draft, setDraft] = useState('');
  const commit = () => {
    const name = draft.trim();
    if (!name) return;
    setUserName(name);
    void api.command('settings:set', { key: 'userName', value: name });
  };
  return (
    <div className="mt-2.5 flex items-center gap-2">
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        onBlur={commit}
        placeholder="What's your name?"
        aria-label="Your name"
        className="border-hairline bg-surface focus:ring-accent rounded-lg border px-2.5 py-1.5 text-[13px] focus:ring-2 focus:outline-none"
      />
      <button onClick={commit} className="text-accent text-[12.5px] font-semibold hover:underline">
        Save
      </button>
    </div>
  );
}

export function HomeView() {
  const now = useNow();
  const scheduling = useScheduling();
  const { accounts } = useAccounts();
  const priorityEmails = useUi((s) => s.priorityEmails);
  const baseline = useUi((s) => s.homeBaseline);
  const userName = useUi((s) => s.userName);
  const kanbanOpen = useUi((s) => s.kanbanOpen);
  const setKanbanOpen = useUi((s) => s.setKanbanOpen);
  const kanban = useKanban();
  const newRequests = kanbanNewCount(kanban.board, kanban.seenAt);
  const { threads } = useThreads({ view: 'inbox', accountId: undefined, search: '' });

  const start = scheduling.morningHour;
  const end = Math.max(scheduling.eveningHour, start + 1);
  const h = hourOf(now);

  const prio = new Set(priorityEmails.map((e) => e.toLowerCase()));
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  // Priority mail that actually arrived since the app was last open (the
  // persisted last-active baseline), in arrival order. Keyed off the newest
  // message from someone else, so our own drafts and replies do not resurface
  // an old thread, and rows name the person who really wrote.
  const fresh = freshPriorityThreads(threads, prio, baseline);
  const newCount = fresh.filter((t) => t.unreadCount > 0).length;
  // The timeline maps today's hours, so only today's arrivals get a dot.
  const marks = fresh
    .filter((t) => arrivedAt(t) >= startOfToday)
    .map((t) => ({
      at: hourOf(new Date(arrivedAt(t))),
      unread: t.unreadCount > 0,
      label: `${clockTime(arrivedAt(t))} · ${inboundSenderLabel(t)} — ${t.subject || '(no subject)'}`,
    }));

  const accountName = (id: string) => {
    const a = accounts.find((x) => x.id === id);
    return a?.displayName || a?.email || 'Account';
  };
  const showAccount = accounts.length > 1;

  const greeting = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';

  const minutesLeft = Math.max(0, Math.round((end - h) * 60));
  const subline =
    h < start
      ? `Workday starts at ${hm(start)}`
      : h > end
        ? `Workday wrapped at ${hm(end)}`
        : `${Math.floor(minutesLeft / 60)}h ${minutesLeft % 60}m left in the workday`;

  const dateLine = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });

  if (kanbanOpen) {
    return <KanbanView board={kanban.board} onBack={() => setKanbanOpen(false)} />;
  }

  return (
    <div className="relative flex h-full flex-col">
      {kanban.configured && (
        <button
          onClick={() => {
            setKanbanOpen(true);
            kanban.markSeen();
            kanban.refresh();
          }}
          title={
            newRequests > 0
              ? `${newRequests} new ${newRequests === 1 ? 'request' : 'requests'}`
              : undefined
          }
          className="text-ink-muted hover:text-ink absolute top-6 right-6 z-10 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold"
        >
          <KanbanSquare size={13} />
          Sprint board
          {/* new tasks/requests since the board was last opened; the ping halo
              draws the eye (and stays still under reduced-motion) */}
          {newRequests > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
              <span className="bg-danger absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 motion-reduce:hidden" />
              <span className="bg-danger relative inline-flex h-2 w-2 rounded-full" />
            </span>
          )}
        </button>
      )}
      <div className="mx-auto my-auto flex h-[60%] w-full max-w-160 flex-col gap-y-14 px-8 pt-16 pb-6">
        <header className="home-rise">
          <p className="text-ink-faint font-mono text-[11px] font-semibold tracking-[0.16em] uppercase">
            {dateLine}
          </p>
          <h1 className="text-gradient mt-2 w-fit text-[34px] leading-tight font-bold tracking-tight">
            {greeting}
            {userName && `, ${userName}`}
          </h1>
          {!userName && <NameAsk />}
          <p className="text-ink-muted mt-1.5 text-[14px]">{subline}</p>
        </header>

        <div className="home-rise" style={{ animationDelay: '0.09s' }}>
          <DaylightArc now={now} start={start} end={end} marks={marks} />
        </div>

        {/* Always mounted so the greeting and timeline never shift when the
            list empties; the section keeps its slice of the page and only the
            rows inside scroll. When empty it stays as invisible reserved
            space — no header, no placeholder. */}
        <section
          className={cn(
            'home-rise flex min-h-0 flex-1 flex-col',
            fresh.length === 0 && 'invisible',
          )}
          style={{ animationDelay: '0.16s' }}
          aria-label="Priority mail"
          aria-hidden={fresh.length === 0}
        >
          <div className="flex shrink-0 items-baseline justify-between">
            <h2 className="text-ink text-[17px] font-bold tracking-tight">Priority mail</h2>
            {newCount > 0 && (
              <span className="text-ink-muted text-[12.5px] tabular-nums">{newCount} new</span>
            )}
          </div>
          <div className="no-scrollbar mt-2 min-h-0 flex-1 overflow-y-auto">
            {fresh.map((t) => (
              <PriorityRow
                key={t.id}
                thread={t}
                accountName={accountName(t.accountId)}
                showAccount={showAccount}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
