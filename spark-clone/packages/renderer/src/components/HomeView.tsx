import type { ThreadSummary } from '@app/shared';
import { KanbanSquare } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { hourOf, useNow, useScheduling } from '../lib/workday';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { arrivedAt, freshPriorityThreads, inboundSenderLabel } from '../lib/homePriority';
import { kanbanNewCount, useKanban } from '../state/kanban';
import { useAccounts, useThreads } from '../state/queries';
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

/**
 * One hour of the day rail: the hour label in the gutter, then a stretch of
 * the rail's track carrying whatever priority mail arrived in that hour. The
 * lived part of the track is lit by RailNow's fill, drawn over all rows.
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
    <div data-rail-row className="grid min-h-11 grid-cols-[44px_1fr] gap-x-2">
      <span
        className={cn(
          'pt-px text-right text-[11px] tabular-nums',
          current ? 'text-ink font-semibold' : 'text-ink-faint',
        )}
      >
        {label}
      </span>
      <div className="border-hairline border-l-2 pb-3 pl-5">
        <div className="flex flex-col gap-2">{children}</div>
      </div>
    </div>
  );
}

/** Height of the "now" line, and of the slot the current hour keeps for it. */
const NOW_H = 20;
/** Where the rail's track sits: past the 44px gutter and the 8px gap. */
const TRACK_X = 52;

/**
 * The lit stretch of the rail plus the "now" line, drawn over the rows at
 * `y` (the line's centre, in px from the top of the rail). Both move on
 * transform only: the fill scales from the top and the line slides, so a
 * tick costs one composited transition and nothing runs in between.
 */
function RailNow({
  label,
  y,
  height,
  glide,
}: {
  label: string;
  y: number;
  height: number;
  glide: boolean;
}) {
  return (
    <>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-0 bottom-0 w-0.5 origin-top',
          glide && 'home-glide',
        )}
        style={{
          left: TRACK_X,
          background: 'linear-gradient(var(--color-aqua), var(--color-azure))',
          transform: `scaleY(${height > 0 ? y / height : 0})`,
        }}
      />
      <div
        className={cn(
          'pointer-events-none absolute top-0 right-0 flex items-center gap-2',
          glide && 'home-glide',
        )}
        style={{
          left: TRACK_X - 3,
          height: NOW_H,
          transform: `translateY(${y - NOW_H / 2}px)`,
        }}
        aria-label={`Now, ${label}`}
      >
        <span className="bg-ink h-2 w-2 shrink-0 rounded-full" />
        <span className="bg-ink/60 h-px flex-1" />
        <span className="text-ink text-[11px] font-semibold tabular-nums">Now · {label}</span>
      </div>
    </>
  );
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
  // Hang each email on the rail at the hour it arrived. Anything from before
  // the workday (or an earlier day) collects under "Earlier", anything after it
  // under the closing hour; those two rows only show when they hold something.
  const railHour = (t: ThreadSummary) => {
    const at = arrivedAt(t);
    return at < startOfToday ? -Infinity : hourOf(new Date(at));
  };
  const rows: { key: string; label: string; from: number; to: number }[] = [
    { key: 'earlier', label: 'Earlier', from: -Infinity, to: start },
  ];
  for (let t = start; t < end; t += 1)
    rows.push({ key: String(t), label: hm(t), from: t, to: t + 1 });
  rows.push({ key: 'later', label: hm(end), from: end, to: Infinity });
  const railRows = rows
    .map((r) => ({
      ...r,
      mail: fresh.filter((t) => railHour(t) >= r.from && railHour(t) < r.to),
      current: h >= r.from && h < r.to,
    }))
    .filter((r) => (r.key !== 'earlier' && r.key !== 'later') || r.mail.length > 0 || r.current);
  const nowLabel = now.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const pct = Math.round(clamp01((h - start) / (end - start)) * 100);
  // How far through the current hour row the line sits; the rows before and
  // after the workday hold it at their top.
  const hourFrac = h >= start && h < end ? h - Math.floor(h) : 0;

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

  // The "now" line glides down the current hour's row: from the slot kept
  // for it (after the mail that already arrived) to the next hour's label.
  // Measured after each render and on resize; changes only animate while the
  // window is active, and snap otherwise so a background tick costs nothing.
  const active = useWindowActive();
  const railRef = useRef<HTMLElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const [mark, setMark] = useState({ y: 0, height: 0 });
  const [measured, setMeasured] = useState(false);
  const measureRef = useRef(() => {});
  useLayoutEffect(() => {
    const measure = () => {
      const track = trackRef.current;
      const slot = slotRef.current;
      const row = slot?.closest<HTMLElement>('[data-rail-row]');
      if (!track || !slot || !row) return;
      const from = slot.offsetTop + NOW_H / 2;
      const to = row.offsetTop + row.offsetHeight + NOW_H / 2;
      const y = Math.round(from + hourFrac * (to - from));
      const height = track.offsetHeight;
      setMark((m) => (m.y === y && m.height === height ? m : { y, height }));
    };
    measureRef.current = measure;
    measure();
  });
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const ro = new ResizeObserver(() => measureRef.current());
    ro.observe(track);
    // First position lands without a glide; later changes animate.
    const id = requestAnimationFrame(() => setMeasured(true));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(id);
      setMeasured(false);
    };
  }, [kanbanOpen]);
  const glide = active && measured;

  // In a short window the rail scrolls; keep "now" in view as rows arrive.
  const railSize = fresh.length;
  useEffect(() => {
    const rail = railRef.current;
    const slot = slotRef.current;
    if (!rail || !slot || rail.scrollHeight <= rail.clientHeight) return;
    rail.scrollTop = slot.offsetTop - rail.clientHeight / 2;
  }, [railSize, kanbanOpen]);

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
          className="home-rise no-scrollbar max-h-[calc(100vh-6rem)] min-h-0 overflow-y-auto"
          style={{ animationDelay: '0.09s' }}
          aria-label="Workday and priority mail"
        >
          <div ref={trackRef} className="relative">
            {railRows.map((r) => (
              <RailRow key={r.key} label={r.label} current={r.current}>
                {r.mail
                  .filter((t) => !r.current || railHour(t) <= h)
                  .map((t) => (
                    <RailMail
                      key={t.id}
                      thread={t}
                      accountName={accountName(t.accountId)}
                      showAccount={showAccount}
                    />
                  ))}
                {r.current && <div ref={slotRef} style={{ height: NOW_H }} />}
                {r.current &&
                  r.mail
                    .filter((t) => railHour(t) > h)
                    .map((t) => (
                      <RailMail
                        key={t.id}
                        thread={t}
                        accountName={accountName(t.accountId)}
                        showAccount={showAccount}
                      />
                    ))}
              </RailRow>
            ))}
            <RailNow label={nowLabel} y={mark.y} height={mark.height} glide={glide} />
          </div>
        </section>
      </div>
    </div>
  );
}
