import { useMemo, useState } from 'react';
import type { Calendar, CalendarEvent } from '@app/shared';
import {
  DAY_MS,
  isSameMonth,
  isToday,
  monthGrid,
  overlapsDay,
  startOfDay,
  timeLabel,
  WEEKDAYS,
} from '../../lib/calendarMonth';
import { isAllDayLike, packLanes } from '../../lib/eventLayout';
import { cn } from '../../lib/utils';
import { newDraft, useCalendar } from '../../state/calendar';
import { useVisibleEvents } from './useNotionEvents';

const MAX_LANES = 3;
const MAX_TIMED = 3;
const HEADER_PX = 24;
const LANE_PX = 20;

/** Chip color: explicit override → calendar color → accent. */
function chipColor(event: CalendarEvent, calendars: Calendar[]): string {
  return event.color ?? calendars.find((c) => c.id === event.calendarId)?.color ?? 'var(--color-accent)';
}

/** One spanning all-day chip, absolutely placed across a week row. */
function SpanChip({
  event,
  startCol,
  span,
  lane,
  calendars,
  onOpen,
}: {
  event: CalendarEvent;
  startCol: number;
  span: number;
  lane: number;
  calendars: Calendar[];
  onOpen: (e: CalendarEvent) => void;
}) {
  return (
    <button
      onClick={(ev) => {
        ev.stopPropagation();
        onOpen(event);
      }}
      onDoubleClick={(ev) => ev.stopPropagation()}
      title={event.title}
      style={{
        position: 'absolute',
        top: HEADER_PX + lane * LANE_PX,
        left: `calc(${(startCol / 7) * 100}% + 3px)`,
        width: `calc(${(span / 7) * 100}% - 6px)`,
        backgroundColor: event.eventType === 'outOfOffice' ? undefined : chipColor(event, calendars),
      }}
      className={cn(
        'flex h-[18px] items-center gap-1 truncate rounded px-1.5 text-left text-[11px] leading-none font-medium',
        event.eventType === 'outOfOffice'
          ? 'bg-sunken text-ink-muted'
          : 'text-white',
      )}
    >
      {event.eventType === 'outOfOffice' && <span aria-hidden>⊗</span>}
      <span className="truncate">{event.title || '(untitled)'}</span>
    </button>
  );
}

/** A single timed chip inside a day cell. */
function TimedChip({
  event,
  calendars,
  onOpen,
}: {
  event: CalendarEvent;
  calendars: Calendar[];
  onOpen: (e: CalendarEvent) => void;
}) {
  const ooo = event.eventType === 'outOfOffice';
  return (
    <button
      onClick={(ev) => {
        ev.stopPropagation();
        onOpen(event);
      }}
      onDoubleClick={(ev) => ev.stopPropagation()}
      title={event.title}
      style={{ borderLeft: `3px solid ${chipColor(event, calendars)}` }}
      className={cn(
        'hover:bg-sunken flex items-center gap-1 truncate rounded-sm px-1 py-0.5 text-left text-[11px] leading-tight',
        ooo ? 'text-ink-faint' : 'text-ink',
      )}
    >
      {ooo && <span aria-hidden>⊗</span>}
      <span className="text-ink-faint shrink-0 tabular-nums">{timeLabel(event.startMs)}</span>
      <span className="truncate">{event.title || '(untitled)'}</span>
    </button>
  );
}

export function MonthView() {
  const anchor = useCalendar((s) => s.anchor);
  const cursor = useCalendar((s) => s.cursor);
  const calendars = useCalendar((s) => s.calendars);
  const setCursor = useCalendar((s) => s.setCursor);
  const openDetails = useCalendar((s) => s.openDetails);
  const openForm = useCalendar((s) => s.openForm);

  const { days, gridStart } = useMemo(() => monthGrid(anchor), [anchor]);
  const events = useVisibleEvents(gridStart, gridStart + 42 * DAY_MS);

  const { spanning, timed } = useMemo(() => {
    const spanning: CalendarEvent[] = [];
    const timed: CalendarEvent[] = [];
    for (const e of events) (isAllDayLike(e) ? spanning : timed).push(e);
    return { spanning, timed };
  }, [events]);

  const [moreOpen, setMoreOpen] = useState<number | null>(null);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <div className="border-hairline grid grid-cols-7 border-b px-3">
        {WEEKDAYS.map((d) => (
          <div key={d} className="text-ink-faint px-1 py-1.5 text-[11px] font-semibold">
            {d}
          </div>
        ))}
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-6">
        {Array.from({ length: 6 }, (_, w) => {
          const weekDays = days.slice(w * 7, w * 7 + 7);
          const rowStart = weekDays[0]!;
          const rowEnd = rowStart + 7 * DAY_MS;
          const placements = packLanes(spanning, rowStart, rowEnd);
          const rowLanes = Math.min(MAX_LANES, placements.reduce((m, p) => Math.max(m, p.lane + 1), 0));
          const timedTop = HEADER_PX + rowLanes * LANE_PX;

          return (
            <div key={rowStart} className="relative grid min-h-0 grid-cols-7">
              {weekDays.map((dayMs, col) => {
                const dim = !isSameMonth(dayMs, anchor);
                const today = isToday(dayMs);
                const focused = startOfDay(dayMs) === cursor;

                const dayTimed = timed.filter((e) => overlapsDay(e.startMs, e.endMs, dayMs));
                const hiddenSpan = placements.filter(
                  (p) => p.lane >= MAX_LANES && p.startCol <= col && col < p.startCol + p.span,
                ).length;
                const hiddenTimed = Math.max(0, dayTimed.length - MAX_TIMED);
                const moreCount = hiddenSpan + hiddenTimed;
                const dayEvents = events.filter((e) => overlapsDay(e.startMs, e.endMs, dayMs));

                return (
                  <div
                    key={dayMs}
                    onClick={() => setCursor(dayMs)}
                    onDoubleClick={() => openForm(newDraft(dayMs, calendars))}
                    className={cn(
                      'border-hairline/60 hover:bg-sunken/40 relative flex min-h-0 flex-col overflow-visible border-r border-b',
                      dim && 'opacity-45',
                      focused && 'ring-accent/60 rounded-lg ring-2 ring-inset',
                    )}
                  >
                    <div className="flex h-6 shrink-0 items-center px-1.5">
                      <span
                        className={cn(
                          'flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11.5px] tabular-nums',
                          today ? 'bg-danger font-bold text-white' : 'text-ink-muted',
                        )}
                      >
                        {new Date(dayMs).getDate()}
                      </span>
                    </div>

                    <div
                      className="flex min-h-0 flex-col gap-0.5 overflow-hidden px-1"
                      style={{ paddingTop: Math.max(0, timedTop - HEADER_PX) }}
                    >
                      {dayTimed.slice(0, MAX_TIMED).map((e) => (
                        <TimedChip key={e.id} event={e} calendars={calendars} onOpen={openDetails} />
                      ))}
                      {moreCount > 0 && (
                        <button
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setMoreOpen(dayMs);
                          }}
                          className="text-ink-faint hover:text-ink px-1 text-left text-[10.5px] font-medium"
                        >
                          +{moreCount} more
                        </button>
                      )}
                    </div>

                    {moreOpen === dayMs && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setMoreOpen(null);
                          }}
                        />
                        <div className="border-hairline bg-sunken absolute top-6 left-1 z-20 flex max-h-64 w-56 flex-col gap-0.5 overflow-y-auto rounded-lg border p-1.5 shadow-lg">
                          <div className="text-ink-muted px-1 pb-1 text-[11px] font-semibold">
                            {new Date(dayMs).toLocaleDateString(undefined, {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </div>
                          {dayEvents.map((e) => (
                            <button
                              key={e.id}
                              onClick={(ev) => {
                                ev.stopPropagation();
                                setMoreOpen(null);
                                openDetails(e);
                              }}
                              onDoubleClick={(ev) => ev.stopPropagation()}
                              title={e.title}
                              style={{ borderLeft: `3px solid ${chipColor(e, calendars)}` }}
                              className="hover:bg-hairline/40 text-ink flex items-center gap-1 truncate rounded-sm px-1.5 py-1 text-left text-[11.5px]"
                            >
                              {e.eventType === 'outOfOffice' && <span aria-hidden>⊗</span>}
                              {!e.allDay && (
                                <span className="text-ink-faint shrink-0 tabular-nums">
                                  {timeLabel(e.startMs)}
                                </span>
                              )}
                              <span className="truncate">{e.title || '(untitled)'}</span>
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}

              <div className="pointer-events-none absolute inset-0">
                {placements
                  .filter((p) => p.lane < MAX_LANES)
                  .map((p) => (
                    <div key={p.event.id} className="pointer-events-auto">
                      <SpanChip
                        event={p.event}
                        startCol={p.startCol}
                        span={p.span}
                        lane={p.lane}
                        calendars={calendars}
                        onOpen={openDetails}
                      />
                    </div>
                  ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
