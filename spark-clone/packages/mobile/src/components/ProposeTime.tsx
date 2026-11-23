import { ChevronLeft, ChevronRight } from 'lucide-react';
import { type PointerEvent as RPointerEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { InviteInfo } from '../data/types';
import { addDays, firstName, startOfDay, startOfWeek } from '../lib/format';
import { useStore } from '../lib/store';
import { createPortal } from 'react-dom';
import { Sheet, Spinner } from './ui';
import './propose.css';

const H0 = 8; // first hour shown
const H1 = 19; // last hour shown (exclusive)
const PX = 44; // pixels per hour
const WORK0 = 9;
const WORK1 = 18;
type Block = { startMs: number; endMs: number };

const hourLabel = (h: number) => {
  const hh = Math.floor(h);
  const m = Math.round((h - hh) * 60);
  const ampm = hh < 12 ? 'AM' : 'PM';
  const h12 = hh % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${ampm}` : `${h12} ${ampm}`;
};
const at = (day: number, h: number) => day + h * 3_600_000; // day = local midnight
const hourOf = (day: number, ms: number) => (ms - day) / 3_600_000;

/**
 * Propose a new time for an invite, like Gmail: one day at a time with
 * everyone's availability, weekends and past days greyed out, swipe for the
 * next or previous day, tap a time and drag it with a finger. Sends the
 * organizer a proposal Google Calendar shows on the event.
 */
export function ProposeTime({
  invite,
  accountId,
  onClose,
  onSent,
}: {
  invite: InviteInfo;
  accountId: string;
  onClose: () => void;
  onSent?: () => void;
}) {
  const { api, showToast } = useStore();
  const durH = Math.min(4, Math.max(0.5, (invite.endMs - invite.startMs) / 3_600_000 || 1));
  const nowMs = Date.now();
  const today = startOfDay(nowMs);
  const firstWorkday = (() => {
    let d = startOfDay(Math.max(nowMs, invite.startMs));
    const late = hourOf(d, nowMs) > WORK1 - durH;
    if (d === today && late) d = addDays(d, 1);
    while ([0, 6].includes(new Date(d).getDay())) d = addDays(d, 1);
    return d;
  })();
  const [day, setDay] = useState(firstWorkday);
  const [anim, setAnim] = useState('');
  const [pick, setPick] = useState<number | null>(null); // start hour on `day`
  const [busy, setBusy] = useState<{ me: string; busy: Record<string, Block[] | null> } | null>(
    null,
  );
  const [sending, setSending] = useState(false);
  const week = startOfWeek(day);

  const people = useMemo(() => {
    const all = [invite.organizer, ...invite.guests].filter(Boolean) as {
      email: string;
      name?: string;
    }[];
    const seen = new Set<string>();
    return all.filter((p) => !seen.has(p.email.toLowerCase()) && seen.add(p.email.toLowerCase()));
  }, [invite]);

  useEffect(() => {
    let live = true;
    void api
      .freeBusy(
        accountId,
        people.map((p) => p.email),
        week,
        addDays(week, 7),
      )
      .then((r) => live && setBusy(r))
      .catch(() => live && setBusy({ me: '', busy: {} }));
    return () => {
      live = false;
    };
  }, [api, accountId, people, week]);

  const nameOf = (email: string) => {
    if (busy && email === busy.me) return 'You';
    const p = people.find((x) => x.email.toLowerCase() === email);
    return firstName(p ?? { email, name: '' }) || email;
  };
  const hidden = busy
    ? Object.entries(busy.busy)
        .filter(([, v]) => v === null)
        .map(([e]) => nameOf(e))
    : [];

  // Busy blocks on this day, merged, labelled with who is busy.
  const dayBusy = useMemo(() => {
    if (!busy) return [];
    const out: { a: number; b: number; who: string[] }[] = [];
    for (const [email, blocks] of Object.entries(busy.busy)) {
      for (const bl of blocks ?? []) {
        const a = Math.max(H0, hourOf(day, bl.startMs));
        const b = Math.min(H1, hourOf(day, bl.endMs));
        if (b <= a) continue;
        const hit = out.find((o) => a < o.b && b > o.a);
        if (hit) {
          hit.a = Math.min(hit.a, a);
          hit.b = Math.max(hit.b, b);
          if (!hit.who.includes(nameOf(email))) hit.who.push(nameOf(email));
        } else out.push({ a, b, who: [nameOf(email)] });
      }
    }
    return out.sort((x, y) => x.a - y.a);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, day]);

  const past = day < today;
  const isToday = day === today;
  const nowH = hourOf(day, nowMs);
  const earliest = isToday ? Math.ceil(nowH * 2) / 2 : H0;
  const free = useMemo(() => {
    if (past || !busy) return [] as [number, number][];
    const out: [number, number][] = [];
    let t = Math.max(WORK0, earliest);
    for (const b of dayBusy) {
      if (b.a > t && b.a <= WORK1) out.push([t, Math.min(b.a, WORK1)]);
      t = Math.max(t, b.b);
    }
    if (t < WORK1) out.push([t, WORK1]);
    return out.filter(([a, b]) => b - a >= 0.5);
  }, [dayBusy, past, busy, earliest]);
  const clash = (h: number) => dayBusy.some((b) => h < b.b && h + durH > b.a);

  const shift = (dir: 1 | -1) => {
    let d = day;
    do d = addDays(d, dir);
    while ([0, 6].includes(new Date(d).getDay()));
    if (d < today && dir < 0) return;
    setAnim(dir > 0 ? 'slide-l' : 'slide-r');
    setDay(d);
    setPick(null);
  };
  const jumpWeek = (dir: 1 | -1) => {
    const d = addDays(week, dir * 7);
    const target = d < today ? firstWorkday : d;
    if (startOfWeek(target) === week) return;
    setAnim(dir > 0 ? 'slide-l' : 'slide-r');
    setDay(target);
    setPick(null);
  };

  // Horizontal swipe on the grid changes the day.
  const sw = useRef<{ x: number; y: number } | null>(null);
  // Dragging the pick moves it in half hours.
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const [dragH, setDragH] = useState<number | null>(null);
  const clampH = (h: number) => Math.max(earliest, Math.min(H1 - durH, Math.round(h * 2) / 2));

  const onGridDown = (e: RPointerEvent) => {
    if ((e.target as HTMLElement).closest('.pc-pick')) return;
    sw.current = { x: e.clientX, y: e.clientY };
  };
  const onGridUp = (e: RPointerEvent) => {
    const s = sw.current;
    sw.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      shift(dx < 0 ? 1 : -1);
      return;
    }
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8 && !past) {
      const col = (e.currentTarget as HTMLElement)
        .querySelector('.pc-col')!
        .getBoundingClientRect();
      const y = e.clientY - col.top;
      if (y < 0) return;
      const h = clampH(H0 + y / PX - durH / 2);
      setPick(h);
    }
  };

  const shownH = dragH ?? pick;
  const bad = shownH != null && clash(shownH);
  const send = async () => {
    if (pick == null || !invite.eventId) return;
    setSending(true);
    const start = at(day, pick);
    const end = start + durH * 3_600_000;
    const label = `${new Date(start).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}, ${hourLabel(pick)} – ${hourLabel(pick + durH)}`;
    try {
      await api.proposeTime(invite.eventId, start, end, label);
      showToast({
        text: `Proposed. ${firstName(invite.organizer) || 'The organizer'} sees it in Google Calendar`,
      });
      onSent?.();
      onClose();
    } catch (e) {
      showToast({ text: (e as Error).message });
      setSending(false);
    }
  };

  const wkLabel = `${new Date(week).getDate()} – ${new Date(addDays(week, 4)).toLocaleDateString([], { day: 'numeric', month: 'long' })}`;
  return createPortal(
    <Sheet onClose={onClose} full>
      <div className="pc">
        <div className="eyebrow">Propose a new time · {wkLabel}</div>
        <h3>{invite.title}</h3>
        <div className="pc-wk">
          <button
            className="nav"
            aria-label="Previous week"
            disabled={week <= startOfWeek(today)}
            onClick={() => jumpWeek(-1)}
          >
            <ChevronLeft size={16} />
          </button>
          <div className="pc-days">
            {Array.from({ length: 7 }, (_, i) => {
              const d = addDays(week, i);
              const off = d < today || i > 4;
              return (
                <button
                  key={i}
                  className={`pc-d ${off ? 'off' : ''} ${d === today ? 'today' : ''} ${d === day ? 'sel' : ''}`}
                  disabled={off}
                  onClick={() => {
                    setAnim(d > day ? 'slide-l' : 'slide-r');
                    setDay(d);
                    setPick(null);
                  }}
                >
                  {new Date(d).toLocaleDateString([], { weekday: 'short' })}
                  <b>{new Date(d).getDate()}</b>
                </button>
              );
            })}
          </div>
          <button className="nav" aria-label="Next week" onClick={() => jumpWeek(1)}>
            <ChevronRight size={16} />
          </button>
        </div>
        <div className="pc-title">
          {new Date(day).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}
          <span>
            {!busy
              ? 'Loading…'
              : past
                ? 'This day has passed'
                : free.length
                  ? 'Blue: everyone’s free'
                  : 'No shared free time'}
          </span>
        </div>
        <div
          key={day}
          className={`pc-grid ${anim}`}
          onPointerDown={onGridDown}
          onPointerUp={onGridUp}
          onAnimationEnd={() => setAnim('')}
        >
          {Array.from({ length: H1 - H0 }, (_, k) => (
            <div key={k} className="pc-hr" style={{ gridRow: k + 1 }}>
              {hourLabel(H0 + k)}
            </div>
          ))}
          <div
            className="pc-col"
            style={{ height: (H1 - H0) * PX, gridRow: `1 / span ${H1 - H0}` }}
          >
            {!busy && (
              <div className="pc-load">
                <Spinner />
              </div>
            )}
            {free.map(([a, b]) => (
              <span
                key={a}
                className="pc-free"
                style={{ top: (a - H0) * PX + 2, height: (b - a) * PX - 4 }}
              />
            ))}
            {dayBusy.map((b) => (
              <span
                key={b.a}
                className="pc-busy"
                style={{ top: (b.a - H0) * PX + 2, height: Math.max(20, (b.b - b.a) * PX - 4) }}
              >
                Busy
                {b.b - b.a >= 0.75 ? (
                  <span>
                    {b.who.join(' and ')} · {hourLabel(b.a)}
                  </span>
                ) : (
                  ` · ${b.who.join(', ')}`
                )}
              </span>
            ))}
            {past && <span className="pc-past" style={{ height: '100%' }} />}
            {isToday && nowH > H0 && (
              <>
                <span className="pc-past" style={{ height: Math.min(H1 - H0, nowH - H0) * PX }} />
                {nowH < H1 && <span className="pc-now" style={{ top: (nowH - H0) * PX }} />}
              </>
            )}
            {shownH != null && (
              <button
                className={`pc-pick ${dragH != null ? 'drag' : ''} ${bad ? 'bad' : ''}`}
                style={{ top: (shownH - H0) * PX + 2, height: durH * PX - 4 }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drag.current = { y: e.clientY, h: shownH, moved: false };
                }}
                onPointerMove={(e) => {
                  const g = drag.current;
                  if (!g) return;
                  const dy = e.clientY - g.y;
                  if (Math.abs(dy) > 4) g.moved = true;
                  if (g.moved) setDragH(clampH(g.h + dy / PX));
                }}
                onPointerUp={(e) => {
                  e.stopPropagation();
                  if (drag.current?.moved && dragH != null) setPick(dragH);
                  drag.current = null;
                  setDragH(null);
                }}
                onPointerCancel={() => {
                  drag.current = null;
                  setDragH(null);
                }}
              >
                {hourLabel(shownH)} – {hourLabel(shownH + durH)}
              </button>
            )}
          </div>
        </div>
        <div className="pc-foot">
          <div className="pc-leg">
            <span>
              <i className="f" />
              Everyone’s free
            </span>
            <span>
              <i className="p" />
              Your pick
            </span>
            <span style={{ marginLeft: 'auto' }}>Swipe for other days</span>
          </div>
          {hidden.length > 0 && (
            <div className="pc-hidden">
              Can’t see{' '}
              {hidden.length === 1
                ? `${hidden[0]}’s calendar`
                : `the calendars of ${hidden.slice(0, -1).join(', ')} and ${hidden[hidden.length - 1]}`}
              .
            </div>
          )}
          <button
            className="pc-send"
            disabled={pick == null || sending || bad || !invite.eventId}
            onClick={() => void send()}
          >
            {sending
              ? 'Sending…'
              : pick == null
                ? `Tap a time (${durH === 1 ? '1 hour' : `${durH} h`}, like the meeting)`
                : bad
                  ? 'Someone is busy then'
                  : `Propose ${new Date(day).toLocaleDateString([], { weekday: 'short' })} ${new Date(day).getDate()} · ${hourLabel(pick)} – ${hourLabel(pick + durH)}`}
          </button>
        </div>
      </div>
    </Sheet>,
    document.body,
  );
}
