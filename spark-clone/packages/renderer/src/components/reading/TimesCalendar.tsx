import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { create } from 'zustand';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { addPick, cellStatus, removePickAt, type Slot } from '../../lib/availability';
import { cn } from '../../lib/utils';
import type { GroupSuggestion } from '../../state/availability';

/** True while the picker is open, so Esc closes it and nothing underneath. */
export const useTimesCalendarOpen = create<boolean>(() => false);

const ROW = 13; // px per half hour
const STEP = 30 * 60_000;

function hm(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * A small week view of the suggested days: green where everyone is free and
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
  // Open on the week holding the first pick.
  const [week, setWeek] = useState<0 | 1>(() =>
    picks.length && grid.weeks[1].length && picks[0]!.startMs >= grid.weeks[1][0]! ? 1 : 0,
  );
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
  const days = grid.weeks[week];
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

  const width = Math.max(260, 64 * days.length + 40 + 24);
  const height = rows * ROW + 110;
  const top = Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - height - 8));
  const left = Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8));
  const weekLabel = (w: 0 | 1) => {
    const d = grid.weeks[w];
    if (!d.length) return '';
    const f = (ms: number) =>
      new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(ms);
    return d.length > 1 ? `${f(d[0]!)}–${f(d[d.length - 1]!)}` : f(d[0]!);
  };

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Pick meeting times"
      style={{ position: 'fixed', top, left, width }}
      className="border-hairline bg-surface text-ink z-[65] rounded-xl border p-3 shadow-2xl select-none"
    >
      <div className="mb-2 flex items-center gap-1.5 text-[12px]">
        {([0, 1] as const).map((w) => (
          <button
            key={w}
            onClick={() => setWeek(w)}
            aria-pressed={week === w}
            className={cn(
              'rounded-full px-2 py-0.5 font-semibold whitespace-nowrap',
              week === w ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink',
            )}
          >
            {weekLabel(w)}
          </button>
        ))}
        <span className="flex-1" />
        <button onClick={onClose} aria-label="Close" className="text-ink-faint hover:text-ink">
          <X size={14} />
        </button>
      </div>
      <div className="flex">
        <div className="relative w-[40px] shrink-0" style={{ marginTop: 20, height: rows * ROW }}>
          {Array.from({ length: hi - lo + 1 }, (_, i) => (
            <div
              key={i}
              style={{ top: i * 2 * ROW - 6 }}
              className="text-ink-faint absolute right-1.5 text-[10px] leading-none tabular-nums"
            >
              {lo + i}:00
            </div>
          ))}
        </div>
        {days.map((day) => (
          <div key={day} className="w-[64px] shrink-0">
            <div className="text-ink-muted h-[20px] text-center text-[11px] font-semibold">
              {new Intl.DateTimeFormat('en-US', { weekday: 'short', day: 'numeric' }).format(day)}
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
                      s.ok && (s.inWindow ? 'bg-emerald-500/25' : 'bg-emerald-500/10'),
                      !s.inWindow && 'opacity-60',
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
                    {p.endMs - p.startMs > STEP ? `${hm(p.startMs)}–${hm(p.endMs)}` : hm(p.startMs)}
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
        ))}
      </div>
      <p className="text-ink-faint mt-2 text-[11px] leading-snug">
        Green: everyone’s free. Click to add a time, drag for a longer one, click a time to remove
        it.
      </p>
    </div>,
    document.body,
  );
}
