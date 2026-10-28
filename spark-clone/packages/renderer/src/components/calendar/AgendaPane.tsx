import { ExternalLink, MapPin, Pencil, Repeat, Trash2, Video, X } from 'lucide-react';
import type { CalendarEvent } from '@app/shared';
import { durationLabel, eventColor, softFill, timedOn } from '../../lib/agenda';
import { addDays, startOfDay, timeLabel } from '../../lib/calendarMonth';
import { canEditEvent } from '../../lib/eventEdit';
import { descriptionToHtml } from '../../lib/richText';
import { ruleLabel, seriesId } from '../../lib/rrule';
import { useAccounts } from '../../state/queries';
import { useCalendar } from '../../state/calendar';
import { DayTrack, useNow } from './AgendaView';
import { useVisibleEvents } from './useNotionEvents';

/* The calendar's right pane as the Agenda view shows it: the time leads,
 * with a countdown and the event placed in its working day. */

const Eyebrow = ({ children }: { children: React.ReactNode }) => (
  <p className="text-ink-faint font-mono text-[10.5px] font-semibold tracking-[0.16em] uppercase">
    {children}
  </p>
);

function CloseButton({ label }: { label: string }) {
  const closePane = useCalendar((s) => s.closePane);
  return (
    <button
      onClick={closePane}
      aria-label={label}
      className="text-ink-muted hover:text-ink -mr-2 ml-auto flex h-7 w-7 items-center justify-center rounded-lg"
    >
      <X size={14} />
    </button>
  );
}

/** "13:30 – 17:15" set large, light weight. */
export function BigTimes({ start, end }: { start: number; end: number }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
      <span className="text-ink text-[28px] leading-none font-light tracking-tight">
        {timeLabel(start)}
      </span>
      <span className="text-ink-faint text-[18px] font-light">–</span>
      <span className="text-ink-muted text-[28px] leading-none font-light tracking-tight">
        {timeLabel(end)}
      </span>
    </div>
  );
}

const dayLabel = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

function countdown(e: CalendarEvent, now: number): string {
  if (e.allDay) return 'All day';
  if (e.endMs <= now) return 'Ended';
  if (e.startMs <= now) return `Happening now · ${durationLabel(e.endMs - now)} left`;
  return `Starts in ${durationLabel(e.startMs - now)}`;
}

function Row({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3 text-[12.5px]">
      <span className="text-ink-faint mt-0.5 flex w-3.5 justify-center">{icon}</span>
      <div className="text-ink-muted min-w-0 flex-1 break-words">{children}</div>
    </div>
  );
}

export function AgendaDetailsPanel({ event }: { event: CalendarEvent }) {
  const editEvent = useCalendar((s) => s.editEvent);
  const remove = useCalendar((s) => s.remove);
  const calendars = useCalendar((s) => s.calendars);
  const { accounts } = useAccounts();
  const day = startOfDay(event.startMs);
  const dayEvents = timedOn(useVisibleEvents(day, addDays(day, 1)), day);
  const cal = calendars.find((c) => c.id === event.calendarId);
  const account = accounts.find((a) => a.id === (event.accountId ?? cal?.accountId));
  const editable = canEditEvent(event, calendars);
  const deletable = event.source === 'local';
  const color = eventColor(event, calendars);
  const now = useNow();

  return (
    <div className="flex min-h-full flex-col">
      <div
        className="px-6 pt-6 pb-5"
        style={{ background: `linear-gradient(${softFill(color, 16)}, transparent)` }}
      >
        <div className="flex items-center">
          <Eyebrow>{countdown(event, now)}</Eyebrow>
          <CloseButton label="Close details" />
        </div>
        <h2
          onClick={editable ? () => editEvent(event) : undefined}
          className="text-ink mt-3 text-[20px] leading-tight font-semibold tracking-tight"
        >
          {event.eventType === 'outOfOffice' && '⊗ '}
          {event.title || '(untitled)'}
        </h2>
        {!event.allDay && (
          <div className="mt-4">
            <BigTimes start={event.startMs} end={event.endMs} />
          </div>
        )}
        <p className="text-ink-muted mt-2 text-[12.5px]">
          {dayLabel(event.startMs)}
          {!event.allDay && ` · ${durationLabel(event.endMs - event.startMs)}`}
        </p>
        {!event.allDay && (
          <div className="mt-5">
            <DayTrack
              events={dayEvents}
              lit={event}
              color={color}
              now={day === startOfDay(now) ? now : undefined}
              size="md"
            />
          </div>
        )}
      </div>

      {event.meetingUrl && (
        <div className="px-6">
          <a
            href={event.meetingUrl}
            target="_blank"
            rel="noreferrer"
            className="bg-ink text-app flex h-10 items-center justify-center gap-2 rounded-xl text-[13px] font-medium"
          >
            <Video size={15} /> Join meeting
            <span className="text-app/60 ml-1 font-mono text-[10.5px]">⌘J</span>
          </a>
        </div>
      )}

      <div className="mt-6 flex flex-col gap-4 px-6">
        {event.location && <Row icon={<MapPin size={14} />}>{event.location}</Row>}
        {event.rrule && <Row icon={<Repeat size={14} />}>{ruleLabel(event.rrule)}</Row>}
        <Row icon={<span className="block h-3 w-3 rounded-full" style={{ background: color }} />}>
          <span className="text-ink">
            {account?.email ?? (cal ? cal.name : event.source === 'notion' ? 'Notion' : 'Calendar')}
          </span>
          {editable && (
            <span className="text-ink-faint">
              {' · '}
              {event.transparency === 'transparent' ? 'Free' : 'Busy'}
            </span>
          )}
        </Row>
      </div>

      {event.description && (
        <div className="border-hairline mx-6 mt-6 border-t pt-5">
          <Eyebrow>Notes</Eyebrow>
          <div
            // Sanitized by descriptionToHtml (same DOMPurify layer as mail).
            dangerouslySetInnerHTML={{ __html: descriptionToHtml(event.description) }}
            onClick={(e) => {
              const a = (e.target as HTMLElement).closest('a');
              if (a) {
                e.preventDefault();
                window.open(a.href, '_blank');
              }
            }}
            className="text-ink-muted [&_a]:text-accent mt-2 text-[12.5px] leading-relaxed break-words whitespace-pre-wrap select-text [&_a]:underline"
          />
        </div>
      )}

      {event.url && (
        <a
          href={event.url}
          target="_blank"
          rel="noreferrer"
          className="text-accent mx-6 mt-5 inline-flex items-center gap-1.5 text-[12.5px] font-medium"
        >
          <ExternalLink size={13} /> Open in Notion
        </a>
      )}

      {editable && (
        <div className="mt-auto flex gap-2 px-6 pt-6 pb-6">
          <button
            onClick={() => editEvent(event)}
            className="border-hairline text-ink hover:bg-sunken flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border text-[12px] font-medium"
          >
            <Pencil size={12} /> Edit{' '}
            <span className="text-ink-faint font-mono text-[10.5px]">E</span>
          </button>
          {deletable && (
            <button
              onClick={() => void remove(seriesId(event.id))}
              aria-label="Delete event"
              className="border-hairline text-danger hover:bg-sunken flex h-9 w-11 items-center justify-center rounded-lg border"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      )}
      {event.rrule && editable && (
        <p className="text-ink-faint -mt-3 px-6 pb-5 text-[11px]">
          Edits apply to the whole series.
        </p>
      )}
    </div>
  );
}

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Views',
    items: [
      ['Agenda', 'A'],
      ['Day', 'D'],
      ['Week', 'W'],
      ['Month', 'M'],
    ],
  },
  {
    title: 'Get around',
    items: [
      ['Today', 'T'],
      ['Earlier / later days', '← →'],
      ['Go to date', '⌘ ⇧ G'],
      ['Search events', '⌘ F'],
    ],
  },
  {
    title: 'Create & act',
    items: [
      ['New event', 'C'],
      ['Book next free slot', 'F'],
      ['Edit open event', 'E'],
      ['Join its meeting', '⌘ J'],
      ['Pick account', '⌥ ↓'],
    ],
  },
  {
    title: 'Panels',
    items: [
      ['Sidebar', '⌘ \\'],
      ['This panel', '⌘ /'],
      ['Mail rail', '/'],
      ['Back to mail', 'Esc'],
    ],
  },
];

/** Idle pane: shortcuts grouped by intent instead of one long list. */
export function AgendaShortcutsPanel() {
  return (
    <div className="px-6 pt-6 pb-6">
      <Eyebrow>Shortcuts</Eyebrow>
      <div className="mt-4 flex flex-col gap-5">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <div className="text-ink mb-2 text-[12.5px] font-semibold">{g.title}</div>
            <div className="border-hairline divide-hairline divide-y rounded-xl border">
              {g.items.map(([label, keys]) => (
                <div key={label} className="flex items-center gap-1 px-3 py-2">
                  <span className="text-ink-muted flex-1 text-[12.5px]">{label}</span>
                  {keys.split(' ').map((k, i) => (
                    <kbd
                      key={i}
                      className="bg-sunken text-ink-muted min-w-5 rounded-md px-1.5 py-0.5 text-center font-mono text-[10.5px]"
                    >
                      {k}
                    </kbd>
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
