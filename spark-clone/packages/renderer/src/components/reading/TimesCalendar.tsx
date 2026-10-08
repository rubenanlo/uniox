import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { create } from 'zustand';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import {
  addPick,
  cellStatus,
  localHour,
  removePickAt,
  zoneColumns,
  zoneLabel,
  type Slot,
} from '../../lib/availability';
import { cn } from '../../lib/utils';
import type { GroupSuggestion } from '../../state/availability';

/** True while the picker is open, so Esc closes it and nothing underneath. */
export const useTimesCalendarOpen = create<boolean>(() => false);

const ROW = 13; // px per half hour
const COL = 64; // px per day
const LABEL = 42; // px per time zone column
const VISIBLE_DAYS = 5;
const STEP = 30 * 60_000;

function hm(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * A small calendar of the next three weeks, scrolling sideways: green where everyone is free and
 * inside their working day, faded outside the user's hours. Click a cell to
 * add a time (the meeting length), drag to pick a longer one, click a pick
 * to remove it. Every change goes straight to `onChange`.
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
  const ref = useRef<HTMLDivElement>(null);

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
  const scrollRef = useRef<HTMLDivElement>(null);
  // Open scrolled to the first pick's day (or the first chosen day).
  useEffect(() => {
    const target = picks[0]?.startMs ?? grid.chosenDays[0];
    if (target === undefined || !scrollRef.current) return;
    const i = days.findIndex((d) => target >= d && target < d + 86_400_000);
    if (i > 0) scrollRef.current.scrollLeft = Math.max(0, (i - 0.5) * COL);
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const at = (day: number, row: number) => {
    const d = new Date(day);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), lo, row * 30).getTime();
  };
  const ctx = { ...grid, participants };

  const rowAt = (e: { clientY: number }, col: HTMLElement) =>
    Math.max(
      0,
      Math.min(rows - 1, Math.floor((e.clientY - col.getBoundingClientRect().top) / ROW)),
    );

  const startDrag = (e: React.MouseEvent<HTMLDivElement>, day: number) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const col = e.currentTarget;
    const a = rowAt(e, col);
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

  const width = LABEL * (1 + zones.length) + COL * Math.min(VISIBLE_DAYS, days.length) + 24;
  const height = rows * ROW + 110;
  const top = Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - height - 8));
  const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Pick meeting times"
      style={{ position: 'fixed', top, left, width }}
      className="border-hairline bg-surface text-ink z-[65] rounded-xl border p-3 shadow-2xl select-none"
    >
      <div className="mb-2 flex items-center gap-1.5 text-[12px]">
        <span className="font-semibold">Pick times</span>
        <span className="text-ink-faint">· scroll sideways for more days</span>
        <span className="flex-1" />
        <button onClick={onClose} aria-label="Close" className="text-ink-faint hover:text-ink">
          <X size={14} />
        </button>
      </div>
      <div className="flex">
        {/* Time columns: the user's, then one per other zone, lit in their 9:00–18:00. */}
        {[null, ...zones].map((z) => (
          <div key={z?.label ?? 'me'} className="shrink-0" style={{ width: LABEL }}>
            <div
              className="text-ink-muted h-[20px] truncate pr-1.5 text-right text-[10px] font-semibold"
              title={z ? `${z.names.join(', ')} (${z.label})` : `You (${zoneLabel(days[0] ?? 0)})`}
            >
              {z ? z.label : 'You'}
            </div>
            <div className="relative" style={{ height: rows * ROW }}>
              {Array.from({ length: hi - lo + 1 }, (_, i) => {
                const ms = at(days[0] ?? 0, i * 2);
                const t = z ? localHour(ms, z.timeZone) : { text: `${lo + i}:00`, working: true };
                return (
                  <div
                    key={i}
                    style={{ top: i * 2 * ROW - 6 }}
                    className={cn(
                      'absolute right-1.5 text-[10px] leading-none tabular-nums',
                      z && t.working ? 'font-semibold text-emerald-500' : 'text-ink-faint',
                    )}
                  >
                    {t.text}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div
          ref={scrollRef}
          className="flex min-w-0 flex-1 overflow-x-auto overscroll-x-contain [scrollbar-width:thin]"
        >
          {days.map((day) => {
            const weekend = [0, 6].includes(new Date(day).getDay());
            return (
              <div key={day} className="shrink-0" style={{ width: COL }}>
                <div
                  className={cn(
                    'h-[20px] text-center text-[11px] font-semibold whitespace-nowrap',
                    chosen.has(day) ? 'text-accent' : weekend ? 'text-ink-faint' : 'text-ink-muted',
                  )}
                >
                  {new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric' }).format(
                    day,
                  )}
                </div>
                <div
                  className="border-hairline relative cursor-pointer border-l"
                  style={{ height: rows * ROW }}
                  onMouseDown={(e) => startDrag(e, day)}
                >
                  {Array.from({ length: rows }, (_, r) => {
                    const startMs = at(day, r);
                    const s = cellStatus({ startMs, endMs: startMs + STEP }, ctx);
                    return (
                      <div
                        key={r}
                        title={`${hm(startMs)} · ${s.ok ? 'everyone is free' : s.issues.join(', ')}`}
                        style={{
                          height: ROW,
                          backgroundImage: s.ok
                            ? undefined
                            : 'repeating-linear-gradient(135deg, transparent 0 3px, rgb(128 128 128 / 0.12) 3px 5px)',
                        }}
                        className={cn(
                          'border-hairline border-b',
                          s.ok && (s.inWindow ? 'bg-emerald-500/40' : 'bg-emerald-500/15'),
                          (!s.inWindow || weekend) && 'opacity-60',
                        )}
                      />
                    );
                  })}
                  {picks
                    .filter((p) => p.startMs >= day && p.startMs < day + 86_400_000)
                    .map((p) => (
                      <div
                        key={p.startMs}
                        className="bg-accent pointer-events-none absolute inset-x-0.5 overflow-hidden rounded-md px-1 text-[10px] leading-[12px] font-semibold text-white"
                        style={{
                          top: ((p.startMs - at(day, 0)) / STEP) * ROW,
                          height: Math.max(ROW - 2, ((p.endMs - p.startMs) / STEP) * ROW - 2),
                        }}
                      >
                        {p.endMs - p.startMs > STEP
                          ? `${hm(p.startMs)}–${hm(p.endMs)}`
                          : hm(p.startMs)}
                      </div>
                    ))}
                  {drag?.day === day && (
                    <div
                      className="border-accent bg-accent/20 pointer-events-none absolute inset-x-0.5 rounded-md border"
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
      <p className="text-ink-faint mt-2 text-[11px] leading-snug">
        Green: everyone’s free. Lit hours: their 9:00–18:00. Click to add a time, drag for a longer
        one, click a time to remove it.
      </p>
    </div>,
    document.body,
  );
}
