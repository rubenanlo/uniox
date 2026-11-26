import { Archive, Clock, MailOpen, Paperclip, Pin } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MobileThread } from '../data/types';
import { displayName, firstName, listTime } from '../lib/format';
import { go } from '../lib/router';
import { useStore } from '../lib/store';
import { Avatar, Highlight } from './ui';

/** Width of the two revealed buttons (Snooze + Archive). */
const OPEN = 150;
const READ_AT = 90;
const READ_MAX = 150;

/** Tomorrow 8:00, the default snooze. */
export function tomorrowMorning(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  return d.getTime();
}

/**
 * One inbox row. Swipe left to archive (a long swipe) or reveal snooze;
 * swipe right to toggle read. Tap opens the thread.
 */
export function ThreadRow({
  thread,
  query,
  accountColor,
  gist,
}: {
  thread: MobileThread;
  query?: string;
  accountColor?: string;
  /**
   * Priority rows: the AI's one-sentence gist replaces sender/subject/snippet.
   * `null` means the gist is still loading or unavailable (row shows the subject).
   */
  gist?: string | null;
}) {
  const act = useStore((s) => s.act);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const start = useRef<{
    x: number;
    y: number;
    base: number;
    locked: 'x' | 'y' | null;
    lx: number;
    lt: number;
    v: number;
  } | null>(null);
  const dragged = useRef(false);
  const unread = thread.unreadCount > 0;
  const width = () => wrap.current?.offsetWidth ?? 390;
  const fullAt = () => width() * 0.55;

  // Only one row stays open at a time, like Mail.
  useEffect(() => {
    const close = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== thread.id)
        setDx((d) => (d < 0 && d > -OPEN ? 0 : d));
    };
    window.addEventListener('trow:open', close);
    return () => window.removeEventListener('trow:open', close);
  }, [thread.id]);

  /** Slide the row off, fold its height away, then act (the list drops it). */
  const leave = (run: () => void) => {
    setLeaving(true);
    setDx(-width() - 40);
    setHeight(wrap.current?.offsetHeight ?? null);
    requestAnimationFrame(() => requestAnimationFrame(() => setHeight(0)));
    window.setTimeout(run, 420);
  };
  const archive = () => leave(() => void act(thread, { kind: 'archive' }, 'Archived'));
  const snooze = () =>
    leave(
      () =>
        void act(
          thread,
          { kind: 'snooze', until: tomorrowMorning() },
          'Snoozed until tomorrow 8:00',
        ),
    );

  const onDown = (e: React.PointerEvent) => {
    if (leaving) return;
    dragged.current = false;
    // The left edge belongs to the back gesture.
    if (e.pointerType === 'touch' && e.clientX <= 28 && dx === 0) return;
    start.current = {
      x: e.clientX,
      y: e.clientY,
      base: dx,
      locked: null,
      lx: e.clientX,
      lt: e.timeStamp,
      v: 0,
    };
  };
  const onMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (!s.locked && Math.hypot(mx, my) > 8) s.locked = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
    if (s.locked !== 'x') return;
    if (!dragging) {
      dragged.current = true;
      setDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
      window.dispatchEvent(new CustomEvent('trow:open', { detail: thread.id }));
    }
    const dt = Math.max(1, e.timeStamp - s.lt);
    s.v = 0.7 * ((e.clientX - s.lx) / dt) + 0.3 * s.v;
    s.lx = e.clientX;
    s.lt = e.timeStamp;
    const raw = s.base + mx;
    const W = width();
    // Rubber band past the ends, like UIKit.
    const band = (over: number) => over * 0.35;
    setDx(raw < -W ? -W - band(-W - raw) : raw > READ_MAX ? READ_MAX + band(raw - READ_MAX) : raw);
  };
  const onUp = () => {
    const s = start.current;
    start.current = null;
    setDragging(false);
    if (!s || s.locked !== 'x') return;
    const v = s.v; // px per ms; negative = flick left
    if (dx < 0) {
      if (dx <= -fullAt() || (v < -1.1 && dx < -OPEN * 0.6)) archive();
      else if (v > 0.35) setDx(0);
      else if (dx <= -OPEN / 2 || v < -0.35) setDx(-OPEN);
      else setDx(0);
    } else {
      if (dx >= READ_AT) void act(thread, { kind: 'read', read: unread });
      setDx(0);
    }
  };

  const left = Math.max(0, -dx);
  const armed = left >= fullAt();
  const readArmed = dx >= READ_AT;
  const reveal = Math.min(1, left / 70);
  const spring = leaving
    ? 'transform .32s cubic-bezier(.4,0,.6,1)'
    : 'transform .42s cubic-bezier(.2,1.15,.35,1)';

  return (
    <div
      className="trow"
      ref={wrap}
      style={
        height === null
          ? undefined
          : { height, transition: 'height .26s cubic-bezier(.4,0,.2,1) .14s' }
      }
    >
      {
        <div
          className="trow-read"
          style={{
            width: Math.max(0, dx),
            transition: dragging ? 'none' : 'width .42s cubic-bezier(.2,1.15,.35,1)',
          }}
        >
          <span className={readArmed ? 'pop' : ''}>
            <MailOpen size={22} />
            <small>{unread ? 'Read' : 'Unread'}</small>
          </span>
        </div>
      }
      {
        <div
          className="trow-acts"
          style={{
            width: left,
            transition: dragging ? 'none' : `width .42s cubic-bezier(.2,1.15,.35,1)`,
          }}
        >
          <button
            className="trow-snooze"
            style={{ flexBasis: armed || leaving ? '0%' : '50%' }}
            onClick={snooze}
            aria-label="Snooze until tomorrow"
          >
            <span style={{ opacity: reveal, transform: `scale(${0.6 + 0.4 * reveal})` }}>
              <Clock size={22} />
              <small>Snooze</small>
            </span>
          </button>
          <button
            className={`trow-archive ${armed || leaving ? 'armed' : ''}`}
            style={{ flexBasis: armed || leaving ? '100%' : '50%' }}
            onClick={archive}
            aria-label="Archive"
          >
            <span style={{ opacity: reveal, transform: `scale(${0.6 + 0.4 * reveal})` }}>
              <Archive size={22} />
              <small>Archive</small>
            </span>
          </button>
        </div>
      }
      <div
        className={`row ${unread ? 'unread' : ''}`}
        style={{
          transform: `translate3d(${dx}px,0,0)`,
          transition: dragging ? 'none' : spring,
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onClick={() => {
          if (dragged.current) {
            dragged.current = false;
            return;
          }
          if (dx !== 0) {
            setDx(0);
            return;
          }
          go(`thread/${encodeURIComponent(thread.id)}`);
        }}
      >
        {gist !== undefined ? (
          <GistBody thread={thread} gist={gist} accountColor={accountColor} />
        ) : (
          <>
            {/* Rounded-square face; the account shows as a thin ring in its colour. */}
            <span
              className="row-av"
              style={accountColor ? { borderColor: accountColor } : undefined}
            >
              <Avatar who={thread.lastFrom} />
            </span>
            <div className="meta">
              <div className="top">
                {unread && <span className="unread-dot" />}
                <span className="from">
                  <Highlight text={displayName(thread.lastFrom)} query={query ?? ''} />
                </span>
                {thread.messageCount > 1 && (
                  <span className="faint" style={{ fontSize: 13 }}>
                    {thread.messageCount}
                  </span>
                )}
                <span className="time">
                  {thread.pinned && <Pin size={12} color="var(--priority)" />}
                  {thread.hasAttachments && <Paperclip size={12} />}
                  {listTime(thread.lastMessageAt)}
                </span>
              </div>
              <div className="subj">
                <Highlight text={thread.subject || '(no subject)'} query={query ?? ''} />
              </div>
              <div className="snip">
                <Highlight text={thread.snippet} query={query ?? ''} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** A priority row: one plain sentence of what the email wants, then a quiet meta line. */
function GistBody({
  thread,
  gist,
  accountColor,
}: {
  thread: MobileThread;
  gist: string | null;
  accountColor?: string;
}) {
  const name = firstName(thread.lastFrom);
  const lead = gist && name && gist.startsWith(name) ? name : '';
  const unread = thread.unreadCount > 0;
  return (
    <>
      <span
        className={`gist-mk ${unread ? 'on' : ''}`}
        aria-label={unread ? 'Unread' : undefined}
      />
      <div className="meta">
        <div className="gist-tx">
          {gist ? (
            <>
              {lead && <b>{lead}</b>}
              {gist.slice(lead.length)}
            </>
          ) : (
            <>
              <b>{displayName(thread.lastFrom)}</b>: {thread.subject || '(no subject)'}
            </>
          )}
        </div>
        <div className="gist-meta">
          {gist && <span className="ai-tag">AI</span>}
          {accountColor && (
            <span className="swatch" style={{ background: accountColor, width: 7, height: 7 }} />
          )}
          <span className="gist-sub">{gist ? thread.subject : thread.snippet}</span>
          <span className="gist-time">
            {thread.hasAttachments && <Paperclip size={11} />}
            {listTime(thread.lastMessageAt)}
            {thread.messageCount > 1 ? ` · ${thread.messageCount}` : ''}
          </span>
        </div>
      </div>
    </>
  );
}
