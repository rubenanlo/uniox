import { DoorClosed, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DAY_MS, startOfDay } from '../../lib/calendarMonth';
import { descriptionToHtml } from '../../lib/richText';
import { presetRrule, type RepeatPreset } from '../../lib/rrule';
import { cn } from '../../lib/utils';
import { useAccounts } from '../../state/queries';
import { type EventDraft, useCalendar } from '../../state/calendar';
import { Keycaps } from '../ui/Keycap';
import { RichTextArea } from './RichTextArea';

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

export function EventForm({ draft }: { draft: EventDraft }) {
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
  const [color, setColor] = useState(draft.color ?? COLORS[0]!);
  const [showAs, setShowAs] = useState<'opaque' | 'transparent'>(draft.transparency ?? 'opaque');
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  // Account choices map onto per-account PRIMARY calendars (id 'acct:<id>') —
  // synced secondary Google calendars are view-only in phase 2.
  const accountCalendars = calendars.filter((c) => c.accountId && c.id.startsWith('acct:'));

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
      meetingUrl,
      color,
      transparency: showAs,
    });
  };

  const weekday = new Date(combine(date, '00:00')).toLocaleDateString(undefined, { weekday: 'long' });

  return (
    <div
      className="flex flex-col gap-3 px-4 py-4"
      onKeyDown={(e) => {
        // The title input autofocuses, so CalendarView's Esc handler (which
        // skips editables) never fires while typing. Close the form here.
        if (e.key === 'Escape') {
          e.stopPropagation();
          closePane();
        }
      }}
    >
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
          <input value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)}
                 placeholder="Meeting link" className={inputCls} />
        </>
      )}
      <RichTextArea initialHtml={descInit} onChange={setDescription} placeholder="Description" />
      {!isGoogle && (
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
              className="bg-accent mt-1 rounded-xl py-2 text-[12.5px] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40">
        {isGoogle ? 'Save & sync' : draft.id ? 'Save changes' : 'Add event'}
      </button>
    </div>
  );
}
