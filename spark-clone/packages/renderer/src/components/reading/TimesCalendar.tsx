import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { create } from 'zustand';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import {
  addPick,
  cellStatus,
  localHour,
  mergeIntervals,
  minutesIn,
  removePickAt,
  zoneColumns,
  zoneLabel,
  type Slot,
} from '../../lib/availability';
import { cn } from '../../lib/utils';
import type { GroupSuggestion } from '../../state/availability';

/** True while the picker is open, so Esc closes it and nothing underneath. */
export const useTimesCalendarOpen = create<boolean>(() => false);

const ROW = 18; // px per half hour
const COL = 104; // px per day
const LABEL = 52; // px per time zone column
const HEAD = 44; // px of the day header row
const VISIBLE_DAYS = 5;
const STEP = 30 * 60_000;
const DAY_MS = 86_400_000;

function hm(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "9 am" in the user's zone or another one ("9:30 am" for half-hour zones). */
function hourText(ms: number, timeZone?: string): string {
  const m = minutesIn(ms, timeZone);
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    ...(m % 60 ? { minute: '2-digit' } : {}),
    timeZone,
  })
    .format(ms)
    .toLowerCase();
}

/** "8 – 12 June 2026", or "29 June – 3 July 2026" across months. */
function rangeLabel(a: number, b: number): string {
  const da = new Date(a);
  const db = new Date(b);
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: 'long' });
  const y = db.getFullYear();
  if (da.getMonth() === db.getMonth()) {
    return `${da.getDate()} – ${db.getDate()} ${month(db)} ${y}`;
  }
  return `${da.getDate()} ${month(da)} – ${db.getDate()} ${month(db)} ${y}`;
}

/** Consecutive half-hour rows with the same truthy key, as [from, to) runs. */
function runs<T>(keys: (T | null)[]): { from: number; to: number; key: T }[] {
  const out: { from: number; to: number; key: T }[] = [];
  keys.forEach((k, i) => {
    const last = out[out.length - 1];
    if (k === null) return;
    if (last && last.to === i && last.key === k) last.to = i + 1;
    else out.push({ from: i, to: i + 1, key: k });
  });
  return out;
}

/**
 * The next three weeks as a small week-view calendar, scrolling sideways:
 * accent bands where everyone is free (strong inside the user's hours),
 * the user's own meetings as outlined blocks, and the picked times in solid
 * accent. Click a free spot to add a time (the meeting length), drag for a
 * longer one, click a pick to remove it. Every change goes to `onChange`.
 */
export function TimesCalendar({
  found,
  picks,
  anchor,
  onChange,
  onClose,
}: {
  found: GroupSuggestion;
  picks: Slot[];
  anchor: DOMRect;
  onChange: (picks: Slot[]) => void;
  onClose: () => void;
}) {
  const { grid, participants } = found;
  useEscapeClose(true, onClose);
  useEffect(() => {
    useTimesCalendarOpen.setState(true, true);
    return () => useTimesCalendarOpen.setState(false, true);
  }, []);
  const [drag, setDrag] = useState<{ day: number; a: number; b: number } | null>(null);
  const [now] = useState(() => Date.now());
  const [first, setFirst] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Close on a click outside (not on the buttons that toggle it).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest?.('[data-times-calendar-toggle]')) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [onClose]);

  const lo = Math.max(6, Math.floor(grid.startHour - 2));
  const hi = Math.min(22, Math.ceil(grid.endHour + 2));
  const rows = (hi - lo) * 2;
  const days = grid.days;
  const chosen = new Set(grid.chosenDays);
  const zones = zoneColumns(participants, days[0] ?? 0);
  const gutter = LABEL * (1 + zones.length);
  const at = (day: number, row: number) => {
    const d = new Date(day);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), lo, row * 30).getTime();
  };
  const ctx = { ...grid, participants };

  // Open on today, or on the first pick's day when that's further out.
  useEffect(() => {
    const target = picks[0]?.startMs ?? grid.chosenDays[0];
    if (target === undefined || !scrollRef.current) return;
    const i = days.findIndex((d) => target >= d && target < d + DAY_MS);
    if (i >= VISIBLE_DAYS) scrollRef.current.scrollLeft = (i - 1) * COL;
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const scrollToDay = (i: number) =>
    scrollRef.current?.scrollTo({
      left: Math.max(0, Math.min(days.length - VISIBLE_DAYS, i)) * COL,
      behavior: 'smooth',
    });

  const rowAt = (e: { clientY: number }, col: HTMLElement) =>
    Math.max(
      0,
      Math.min(rows - 1, Math.floor((e.clientY - col.getBoundingClientRect().top) / ROW)),
    );

  const startDrag = (e: React.MouseEvent<HTMLDivElement>, day: number, off: boolean) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const col = e.currentTarget;
    const a = rowAt(e, col);
    // Weekends are off: a click there can only remove a pick made earlier.
    if (off) {
      const ms = at(day, a);
      if (picks.some((p) => p.startMs <= ms && ms < p.endMs)) onChange(removePickAt(picks, ms));
      return;
    }
    setDrag({ day, a, b: a });
    const move = (ev: MouseEvent) => setDrag({ day, a, b: rowAt(ev, col) });
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDrag(null);
      const b = rowAt(ev, col);
      const startMs = at(day, Math.min(a, b));
      if (a === b && picks.some((p) => p.startMs <= startMs && startMs < p.endMs)) {
        onChange(removePickAt(picks, startMs));
        return;
      }
      if (startMs < now) {
        toast('That time has already passed.');
        return;
      }
      const slot =
        a === b
          ? { startMs, endMs: startMs + grid.durationMin * 60_000 }
          : { startMs, endMs: at(day, Math.max(a, b) + 1) };
      const status = cellStatus(slot, ctx);
      if (!status.ok) toast(`Heads up: ${status.issues.join(', ')}.`);
      onChange(addPick(picks, slot));
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const shown = Math.min(VISIBLE_DAYS, days.length);
  const width = gutter + COL * shown + 26;
  const bodyHeight = rows * ROW;
  const maxBody = Math.max(200, window.innerHeight - 150);
  const height = Math.min(bodyHeight, maxBody) + HEAD + 92;
  const top = Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - height - 8));
  const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
  const last = Math.min(days.length - 1, first + shown - 1);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Pick meeting times"
      style={{ position: 'fixed', top, left, width }}
      className="border-hairline bg-surface text-ink z-[65] overflow-hidden rounded-xl border shadow-2xl select-none"
    >
      {/* Toolbar: ‹ › Today, the visible range, close. */}
      <div className="border-hairline flex items-center gap-1 border-b px-2 py-2">
        <button
          onClick={() => scrollToDay(first - VISIBLE_DAYS)}
          aria-label="Earlier days"
          className="text-ink-muted hover:text-ink hover:bg-sunken rounded-md p-1"
        >
          <ChevronLeft size={15} />
        </button>
        <button
          onClick={() => scrollToDay(first + VISIBLE_DAYS)}
          aria-label="Later days"
          className="text-ink-muted hover:text-ink hover:bg-sunken rounded-md p-1"
        >
          <ChevronRight size={15} />
        </button>
        <button
          onClick={() => scrollToDay(0)}
          className="bg-sunken hover:text-ink text-ink-muted ml-1 rounded-md px-2 py-0.5 text-[12px] font-semibold"
        >
          Today
        </button>
        <span className="ml-2 text-[13px] font-semibold tabular-nums">
          {days.length ? rangeLabel(days[first] ?? days[0]!, days[last]!) : ''}
        </span>
        <span className="flex-1" />
        <button
          onClick={onClose}
          aria-label="Close"
          className="text-ink-faint hover:text-ink rounded-md p-1"
        >
          <X size={14} />
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => setFirst(Math.round(e.currentTarget.scrollLeft / COL))}
        className="no-scrollbar overflow-auto overscroll-contain"
        style={{
          maxHeight: maxBody + HEAD,
          scrollPaddingLeft: gutter,
          scrollSnapType: 'x mandatory',
        }}
      >
        <div className="flex" style={{ width: gutter + COL * days.length }}>
          {/* Time columns, pinned left: the user's, then one per other zone. */}
          <div className="bg-surface sticky left-0 z-20 flex shrink-0">
            {[null, ...zones].map((z) => (
              <div key={z?.label ?? 'me'} className="shrink-0" style={{ width: LABEL }}>
                <div
                  className="bg-surface text-ink-faint border-hairline sticky top-0 z-10 flex items-end justify-end truncate border-b pr-2 pb-1.5 text-[10px] font-semibold"
                  style={{ height: HEAD }}
                  title={
                    z ? `${z.names.join(', ')} (${z.label})` : `You (${zoneLabel(days[0] ?? 0)})`
                  }
                >
                  {z ? z.label : 'You'}
                </div>
                <div className="relative" style={{ height: bodyHeight }}>
                  {Array.from({ length: hi - lo }, (_, i) => {
                    const ms = at(days[0] ?? 0, i * 2);
                    const working = z ? localHour(ms, z.timeZone).working : true;
                    return (
                      <div
                        key={i}
                        style={{ top: i * 2 * ROW }}
                        className={cn(
                          'absolute right-2 -translate-y-1/2 text-[10px] leading-none whitespace-nowrap tabular-nums',
                          i === 0 && 'translate-y-0',
                          z && working ? 'text-ink font-semibold' : 'text-ink-faint',
                        )}
                      >
                        {hourText(ms, z?.timeZone)}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {days.map((day) => {
            const date = new Date(day);
            const isToday = day <= now && now < day + DAY_MS;
            const weekend = [0, 6].includes(date.getDay());
            const cells = Array.from({ length: rows }, (_, r) => {
              const startMs = at(day, r);
              return {
                startMs,
                past: startMs < now || weekend,
                ...cellStatus({ startMs, endMs: startMs + STEP }, ctx),
              };
            });
            const free = runs(
              cells.map((c) => (c.ok && !c.past ? (c.inWindow ? 'in' : 'out') : null)),
            );
            const mine = mergeIntervals(
              grid.myBusy.filter((b) => b.startMs < at(day, rows) && b.endMs > at(day, 0)),
            );
            const y = (ms: number) =>
              Math.max(0, Math.min(bodyHeight, ((ms - at(day, 0)) / STEP) * ROW));
            return (
              <div key={day} className="shrink-0" style={{ width: COL, scrollSnapAlign: 'start' }}>
                <div
                  className="bg-surface border-hairline sticky top-0 z-10 flex items-center justify-center gap-1.5 border-b"
                  style={{ height: HEAD }}
                >
                  <span
                    className={cn(
                      'text-[10.5px] font-semibold tracking-wide uppercase',
                      weekend ? 'text-ink-faint' : 'text-ink-muted',
                    )}
                  >
                    {date.toLocaleDateString(undefined, { weekday: 'short' })}
                  </span>
                  <span
                    className={cn(
                      'flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[13px] font-semibold tabular-nums',
                      isToday ? 'bg-accent text-white' : weekend ? 'text-ink-faint' : 'text-ink',
                    )}
                    title={chosen.has(day) ? 'One of your meeting days' : undefined}
                  >
                    {date.getDate()}
                  </span>
                  {chosen.has(day) && !isToday && !weekend && (
                    <span className="bg-accent h-1 w-1 rounded-full" aria-hidden />
                  )}
                </div>
                <div
                  className={cn(
                    'border-hairline relative border-l',
                    weekend ? 'bg-sunken/50 cursor-not-allowed' : 'cursor-pointer',
                  )}
                  style={{
                    height: bodyHeight,
                    backgroundImage: weekend
                      ? 'repeating-linear-gradient(135deg, transparent 0 4px, rgb(128 128 128 / 0.12) 4px 6px)'
                      : undefined,
                  }}
                  aria-disabled={weekend || undefined}
                  title={weekend ? 'Weekends are off' : undefined}
                  onMouseDown={(e) => startDrag(e, day, weekend)}
                >
                  {/* Hour lines. */}
                  {Array.from({ length: hi - lo }, (_, i) => (
                    <div
                      key={i}
                      className="border-hairline absolute inset-x-0 border-t"
                      style={{ top: i * 2 * ROW }}
                    />
                  ))}
                  {/* Time already gone today. */}
                  {isToday && (
                    <div
                      className="absolute inset-x-0 top-0"
                      style={{
                        height: y(now),
                        backgroundImage:
                          'repeating-linear-gradient(135deg, transparent 0 4px, rgb(128 128 128 / 0.12) 4px 6px)',
                      }}
                    />
                  )}
                  {/* When everyone is free: strong inside the user's hours. */}
                  {free.map((f) => (
                    <div
                      key={f.from}
                      className="absolute inset-x-1 rounded-md"
                      style={{
                        top: f.from * ROW + 1,
                        height: (f.to - f.from) * ROW - 2,
                        background: `color-mix(in srgb, var(--color-accent) ${f.key === 'in' ? 34 : 10}%, transparent)`,
                      }}
                    />
                  ))}
                  {/* The user's own meetings. */}
                  {!weekend &&
                    mine.map((b) => (
                      <div
                        key={b.startMs}
                        className="border-hairline bg-surface/70 text-ink-muted absolute inset-x-1 overflow-hidden rounded-md border px-1.5 py-0.5 text-[10px] leading-tight"
                        style={{
                          top: y(b.startMs) + 1,
                          height: Math.max(ROW - 2, y(b.endMs) - y(b.startMs) - 2),
                        }}
                      >
                        <span className="text-ink font-medium">Busy</span>
                        {y(b.endMs) - y(b.startMs) > ROW * 1.5 && (
                          <span className="block tabular-nums">{hm(b.startMs)}</span>
                        )}
                      </div>
                    ))}
                  {/* Hover reasons, per half hour. */}
                  {!weekend &&
                    cells.map((c, r) => (
                      <div
                        key={r}
                        className="absolute inset-x-0"
                        style={{ top: r * ROW, height: ROW }}
                        title={`${hm(c.startMs)} · ${
                          c.past
                            ? 'already passed'
                            : c.ok
                              ? 'everyone is free'
                              : c.issues.join(', ')
                        }`}
                      />
                    ))}
                  {/* Picked times. */}
                  {picks
                    .filter((p) => p.startMs >= day && p.startMs < day + DAY_MS)
                    .map((p) => (
                      <div
                        key={p.startMs}
                        className="bg-accent pointer-events-none absolute inset-x-1 overflow-hidden rounded-md px-1.5 py-0.5 text-[10.5px] leading-tight font-semibold text-white shadow-sm"
                        style={{
                          top: y(p.startMs) + 1,
                          height: Math.max(ROW - 2, y(p.endMs) - y(p.startMs) - 2),
                        }}
                      >
                        {hm(p.startMs)}–{hm(p.endMs)}
                      </div>
                    ))}
                  {drag?.day === day && (
                    <div
                      className="border-accent bg-accent/25 pointer-events-none absolute inset-x-1 rounded-md border"
                      style={{
                        top: Math.min(drag.a, drag.b) * ROW,
                        height: (Math.abs(drag.b - drag.a) + 1) * ROW,
                      }}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="border-hairline text-ink-faint flex items-center gap-3 border-t px-3 py-2 text-[11px]">
        <span className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ background: 'color-mix(in srgb, var(--color-accent) 34%, transparent)' }}
          />
          Everyone’s free
        </span>
        <span className="flex items-center gap-1.5">
          <span className="bg-accent h-2.5 w-2.5 rounded-sm" />
          Your picks
        </span>
        <span className="flex-1 text-right">
          Click to add, drag for longer, click a pick to remove
        </span>
      </div>
    </div>,
    document.body,
  );
}
