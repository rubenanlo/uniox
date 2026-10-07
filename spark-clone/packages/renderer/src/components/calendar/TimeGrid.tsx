import { ChevronDown, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Calendar, CalendarEvent } from '@app/shared';
import { addDays, DAY_MS, isToday, startOfDay, timeLabel } from '../../lib/calendarMonth';
import { dragTarget } from '../../lib/dragMove';
import { canEditEvent } from '../../lib/eventEdit';
import { isAllDayLike, layoutColumns, packLanes } from '../../lib/eventLayout';
import { cn } from '../../lib/utils';
import { newDraft, useCalendar } from '../../state/calendar';
import { useVisibleEvents } from './useNotionEvents';

const HOUR_PX = 48;
const GUTTER = 56;
const HALF = HOUR_PX / 2;
const HOUR_MS = 3_600_000;

/** Chip color: explicit override → calendar color → accent. */
function chipColor(event: CalendarEvent, calendars: Calendar[]): string {
  return event.color ?? calendars.find((c) => c.id === event.calendarId)?.color ?? 'var(--color-accent)';
}

/** Soft translucent fill for a chip background (hex → +alpha, else color-mix). */
function softFill(color: string): string {
  return color.startsWith('#') ? color + '26' : `color-mix(in srgb, ${color} 15%, transparent)`;
}

function snap(y: number): number {
  return Math.round(y / HALF) * HALF;
}

function gmtLabel(): string {
  const off = -new Date().getTimezoneOffset() / 60;
  return 'GMT' + (off >= 0 ? '+' : '') + off;
}

function hourLabel(h: number): string {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric' });
}

function dayHeader(dayMs: number): string {
  return new Date(dayMs).toLocaleDateString(undefined, { weekday: 'short' });
}

export function TimeGrid({ days }: { days: number[] }) {
  const calendars = useCalendar((s) => s.calendars);
  const cursor = useCalendar((s) => s.cursor);
  const setCursor = useCalendar((s) => s.setCursor);
  const openDetails = useCalendar((s) => s.openDetails);
  const openForm = useCalendar((s) => s.openForm);
  const beginReschedule = useCalendar((s) => s.beginReschedule);

  const rangeStart = days[0]!;
  const rangeEnd = addDays(days[days.length - 1]!, 1);
  const events = useVisibleEvents(rangeStart, rangeEnd);

  const { allDay, timed } = useMemo(() => {
    const allDay: CalendarEvent[] = [];
    const timed: CalendarEvent[] = [];
    for (const e of events) (isAllDayLike(e) ? allDay : timed).push(e);
    return { allDay, timed };
  }, [events]);

  const bodyRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const dragAbort = useRef<AbortController | null>(null);
  // A finished chip drag must swallow the click the browser fires right after mouseup.
  const suppressClick = useRef(false);
  const [collapsed, setCollapsed] = useState(false);
  const [draft, setDraft] = useState<{ dayIndex: number; top: number; height: number } | null>(null);
  const [ghost, setGhost] = useState<{
    dayIndex: number;
    top: number;
    height: number;
    event: CalendarEvent;
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // Tear down any in-flight drag listeners if the grid unmounts mid-drag.
  useEffect(() => () => dragAbort.current?.abort(), []);

  // Re-render the now-line every minute.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Land on 8 AM when the grid mounts.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 8 * HOUR_PX;
  }, []);

  const cols = days.length;
  const gridCols = `${GUTTER}px repeat(${cols}, minmax(0, 1fr))`;
  const todayIndex = days.findIndex((d) => isToday(d));

  const allDayPlacements = useMemo(
    () => packLanes(allDay, rangeStart, rangeEnd),
    [allDay, rangeStart, rangeEnd],
  );
  const maxLane = allDayPlacements.reduce((m, p) => Math.max(m, p.lane), -1);
  const visibleLanes = collapsed ? 1 : maxLane + 1;
  const shownAllDay = allDayPlacements.filter((p) => p.lane < visibleLanes);
  const hiddenAllDay = allDayPlacements.length - shownAllDay.length;

  const startDrag = (e: React.MouseEvent, dayIndex: number, day: number) => {
    if (e.button !== 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const startY = e.clientY - rect.top;
    let moved = false;
    setDraft({ dayIndex, top: snap(startY), height: HALF });
    dragAbort.current?.abort();
    const controller = new AbortController();
    dragAbort.current = controller;
    const { signal } = controller;
    const move = (me: MouseEvent) => {
      const curY = me.clientY - rect.top;
      if (Math.abs(curY - startY) > 4) moved = true;
      const a = snap(Math.min(startY, curY));
      const b = snap(Math.max(startY, curY));
      setDraft({ dayIndex, top: a, height: Math.max(HALF, b - a) });
    };
    const up = (ue: MouseEvent) => {
      controller.abort();
      dragAbort.current = null;
      const endY = ue.clientY - rect.top;
      setDraft(null);
      if (!moved && Math.abs(endY - startY) <= 4) {
        setCursor(day);
        return;
      }
      const a = snap(Math.min(startY, endY));
      let b = snap(Math.max(startY, endY));
      if (b - a < HALF) b = a + HALF;
      openForm({
        ...newDraft(day, calendars),
        startMs: day + (a / HOUR_PX) * HOUR_MS,
        endMs: day + (b / HOUR_PX) * HOUR_MS,
      });
    };
    window.addEventListener('mousemove', move, { signal });
    window.addEventListener('mouseup', up, { signal });
  };

  /** Drag an existing chip to a new day/time; drop opens the form to review. */
  const startChipDrag = (
    me: React.MouseEvent,
    event: CalendarEvent,
    chipTop: number,
    chipHeight: number,
  ) => {
    me.stopPropagation(); // never start a create-drag underneath
    if (me.button !== 0) return;
    if (event.rrule || !canEditEvent(event, calendars)) return; // click still opens details
    const grid = gridRef.current;
    if (!grid) return;
    const rect = grid.getBoundingClientRect();
    const geo = {
      days,
      gutter: GUTTER,
      colWidth: (rect.width - GUTTER) / days.length,
      hourPx: HOUR_PX,
      snapPx: HALF,
    };
    const grabOffsetY = me.clientY - rect.top - chipTop;
    const duration = event.endMs - event.startMs;
    const startX = me.clientX;
    const startY = me.clientY;
    let moved = false;
    dragAbort.current?.abort();
    const controller = new AbortController();
    dragAbort.current = controller;
    const { signal } = controller;
    const move = (ev: MouseEvent) => {
      if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) <= 4) return;
      moved = true;
      const t = dragTarget(geo, ev.clientX - rect.left, ev.clientY - rect.top, grabOffsetY, duration);
      setGhost({ dayIndex: t.dayIndex, top: t.top, height: chipHeight, event });
    };
    const up = (ev: MouseEvent) => {
      controller.abort();
      dragAbort.current = null;
      setGhost(null);
      if (!moved) return; // plain click: the chip's onClick opens details
      suppressClick.current = true;
      // The browser's post-drag click (if any) fires synchronously after this
      // mouseup; clear the flag right after so it can't swallow a later click.
      setTimeout(() => (suppressClick.current = false), 0);
      const t = dragTarget(geo, ev.clientX - rect.left, ev.clientY - rect.top, grabOffsetY, duration);
      if (t.startMs !== event.startMs) beginReschedule(event, t.startMs, t.endMs);
    };
    window.addEventListener('mousemove', move, { signal });
    window.addEventListener('mouseup', up, { signal });
  };

  /** Double-click on an empty slot: new 1-hour event starting at that half hour. */
  const dblClickCreate = (e: React.MouseEvent, day: number) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const slotTop = Math.floor((e.clientY - rect.top) / HALF) * HALF;
    const startMs = day + (slotTop / HOUR_PX) * HOUR_MS;
    openForm({ ...newDraft(day, calendars), startMs, endMs: startMs + HOUR_MS });
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      {/* Header: GMT gutter + per-day columns */}
      <div className="border-hairline grid border-b" style={{ gridTemplateColumns: gridCols }}>
        <div className="text-ink-faint flex items-end justify-end px-1.5 pb-1 text-[10px] font-medium">
          {gmtLabel()}
        </div>
        {days.map((day) => {
          const today = isToday(day);
          const focused = day === cursor && !today;
          return (
            <div
              key={day}
              className={cn(
                'flex items-center gap-1.5 px-2 py-1.5',
                focused && 'ring-accent/60 rounded-lg ring-2 ring-inset',
              )}
            >
              <span className="text-ink-muted text-[11px] font-semibold uppercase">
                {dayHeader(day)}
              </span>
              <span
                className={cn(
                  'flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[13px] font-semibold tabular-nums',
                  today ? 'bg-danger text-white' : 'text-ink',
                )}
              >
                {new Date(day).getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* All-day lane (pinned, collapsible) */}
      {maxLane >= 0 && (
        <div
          className="border-hairline grid border-b"
          style={{ gridTemplateColumns: gridCols, gridAutoRows: '22px' }}
        >
          <div
            className="flex items-start justify-end gap-1 px-1.5 py-1"
            style={{ gridColumn: '1', gridRow: `1 / span ${Math.max(1, visibleLanes)}` }}
          >
            {maxLane >= 1 && (
              <button
                onClick={() => setCollapsed((c) => !c)}
                aria-label={collapsed ? 'Expand all-day events' : 'Collapse all-day events'}
                className="text-ink-faint hover:text-ink flex h-4 w-4 items-center justify-center"
              >
                {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
              </button>
            )}
          </div>
          {shownAllDay.map((p) => {
            const ooo = p.event.eventType === 'outOfOffice';
            return (
              <button
                key={p.event.id}
                onClick={() => openDetails(p.event)}
                title={p.event.title}
                style={{
                  gridColumn: `${p.startCol + 2} / span ${p.span}`,
                  gridRow: `${p.lane + 1}`,
                  backgroundColor: ooo ? undefined : chipColor(p.event, calendars),
                }}
                className={cn(
                  'mx-0.5 my-0.5 flex items-center gap-1 truncate rounded px-1.5 text-left text-[11px] font-medium',
                  ooo ? 'bg-sunken text-ink-muted' : 'text-white',
                )}
              >
                {ooo && <span aria-hidden>⊗</span>}
                <span className="truncate">{p.event.title || '(untitled)'}</span>
              </button>
            );
          })}
          {collapsed && hiddenAllDay > 0 && (
            <button
              onClick={() => setCollapsed(false)}
              style={{ gridColumn: `2 / span ${cols}`, gridRow: '1' }}
              className="text-ink-faint hover:text-ink justify-self-end px-1.5 text-[10.5px] font-medium"
            >
              +{hiddenAllDay}
            </button>
          )}
        </div>
      )}

      {/* Scrollable hour body */}
      <div ref={bodyRef} data-timegrid className="relative min-h-0 flex-1 overflow-y-auto">
        <div
          ref={gridRef}
          className="relative grid"
          style={{ gridTemplateColumns: gridCols, height: 24 * HOUR_PX }}
        >
          {/* Gutter with hour labels */}
          <div className="border-hairline relative border-r">
            {Array.from({ length: 24 }, (_, h) => (
              <div
                key={h}
                className="text-ink-faint absolute right-1.5 -translate-y-1/2 text-[10px] tabular-nums"
                style={{ top: h * HOUR_PX }}
              >
                {h > 0 ? hourLabel(h) : ''}
              </div>
            ))}
            {todayIndex >= 0 && (
              <div
                className="bg-danger absolute right-1 -translate-y-1/2 rounded px-1 text-[9.5px] font-semibold text-white"
                style={{ top: ((now - startOfDay(now)) / HOUR_MS) * HOUR_PX }}
              >
                {timeLabel(now)}
              </div>
            )}
          </div>

          {/* Day columns */}
          {days.map((day, dayIndex) => {
            const dayTimed = timed.filter((e) => e.startMs < day + DAY_MS && e.endMs > day);
            const placed = layoutColumns(dayTimed);
            return (
              <div
                key={day}
                onMouseDown={(e) => startDrag(e, dayIndex, day)}
                onDoubleClick={(e) => dblClickCreate(e, day)}
                className={cn(
                  'border-hairline relative border-r',
                  day === cursor && 'bg-sunken/30',
                )}
              >
                {/* Hour gridlines */}
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className="border-hairline/50 absolute inset-x-0 border-t"
                    style={{ top: h * HOUR_PX }}
                  />
                ))}

                {/* Timed chips */}
                {placed.map(({ event, col, cols: n }) => {
                  const ooo = event.eventType === 'outOfOffice';
                  const color = chipColor(event, calendars);
                  const top = Math.max(0, ((event.startMs - day) / HOUR_MS) * HOUR_PX);
                  const height = Math.max(20, ((event.endMs - event.startMs) / HOUR_MS) * HOUR_PX);
                  return (
                    <button
                      key={event.id}
                      onMouseDown={(e) => startChipDrag(e, event, top, height)}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (suppressClick.current) {
                          suppressClick.current = false;
                          return;
                        }
                        openDetails(event);
                      }}
                      title={event.title}
                      style={{
                        top,
                        height,
                        left: `${(col / n) * 100}%`,
                        width: `${100 / n}%`,
                        borderLeft: `3px solid ${ooo ? 'var(--color-ink-faint)' : color}`,
                        backgroundColor: ooo ? 'var(--color-sunken)' : softFill(color),
                      }}
                      className={cn(
                        'absolute flex flex-col overflow-hidden rounded-sm px-1.5 py-0.5 text-left text-[11px] leading-tight',
                        ooo ? 'text-ink-muted' : 'text-ink',
                        ghost?.event.id === event.id && 'opacity-40',
                      )}
                    >
                      <span className="truncate font-medium">
                        {ooo && <span aria-hidden>⊗ </span>}
                        {event.title || '(untitled)'}
                      </span>
                      <span className="text-ink-faint truncate tabular-nums">
                        {timeLabel(event.startMs)}
                      </span>
                    </button>
                  );
                })}

                {/* Now line */}
                {dayIndex === todayIndex && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10"
                    style={{ top: ((now - startOfDay(now)) / HOUR_MS) * HOUR_PX }}
                  >
                    <div className="bg-danger h-0.5 w-full" />
                    <div className="bg-danger absolute -top-1 -left-1 h-2 w-2 rounded-full" />
                  </div>
                )}

                {/* Drag-create draft */}
                {draft && draft.dayIndex === dayIndex && (
                  <div
                    className="bg-accent/25 border-accent pointer-events-none absolute inset-x-1 rounded-sm border"
                    style={{ top: draft.top, height: draft.height }}
                  />
                )}

                {/* Chip-move ghost */}
                {ghost && ghost.dayIndex === dayIndex && (
                  <div
                    className="border-accent bg-accent/20 text-ink pointer-events-none absolute inset-x-1 z-20 flex flex-col overflow-hidden rounded-sm border px-1.5 py-0.5 text-[11px] leading-tight"
                    style={{ top: ghost.top, height: ghost.height }}
                  >
                    <span className="truncate font-medium">{ghost.event.title || '(untitled)'}</span>
                    <span className="text-ink-faint truncate tabular-nums">
                      {timeLabel(day + (ghost.top / HOUR_PX) * HOUR_MS)}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
