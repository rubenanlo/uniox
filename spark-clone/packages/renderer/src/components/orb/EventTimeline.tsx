import { CalendarDays, ChevronDown, ExternalLink, Sparkles, Video } from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { CalendarEvent } from '@app/shared';
import { useNow } from '../../lib/workday';
import type { TodayEvents } from '../../lib/todayEvents';
import { cn } from '../../lib/utils';
import { useAssistant } from '../../state/assistant';
import { useCalendar } from '../../state/calendar';
import { useUi } from '../../state/store';

/** Join turns solid this long before a call starts. */
const JOIN_LEAD_MS = 10 * 60_000;
/** A gap at least this long gets a "3h free" note on the rail. */
const GAP_NOTE_MS = 150 * 60_000;

const AVATAR_TINTS = ['#7a5cf6', '#14a3a0', '#e5677c', '#e99a2c', '#5b5cf0', '#3f9d5a'];

function timeParts(ms: number): { main: string; period: string } {
  const parts = new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).formatToParts(new Date(ms));
  const period = parts.find((p) => p.type === 'dayPeriod')?.value ?? '';
  const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
  const minute = parts.find((p) => p.type === 'minute')?.value ?? '00';
  // 12-hour clocks drop ":00" on the rail ("2 PM"); 24-hour clocks keep "14:00".
  return { main: period && minute === '00' ? hour : `${hour}:${minute}`, period };
}

function clock(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function span(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function initials(p: { name: string; email: string }): string {
  const src = p.name.trim() || p.email.split('@')[0] || '?';
  const bits = src.split(/[\s._-]+/).filter(Boolean);
  return ((bits[0]?.[0] ?? '') + (bits[1]?.[0] ?? '')).toUpperCase() || '?';
}

function firstName(p: { name: string; email: string }): string {
  return p.name.trim().split(/\s+/)[0] || p.email.split('@')[0] || '';
}

function Avatars({ people }: { people: { name: string; email: string }[] }) {
  if (!people.length) return null;
  const shown = people.slice(0, 3);
  const extra = people.length - shown.length;
  return (
    <span className="flex">
      {shown.map((p, i) => (
        <span
          key={p.email || i}
          title={p.name || p.email}
          style={{ background: AVATAR_TINTS[i % AVATAR_TINTS.length] }}
          className="-ml-1.5 flex h-5 w-5 items-center justify-center rounded-full border-[1.5px] border-white/80 text-[8.5px] font-bold text-white first:ml-0"
        >
          {initials(p)}
        </span>
      ))}
      {extra > 0 && (
        <span className="-ml-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-[1.5px] border-white/80 bg-[#8a8aa0] px-1 text-[8.5px] font-bold text-white">
          +{extra}
        </span>
      )}
    </span>
  );
}

function openExternal(url: string) {
  window.open(url, '_blank', 'noopener');
}

function JoinButton({ event, now }: { event: CalendarEvent; now: number }) {
  if (!event.meetingUrl) return null;
  const soon = now >= event.startMs - JOIN_LEAD_MS && now < event.endMs;
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        openExternal(event.meetingUrl!);
      }}
      className={cn(
        'inline-flex h-[26px] items-center gap-1.5 rounded-[9px] px-2.5 text-[11.5px] font-semibold whitespace-nowrap transition-transform active:scale-[0.97]',
        soon ? 'bg-accent text-white' : 'bg-accent/12 text-accent',
      )}
    >
      <Video size={13} /> {soon ? 'Join now' : 'Join'}
    </button>
  );
}

function openInCalendar(event: CalendarEvent) {
  useAssistant.getState().setOpen(false);
  useUi.getState().setView('calendar');
  const cal = useCalendar.getState();
  cal.setCursor(event.startMs);
  cal.openDetails(event);
}

function prepFor(event: CalendarEvent) {
  const a = useAssistant.getState();
  const who = event.attendees?.map((p) => p.name || p.email).join(', ');
  a.send(
    `Prep me for "${event.title}" at ${clock(event.startMs)}.`,
    `The meeting: ${event.title}, ${clock(event.startMs)}–${clock(event.endMs)}` +
      (event.location ? `, ${event.location}` : '') +
      (who ? `, with ${who}` : '') +
      (event.description ? `.\nDescription:\n${event.description.slice(0, 3000)}` : '.') +
      '\n\nGive a short brief: what it is likely about, a good opening line, and what to bring.',
  );
}

const ghostBtn =
  'tl-ghost text-ink-muted hover:text-ink inline-flex h-[26px] items-center gap-1.5 rounded-[9px] px-2.5 text-[11.5px] font-semibold whitespace-nowrap transition-colors';

function EventRow({
  event,
  now,
  isNext,
  open,
  onToggle,
  calendar,
  index,
}: {
  event: CalendarEvent;
  now: number;
  isNext: boolean;
  open: boolean;
  onToggle(): void;
  calendar?: { name: string; color: string };
  index: number;
}) {
  const past = now >= event.endMs;
  const live = !past && now >= event.startMs;
  const color = event.color || calendar?.color || 'var(--color-accent)';
  const people = event.attendees ?? [];
  const { main, period } = timeParts(event.startMs);
  const meta = [
    span(event.endMs - event.startMs),
    event.location || (event.meetingUrl ? 'Video call' : ''),
    people.length ? `${people.length + 1} people` : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return (
    <div
      className={cn(
        'tl-rise relative grid grid-cols-[48px_14px_1fr] gap-x-2',
        past && 'opacity-50',
      )}
      style={{ '--c': color, animationDelay: `${index * 40}ms` } as CSSProperties}
    >
      <div className="text-ink pt-2.5 text-right text-[11.5px] leading-tight font-semibold tabular-nums">
        {main}
        {period && <span className="text-ink-faint block text-[10.5px] font-normal">{period}</span>}
      </div>
      <div className="tl-rail relative">
        <span className="tl-dot absolute top-[13px] left-[2px] h-2.5 w-2.5 rounded-full" />
      </div>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className={cn(
          'my-1 cursor-pointer rounded-[13px] border px-[11px] py-[9px] transition-transform duration-150 outline-none hover:translate-x-0.5 focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
          past ? 'border-transparent py-1.5' : 'tl-card',
          isNext && 'tl-card-next',
        )}
      >
        <div className="text-ink text-[12.5px] leading-snug font-semibold">
          {event.title || '(no title)'}
        </div>
        <div className="text-ink-muted mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span>{past ? 'Done' : meta}</span>
          {live && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[rgb(239_79_95/0.14)] px-[7px] py-px text-[10.5px] font-semibold text-[#ef4f5f]">
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              Now · {span(event.endMs - now)} left
            </span>
          )}
          {isNext && !live && (
            <span className="bg-accent/12 text-accent rounded-full px-[7px] py-px text-[10.5px] font-semibold">
              in {span(event.startMs - now)}
            </span>
          )}
        </div>
        {isNext && !open && (event.meetingUrl || people.length > 0) && (
          <div className="mt-2 flex items-center gap-2">
            <JoinButton event={event} now={now} />
            <Avatars people={people} />
          </div>
        )}
        <div className={cn('tl-details grid', open && 'tl-details-open')}>
          <div className="overflow-hidden">
            {calendar && (
              <div className="text-ink-muted mt-2 flex items-center gap-2 text-[11.5px]">
                <CalendarDays size={13} /> {calendar.name}
              </div>
            )}
            {people.length > 0 && (
              <div className="text-ink-muted mt-2 flex items-center gap-2 text-[11.5px]">
                <Avatars people={people} />
                <span className="truncate">
                  {people.length <= 3
                    ? people.map(firstName).join(', ')
                    : `${people.slice(0, 2).map(firstName).join(', ')} and ${people.length - 2} others`}
                </span>
              </div>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <JoinButton event={event} now={now} />
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  openInCalendar(event);
                }}
                className={ghostBtn}
              >
                <ExternalLink size={12} /> Open in Calendar
              </button>
              {!past && (people.length > 0 || event.meetingUrl) && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    prepFor(event);
                  }}
                  className={ghostBtn}
                >
                  <Sparkles size={12} /> Prep me
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Today's events as a vertical timeline under an Assistant answer: a Now
 * line, the next meeting lifted with a countdown and Join, past events
 * faded, long gaps noted, and "Busy" mirrors tucked behind a toggle.
 */
export function EventTimeline({ day }: { day: TodayEvents }) {
  const now = useNow().getTime();
  const [openId, setOpenId] = useState<string | null>(null);
  const [showMirrors, setShowMirrors] = useState(false);
  const { events, allDay, mirrors, calendars } = day;
  // Only today's card is live; an old answer from yesterday shows no Now line.
  const isToday = now >= day.dayStartMs && now < day.dayStartMs + 86_400_000;
  const next = isToday ? events.find((e) => e.endMs > now) : undefined;

  type Item = { kind: 'event' | 'mirror'; e: CalendarEvent };
  const items: Item[] = [
    ...events.map((e): Item => ({ kind: 'event', e })),
    ...(showMirrors ? mirrors.map((e): Item => ({ kind: 'mirror', e })) : []),
  ].sort((a, b) => a.e.startMs - b.e.startMs || (a.kind === 'mirror' ? 1 : -1));

  if (!events.length && !allDay.length) return null;

  const nowLine = (
    <div
      key="now"
      className="grid grid-cols-[48px_14px_1fr] items-center gap-x-2 py-0.5"
      aria-label="Now"
    >
      <b className="text-right text-[10.5px] text-[#ef4f5f] tabular-nums">{timeParts(now).main}</b>
      <i className="ml-[2px] h-2.5 w-2.5 rounded-full bg-[#ef4f5f] shadow-[0_0_0_4px_rgb(239_79_95/0.18)]" />
      <span className="h-0.5 rounded-sm bg-gradient-to-r from-[#ef4f5f] to-transparent" />
    </div>
  );

  const rows: ReactNode[] = [];
  let nowPlaced = !isToday;
  let prevEnd: number | null = null;
  items.forEach((it, i) => {
    const e = it.e;
    if (it.kind === 'event' && prevEnd !== null && e.startMs - prevEnd >= GAP_NOTE_MS) {
      rows.push(
        <div key={`gap${i}`} className="grid grid-cols-[48px_14px_1fr] gap-x-2">
          <div />
          <div className="tl-rail tl-rail-gap relative" />
          <p className="text-ink-faint my-1 text-[11px] italic">{span(e.startMs - prevEnd)} free</p>
        </div>,
      );
    }
    if (!nowPlaced && now < e.endMs) {
      // A running event carries its own "Now" pill; the line marks gaps only.
      if (now < e.startMs) rows.push(nowLine);
      nowPlaced = true;
    }
    if (it.kind === 'mirror') {
      const { main } = timeParts(e.startMs);
      rows.push(
        <div key={`m${e.id}`} className="grid grid-cols-[48px_14px_1fr] gap-x-2">
          <div className="text-ink-faint pt-2 text-right text-[11px] tabular-nums">{main}</div>
          <div className="tl-rail relative">
            <span className="border-ink-faint absolute top-[11px] left-[2px] h-2.5 w-2.5 rounded-full border-2 border-dashed" />
          </div>
          <div className="tl-busy text-ink-faint my-1 rounded-[11px] border border-dashed px-2.5 py-1 text-[11.5px]">
            {e.title || 'Busy'} · copy from {calendars[e.calendarId]?.name ?? 'another calendar'}
          </div>
        </div>,
      );
      return;
    }
    rows.push(
      <EventRow
        key={e.id}
        event={e}
        now={now}
        index={i}
        isNext={e === next}
        open={openId === e.id}
        onToggle={() => setOpenId((id) => (id === e.id ? null : e.id))}
        calendar={calendars[e.calendarId]}
      />,
    );
    prevEnd = Math.max(prevEnd ?? 0, e.endMs);
  });
  if (!nowPlaced) rows.push(nowLine);

  return (
    <div className="flex flex-col gap-2">
      {allDay.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allDay.map((e) => (
            <span
              key={e.id}
              style={
                {
                  '--c': e.color || calendars[e.calendarId]?.color || 'var(--color-accent)',
                } as CSSProperties
              }
              className="tl-allday text-ink inline-flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-[11px] font-medium"
            >
              All day · {e.title}
            </span>
          ))}
        </div>
      )}
      {items.length > 0 && <div className="tl flex flex-col">{rows}</div>}
      {mirrors.length > 0 && (
        <button
          onClick={() => setShowMirrors((v) => !v)}
          className="text-ink-faint hover:text-ink-muted inline-flex items-center gap-1.5 self-start text-[11.5px] transition-colors"
        >
          <ChevronDown
            size={12}
            className={cn('transition-transform', showMirrors && 'rotate-180')}
          />
          {showMirrors ? 'Hide' : 'Show'} {mirrors.length} “Busy”{' '}
          {mirrors.length === 1 ? 'copy' : 'copies'} from your other calendars
        </button>
      )}
    </div>
  );
}
