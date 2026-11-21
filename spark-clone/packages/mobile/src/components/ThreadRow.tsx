import { Archive, Clock, MailOpen, Paperclip, Pin } from 'lucide-react';
import { useRef, useState } from 'react';
import type { MobileThread } from '../data/types';
import { displayName, listTime } from '../lib/format';
import { go } from '../lib/router';
import { useStore } from '../lib/store';
import { Avatar, Highlight } from './ui';

const ARCHIVE_AT = 110;
const READ_AT = 90;

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
}: {
  thread: MobileThread;
  query?: string;
  accountColor?: string;
}) {
  const act = useStore((s) => s.act);
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number; locked: 'x' | 'y' | null } | null>(null);
  const unread = thread.unreadCount > 0;

  const onDown = (e: React.PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY, locked: null };
  };
  const onMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (!s.locked && Math.hypot(mx, my) > 8) s.locked = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
    if (s.locked !== 'x') return;
    setDragging(true);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    setDx(Math.max(-220, Math.min(140, mx)));
  };
  const onUp = () => {
    const s = start.current;
    start.current = null;
    if (!s || s.locked !== 'x') {
      setDx(0);
      setDragging(false);
      return;
    }
    setDragging(false);
    if (dx <= -ARCHIVE_AT * 1.6) {
      setDx(-500);
      void act(thread, { kind: 'archive' }, 'Archived');
    } else if (dx <= -60) {
      setDx(-150); // reveal snooze + archive buttons
    } else if (dx >= READ_AT) {
      setDx(0);
      void act(thread, { kind: 'read', read: unread });
    } else setDx(0);
  };

  return (
    <div className="trow">
      <div className="trow-actions">
        <div style={{ background: 'var(--accent)', width: '50%', color: 'var(--on-accent)' }}>
          <MailOpen size={20} /> {unread ? 'Read' : 'Unread'}
        </div>
        <div style={{ width: '50%', justifyContent: 'flex-end', padding: 0 }}>
          <button
            style={{
              width: 75,
              height: '100%',
              background: '#e8a33a',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
            }}
            onClick={() =>
              void act(
                thread,
                { kind: 'snooze', until: tomorrowMorning() },
                'Snoozed until tomorrow 8:00',
              )
            }
            aria-label="Snooze until tomorrow"
          >
            <Clock size={20} />
          </button>
          <button
            style={{
              width: 75,
              height: '100%',
              background: '#34a853',
              color: '#fff',
              display: 'grid',
              placeItems: 'center',
            }}
            onClick={() => void act(thread, { kind: 'archive' }, 'Archived')}
            aria-label="Archive"
          >
            <Archive size={20} />
          </button>
        </div>
      </div>
      <div
        className={`row ${unread ? 'unread' : ''}`}
        style={{
          transform: `translateX(${dx}px)`,
          transition: dragging ? 'none' : 'transform .25s cubic-bezier(.2,.8,.2,1)',
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onClick={() => {
          if (dx !== 0) {
            setDx(0);
            return;
          }
          go(`thread/${encodeURIComponent(thread.id)}`);
        }}
      >
        <Avatar who={thread.lastFrom} />
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
            {accountColor && (
              <span className="swatch" style={{ background: accountColor, width: 7, height: 7 }} />
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
      </div>
    </div>
  );
}
