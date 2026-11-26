import { Bell, Check, HelpCircle, MapPin, Text, Users, Video, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { MobileEvent, RsvpAnswer } from '../data/types';
import { AiMark, AvatarStack, CloseButton, Sheet, TabBar, Toggle } from '../components/ui';
import {
  addDays,
  dayLabel,
  displayName,
  fullDate,
  startOfDay,
  startOfWeek,
  timeRange,
} from '../lib/format';
import { go, useRoute } from '../lib/router';
import { useStore } from '../lib/store';
import { useNow } from '../lib/useNow';
import { CalTop, DayRiver, MonthDots, WeekFolds } from './CalendarDay';
import {
  CalendarChoice,
  type CalendarPick,
  pickLabel,
  useCalendarGroups,
} from '../components/CalendarChoice';

type View = 'day' | 'week' | 'month' | 'list';

export function CalendarScreen() {
  const { api, threads } = useStore();
  const route = useRoute();
  const view = (route.query.get('view') as View) || 'day';
  const now = useNow();
  const [day, setDay] = useState(() => startOfDay(now));
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const openId = route.query.get('event');
  const creating = route.query.has('new');
  // The island's "add an event" lands in the day's next free gap; the sheet
  // is the fallback when there is none, and in the week and list views.
  const [newSheet, setNewSheet] = useState(false);

  const range = useMemo(() => {
    const ws = startOfWeek(day);
    if (view === 'month') {
      const x = new Date(day);
      const first = new Date(x.getFullYear(), x.getMonth(), 1).getTime();
      const next = new Date(x.getFullYear(), x.getMonth() + 1, 1).getTime();
      return [startOfWeek(first), addDays(next, 7)];
    }
    return view === 'list'
      ? [startOfDay(now), addDays(startOfDay(now), 30)]
      : view === 'week'
        ? [addDays(ws, -14), addDays(ws, 21)] // the week picker shows two weeks each side
        : [addDays(ws, -7), addDays(ws, 14)];
  }, [day, view, now]);

  const load = useCallback(
    () => void api.events(range[0]!, range[1]!).then(setEvents),
    [api, range],
  );
  useEffect(load, [load, threads]);

  const setView = (v: View) => go(`calendar?view=${v}`, true);
  const open = events.find((e) => e.id === openId);
  return (
    <>
      <div
        className="screen"
      >
        {view === 'day' ? (
          <DayRiver
            day={day}
            setDay={setDay}
            events={events}
            now={now}
            view={view}
            setView={setView}
            onChanged={load}
            onDetails={(e) => go(`calendar?event=${encodeURIComponent(e.id)}`, true)}
            wantNew={creating && !newSheet}
            onNewHandled={(placed) => (placed ? go('calendar', true) : setNewSheet(true))}
          />
        ) : view === 'week' ? (
          <WeekFolds
            day={day}
            setDay={setDay}
            events={events}
            now={now}
            view={view}
            setView={setView}
            onChanged={load}
            onDetails={(e) => go(`calendar?view=week&event=${encodeURIComponent(e.id)}`, true)}
            onOpenDay={(d) => (setDay(d), go('calendar', true))}
          />
        ) : view === 'month' ? (
          <MonthDots
            day={day}
            setDay={setDay}
            events={events}
            now={now}
            view={view}
            setView={setView}
            onChanged={load}
            onDetails={(e) => go(`calendar?view=month&event=${encodeURIComponent(e.id)}`, true)}
            onOpenDay={(d) => (setDay(d), go('calendar', true))}
            onOpenWeek={(d) => (setDay(d), go('calendar?view=week', true))}
          />
        ) : (
          <>
            <div className="cal">
              <CalTop
                label="Next 30 days"
                onToday={() => setDay(startOfDay(now))}
                view={view}
                setView={setView}
              />
            </div>
            <ListView events={events} now={now} />
          </>
        )}
      </div>
      <TabBar on="calendar" />
      {open && (
        <EventSheet ev={open} onClose={() => go(`calendar?view=${view}`, true)} onChanged={load} />
      )}
      {creating && (view !== 'day' || newSheet) && (
        <NewEventSheet
          day={day}
          onClose={() => (setNewSheet(false), go(`calendar?view=${view}`, true))}
          onCreated={load}
        />
      )}
    </>
  );
}

function ListView({ events, now }: { events: MobileEvent[]; now: number }) {
  const upcoming = events.filter((e) => e.endMs > now).sort((a, b) => a.startMs - b.startMs);
  const days: { day: number; items: MobileEvent[] }[] = [];
  for (const e of upcoming) {
    const d = startOfDay(Math.max(e.startMs, now));
    const g = days[days.length - 1];
    if (g?.day === d) g.items.push(e);
    else days.push({ day: d, items: [e] });
  }
  return (
    <div style={{ padding: '4px 0 20px' }}>
      {days.map((g) => (
        <div key={g.day}>
          <div className="sect">
            <span className="eyebrow">
              {dayLabel(g.day)} ·{' '}
              {new Date(g.day).toLocaleDateString([], { month: 'short', day: 'numeric' })}
            </span>
          </div>
          {g.items.map((e) => (
            <button
              key={e.id}
              className="row"
              style={{ width: '100%', textAlign: 'left', alignItems: 'center' }}
              onClick={() => go(`calendar?view=list&event=${encodeURIComponent(e.id)}`, true)}
            >
              <span
                style={{
                  width: 4,
                  alignSelf: 'stretch',
                  borderRadius: 2,
                  background: e.free ? 'var(--faint)' : e.color,
                }}
              />
              <div className="meta">
                <div className="from">{e.title}</div>
                <div className="snip">
                  {e.allDay ? 'All day' : timeRange(e.startMs, e.endMs)}
                  {e.location ? ` · ${e.location}` : ''}
                </div>
              </div>
              {e.meetingUrl && <Video size={18} color="var(--muted)" />}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

function EventSheet({
  ev,
  onClose,
  onChanged,
}: {
  ev: MobileEvent;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { api, showToast, threads } = useStore();
  const [answer, setAnswer] = useState<RsvpAnswer | null>(ev.myAnswer);
  const related = threads.find(
    (t) =>
      t.priority && t.unreadCount > 0 && ev.attendees.some((a) => a.email === t.lastFrom?.email),
  );
  const rsvp = async (a: RsvpAnswer) => {
    const prev = answer;
    setAnswer(a);
    try {
      await api.rsvp(ev.id, ev.accountId, a);
      onChanged();
    } catch (e) {
      setAnswer(prev);
      showToast({ text: (e as Error).message });
    }
  };
  const isOrganizer = !ev.organizer || ev.attendees.length === 0;
  return (
    <Sheet onClose={onClose}>
      <div className="sheet-body" style={{ padding: '8px 22px 22px' }}>
        <div className="row-flex" style={{ justifyContent: 'space-between' }}>
          <div className="row-flex muted" style={{ fontSize: 13 }}>
            <span style={{ width: 12, height: 12, borderRadius: 4, background: ev.color }} />
            {ev.calendarName}
          </div>
          <CloseButton onClick={onClose} />
        </div>
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-.02em', marginTop: 4 }}>
          {ev.title}
        </div>
        <div className="muted" style={{ fontSize: 16, marginTop: 6 }}>
          {fullDate(ev.startMs)} · {ev.allDay ? 'All day' : timeRange(ev.startMs, ev.endMs)}
        </div>
        {ev.meetingUrl && (
          <a
            className="btn primary block"
            href={ev.meetingUrl}
            target="_blank"
            rel="noreferrer"
            style={{ marginTop: 18 }}
          >
            <Video size={19} /> Join {ev.meetingUrl.includes('zoom') ? 'Zoom' : 'Google Meet'}
          </a>
        )}
        {!isOrganizer && (
          <div className="row-flex" style={{ gap: 10, marginTop: 10 }}>
            {(
              [
                ['accepted', 'Going', Check, '#34a853'],
                ['tentative', 'Maybe', HelpCircle, '#e8a33a'],
                ['declined', 'No', X, '#d4386c'],
              ] as const
            ).map(([k, label, Icon, c]) => (
              <button
                key={k}
                className="btn soft"
                style={{
                  flex: 1,
                  ...(answer === k
                    ? { background: `color-mix(in srgb, ${c} 18%, transparent)`, color: c }
                    : {}),
                }}
                onClick={() => void rsvp(k)}
              >
                <Icon size={17} /> {label}
              </button>
            ))}
          </div>
        )}
        <div
          style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 16, fontSize: 15 }}
        >
          {ev.attendees.length > 0 && (
            <div className="row-flex muted" style={{ gap: 14 }}>
              <Users size={20} />
              <AvatarStack people={ev.attendees} size={28} />
              <span style={{ color: 'var(--ink)' }}>
                {displayName(ev.organizer ?? ev.attendees[0])}
                {ev.attendees.length > 1 ? ` + ${ev.attendees.length - 1} guests` : ''}
              </span>
            </div>
          )}
          {ev.location && (
            <div className="row-flex muted" style={{ gap: 14 }}>
              <MapPin size={20} />
              <span style={{ color: 'var(--ink)' }}>{ev.location}</span>
            </div>
          )}
          <div className="row-flex muted" style={{ gap: 14 }}>
            <Bell size={20} />
            <span style={{ color: 'var(--ink)' }}>10 minutes before</span>
          </div>
          {ev.description && (
            <div className="row-flex muted" style={{ gap: 14, alignItems: 'flex-start' }}>
              <Text size={20} style={{ flex: 'none' }} />
              <span
                className="mail-text"
                style={{ color: 'var(--ink)', fontSize: 15, lineHeight: 1.45 }}
              >
                {ev.description.replace(/<[^>]+>/g, ' ').slice(0, 600)}
              </span>
            </div>
          )}
        </div>
        {related && (
          <button
            className="glass row-flex"
            style={{
              marginTop: 18,
              borderRadius: 18,
              padding: '12px 14px',
              gap: 10,
              width: '100%',
              textAlign: 'left',
              alignItems: 'flex-start',
            }}
            onClick={() => go(`thread/${encodeURIComponent(related.id)}`)}
          >
            <AiMark />
            <div style={{ fontSize: 14, lineHeight: 1.45 }}>
              <b>Prep:</b> {displayName(related.lastFrom)} is waiting on you: “{related.subject}”.
            </div>
          </button>
        )}
      </div>
    </Sheet>
  );
}

function NewEventSheet({
  day,
  onClose,
  onCreated,
}: {
  day: number;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { api, accounts, showToast } = useStore();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(() => new Date(day).toLocaleDateString('en-CA'));
  const [time, setTime] = useState('10:00');
  const [mins, setMins] = useState(30);
  const [meet, setMeet] = useState(true);
  const [where, setWhere] = useState<CalendarPick>({ accountId: accounts[0]?.id ?? '' });
  const [picking, setPicking] = useState(false);
  const groups = useCalendarGroups();
  const choices = groups.reduce((n, g) => n + 1 + g.others.length, 0);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    const start = new Date(`${date}T${time}`).getTime();
    setBusy(true);
    try {
      await api.createEvent({
        accountId: where.accountId,
        calendarId: where.calendarId,
        title: title.trim() || 'New event',
        startMs: start,
        endMs: start + mins * 60_000,
        addMeet: meet,
      });
      showToast({ text: 'Event created' });
      onCreated();
      onClose();
    } catch (e) {
      showToast({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet onClose={onClose}>
      <div style={{ padding: '8px 16px 20px' }}>
        <div
          className="row-flex"
          style={{ justifyContent: 'space-between', padding: '0 4px 10px' }}
        >
          <button style={{ color: 'var(--accent)', fontSize: 17 }} onClick={onClose}>
            Cancel
          </button>
          <b style={{ fontSize: 17 }}>New event</b>
          <button
            style={{ color: 'var(--accent)', fontSize: 17, fontWeight: 600 }}
            disabled={busy}
            onClick={() => void create()}
          >
            Add
          </button>
        </div>
        <div className="group" style={{ margin: 0, background: 'var(--sunken)' }}>
          <input
            className="gi"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        <div className="group" style={{ margin: '12px 0 0', background: 'var(--sunken)' }}>
          <label className="gi">
            Date
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={{ marginLeft: 'auto', textAlign: 'right' }}
            />
          </label>
          <label className="gi">
            Starts
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              style={{ marginLeft: 'auto', textAlign: 'right' }}
            />
          </label>
          <div className="gi">
            Length
            <div className="seg" style={{ marginLeft: 'auto', width: 190 }}>
              {[30, 60, 90].map((m) => (
                <button key={m} className={mins === m ? 'on' : ''} onClick={() => setMins(m)}>
                  {m < 60 ? `${m}m` : `${m / 60}h`}
                </button>
              ))}
            </div>
          </div>
          <div className="gi">
            <Video size={18} /> Google Meet link
            <Toggle on={meet} onChange={setMeet} label="Add Google Meet" />
          </div>
          {choices > 1 && (
            <>
              <button
                className="gi"
                style={{ width: '100%' }}
                aria-expanded={picking}
                onClick={() => setPicking(!picking)}
              >
                Calendar
                <span className="v">{pickLabel(groups, where)}</span>
              </button>
              {picking && (
                <div style={{ padding: '0 14px 10px' }}>
                  <CalendarChoice
                    groups={groups}
                    value={where}
                    onChange={(p, done) => (setWhere(p), done && setPicking(false))}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Sheet>
  );
}
