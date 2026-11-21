import {
  Bell,
  Check,
  ChevronLeft,
  ChevronRight,
  HelpCircle,
  MapPin,
  Text,
  Users,
  Video,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MobileEvent, RsvpAnswer } from '../data/types';
import { AiMark, AvatarStack, CloseButton, Sheet, TabBar, Toggle } from '../components/ui';
import {
  addDays,
  clock,
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

type View = 'day' | 'week' | 'list';
const HOUR = 56;
const FIRST_HOUR = 7;
const LAST_HOUR = 21;

export function CalendarScreen() {
  const { api, threads } = useStore();
  const route = useRoute();
  const view = (route.query.get('view') as View) || 'day';
  const now = useNow();
  const [day, setDay] = useState(() => startOfDay(now));
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const openId = route.query.get('event');
  const creating = route.query.has('new');
  const touch = useRef<number | null>(null);

  const range = useMemo(() => {
    const ws = startOfWeek(day);
    return view === 'list'
      ? [startOfDay(now), addDays(startOfDay(now), 30)]
      : [addDays(ws, -7), addDays(ws, 14)];
  }, [day, view, now]);

  const load = useCallback(
    () => void api.events(range[0]!, range[1]!).then(setEvents),
    [api, range],
  );
  useEffect(load, [load, threads]);

  const setView = (v: View) => go(`calendar?view=${v}`, true);
  const step = (n: number) => setDay((d) => addDays(d, view === 'week' ? 7 * n : n));
  const open = events.find((e) => e.id === openId);
  const week = Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(day), i));
  const dayEvents = events.filter((e) => e.startMs < addDays(day, 1) && e.endMs > day);
  const clashes = dayEvents.filter(
    (a) =>
      !a.free &&
      !a.allDay &&
      dayEvents.some(
        (b) => b !== a && !b.free && !b.allDay && a.startMs < b.endMs && b.startMs < a.endMs,
      ),
  ).length;

  const title =
    view === 'week'
      ? `${new Date(week[0]!).toLocaleDateString([], { month: 'short', day: 'numeric' })} – ${new Date(week[6]!).toLocaleDateString([], { day: 'numeric' })}`
      : new Date(day).toLocaleDateString([], { month: 'long' });

  return (
    <>
      <div
        className="screen"
        onTouchStart={(e) => (touch.current = e.touches[0]?.clientX ?? null)}
        onTouchEnd={(e) => {
          const x0 = touch.current;
          const x1 = e.changedTouches[0]?.clientX;
          touch.current = null;
          if (view !== 'list' && x0 != null && x1 != null && Math.abs(x1 - x0) > 70)
            step(x1 < x0 ? 1 : -1);
        }}
      >
        <div
          style={{
            position: 'sticky',
            top: 'calc(-1 * var(--safe-top))',
            paddingTop: 'var(--safe-top)',
            marginTop: 'calc(-1 * var(--safe-top))',
            zIndex: 10,
            background: 'var(--app)',
          }}
        >
          <div className="navbar">
            <button
              className="row-flex"
              style={{ paddingLeft: 6 }}
              onClick={() => setDay(startOfDay(now))}
            >
              <span className="bigtitle" style={{ fontSize: 26 }}>
                {title}
              </span>
            </button>
            <div className="pill-seg glass-flat">
              {(['day', 'week', 'list'] as View[]).map((v) => (
                <button
                  key={v}
                  className={view === v ? 'on' : ''}
                  onClick={() => setView(v)}
                  style={{ textTransform: 'capitalize' }}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {view !== 'list' && (
            <div
              className="row-flex"
              style={{ padding: '6px 4px 10px', borderBottom: '1px solid var(--hair)', gap: 0 }}
            >
              <button
                className="navbtn"
                aria-label="Previous"
                onClick={() => step(-1)}
                style={{ minWidth: 26 }}
              >
                <ChevronLeft size={18} color="var(--faint)" />
              </button>
              {week.map((d) => {
                const isSel = view === 'day' && d === day;
                const isToday = d === startOfDay(now);
                const count = events.filter(
                  (e) => !e.allDay && e.startMs >= d && e.startMs < addDays(d, 1),
                ).length;
                return (
                  <button
                    key={d}
                    style={{ flex: 1, textAlign: 'center' }}
                    onClick={() => (setDay(d), view === 'week' && setView('day'))}
                  >
                    <div style={{ fontSize: 11, color: 'var(--faint)', fontWeight: 600 }}>
                      {new Date(d).toLocaleDateString([], { weekday: 'narrow' })}
                    </div>
                    <div
                      style={{
                        margin: '5px auto 0',
                        width: 34,
                        height: 34,
                        borderRadius: 17,
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 16,
                        fontWeight: isSel || isToday ? 700 : 500,
                        background: isSel ? 'var(--accent)' : 'transparent',
                        color: isSel ? 'var(--on-accent)' : isToday ? 'var(--accent)' : undefined,
                      }}
                    >
                      {new Date(d).getDate()}
                    </div>
                    <div
                      style={{
                        display: 'flex',
                        gap: 2,
                        justifyContent: 'center',
                        marginTop: 4,
                        height: 5,
                      }}
                    >
                      {Array.from({ length: Math.min(4, count) }, (_, i) => (
                        <span
                          key={i}
                          style={{
                            width: 4,
                            height: 4,
                            borderRadius: 2,
                            background: 'var(--faint)',
                          }}
                        />
                      ))}
                    </div>
                  </button>
                );
              })}
              <button
                className="navbtn"
                aria-label="Next"
                onClick={() => step(1)}
                style={{ minWidth: 26 }}
              >
                <ChevronRight size={18} color="var(--faint)" />
              </button>
            </div>
          )}

          {view === 'day' && (
            <>
              <div className="row-flex muted" style={{ padding: '8px 18px', fontSize: 13 }}>
                <b style={{ color: 'var(--ink)' }}>{dayLabel(day)}</b> ·{' '}
                {dayEvents.filter((e) => !e.allDay).length} events
                {clashes > 0 && <span style={{ color: 'var(--danger)' }}>· {clashes} clash</span>}
              </div>
              <AllDay events={dayEvents} />
            </>
          )}
        </div>
        {view === 'day' && (
          <>
            <DayGrid day={day} events={dayEvents.filter((e) => !e.allDay)} now={now} />
          </>
        )}
        {view === 'week' && <WeekGrid week={week} events={events} now={now} />}
        {view === 'list' && <ListView events={events} now={now} />}
      </div>
      <TabBar on="calendar" fab="event" />
      {open && (
        <EventSheet ev={open} onClose={() => go(`calendar?view=${view}`, true)} onChanged={load} />
      )}
      {creating && (
        <NewEventSheet
          day={day}
          onClose={() => go(`calendar?view=${view}`, true)}
          onCreated={load}
        />
      )}
    </>
  );
}

function AllDay({ events }: { events: MobileEvent[] }) {
  const all = events.filter((e) => e.allDay);
  if (!all.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 14px 8px 62px' }}>
      {all.map((e) => (
        <button
          key={e.id}
          onClick={() => go(`calendar?event=${encodeURIComponent(e.id)}`, true)}
          style={{
            borderRadius: 6,
            background: `color-mix(in srgb, ${e.color} 20%, transparent)`,
            fontSize: 12,
            fontWeight: 600,
            padding: '3px 8px',
          }}
        >
          {e.title}
        </button>
      ))}
    </div>
  );
}

/** Lays overlapping events side by side. */
function columns(evs: MobileEvent[]): Map<string, { col: number; cols: number }> {
  const sorted = [...evs].sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs);
  const out = new Map<string, { col: number; cols: number }>();
  let cluster: MobileEvent[] = [];
  let clusterEnd = 0;
  const flush = () => {
    const cols: number[] = [];
    const assigned: [MobileEvent, number][] = [];
    for (const e of cluster) {
      let c = cols.findIndex((end) => end <= e.startMs);
      if (c < 0) c = cols.length;
      cols[c] = e.endMs;
      assigned.push([e, c]);
    }
    for (const [e, c] of assigned) out.set(e.id, { col: c, cols: cols.length });
    cluster = [];
  };
  for (const e of sorted) {
    if (cluster.length && e.startMs >= clusterEnd) flush();
    cluster.push(e);
    clusterEnd = Math.max(clusterEnd, e.endMs);
  }
  flush();
  return out;
}

function DayGrid({ day, events, now }: { day: number; events: MobileEvent[]; now: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const layout = columns(events);
  const top = (ms: number) => ((ms - day) / 3_600_000 - FIRST_HOUR) * HOUR;
  useEffect(() => {
    const target = Math.max(0, top(startOfDay(now) === day ? now : day + 8 * 3_600_000) - 120);
    ref.current?.closest('.screen')?.scrollTo({ top: target });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day]);
  return (
    <div
      ref={ref}
      style={{
        position: 'relative',
        height: (LAST_HOUR - FIRST_HOUR + 1) * HOUR,
        margin: '6px 0 20px',
      }}
    >
      {Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => (
        <div
          key={i}
          className="row-flex"
          style={{ position: 'absolute', top: i * HOUR, left: 0, right: 0, gap: 8 }}
        >
          <span className="faint" style={{ width: 50, textAlign: 'right', fontSize: 11.5 }}>
            {FIRST_HOUR + i}:00
          </span>
          <div style={{ flex: 1, borderTop: '1px solid var(--hair)' }} />
        </div>
      ))}
      {events.map((e) => {
        const l = layout.get(e.id) ?? { col: 0, cols: 1 };
        const t = Math.max(0, top(e.startMs));
        const h = Math.max(24, top(e.endMs) - t - 3);
        const width = `calc((100% - 76px) / ${l.cols})`;
        return (
          <button
            key={e.id}
            className={`ev ${e.free ? 'free' : ''}`}
            onClick={() => go(`calendar?event=${encodeURIComponent(e.id)}`, true)}
            style={{
              top: t + 2,
              height: h,
              left: `calc(62px + ${width} * ${l.col})`,
              width: `calc(${width} - 4px)`,
              background: `color-mix(in srgb, ${e.color} 15%, var(--surface))`,
              borderColor: e.free ? 'var(--faint)' : e.color,
              opacity: e.myAnswer === null && !e.free ? 0.75 : 1,
              borderStyle: e.myAnswer === 'tentative' ? 'dashed' : 'solid',
            }}
          >
            <b className="ellipsis">{e.title}</b>
            {h > 36 && (
              <span className="muted">
                {clock(e.startMs)} – {clock(e.endMs)}
                {e.location ? ` · ${e.location}` : e.meetingUrl ? ' · Meet' : ''}
              </span>
            )}
          </button>
        );
      })}
      {startOfDay(now) === day && (
        <div
          className="row-flex"
          style={{
            position: 'absolute',
            top: top(now),
            left: 52,
            right: 0,
            gap: 0,
            zIndex: 3,
            pointerEvents: 'none',
          }}
        >
          <span style={{ width: 10, height: 10, borderRadius: 5, background: 'var(--danger)' }} />
          <div style={{ flex: 1, borderTop: '2px solid var(--danger)' }} />
        </div>
      )}
    </div>
  );
}

function WeekGrid({ week, events, now }: { week: number[]; events: MobileEvent[]; now: number }) {
  return (
    <div
      style={{
        position: 'relative',
        height: (LAST_HOUR - FIRST_HOUR + 1) * HOUR,
        margin: '6px 0 20px',
      }}
    >
      {Array.from({ length: LAST_HOUR - FIRST_HOUR + 1 }, (_, i) => (
        <div
          key={i}
          className="row-flex"
          style={{ position: 'absolute', top: i * HOUR, left: 0, right: 0, gap: 4 }}
        >
          <span className="faint" style={{ width: 30, textAlign: 'right', fontSize: 10.5 }}>
            {FIRST_HOUR + i}
          </span>
          <div style={{ flex: 1, borderTop: '1px solid var(--hair)' }} />
        </div>
      ))}
      <div
        style={{
          position: 'absolute',
          inset: '0 2px 0 36px',
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
        }}
      >
        {week.map((d, i) => {
          const evs = events.filter(
            (e) => !e.allDay && e.startMs >= d && e.startMs < addDays(d, 1),
          );
          const lay = columns(evs);
          const weekend = new Date(d).getDay() % 6 === 0;
          return (
            <div
              key={d}
              style={{
                position: 'relative',
                borderLeft: i
                  ? '1px solid color-mix(in srgb, var(--hair) 60%, transparent)'
                  : undefined,
                background: weekend
                  ? 'color-mix(in srgb, var(--sunken) 50%, transparent)'
                  : undefined,
              }}
            >
              {evs.map((e) => {
                const l = lay.get(e.id) ?? { col: 0, cols: 1 };
                const t = ((e.startMs - d) / 3_600_000 - FIRST_HOUR) * HOUR;
                const h = Math.max(18, ((e.endMs - e.startMs) / 3_600_000) * HOUR - 3);
                return (
                  <button
                    key={e.id}
                    onClick={() => go(`calendar?view=week&event=${encodeURIComponent(e.id)}`, true)}
                    style={{
                      position: 'absolute',
                      top: Math.max(0, t) + 2,
                      height: h,
                      left: `${(l.col / l.cols) * 100}%`,
                      width: `calc(${100 / l.cols}% - 3px)`,
                      marginLeft: 1.5,
                      borderRadius: 6,
                      background: `color-mix(in srgb, ${e.free ? 'var(--faint)' : e.color} 22%, var(--surface))`,
                      borderLeft: `3px solid ${e.free ? 'var(--faint)' : e.color}`,
                      fontSize: 10,
                      fontWeight: 600,
                      padding: '3px 3px',
                      overflow: 'hidden',
                      lineHeight: 1.2,
                      textAlign: 'left',
                    }}
                  >
                    {e.title}
                  </button>
                );
              })}
              {startOfDay(now) === d && (
                <div
                  style={{
                    position: 'absolute',
                    top: ((now - d) / 3_600_000 - FIRST_HOUR) * HOUR,
                    left: 0,
                    right: 0,
                    borderTop: '2px solid var(--danger)',
                    zIndex: 3,
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
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
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const create = async () => {
    const start = new Date(`${date}T${time}`).getTime();
    setBusy(true);
    try {
      await api.createEvent({
        accountId,
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
          {accounts.length > 1 && (
            <label className="gi" style={{ position: 'relative' }}>
              Calendar
              <span className="v">{accounts.find((a) => a.id === accountId)?.email}</span>
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                style={{ position: 'absolute', inset: 0, opacity: 0 }}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </div>
    </Sheet>
  );
}
