import { ChevronDown, ChevronLeft, ChevronRight, Video } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TILES } from '../components/InviteCard';
import { ProposeTime } from '../components/ProposeTime';
import type { MobileEvent, RsvpAnswer } from '../data/types';
import {
  addDays,
  clock12,
  dayLabel,
  displayName,
  firstName,
  startOfDay,
  startOfWeek,
  timeRange,
} from '../lib/format';
import { useStore } from '../lib/store';
import './inbox.css';
import './calendar.css';

const MIN = 60_000;
const HOUR = 60 * MIN;
/** A free gap shorter than this is not worth a line. */
const MIN_GAP = 30 * MIN;
/** "Free from…" is only offered until this hour of the day. */
const DAY_END_H = 21;

type Gap = { key: string; startMs: number; endMs: number | null };
type Item = { kind: 'event'; ev: MobileEvent } | { kind: 'gap'; gap: Gap } | { kind: 'now' };

const span = (ms: number) => {
  const m = Math.round(ms / MIN);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h} h ${m % 60}` : `${h} h`;
};
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const isWaiting = (e: MobileEvent, mine: Set<string>) =>
  e.myAnswer === null &&
  e.attendees.length > 0 &&
  !!e.organizer &&
  !mine.has(e.organizer.email.toLowerCase());
const clashIn = (busy: MobileEvent[], a: MobileEvent) =>
  a.free ? undefined : busy.find((b) => b !== a && a.startMs < b.endMs && b.startMs < a.endMs);
const COUNT = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
const inviteWord = (n: number) => `${COUNT[n] ?? n} invite${n === 1 ? '' : 's'}`;
const quarter = (ms: number) => Math.ceil(ms / (15 * MIN)) * 15 * MIN;

/**
 * The Calendar's day view. A sentence sums the day up and its words act: the
 * day opens the week, the clash and the next meeting jump to their event, the
 * invites open "Needs your answer". Below, the day is one line of events with
 * the free time between them; tapping free time adds an event right there.
 */
export function DayRiver({
  day,
  setDay,
  events,
  now,
  view,
  setView,
  onChanged,
  onDetails,
  wantNew,
  onNewHandled,
}: {
  day: number;
  setDay: (d: number) => void;
  events: MobileEvent[];
  now: number;
  view: string;
  setView: (v: 'day' | 'week' | 'list') => void;
  onChanged: () => void;
  onDetails: (e: MobileEvent) => void;
  /** The island asked for a new event: open one in the next free gap. */
  wantNew: boolean;
  /** Called once that request is dealt with; false when no gap could take it. */
  onNewHandled: (placed: boolean) => void;
}) {
  const accounts = useStore((s) => s.accounts);
  const [weekOpen, setWeekOpen] = useState(false);
  const [needOpen, setNeedOpen] = useState(true);
  // What is unfolded belongs to one day: another day starts folded.
  const [opened, setOpened] = useState<{ day: number; id: string | null }>({ day, id: null });
  const [drafted, setDrafted] = useState<{ day: number; gap: Gap | null }>({ day, gap: null });
  const openId = opened.day === day ? opened.id : null;
  const setOpenId = (id: string | null) => setOpened({ day, id });
  const needRef = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);

  const today = startOfDay(now);
  const isToday = day === today;
  const mine = useMemo(() => new Set(accounts.map((a) => a.email.toLowerCase())), [accounts]);

  const dayEvents = useMemo(
    () =>
      events
        .filter((e) => e.startMs < addDays(day, 1) && e.endMs > day)
        .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs),
    [events, day],
  );
  const allDay = dayEvents.filter((e) => e.allDay);
  const timed = dayEvents.filter((e) => !e.allDay);
  const busy = timed.filter((e) => !e.free);
  const clashOf = (a: MobileEvent) => clashIn(busy, a);
  const clashing = busy.filter(clashOf);
  const waits = (e: MobileEvent) => isWaiting(e, mine);
  const pending = timed.filter((e) => waits(e) && e.endMs > now);
  const next = isToday ? busy.find((e) => e.startMs > now) : undefined;

  const minute = Math.floor(now / MIN);
  // The line: events in order, the free time between busy blocks, and Now.
  const items = useMemo(() => {
    const out: Item[] = [];
    const dayEnd = day + DAY_END_H * HOUR;
    let cursor = 0; // end of the busy block so far
    let nowPlaced = !isToday;
    const placeNow = (before: number) => {
      if (!nowPlaced && now < before) {
        out.push({ kind: 'now' });
        nowPlaced = true;
      }
    };
    for (const e of timed) {
      if (!e.free) {
        if (cursor && e.startMs - cursor >= MIN_GAP) {
          // Now sits before the gap when the gap is still ahead of it.
          if (now <= cursor) placeNow(e.startMs);
          out.push({ kind: 'gap', gap: { key: `g${cursor}`, startMs: cursor, endMs: e.startMs } });
        }
        cursor = Math.max(cursor, e.endMs);
      }
      placeNow(e.startMs);
      out.push({ kind: 'event', ev: e });
    }
    if (!nowPlaced) out.push({ kind: 'now' });
    if (!cursor) {
      const start = isToday ? Math.max(quarter(now), day + 9 * HOUR) : day + 10 * HOUR;
      out.push({ kind: 'gap', gap: { key: 'all', startMs: start, endMs: null } });
    } else if (cursor < dayEnd) {
      out.push({ kind: 'gap', gap: { key: `g${cursor}`, startMs: cursor, endMs: null } });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayEvents, day, isToday, minute]);

  /** Where a new event in this gap would start, or null when the gap is over. */
  const startIn = (g: Gap): number | null => {
    if (day < today) return null;
    const s = isToday ? Math.max(g.startMs, quarter(now)) : g.startMs;
    if (g.endMs !== null && g.endMs - s < 15 * MIN) return null;
    return s;
  };

  // A request from the island opens the next free gap, for as long as it stands.
  const autoGap = wantNew
    ? (items.find((i) => i.kind === 'gap' && startIn(i.gap) !== null) as
        { kind: 'gap'; gap: Gap } | undefined)
    : undefined;
  const draft = autoGap?.gap ?? (drafted.day === day ? drafted.gap : null);
  const setDraft = (gap: Gap | null) => {
    setDrafted({ day, gap });
    if (wantNew) onNewHandled(true);
  };
  const noGap = wantNew && !autoGap;
  useEffect(() => {
    if (noGap) return onNewHandled(false);
    if (wantNew)
      setTimeout(
        () =>
          root.current
            ?.querySelector('.cal-new')
            ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
        80,
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantNew, noGap]);

  const jumpTo = (id: string) => {
    setOpenId(id);
    setTimeout(
      () =>
        root.current
          ?.querySelector(`[data-ev="${CSS.escape(id)}"]`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' }),
      60,
    );
  };
  const showNeed = () => {
    setNeedOpen(true);
    setTimeout(() => needRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const dayWord = dayLabel(day, now);
  const past = day < today;
  const week = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(day), i));
  const clashPairs = Math.max(1, Math.round(clashing.length / 2));

  return (
    <div className="cal" ref={root}>
      <CalTop
        label={new Date(day).toLocaleDateString([], { month: 'long', day: 'numeric' })}
        onToday={() => setDay(today)}
        view={view}
        setView={setView}
      />

      <p className="cal-sent">
        <button className="ib-w" aria-expanded={weekOpen} onClick={() => setWeekOpen(!weekOpen)}>
          {dayWord}
        </button>{' '}
        {busy.length === 0 ? (
          <>{past ? 'was' : 'is'} completely free.</>
        ) : (
          <>
            {past ? 'had' : 'has'} {plural(busy.length, 'meeting')}
            {clashing.length > 0 && (
              <>
                {' '}
                and{' '}
                <button className="ib-w warn" onClick={() => jumpTo(clashing[0]!.id)}>
                  {clashPairs === 1 ? 'one clash' : `${clashPairs} clashes`}
                </button>
              </>
            )}
            .
          </>
        )}
        {pending.length > 0 && (
          <>
            {' '}
            <button className="ib-w" onClick={() => (needOpen ? setNeedOpen(false) : showNeed())}>
              {inviteWord(pending.length)}
            </button>{' '}
            {pending.length === 1 ? 'waits' : 'wait'} for you.
          </>
        )}
        {next ? (
          <>
            {' '}
            Next is{' '}
            <button className="ib-w" onClick={() => jumpTo(next.id)}>
              {next.title}
            </button>{' '}
            in {span(next.startMs - now)}.
          </>
        ) : (
          isToday && busy.length > 0 && <> The rest of the day is yours.</>
        )}
      </p>

      <div className={`cal-fold${weekOpen ? ' open' : ''}`} inert={!weekOpen}>
        <div>
          <div className="cal-week glass">
            <button
              className="nav"
              aria-label="Previous week"
              onClick={() => setDay(addDays(day, -7))}
            >
              <ChevronLeft size={18} />
            </button>
            {week.map((d) => {
              const count = events.filter(
                (e) => !e.allDay && !e.free && e.startMs >= d && e.startMs < addDays(d, 1),
              ).length;
              return (
                <button
                  key={d}
                  className={`d${d === day ? ' sel' : ''}${d === today ? ' today' : ''}`}
                  aria-label={new Date(d).toLocaleDateString([], {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}
                  aria-pressed={d === day}
                  onClick={() => setDay(d)}
                >
                  <div className="wd">
                    {new Date(d).toLocaleDateString([], { weekday: 'narrow' })}
                  </div>
                  <div className="n">{new Date(d).getDate()}</div>
                  <div className="dots">
                    {Array.from({ length: Math.min(4, count) }, (_, i) => (
                      <i key={i} />
                    ))}
                  </div>
                </button>
              );
            })}
            <button className="nav" aria-label="Next week" onClick={() => setDay(addDays(day, 7))}>
              <ChevronRight size={18} />
            </button>
          </div>
        </div>
      </div>

      <Needs
        pending={pending}
        clashOf={clashOf}
        open={needOpen}
        setOpen={setNeedOpen}
        innerRef={needRef}
        onChanged={onChanged}
        onDetails={onDetails}
      />

      <div className="cal-river">
        {allDay.length > 0 && (
          <div className="cal-allday">
            {allDay.map((e) => (
              <button key={e.id} onClick={() => onDetails(e)}>
                <i style={{ background: e.color }} />
                All day · {e.title}
              </button>
            ))}
          </div>
        )}
        {timed.length === 0 && (
          <p className="cal-empty">
            {past ? 'Nothing was booked.' : 'Nothing booked. A whole day of open sky.'}
          </p>
        )}
        {items.map((it) => {
          if (it.kind === 'now')
            return (
              <div className="cal-now" key="now">
                <span className="p" />
                Now · {clock12(now)}
                <span className="l" />
              </div>
            );
          if (it.kind === 'gap') {
            const g = it.gap;
            const start = startIn(g);
            const label =
              g.key === 'all'
                ? 'Free all day'
                : g.endMs === null
                  ? `Free from ${clock12(g.startMs)}`
                  : `Free for ${span(g.endMs - g.startMs)}`;
            const open = draft?.key === g.key;
            return (
              <div className="cal-node" key={g.key}>
                <div className="cal-rail">
                  <span className="dash" />
                </div>
                <div className="cal-gap">
                  {start === null ? (
                    <div className="cal-gap-h">{label}</div>
                  ) : (
                    <>
                      <button
                        className="cal-gap-h"
                        aria-expanded={open}
                        onClick={() => setDraft(open ? null : g)}
                      >
                        <span>{label}</span>
                        <span className="plan">Plan something</span>
                      </button>
                      <div className={`cal-fold${open ? ' open' : ''}`} inert={!open}>
                        <div>
                          {open && (
                            <NewEventInline
                              startMs={start}
                              onClose={() => setDraft(null)}
                              onCreated={onChanged}
                            />
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            );
          }
          const e = it.ev;
          const open = openId === e.id;
          const waiting = waits(e);
          const sub = [
            clock12(e.startMs),
            span(e.endMs - e.startMs),
            e.free
              ? 'free time'
              : waiting
                ? 'not answered yet'
                : e.meetingUrl
                  ? e.meetingUrl.includes('zoom')
                    ? 'Zoom'
                    : 'Meet'
                  : e.location,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <div
              className={`cal-node${e.endMs <= now ? ' done' : ''}`}
              key={e.id}
              data-ev={e.id}
              style={{ ['--c' as string]: e.free ? 'var(--faint)' : e.color }}
            >
              <div className="cal-rail">
                <span className={`dot${waiting ? ' hollow' : ''}`} />
                <span className="line" />
              </div>
              <div className="cal-ev">
                <button
                  className="cal-ev-h"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : e.id)}
                >
                  <b>{e.title}</b>
                  {clashOf(e) && <span className="clash">clash</span>}
                  <span className="sub">{sub}</span>
                </button>
                <div className={`cal-fold${open ? ' open' : ''}`} inert={!open}>
                  <div>
                    <div className="cal-detail">
                      {e.attendees.length > 0 && (
                        <p>
                          With {e.attendees.slice(0, 2).map(displayName).join(', ')}
                          {e.attendees.length > 2 ? ` and ${e.attendees.length - 2} more` : ''}.
                        </p>
                      )}
                      {e.location && <p className="muted">{e.location}</p>}
                      {clashOf(e) && <p className="muted">Clashes with {clashOf(e)!.title}.</p>}
                      <div className="cal-acts">
                        {e.meetingUrl && (
                          <a
                            className="btn primary"
                            href={e.meetingUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            <Video size={17} /> Join
                          </a>
                        )}
                        {waiting && e.endMs > now && (
                          <button className="cal-link" onClick={showNeed}>
                            Answer
                          </button>
                        )}
                        <button className="cal-link" onClick={() => onDetails(e)}>
                          Details
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type ViewName = 'day' | 'week' | 'list';

/** The quiet top line: where you are, and the Day / Week / List words. */
export function CalTop({
  label,
  onToday,
  view,
  setView,
}: {
  label: string;
  onToday: () => void;
  view: string;
  setView: (v: ViewName) => void;
}) {
  return (
    <div className="cal-top">
      <button className="cal-eye" onClick={onToday} aria-label={`${label}. Go to today`}>
        {label}
      </button>
      <div className="cal-views">
        {(['day', 'week', 'list'] as const).map((v) => (
          <button
            key={v}
            className={view === v ? 'on' : ''}
            aria-current={view === v}
            onClick={() => setView(v)}
          >
            {v}
          </button>
        ))}
      </div>
    </div>
  );
}

/** "Needs your answer": the invites still waiting, folding as one section. */
function Needs({
  pending,
  clashOf,
  open,
  setOpen,
  innerRef,
  onChanged,
  onDetails,
  showDay,
}: {
  pending: MobileEvent[];
  clashOf: (e: MobileEvent) => MobileEvent | undefined;
  open: boolean;
  setOpen: (o: boolean) => void;
  innerRef: React.RefObject<HTMLDivElement | null>;
  onChanged: () => void;
  onDetails: (e: MobileEvent) => void;
  showDay?: boolean;
}) {
  if (!pending.length) return null;
  return (
    <div ref={innerRef} style={{ scrollMarginTop: 'calc(var(--top-clear) + 8px)' }}>
      <button className="cal-need-h" aria-expanded={open} onClick={() => setOpen(!open)}>
        <h2>
          Needs your answer <span>{pending.length}</span>
        </h2>
        <ChevronDown size={18} strokeWidth={2.4} />
      </button>
      <div className={`cal-fold${open ? ' open' : ''}`} inert={!open}>
        <div>
          {pending.map((e) => (
            <InviteAnswer
              key={e.id}
              ev={e}
              clash={clashOf(e)}
              showDay={showDay}
              onChanged={onChanged}
              onDetails={() => onDetails(e)}
            />
          ))}
        </div>
      </div>
      <div className={`cal-fold${open ? '' : ' open'}`} aria-hidden={open}>
        <div>
          <p className="cal-need-hint">{pending.map((e) => e.title).join(' and ')}</p>
        </div>
      </div>
    </div>
  );
}

const list = (words: string[]) =>
  words.length < 2
    ? (words[0] ?? '')
    : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;

/**
 * The week view, "Seven folds": the same sentence and "Needs your answer",
 * then one row per day with its meetings as dots. A day opens into its own
 * short line of events; free time there leads to a new event on that day.
 */
export function WeekFolds({
  day,
  setDay,
  events,
  now,
  view,
  setView,
  onChanged,
  onDetails,
  onOpenDay,
  onPlan,
}: {
  day: number;
  setDay: (d: number) => void;
  events: MobileEvent[];
  now: number;
  view: string;
  setView: (v: ViewName) => void;
  onChanged: () => void;
  onDetails: (e: MobileEvent) => void;
  onOpenDay: (d: number) => void;
  /** Start a new event on that day. */
  onPlan: (d: number) => void;
}) {
  const accounts = useStore((s) => s.accounts);
  const mine = useMemo(() => new Set(accounts.map((a) => a.email.toLowerCase())), [accounts]);
  const today = startOfDay(now);
  const ws = startOfWeek(day);
  const [needOpen, setNeedOpen] = useState(false);
  const [opened, setOpened] = useState<{ ws: number; d: number | null } | null>(null);
  const needRef = useRef<HTMLDivElement>(null);

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = addDays(ws, i);
    const all = events
      .filter((e) => e.startMs < addDays(d, 1) && e.endMs > d)
      .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    const timed = all.filter((e) => !e.allDay);
    const busy = timed.filter((e) => !e.free);
    return { d, all, timed, busy, clashing: busy.filter((e) => clashIn(busy, e)) };
  });
  const inWeek = today >= ws && today < addDays(ws, 7);
  // Today starts open; another week starts with every day folded.
  const openDay = opened?.ws === ws ? opened.d : inWeek ? today : null;
  const total = days.reduce((n, x) => n + x.busy.length, 0);
  const pending = days.flatMap((x) => x.timed.filter((e) => isWaiting(e, mine) && e.endMs > now));
  const clashOf = (e: MobileEvent) => clashIn(days.find((x) => x.timed.includes(e))?.busy ?? [], e);

  const past = addDays(ws, 7) <= today;
  const weekWord = inWeek
    ? 'This week'
    : ws === addDays(startOfWeek(today), 7)
      ? 'Next week'
      : ws === addDays(startOfWeek(today), -7)
        ? 'Last week'
        : `The week of ${new Date(ws).toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
  const freeDays = days.filter((x) => x.d >= today && x.busy.length === 0);
  const names = freeDays.map((x) => new Date(x.d).toLocaleDateString([], { weekday: 'long' }));
  const sat = freeDays.find((x) => new Date(x.d).getDay() === 6);
  const sun = freeDays.find((x) => new Date(x.d).getDay() === 0);
  const openWords =
    sat && sun
      ? [
          ...freeDays
            .filter((x) => x !== sat && x !== sun)
            .map((x) => new Date(x.d).toLocaleDateString([], { weekday: 'long' })),
          'the weekend',
        ]
      : names;
  const label = `${new Date(ws).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${new Date(
    addDays(ws, 6),
  ).toLocaleDateString([], { day: 'numeric' })}`;

  return (
    <div className="cal">
      <CalTop label={label} onToday={() => setDay(today)} view={view} setView={setView} />
      <p className="cal-sent">
        <b>{weekWord}</b> {past ? 'held' : 'holds'} {plural(total, 'meeting')}.
        {pending.length > 0 && (
          <>
            {' '}
            <button
              className="ib-w"
              onClick={() => {
                setNeedOpen(!needOpen);
                if (!needOpen)
                  setTimeout(
                    () => needRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
                    60,
                  );
              }}
            >
              {inviteWord(pending.length)}
            </button>{' '}
            {pending.length === 1 ? 'waits' : 'wait'} for you.
          </>
        )}
        {openWords.length > 0 && openWords.length < 7 && (
          <>
            {' '}
            {list(openWords).replace(/^./, (c) => c.toUpperCase())}{' '}
            {openWords.length === 1 && openWords[0] !== 'the weekend' ? 'is' : 'are'} open.
          </>
        )}
      </p>

      <Needs
        pending={pending}
        clashOf={clashOf}
        open={needOpen}
        setOpen={setNeedOpen}
        innerRef={needRef}
        onChanged={onChanged}
        onDetails={onDetails}
        showDay
      />

      <div className="cal-days">
        {days.map(({ d, all, timed, busy, clashing }) => {
          const open = openDay === d;
          const isToday = d === today;
          const last = busy.reduce((m, e) => Math.max(m, e.endMs), 0);
          const freeLabel = !busy.length
            ? 'Free all day'
            : last < d + DAY_END_H * HOUR
              ? `Free from ${clock12(last)}`
              : null;
          const pairs = Math.max(1, Math.round(clashing.length / 2));
          return (
            <div className={`cal-day${d < today ? ' past' : ''}`} key={d}>
              <button
                className="cal-day-h"
                aria-expanded={open}
                onClick={() => setOpened({ ws, d: open ? null : d })}
              >
                <span className={`nm${isToday ? ' today' : ''}`}>
                  {isToday ? 'Today' : new Date(d).toLocaleDateString([], { weekday: 'long' })}{' '}
                  <span>{new Date(d).getDate()}</span>
                </span>
                <span className="dots">
                  {busy.slice(0, 6).map((e) => (
                    <i key={e.id} style={{ background: e.color }} />
                  ))}
                </span>
                <span className="sm">
                  {busy.length
                    ? `${plural(busy.length, 'meeting')}${clashing.length ? ` · ${plural(pairs, 'clash').replace('clashs', 'clashes')}` : ''}`
                    : 'Free all day'}
                </span>
              </button>
              <div className={`cal-fold${open ? ' open' : ''}`} inert={!open}>
                <div>
                  <div className="cal-day-in">
                    {all
                      .filter((e) => e.allDay)
                      .map((e) => (
                        <button key={e.id} className="cal-mini" onClick={() => onDetails(e)}>
                          <span className="cal-rail">
                            <span className="dot" style={{ ['--c' as string]: e.color }} />
                            <span className="line" />
                          </span>
                          <span className="tx">
                            <b>{e.title}</b>
                            <span className="sub">All day</span>
                          </span>
                        </button>
                      ))}
                    {timed.map((e) => {
                      const waiting = isWaiting(e, mine);
                      return (
                        <button
                          key={e.id}
                          className={`cal-mini${e.endMs <= now ? ' done' : ''}`}
                          style={{ ['--c' as string]: e.free ? 'var(--faint)' : e.color }}
                          onClick={() => onDetails(e)}
                        >
                          <span className="cal-rail">
                            <span className={`dot${waiting ? ' hollow' : ''}`} />
                            <span className="line" />
                          </span>
                          <span className="tx">
                            <b>{e.title}</b>
                            {clashIn(busy, e) && <span className="clash">clash</span>}
                            <span className="sub">
                              {clock12(e.startMs)} · {span(e.endMs - e.startMs)}
                              {e.free ? ' · free time' : waiting ? ' · not answered yet' : ''}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                    <div className="cal-gap-h">
                      <button className="cal-link flush" onClick={() => onOpenDay(d)}>
                        {freeLabel ?? 'Open the day'}
                      </button>
                      {d >= today && (
                        <button className="plan cal-link" onClick={() => onPlan(d)}>
                          Plan something
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const DONE: Record<RsvpAnswer, string> = {
  accepted: 'Accepted',
  tentative: 'Answered maybe',
  declined: 'Declined',
};

/** One invite waiting for an answer: what, when, who, and the four answer tiles. */
function InviteAnswer({
  ev,
  clash,
  showDay,
  onChanged,
  onDetails,
}: {
  ev: MobileEvent;
  clash?: MobileEvent;
  showDay?: boolean;
  onChanged: () => void;
  onDetails: () => void;
}) {
  const { api, showToast } = useStore();
  const [answer, setAnswer] = useState<RsvpAnswer | null>(null);
  const [proposing, setProposing] = useState(false);
  const who = firstName(ev.organizer);
  const respond = async (key: RsvpAnswer | 'propose') => {
    if (key === 'propose') return setProposing(true);
    setAnswer(key);
    try {
      await api.rsvp(ev.id, ev.accountId, key);
      showToast({ text: `${DONE[key]}. ${who} sees it in Google Calendar` });
      setTimeout(onChanged, 900);
    } catch (e) {
      setAnswer(null);
      showToast({ text: (e as Error).message });
    }
  };
  return (
    <div className={`cal-inv${answer ? ' picked' : ''}`}>
      <button className="cal-inv-top" onClick={onDetails}>
        <b>{ev.title}</b>
        <span>
          {showDay ? `${dayLabel(ev.startMs)} ` : ''}
          {timeRange(ev.startMs, ev.endMs)} · from {who} ·{' '}
          {clash ? <em>clashes with {clash.title}</em> : 'you are free'}
        </span>
      </button>
      <div className="ib-tiles">
        {TILES.map(({ key, label, Icon, tilt, bg, ic }) => (
          <button
            key={key}
            className={`ib-tile${answer === key ? ' sel' : ''}`}
            style={{ ['--tilt' as string]: `${tilt}deg`, background: bg }}
            disabled={!!answer}
            onClick={() => void respond(key)}
          >
            <Icon size={14} strokeWidth={2.4} color={ic} />
            {key === 'accepted' ? 'Going' : label}
          </button>
        ))}
      </div>
      {proposing && (
        <ProposeTime
          invite={{
            eventId: ev.id,
            title: ev.title,
            startMs: ev.startMs,
            endMs: ev.endMs,
            meetingUrl: ev.meetingUrl,
            organizer: ev.organizer ?? null,
            guests: ev.attendees,
            myAnswer: ev.myAnswer,
          }}
          accountId={ev.accountId}
          onClose={() => setProposing(false)}
        />
      )}
    </div>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');

/** A new event, written right in the free gap it will fill. */
function NewEventInline({
  startMs,
  onClose,
  onCreated,
}: {
  startMs: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { api, accounts, showToast } = useStore();
  const [title, setTitle] = useState('');
  const d0 = new Date(startMs);
  const [time, setTime] = useState(`${pad(d0.getHours())}:${pad(d0.getMinutes())}`);
  const [mins, setMins] = useState(30);
  const [meet, setMeet] = useState(true);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const start = () => {
    const [h, m] = time.split(':').map(Number);
    const d = new Date(startMs);
    d.setHours(h ?? d.getHours(), m ?? 0, 0, 0);
    return d.getTime();
  };
  const create = async () => {
    const s = start();
    setBusy(true);
    try {
      await api.createEvent({
        accountId,
        title: title.trim() || 'New event',
        startMs: s,
        endMs: s + mins * MIN,
        addMeet: meet,
      });
      showToast({ text: `Added for ${clock12(s)}` });
      onCreated();
      onClose();
    } catch (e) {
      showToast({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="cal-new">
      <div className="cap">
        New event at
        <input
          type="time"
          aria-label="Starts at"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      </div>
      <input
        className="title"
        aria-label="Title"
        placeholder="What is it?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void create()}
      />
      <div className="len" role="group" aria-label="Length">
        {[30, 60, 90].map((m) => (
          <button
            key={m}
            className={mins === m ? 'on' : ''}
            aria-pressed={mins === m}
            onClick={() => setMins(m)}
          >
            {span(m * MIN)}
          </button>
        ))}
      </div>
      {accounts.length > 1 && (
        <select
          aria-label="Calendar"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.email}
            </option>
          ))}
        </select>
      )}
      <div className="foot">
        <button
          className={`meet${meet ? ' on' : ''}`}
          aria-pressed={meet}
          onClick={() => setMeet(!meet)}
        >
          {meet ? 'With a Meet link' : 'No Meet link'}
        </button>
        <span className="sp" />
        <button className="cal-link" onClick={onClose}>
          Cancel
        </button>
        <button className="btn primary" disabled={busy} onClick={() => void create()}>
          Add
        </button>
      </div>
    </div>
  );
}
