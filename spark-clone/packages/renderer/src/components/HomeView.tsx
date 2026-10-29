import type { ThreadSummary } from '@app/shared';
import { KanbanSquare } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { hourOf, useNow, useScheduling } from '../lib/workday';
import { api } from '../lib/api';
import { cn, isPriorityThread } from '../lib/utils';
import { arrivedAt, freshPriorityThreads, inboundSenderLabel } from '../lib/homePriority';
import { kanbanNewCount, useKanban } from '../state/kanban';
import { useAccounts, usePriorityTimeline } from '../state/queries';
import { useUi } from '../state/store';
import { useWindowActive } from '../lib/useWindowActive';
import { HalftoneWave } from './HalftoneWave';
import { KanbanView } from './kanban/KanbanView';
import { RollingNumber } from './RollingNumber';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** "9:00" — the workday bounds as shown in the timeline label. */
const hm = (hour: number) => `${hour}:00`;

function clockTime(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Where the timeline's track sits: past the 44px gutter and the 8px gap. */
const TRACK_X = 52;

/**
 * One hour of the timeline that holds priority mail: the hour label in the
 * gutter, then the cards that arrived in it. The track itself is drawn once
 * per day by RailDay, so rows stay plain layout.
 */
function RailRow({
  label,
  current,
  children,
}: {
  label: string;
  current?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-2">
      <span
        className={cn(
          'pt-3 text-right text-[11px] tabular-nums',
          current ? 'text-ink font-semibold' : 'text-ink-faint',
        )}
      >
        {label}
      </span>
      <div className="flex min-w-0 flex-col gap-2 pb-3 pl-5">{children}</div>
    </div>
  );
}

/**
 * A day on the timeline: its name, then its hours. Today's stretch of track
 * is lit and ends in the "now" line; earlier days sit on a plain hairline.
 */
function RailDay({
  label,
  today,
  children,
}: {
  label: string;
  today: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className={cn('absolute top-7 bottom-0 w-0.5', !today && 'bg-hairline')}
        style={{
          left: TRACK_X,
          background: today ? 'linear-gradient(var(--color-aqua), var(--color-azure))' : undefined,
        }}
      />
      <div className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-2 pb-2">
        <span />
        <p className="text-ink-faint pl-5 font-mono text-[10.5px] font-semibold tracking-[0.16em] uppercase">
          {label}
        </p>
      </div>
      {children}
    </div>
  );
}

function RailNow({ label }: { label: string }) {
  return (
    <div
      className="relative flex h-5 items-center gap-2"
      style={{ marginLeft: TRACK_X - 3 }}
      aria-label={`Now, ${label}`}
    >
      <span className="bg-ink h-2 w-2 shrink-0 rounded-full" />
      <span className="bg-ink/60 h-px flex-1" />
      <span className="text-ink text-[11px] font-semibold tabular-nums">Now · {label}</span>
    </div>
  );
}

const DAY_MS = 86_400_000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today", "Yesterday", "Monday" within the week, then "Mon, Oct 20". */
function dayLabel(dayStart: number, todayStart: number): string {
  const back = Math.round((todayStart - dayStart) / DAY_MS);
  if (back === 0) return 'Today';
  if (back === 1) return 'Yesterday';
  const d = new Date(dayStart);
  if (back < 7) return d.toLocaleDateString([], { weekday: 'long' });
  return d.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() === new Date(todayStart).getFullYear() ? undefined : 'numeric',
  });
}

type TimelineDay = {
  start: number;
  hours: { hour: number; mail: ThreadSummary[] }[];
};

/** Group mail (any order) into days and hours, oldest first, today always last. */
function buildTimeline(mail: ThreadSummary[], todayStart: number): TimelineDay[] {
  const byDay = new Map<number, Map<number, ThreadSummary[]>>([[todayStart, new Map()]]);
  for (const t of [...mail].sort((a, b) => arrivedAt(a) - arrivedAt(b))) {
    const at = arrivedAt(t);
    // Anything stamped after now (clock skew) still belongs to today.
    const day = Math.min(startOfDay(at), todayStart);
    const hour = day === todayStart && at > todayStart + DAY_MS ? 23 : new Date(at).getHours();
    let hours = byDay.get(day);
    if (!hours) byDay.set(day, (hours = new Map()));
    hours.set(hour, [...(hours.get(hour) ?? []), t]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, hours]) => ({
      start,
      hours: [...hours.entries()].sort(([a], [b]) => a - b).map(([hour, m]) => ({ hour, mail: m })),
    }));
}

function RailMail({
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
      className="border-hairline bg-surface/60 hover:bg-surface focus-visible:ring-accent w-full rounded-xl border px-3.5 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
    >
      <span className="flex items-center gap-2">
        {unread && (
          <span className="bg-azure h-1.5 w-1.5 shrink-0 rounded-full" aria-label="unread" />
        )}
        <span
          className={cn('text-ink truncate text-[13px]', unread ? 'font-bold' : 'font-semibold')}
        >
          {from}
        </span>
        <span className="text-ink-faint ml-auto shrink-0 text-[11px] tabular-nums">
          {clockTime(at)}
        </span>
      </span>
      <span className="mt-0.5 flex items-baseline gap-1.5">
        <span
          className={cn('truncate text-[12.5px]', unread ? 'text-ink-muted' : 'text-ink-faint')}
        >
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
  const timeline = usePriorityTimeline(priorityEmails.join(','));

  const start = scheduling.morningHour;
  const end = Math.max(scheduling.eveningHour, start + 1);
  const h = hourOf(now);

  const prio = new Set(priorityEmails.map((e) => e.toLowerCase()));
  const startOfToday = startOfDay(now.getTime());
  // Unread priority mail that actually arrived since the app was last open
  // (the persisted last-active baseline). Keyed off the newest message from
  // someone else, so our own drafts and replies do not resurface an old thread.
  const fresh = freshPriorityThreads(timeline.threads, prio, baseline);
  const newCount = fresh.filter((t) => t.unreadCount > 0).length;
  // The timeline is no longer the workday grid: every priority email sits at
  // the hour it arrived, grouped by day, with today (and "now") at the bottom
  // and older days above it, loaded a page at a time as you scroll up.
  const days = buildTimeline(
    timeline.threads.filter((t) => isPriorityThread(t, prio)),
    startOfToday,
  );
  const nowLabel = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const pct = Math.round(clamp01((h - start) / (end - start)) * 100);
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

  const active = useWindowActive();
  // The rail scrolls bottom-up (flex-col-reverse), so it opens on "now" and
  // keeps its place while older pages are added above. A sentinel at the top
  // asks for the next page once it comes within reach.
  const railRef = useRef<HTMLElement>(null);
  const olderRef = useRef<HTMLDivElement>(null);
  const { hasMore, loadOlder } = timeline;
  const loadedCount = timeline.threads.length;
  useEffect(() => {
    const rail = railRef.current;
    const sentinel = olderRef.current;
    if (!rail || !sentinel || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) loadOlder();
      },
      { root: rail, rootMargin: '240px 0px 0px 0px' },
    );
    io.observe(sentinel);
    return () => io.disconnect();
  }, [hasMore, loadOlder, loadedCount, kanbanOpen]);

  if (kanbanOpen) {
    return <KanbanView board={kanban.board} onBack={() => setKanbanOpen(false)} />;
  }

  return (
    <div className="relative flex h-full flex-col">
      {/* sdsn-crm Admin's halftone wave washes the top of Home behind the
          greeting, feathered out before the priority list. */}
      <HalftoneWave className="home-wave pointer-events-none absolute inset-x-0 top-0 h-[440px] w-full" />
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
      {/* Centred both ways: the summary on the left, the day rail on the
          right. Only the rail scrolls when the day outgrows the window. */}
      <div className="relative m-auto grid max-h-full w-full max-w-230 min-h-0 grid-cols-[minmax(0,320px)_minmax(0,1fr)] items-center gap-x-14 px-10 py-12">
        <header className="home-rise">
          <p className="text-ink-faint font-mono text-[11px] font-semibold tracking-[0.16em] uppercase">
            {dateLine}
          </p>
          <h1 className="text-ink-muted mt-2 text-[30px] leading-tight font-normal tracking-[-0.02em]">
            {greeting}
            {userName && (
              <>
                , <span className="text-ink font-medium">{userName}</span>
              </>
            )}
          </h1>
          {!userName && <NameAsk />}
          <p className="text-ink-muted mt-1.5 text-[14px]">{subline}</p>
          <div className="mt-12">
            <div className="text-ink text-[56px] leading-none font-bold tracking-tight tabular-nums">
              <RollingNumber value={pct} glide={active} />
              <span className="text-ink-faint text-[24px]">%</span>
            </div>
            <p className="text-ink-faint mt-2 font-mono text-[11px] font-semibold tracking-[0.16em] uppercase">
              of {hm(start)} – {hm(end)}
            </p>
          </div>
          <div className="mt-8 flex items-baseline gap-2">
            <span className="text-ink text-[22px] font-bold tabular-nums">{newCount}</span>
            <span className="text-ink-muted text-[13px]">unread priority</span>
          </div>
        </header>

        <section
          ref={railRef}
          className="home-rise no-scrollbar flex max-h-[calc(100vh-6rem)] min-h-0 flex-col-reverse overflow-y-auto"
          style={{
            animationDelay: '0.09s',
            // Older mail fades out under the top edge instead of being cut.
            maskImage: 'linear-gradient(transparent, black 40px)',
          }}
          aria-label="Priority mail timeline"
        >
          <div className="flex flex-col gap-4 pt-8">
            <div ref={olderRef} className="grid grid-cols-[44px_minmax(0,1fr)] gap-x-2">
              <span />
              <p className="text-ink-faint pl-5 text-[11.5px]">
                {hasMore
                  ? 'Loading earlier mail…'
                  : loadedCount > 0
                    ? 'That’s everything from your priority senders'
                    : 'No priority mail yet'}
              </p>
            </div>
            {days.map((d) => {
              const today = d.start === startOfToday;
              return (
                <RailDay key={d.start} label={dayLabel(d.start, startOfToday)} today={today}>
                  {d.hours.map((r) => (
                    <RailRow
                      key={r.hour}
                      label={hm(r.hour)}
                      current={today && r.hour === Math.floor(h)}
                    >
                      {r.mail.map((t) => (
                        <RailMail
                          key={t.id}
                          thread={t}
                          accountName={accountName(t.accountId)}
                          showAccount={showAccount}
                        />
                      ))}
                    </RailRow>
                  ))}
                  {today && <RailNow label={nowLabel} />}
                </RailDay>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
