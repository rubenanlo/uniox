import { ChevronRight, Plus, Video } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Calendar, CalendarEvent } from '@app/shared';
import {
  allDayOn,
  durationLabel,
  eventColor,
  freeSlots,
  MIN_SLOT_MINS,
  type Slot,
  softFill,
  timedOn,
  trackPct,
  WORK_END,
  WORK_START,
} from '../../lib/agenda';
import { api } from '../../lib/api';
import { addDays, rangeForView, startOfDay, startOfWeek, timeLabel } from '../../lib/calendarMonth';
import { cn } from '../../lib/utils';
import { useCalendar } from '../../state/calendar';
import { useVisibleEvents, useVisibleFrom } from './useNotionEvents';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Wall clock, re-rendered once a minute on the minute (no animation frames). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let id: ReturnType<typeof setInterval> | undefined;
    const t = setTimeout(
      () => {
        setNow(Date.now());
        id = setInterval(() => setNow(Date.now()), MIN);
      },
      MIN - (Date.now() % MIN),
    );
    return () => {
      clearTimeout(t);
      if (id) clearInterval(id);
    };
  }, []);
  return now;
}

/** Today and tomorrow's events, whatever span the list is paged to. Re-queried
 *  whenever the main range reloads (saves, syncs) and when the day rolls over. */
function useTodayAndTomorrow(today: number): CalendarEvent[] {
  const storeEvents = useCalendar((s) => s.events);
  const [stored, setStored] = useState<CalendarEvent[]>([]);
  const end = addDays(today, 2);
  useEffect(() => {
    let live = true;
    void api
      .query('calendar:events', { startMs: today, endMs: end })
      .then((rows) => live && setStored(rows))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [today, end, storeEvents]);
  return useVisibleFrom(stored, today, end);
}

const Eyebrow = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <p
    className={cn(
      'text-ink-faint font-mono text-[10.5px] font-semibold tracking-[0.16em] uppercase',
      className,
    )}
  >
    {children}
  </p>
);

/** "11:03" with any day-period ("AM") set small beside it. */
function BigClock({ now }: { now: number }) {
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).formatToParts(now);
  const main = parts
    .filter((p) => p.type !== 'dayPeriod')
    .map((p) => p.value)
    .join('')
    .trim();
  const period = parts.find((p) => p.type === 'dayPeriod')?.value;
  return (
    <div className="text-ink flex items-baseline gap-2 tabular-nums">
      <span className="text-[68px] leading-[0.9] font-extralight tracking-[-0.04em]">{main}</span>
      {period && <span className="text-ink-muted text-[18px] font-light">{period}</span>}
    </div>
  );
}

/** The working day as a thin track: booked time washed, `lit` highlighted. */
export function DayTrack({
  events,
  lit,
  color = 'var(--color-aqua)',
  now,
  size = 'sm',
}: {
  events: CalendarEvent[];
  lit: Slot;
  color?: string;
  now?: number;
  size?: 'sm' | 'md';
}) {
  return (
    <div
      className={cn(
        'bg-sunken relative rounded-full',
        size === 'md' ? 'h-2' : 'h-1.5 overflow-hidden',
      )}
    >
      {events.map((e) => (
        <span
          key={e.id}
          className="bg-ink-faint/45 absolute top-0 bottom-0"
          style={{
            left: `${trackPct(e.startMs)}%`,
            width: `${trackPct(e.endMs) - trackPct(e.startMs)}%`,
          }}
        />
      ))}
      <span
        className={cn(
          'absolute rounded-full',
          size === 'md' ? '-top-0.5 -bottom-0.5' : 'top-0 bottom-0',
        )}
        style={{
          left: `${trackPct(lit.startMs)}%`,
          width: `${Math.max(1.5, trackPct(lit.endMs) - trackPct(lit.startMs))}%`,
          background: color,
        }}
      />
      {now !== undefined && trackPct(now) > 0 && trackPct(now) < 100 && (
        <span
          className="bg-danger absolute -top-1 -bottom-1 w-[2px] rounded-full"
          style={{ left: `${trackPct(now)}%` }}
        />
      )}
    </div>
  );
}

function FreeSlotList({
  label,
  slots,
  dayEvents,
  selected,
}: {
  label: string;
  slots: Slot[];
  dayEvents: CalendarEvent[];
  selected?: Slot;
}) {
  const bookSlot = useCalendar((s) => s.bookSlot);
  return (
    <div>
      <div className="text-ink-muted mb-1 text-[11.5px] font-medium">{label}</div>
      {!slots.length && <p className="text-ink-faint py-1 text-[12px]">No open time left</p>}
      {slots.map((f) => (
        <button
          key={f.startMs}
          onClick={() => bookSlot(f)}
          className={cn(
            'group/slot hover:bg-surface -mx-2 flex w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 py-1.5 text-left',
            selected?.startMs === f.startMs && 'bg-surface ring-1 ring-[var(--color-aqua)]',
          )}
        >
          <span className="text-ink shrink-0 text-[11.5px] whitespace-nowrap tabular-nums">
            {timeLabel(f.startMs)}–{timeLabel(f.endMs)}
          </span>
          <span className="min-w-6 flex-1">
            <DayTrack events={dayEvents} lit={f} />
          </span>
          <span className="text-ink-muted w-12 text-right text-[11.5px] tabular-nums group-hover/slot:hidden">
            {durationLabel(f.endMs - f.startMs)}
          </span>
          <span className="text-ink hidden w-12 items-center justify-end gap-0.5 text-[11.5px] font-medium group-hover/slot:flex">
            <Plus size={12} /> Book
          </span>
        </button>
      ))}
    </div>
  );
}

/** Left column: this moment, what's next, the rest of today and open time. */
function NowColumn({ now, calendars }: { now: number; calendars: Calendar[] }) {
  const openDetails = useCalendar((s) => s.openDetails);
  const rightPane = useCalendar((s) => s.rightPane);
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const events = useTodayAndTomorrow(today);

  const todays = timedOn(events, today);
  const tomorrows = timedOn(events, tomorrow);
  const current = todays.find((e) => e.startMs <= now && e.endMs > now);
  const upcoming = todays.filter((e) => e.startMs > now);
  const next = upcoming[0];
  const prevEnd = Math.max(
    today + WORK_START * HOUR,
    ...todays.filter((e) => e.endMs <= now).map((e) => e.endMs),
  );
  const progress = current
    ? (now - current.startMs) / (current.endMs - current.startMs)
    : next && next.startMs > prevEnd
      ? (now - prevEnd) / (next.startMs - prevEnd)
      : 0;
  const slotSel = rightPane.kind === 'form' ? rightPane.slot : undefined;

  return (
    <aside className="flex w-[272px] shrink-0 flex-col overflow-x-hidden overflow-y-auto px-2 pb-2">
      <BigClock now={now} />
      <p className="text-ink-muted mt-3 text-[14px]">
        {current ? (
          <>
            In <span className="text-ink font-medium">{current.title || '(untitled)'}</span> until{' '}
            {timeLabel(current.endMs)}
          </>
        ) : next ? (
          <>
            You're free for{' '}
            <span className="text-ink font-medium">{durationLabel(next.startMs - now)}</span>
          </>
        ) : (
          'Nothing else on today'
        )}
      </p>
      {(current || next) && (
        <div className="bg-sunken mt-3 h-1.5 overflow-hidden rounded-full">
          <div
            className="bg-ink-muted h-full rounded-full"
            style={{ width: `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%` }}
          />
        </div>
      )}

      {next && (
        <button
          onClick={() => openDetails(next)}
          className="bg-surface border-hairline hover:border-ink-faint/50 mt-7 rounded-2xl border p-4 text-left"
        >
          <Eyebrow>Next · in {durationLabel(next.startMs - now)}</Eyebrow>
          <div className="mt-2 flex items-start gap-3">
            <span
              className="mt-0.5 h-9 w-1 shrink-0 rounded-full"
              style={{ background: eventColor(next, calendars) }}
            />
            <div className="min-w-0">
              <div className="text-ink truncate text-[16px] font-semibold">
                {next.title || '(untitled)'}
              </div>
              <div className="text-ink-muted text-[12.5px] tabular-nums">
                {timeLabel(next.startMs)} – {timeLabel(next.endMs)}
              </div>
            </div>
          </div>
        </button>
      )}

      {upcoming.length > 1 && (
        <>
          <Eyebrow className="mt-7">Rest of today</Eyebrow>
          <div className="mt-2 flex flex-col">
            {upcoming.slice(1).map((e) => (
              <button
                key={e.id}
                onClick={() => openDetails(e)}
                className="hover:bg-surface -mx-2 flex items-center gap-3 rounded-lg px-2 py-1 text-left text-[13px]"
              >
                <span className="text-ink-faint w-16 shrink-0 text-[11.5px] tabular-nums">
                  {timeLabel(e.startMs)}
                </span>
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: eventColor(e, calendars) }}
                />
                <span className="text-ink-muted truncate">{e.title || '(untitled)'}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <div className="mt-7">
        <div className="flex items-baseline">
          <Eyebrow>Free slots</Eyebrow>
          <span className="text-ink-faint ml-auto text-[11px] tabular-nums">
            {timeLabel(today + WORK_START * HOUR)}–{timeLabel(today + WORK_END * HOUR)}
          </span>
        </div>
        <div className="mt-2.5 flex flex-col gap-3">
          <FreeSlotList
            label="Today"
            slots={freeSlots(events, today, now)}
            dayEvents={todays}
            selected={slotSel}
          />
          <FreeSlotList
            label="Tomorrow"
            slots={freeSlots(events, tomorrow)}
            dayEvents={tomorrows}
            selected={slotSel}
          />
        </div>
      </div>

      {allDayOn(events, today).length > 0 && (
        <div className="mt-auto pt-7">
          <Eyebrow>All day</Eyebrow>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {allDayOn(events, today).map((a) => (
              <button
                key={a.id}
                onClick={() => openDetails(a)}
                className="text-ink max-w-full truncate rounded-full px-2.5 py-1 text-[11.5px]"
                style={{ background: softFill(eventColor(a, calendars), 22) }}
              >
                {a.title || '(untitled)'}
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

/** A free stretch between two cards, drawn as space sized by its length. */
function Gap({ slot, label }: { slot: Slot; label?: string }) {
  const bookSlot = useCalendar((s) => s.bookSlot);
  const mins = (slot.endMs - slot.startMs) / MIN;
  return (
    <button
      onClick={() => bookSlot(slot)}
      className="group/gap text-ink-faint hover:text-ink flex w-full items-center gap-3 pl-[84px] text-left text-[11px]"
      style={{ height: Math.min(64, 20 + mins * 0.12) }}
    >
      <span className="border-hairline group-hover/gap:border-ink-faint h-full border-l-2 border-dotted" />
      <span className="group-hover/gap:hidden">
        {label ?? `${durationLabel(slot.endMs - slot.startMs)} free`}
      </span>
      <span className="hidden items-center gap-1 font-medium group-hover/gap:flex">
        <Plus size={11} /> Book {timeLabel(slot.startMs)}
      </span>
    </button>
  );
}

function EventCard({
  event,
  color,
  selected,
  done,
}: {
  event: CalendarEvent;
  color: string;
  selected: boolean;
  done: boolean;
}) {
  const openDetails = useCalendar((s) => s.openDetails);
  const mins = (event.endMs - event.startMs) / MIN;
  return (
    <div className={cn('flex items-stretch gap-3 py-1', done && 'opacity-50')}>
      <span className="text-ink-faint w-[72px] shrink-0 pt-2 text-right text-[11.5px] tabular-nums">
        {timeLabel(event.startMs)}
      </span>
      <button
        onClick={() => openDetails(event)}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-xl px-3 py-2 text-left"
        style={{
          background: softFill(color, 13),
          minHeight: Math.min(76, 34 + mins * 0.11),
          boxShadow: `inset 3px 0 0 ${color}` + (selected ? `, 0 0 0 1.5px ${color}` : ''),
        }}
      >
        <span className="text-ink min-w-0 flex-1 truncate text-[13px] font-medium">
          {event.eventType === 'outOfOffice' && '⊗ '}
          {event.title || '(untitled)'}
        </span>
        {event.meetingUrl && <Video size={13} className="text-ink-faint mt-0.5 shrink-0" />}
        <span className="text-ink-muted shrink-0 text-[11.5px] tabular-nums">
          {durationLabel(mins * MIN)}
        </span>
      </button>
    </div>
  );
}

/** Right column: the coming days as a running list with breathing room. */
function AgendaList({ now, calendars }: { now: number; calendars: Calendar[] }) {
  const anchor = useCalendar((s) => s.anchor);
  const cursor = useCalendar((s) => s.cursor);
  const rightPane = useCalendar((s) => s.rightPane);
  const setView = useCalendar((s) => s.setView);
  const openDetails = useCalendar((s) => s.openDetails);
  const today = startOfDay(now);
  const { days, start, end } = useMemo(() => rangeForView('agenda', anchor), [anchor]);
  const weekStart = startOfWeek(today);
  const events = useVisibleEvents(Math.min(start, weekStart), end);
  const selectedId = rightPane.kind === 'details' ? rightPane.event.id : undefined;
  const listRef = useRef<HTMLDivElement>(null);

  // Keep the cursor day (arrow keys, go-to-date) in view.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-day="${cursor}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [cursor]);

  const showsToday = today >= start && today < end;
  const behind = showsToday
    ? events.filter((e) => e.endMs <= now && e.startMs >= weekStart && !e.allDay).length
    : 0;

  return (
    <section
      ref={listRef}
      data-agenda-list
      className="border-hairline min-w-0 flex-1 overflow-x-hidden overflow-y-auto border-l pr-1 pb-10 pl-7"
    >
      {behind > 0 && (
        <button
          onClick={() => setView('week')}
          className="text-ink-faint hover:text-ink border-hairline flex w-full items-center gap-2 border-b pb-3 text-left text-[12px]"
        >
          <ChevronRight size={13} />
          Earlier this week · {behind} event{behind === 1 ? '' : 's'} behind you
        </button>
      )}
      {days.map((day) => {
        const isToday = day === today;
        const past = day < today;
        const timed = timedOn(events, day).filter((e) => !isToday || e.endMs > now);
        const allDay = allDayOn(events, day);
        let cur = isToday ? now : day + WORK_START * HOUR;
        const label = isToday
          ? 'Today'
          : day === addDays(today, 1)
            ? 'Tomorrow'
            : new Date(day).toLocaleDateString(undefined, { weekday: 'long' });
        const month =
          new Date(day).getMonth() !== new Date(today).getMonth() || new Date(day).getDate() === 1
            ? new Date(day).toLocaleDateString(undefined, { month: 'short' })
            : '';
        return (
          <div key={day} data-day={day} className="grid grid-cols-[104px_minmax(0,1fr)] gap-5 pt-6">
            <div className={cn(past && 'opacity-60')}>
              <div
                className={cn(
                  'text-[11px] font-semibold tracking-[0.12em] uppercase',
                  isToday ? 'text-danger' : day === cursor ? 'text-accent' : 'text-ink-faint',
                )}
              >
                {label}
              </div>
              <div className="text-ink flex items-baseline gap-1.5">
                <span className="text-[40px] leading-none font-light tabular-nums">
                  {new Date(day).getDate()}
                </span>
                {month && <span className="text-ink-muted text-[13px]">{month}</span>}
              </div>
              <div className="mt-2 flex flex-col gap-1">
                {allDay.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => openDetails(a)}
                    className="text-ink-muted hover:text-ink flex items-center gap-1.5 text-left text-[11px]"
                  >
                    <span
                      className="h-1.5 w-1.5 shrink-0 rounded-full"
                      style={{ background: eventColor(a, calendars) }}
                    />
                    <span className="truncate">{a.title || '(untitled)'}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              {!timed.length && !past && (
                <Gap
                  slot={{
                    startMs: Math.max(cur, day + WORK_START * HOUR),
                    endMs: day + WORK_END * HOUR,
                  }}
                  label={isToday ? 'Nothing else today' : 'Free all day'}
                />
              )}
              {!timed.length && past && (
                <p className="text-ink-faint pt-2 text-[12px]">Nothing scheduled</p>
              )}
              {timed.map((e) => {
                const gap = { startMs: cur, endMs: e.startMs };
                cur = Math.max(cur, e.endMs);
                return (
                  <div key={e.id}>
                    {!past && gap.endMs - gap.startMs >= MIN_SLOT_MINS * MIN && <Gap slot={gap} />}
                    <EventCard
                      event={e}
                      color={eventColor(e, calendars)}
                      selected={e.id === selectedId}
                      done={e.endMs <= now}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </section>
  );
}

export function AgendaView() {
  const calendars = useCalendar((s) => s.calendars);
  const now = useNow();
  return (
    <div className="flex min-h-0 flex-1 gap-8 px-5 pt-2">
      <NowColumn now={now} calendars={calendars} />
      <AgendaList now={now} calendars={calendars} />
    </div>
  );
}
