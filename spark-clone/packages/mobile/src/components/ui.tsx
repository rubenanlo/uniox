import type { Address } from '@app/shared';
import { Calendar, Home, Inbox, PenLine, Plus, Search, Sparkles, X } from 'lucide-react';
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react';
import { avatarColor, clock12, initials } from '../lib/format';
import { go } from '../lib/router';
import { useStore } from '../lib/store';

export function Avatar({ who, size = 40 }: { who: Address | null | undefined; size?: number }) {
  return (
    <div
      className="av"
      style={{ width: size, height: size, fontSize: size * 0.33, background: avatarColor(who) }}
    >
      {initials(who)}
    </div>
  );
}

export function AvatarStack({ people, size = 26 }: { people: Address[]; size?: number }) {
  return (
    <div style={{ display: 'flex' }}>
      {people.slice(0, 4).map((p, i) => (
        <div
          key={p.email}
          style={{
            marginLeft: i ? -size * 0.3 : 0,
            border: '2px solid var(--surface)',
            borderRadius: '50%',
          }}
        >
          <Avatar who={p} size={size} />
        </div>
      ))}
    </div>
  );
}

export function AiMark({ size = 26 }: { size?: number }) {
  return (
    <span className="ai-mark" style={{ width: size, height: size, borderRadius: size * 0.31 }}>
      <Sparkles size={size * 0.58} strokeWidth={2} />
    </span>
  );
}

export type Tab = 'home' | 'inbox' | 'calendar' | 'search';

/**
 * Bottom navigation: a small glass handle where the home bar sits. Tap it or
 * drag it up and a glass dock unfolds with Home, Inbox, Calendar, Search and
 * the screen's main action (Write, or New event on Calendar). Tapping outside,
 * Esc, or pulling the dock down folds it away.
 */
export function TabBar({ on, fab = 'compose' }: { on: Tab; fab?: 'compose' | 'event' }) {
  const unread = useStore((s) => s.threads.some((t) => t.unreadCount > 0 && t.priority));
  const [open, setOpen] = useState(false);
  const drag = useRef<{ y: number; moved: boolean } | null>(null);
  const handleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open]);
  const tabs: [Tab, string, typeof Home][] = [
    ['home', 'Home', Home],
    ['inbox', 'Inbox', Inbox],
    ['calendar', 'Calendar', Calendar],
    ['search', 'Search', Search],
  ];
  const goTo = (path: string) => {
    setOpen(false);
    go(path);
  };
  const lift = (dy: number) => {
    if (handleRef.current)
      handleRef.current.style.transform = dy ? `translateX(-50%) translateY(${dy}px)` : '';
  };
  return (
    <>
      <div className={`dock-catch ${open ? 'on' : ''}`} onClick={() => setOpen(false)} />
      <nav
        className={`dock ${open ? 'open' : ''}`}
        aria-label="Go to"
        aria-hidden={!open}
        onPointerDown={(e) => (drag.current = { y: e.clientY, moved: false })}
        onPointerMove={(e) => {
          if (drag.current && e.clientY - drag.current.y > 26) {
            drag.current = null;
            setOpen(false);
          }
        }}
        onPointerUp={() => (drag.current = null)}
      >
        {on === 'inbox' ? (
          <DockSentence open={open} goTo={goTo} />
        ) : (
          <div className="places glass">
            {tabs.map(([k, label, Icon], i) => (
              <button
                key={k}
                style={{ '--i': i } as CSSProperties}
                className={on === k ? 'on' : ''}
                tabIndex={open ? 0 : -1}
                aria-current={on === k}
                onClick={() => goTo(k)}
              >
                <Icon size={22} strokeWidth={1.8} />
                {k === 'inbox' && unread && <span className="dot" />}
                <span className="lb">{label}</span>
              </button>
            ))}
          </div>
        )}
        {on !== 'inbox' && (
          <button
            style={{ '--i': 4 } as CSSProperties}
            className="act glass"
            aria-label={fab === 'event' ? 'New event' : 'Write'}
            tabIndex={open ? 0 : -1}
            onClick={() => goTo(fab === 'event' ? 'calendar?new=1' : 'compose')}
          >
            {fab === 'event' ? <Plus size={24} /> : <PenLine size={22} />}
          </button>
        )}
      </nav>
      <button
        ref={handleRef}
        className={`dock-handle glass ${open ? 'hide' : ''}`}
        aria-label="Open navigation"
        aria-expanded={open}
        onPointerDown={(e) => {
          drag.current = { y: e.clientY, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dy = Math.min(0, e.clientY - d.y);
          if (dy < -6) d.moved = true;
          lift(dy * 0.5);
          if (dy < -28) {
            drag.current = { y: Infinity, moved: true };
            lift(0);
            setOpen(true);
          }
        }}
        onPointerUp={() => {
          lift(0);
          const d = drag.current;
          drag.current = null;
          if (d && !d.moved) setOpen(true);
        }}
        onPointerCancel={() => {
          lift(0);
          drag.current = null;
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        <i />
        {unread && on !== 'inbox' && <span className="hd" />}
      </button>
    </>
  );
}

/**
 * The Inbox's opened dock: one sentence in the Inbox voice. You are already in
 * the Inbox and Home is an edge swipe away, so it only offers Calendar,
 * Search and Write.
 */
function DockSentence({ open, goTo }: { open: boolean; goTo: (p: string) => void }) {
  const api = useStore((s) => s.api);
  const [next, setNext] = useState<{ title: string; startMs: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const now = Date.now();
    void api
      .events(now, now + 86_400_000)
      .then((ev) => setNext(ev.find((e) => !e.allDay && !e.free && e.startMs > now) ?? null))
      .catch(() => setNext(null));
  }, [open, api]);
  const tab = open ? 0 : -1;
  return (
    <div className="dk-sent glass">
      <p>
        Check the{' '}
        <button className="w" tabIndex={tab} onClick={() => goTo('calendar')}>
          Calendar
        </button>
        {next ? ` before ${next.title} at ${clock12(next.startMs)}` : ''},{' '}
        <button className="w" tabIndex={tab} onClick={() => goTo('search')}>
          search
        </button>{' '}
        everything, or{' '}
        <button className="w" tabIndex={tab} onClick={() => goTo('compose')}>
          write
        </button>{' '}
        something.
      </p>
    </div>
  );
}

export function Sheet({
  children,
  onClose,
  full,
}: {
  children: ReactNode;
  onClose: () => void;
  full?: boolean;
}) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-wrap">
      <div className="scrim" onClick={onClose} />
      <div className={`sheet ${full ? 'full' : ''}`} role="dialog">
        <div className="grab" />
        {children}
      </div>
    </div>
  );
}

export function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="navbtn"
      style={{ background: 'var(--sunken)' }}
      onClick={onClick}
      aria-label="Close"
    >
      <X size={20} />
    </button>
  );
}

export function Toggle({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      className={`toggle ${on ? '' : 'off'}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      style={{ marginLeft: 'auto' }}
    />
  );
}

export function Toast() {
  const toast = useStore((s) => s.toast);
  const show = useStore((s) => s.showToast);
  if (!toast) return null;
  return (
    <div className="toast" role="status">
      {toast.text}
      {toast.undo && (
        <button
          onClick={() => {
            toast.undo?.();
            show(null);
          }}
        >
          Undo
        </button>
      )}
    </div>
  );
}

export function Spinner() {
  return <span className="spinner" aria-label="Loading" />;
}

export function Empty({ title, sub }: { title: string; sub?: string }) {
  return (
    <div style={{ textAlign: 'center', padding: '60px 30px', color: 'var(--muted)' }}>
      <div style={{ fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>{title}</div>
      {sub && <div style={{ marginTop: 6, fontSize: 14.5 }}>{sub}</div>}
    </div>
  );
}

/** Highlights each search word in text. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const words = query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return <>{text}</>;
  const re = new RegExp(`(${words.join('|')})`, 'gi');
  return <>{text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part))}</>;
}
