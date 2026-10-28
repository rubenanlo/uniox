import { DoorClosed, Video, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { durationLabel, timedOn } from '../../lib/agenda';
import { addDays, DAY_MS, startOfDay } from '../../lib/calendarMonth';
import { descriptionToHtml } from '../../lib/richText';
import { presetRrule, type RepeatPreset } from '../../lib/rrule';
import { cn } from '../../lib/utils';
import { useAccounts } from '../../state/queries';
import { type EventDraft, type FreeSlot, useCalendar } from '../../state/calendar';
import { DayTrack } from './AgendaView';
import { BigTimes } from './AgendaPane';
import { useVisibleEvents } from './useNotionEvents';
import { Keycaps } from '../ui/Keycap';
import { RichTextArea } from './RichTextArea';

const MIN = 60_000;

const COLORS = ['#2f63e7', '#e0567c', '#e0913a', '#2ba676', '#8b5cf6', '#6d6d75'];
const inputCls =
  'border-hairline bg-sunken text-ink w-full rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-accent';

const pad = (n: number) => String(n).padStart(2, '0');
const dateValue = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const timeValue = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
function combine(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0).getTime();
}

/** Which preset (if any) a stored rrule corresponds to, for the select. */
function presetOf(rrule: string | undefined): RepeatPreset | 'custom' {
  if (!rrule) return 'none';
  if (rrule === 'FREQ=DAILY') return 'daily';
  if (/^FREQ=WEEKLY;BYDAY=[A-Z]{2}$/.test(rrule)) return 'weekly';
  if (/^FREQ=MONTHLY;BYMONTHDAY=\d+$/.test(rrule)) return 'monthly';
  if (rrule === 'FREQ=YEARLY') return 'yearly';
  return 'custom';
}

export function EventForm({
  draft,
  variant = 'default',
  slot,
}: {
  draft: EventDraft;
  /** 'agenda' leads with large times, a day track and (for a free slot) quick lengths. */
  variant?: 'default' | 'agenda';
  slot?: FreeSlot;
}) {
  const save = useCalendar((s) => s.save);
  const patch = useCalendar((s) => s.patch);
  const closePane = useCalendar((s) => s.closePane);
  const calendars = useCalendar((s) => s.calendars);
  const { accounts } = useAccounts();

  // Google-sourced events edit in place and sync upstream; fields Google owns
  // elsewhere (repeat, color, meeting link, event type) are hidden.
  const isGoogle = draft.source === 'google';
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(draft.title);
  const [calendarId, setCalendarId] = useState(draft.calendarId);
  const [date, setDate] = useState(dateValue(draft.startMs));
  // All-day ends are stored as exclusive midnight, so seed from the last
  // inclusive ms (endMs - 1) to show the actual final day.
  const [endDate, setEndDate] = useState(dateValue(draft.allDay ? draft.endMs - 1 : draft.endMs));
  const [start, setStart] = useState(timeValue(draft.startMs));
  const [end, setEnd] = useState(timeValue(draft.endMs));
  const [allDay, setAllDay] = useState(draft.allDay);
  const [ooo, setOoo] = useState(draft.eventType === 'outOfOffice');
  const [repeat, setRepeat] = useState<RepeatPreset | 'custom'>(presetOf(draft.rrule));
  const [customRule, setCustomRule] = useState(presetOf(draft.rrule) === 'custom' ? draft.rrule! : '');
  const [location, setLocation] = useState(draft.location);
  // The editor works on normalized HTML; change detection compares against the
  // same normalization so an untouched Google description is never pushed back.
  const [descInit] = useState(() => descriptionToHtml(draft.description));
  const [description, setDescription] = useState(descInit);
  const [meetingUrl, setMeetingUrl] = useState(draft.meetingUrl);
  // Meet is on by default for new events; it applies only when the chosen
  // account syncs with Google (the event is then created there).
  const [addMeet, setAddMeet] = useState(draft.addMeet ?? !draft.id);
  const [color, setColor] = useState(draft.color ?? COLORS[0]!);
  const [showAs, setShowAs] = useState<'opaque' | 'transparent'>(draft.transparency ?? 'opaque');
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  // Account choices map onto per-account PRIMARY calendars (id 'acct:<id>') —
  // synced secondary Google calendars are view-only in phase 2.
  const accountCalendars = calendars.filter((c) => c.accountId && c.id.startsWith('acct:'));
  const onGoogle =
    !draft.id &&
    accounts.find((a) => a.id === calendars.find((c) => c.id === calendarId)?.accountId)
      ?.authType === 'oauth-google';
  const meet = onGoogle && addMeet && !ooo;

  const submit = () => {
    if (!title.trim()) return;
    const startMs = allDay ? startOfDay(combine(date, '00:00')) : combine(date, start);
    const rawEnd = allDay ? startOfDay(combine(endDate, '00:00')) + DAY_MS : combine(endDate, end);
    const endMs = Math.max(rawEnd, startMs + (allDay ? DAY_MS : 60_000));
    if (isGoogle) {
      // Times always; text fields only when changed (a synced description may
      // be truncated locally — don't push it back unless the user edited it).
      void patch({
        id: draft.id!,
        startMs,
        endMs,
        allDay,
        ...(title.trim() !== draft.title ? { title: title.trim() } : {}),
        ...(location !== draft.location ? { location } : {}),
        ...(description !== descInit ? { description } : {}),
        ...(showAs !== (draft.transparency ?? 'opaque') ? { transparency: showAs } : {}),
      }).then(setError);
      return;
    }
    void save({
      id: draft.id,
      calendarId,
      title: title.trim(),
      startMs,
      endMs,
      allDay,
      eventType: ooo ? 'outOfOffice' : 'default',
      rrule: repeat === 'custom' ? customRule || undefined : presetRrule(repeat, startMs),
      location,
      description,
      meetingUrl: meet ? '' : meetingUrl,
      addMeet: meet,
      color,
      transparency: showAs,
    }).then(setError);
  };

  const weekday = new Date(combine(date, '00:00')).toLocaleDateString(undefined, { weekday: 'long' });

  return (
    <div
      className={cn('flex flex-col gap-3', variant === 'agenda' ? 'px-6 py-6' : 'px-4 py-4')}
      onKeyDown={(e) => {
        // The title input autofocuses, so CalendarView's Esc handler (which
        // skips editables) never fires while typing. Close the form here.
        if (e.key === 'Escape') {
          e.stopPropagation();
          closePane();
        }
      }}
    >
      {variant === 'agenda' ? (
        <AgendaFormHead
          heading={isGoogle ? 'Edit Google event' : draft.id ? 'Edit event' : slot ? 'New event · free slot' : 'New event'}
          onClose={closePane}
          titleInput={
            <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)}
                   onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder="Event title"
                   className="border-hairline text-ink placeholder:text-ink-faint w-full border-b bg-transparent pb-2 text-[20px] font-semibold tracking-tight outline-none focus:border-[var(--color-aqua)]" />
          }
          allDay={allDay}
          startMs={combine(date, start)}
          endMs={combine(endDate, end)}
          slot={slot}
          onLength={(mins) => {
            const e = combine(date, start) + mins * MIN;
            setEndDate(dateValue(e));
            setEnd(timeValue(e));
          }}
        />
      ) : (
        <>
      <div className="flex items-center gap-2">
        <h2 className="text-ink flex-1 text-[13.5px] font-bold">
          {isGoogle ? 'Edit Google event' : draft.id ? 'Edit event' : 'New event'}
        </h2>
        <button onClick={closePane} aria-label="Close form"
                className="text-ink-muted hover:text-ink flex h-7 w-7 items-center justify-center rounded-lg">
          <X size={14} />
        </button>
      </div>
      <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)}
             onKeyDown={(e) => e.key === 'Enter' && submit()}
             placeholder="Event title" className={cn(inputCls, 'text-[13.5px] font-medium')} />
        </>
      )}
      <label className="text-ink-faint flex items-center text-[11px] font-semibold tracking-wide uppercase">
        Account
        {!isGoogle && (
          <span className="ml-auto normal-case">
            <Keycaps keys={['⌥', '↓']} />
          </span>
        )}
      </label>
      {isGoogle ? (
        <p className="text-ink-muted text-[12.5px]">
          {(() => {
            const c = calendars.find((x) => x.id === calendarId);
            const a = accounts.find((x) => x.id === c?.accountId);
            return [c?.name, a?.email].filter(Boolean).join(' · ') || 'Google Calendar';
          })()}
        </p>
      ) : (
        <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} className={inputCls}
                data-account-select aria-label="Account">
          {accountCalendars.map((c) => {
            const a = accounts.find((x) => x.id === c.accountId);
            return <option key={c.id} value={c.id}>{a?.email ?? c.name}</option>;
          })}
          <option value="local-default">My Calendar (local)</option>
        </select>
      )}
      <label className="text-ink-faint text-[11px] font-semibold tracking-wide uppercase">Starts</label>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
      <label className="text-ink-faint text-[11px] font-semibold tracking-wide uppercase">Ends</label>
      <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
      {!allDay && (
        <div className="flex items-center gap-2">
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
          <span className="text-ink-faint">–</span>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label className="text-ink-muted flex items-center gap-2 text-[12.5px]">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)}
                 className="accent-[var(--color-accent)]" /> All day
        </label>
        {!isGoogle && (
          <label className="text-ink-muted flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={ooo} onChange={(e) => setOoo(e.target.checked)}
                   className="accent-[var(--color-accent)]" /> Out of office
          </label>
        )}
      </div>
      <label className="text-ink-faint text-[11px] font-semibold tracking-wide uppercase">Show as</label>
      <select value={showAs} onChange={(e) => setShowAs(e.target.value as 'opaque' | 'transparent')}
              className={inputCls}>
        <option value="opaque">Busy</option>
        <option value="transparent">Free</option>
      </select>
      {!isGoogle && (
        <>
          <label className="text-ink-faint text-[11px] font-semibold tracking-wide uppercase">Repeat</label>
          <select value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatPreset | 'custom')}
                  className={inputCls}>
            <option value="none">Doesn't repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly on {weekday}</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
            <option value="custom">Custom…</option>
          </select>
          {repeat === 'custom' && (
            <>
              <input value={customRule} onChange={(e) => setCustomRule(e.target.value)}
                     placeholder="RRULE, e.g. FREQ=DAILY;INTERVAL=2" className={inputCls} />
              <p className="text-ink-faint text-[11px]">
                Custom rules show their first occurrence only for now.
              </p>
            </>
          )}
        </>
      )}
      <input value={location} onChange={(e) => setLocation(e.target.value)}
             placeholder="Location" className={inputCls} />
      {!isGoogle && (
        <>
          <div className="border-hairline bg-sunken/40 flex items-center gap-2 rounded-lg border border-dashed px-2.5 py-2">
            <DoorClosed size={13} className="text-ink-faint shrink-0" />
            <span className="text-ink-faint text-[11.5px]">Rooms — available after Google sync</span>
          </div>
          {onGoogle && !ooo && (
            <label className="text-ink-muted flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={addMeet} onChange={(e) => setAddMeet(e.target.checked)}
                     className="accent-[var(--color-accent)]" aria-label="Add Google Meet link" />
              <Video size={13} className="text-ink-faint" /> Add Google Meet link
            </label>
          )}
          {!meet && (
            <input value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)}
                   placeholder="Meeting link" className={inputCls} />
          )}
        </>
      )}
      <RichTextArea initialHtml={descInit} onChange={setDescription} placeholder="Description" />
      {!isGoogle && !onGoogle && (
        <div className="flex items-center gap-1.5">
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} aria-label={`Color ${c}`}
                    className={cn('h-5 w-5 rounded-full transition-transform',
                                  color === c && 'ring-ink/40 scale-110 ring-2 ring-offset-1')}
                    style={{ backgroundColor: c }} />
          ))}
        </div>
      )}
      {error && <p className="text-danger text-[12px]">{error}</p>}
      <button onClick={submit} disabled={!title.trim()}
              className={cn(
                'mt-1 rounded-xl py-2 text-[12.5px] font-semibold transition-transform active:scale-[0.98] disabled:opacity-40',
                variant === 'agenda' ? 'bg-ink text-app' : 'bg-accent text-white',
              )}>
        {isGoogle ? 'Save & sync' : draft.id ? 'Save changes' : onGoogle ? 'Add & sync' : 'Add event'}
        {variant === 'agenda' && <span className="ml-2 font-mono text-[10.5px] opacity-60">↩</span>}
      </button>
    </div>
  );
}

/** Agenda form head: big title field, the times set large, the event placed
 *  on its working day and, for a free slot, quick lengths that fit it. */
function AgendaFormHead({
  heading,
  onClose,
  titleInput,
  allDay,
  startMs,
  endMs,
  slot,
  onLength,
}: {
  heading: string;
  onClose(): void;
  titleInput: React.ReactNode;
  allDay: boolean;
  startMs: number;
  endMs: number;
  slot?: FreeSlot;
  onLength(mins: number): void;
}) {
  const day = startOfDay(startMs);
  const dayEvents = timedOn(useVisibleEvents(day, addDays(day, 1)), day);
  const slotMins = slot ? Math.round((slot.endMs - slot.startMs) / MIN) : 0;
  const lengths = slot ? [...new Set([30, 60, slotMins])].filter((m) => m <= slotMins) : [];
  const picked = Math.round((endMs - startMs) / MIN);
  return (
    <div className="mb-2 flex flex-col">
      <div className="flex items-center">
        <span className="text-ink-faint font-mono text-[10.5px] font-semibold tracking-[0.16em] uppercase">
          {heading}
        </span>
        <button onClick={onClose} aria-label="Close form"
                className="text-ink-muted hover:text-ink -mr-2 ml-auto flex h-7 w-7 items-center justify-center rounded-lg">
          <X size={14} />
        </button>
      </div>
      <div className="mt-3">{titleInput}</div>
      {!allDay && endMs > startMs && (
        <>
          <div className="mt-4">
            <BigTimes start={startMs} end={endMs} />
          </div>
          <p className="text-ink-muted mt-2 text-[12.5px]">
            {new Date(startMs).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}
            {slot ? ` · slot is ${durationLabel(slot.endMs - slot.startMs)}` : ` · ${durationLabel(endMs - startMs)}`}
          </p>
          <div className="mt-4">
            <DayTrack events={dayEvents} lit={{ startMs, endMs }} size="md" />
          </div>
        </>
      )}
      {lengths.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {lengths.map((m) => (
            <button
              key={m}
              onClick={() => onLength(m)}
              className={cn(
                'rounded-lg border px-3 py-1.5 text-[12px] font-medium tabular-nums',
                m === picked
                  ? 'text-ink border-[var(--color-aqua)] bg-[color-mix(in_oklab,var(--color-aqua)_14%,transparent)]'
                  : 'border-hairline text-ink-muted hover:text-ink',
              )}
            >
              {m === slotMins ? `Whole slot · ${durationLabel(m * MIN)}` : durationLabel(m * MIN)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
