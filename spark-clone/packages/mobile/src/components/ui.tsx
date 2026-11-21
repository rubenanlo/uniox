import type { Address } from '@app/shared';
import { Calendar, Home, Inbox, PenLine, Plus, Search, Sparkles, X } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { avatarColor, initials } from '../lib/format';
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

export function TabBar({ on, fab = 'compose' }: { on: Tab; fab?: 'compose' | 'event' }) {
  const unread = useStore((s) => s.threads.some((t) => t.unreadCount > 0 && t.priority));
  const tabs: [Tab, string, typeof Home][] = [
    ['home', 'Home', Home],
    ['inbox', 'Inbox', Inbox],
    ['calendar', 'Calendar', Calendar],
    ['search', 'Search', Search],
  ];
  return (
    <>
      <nav className="tabbar glass">
        {tabs.map(([k, label, Icon]) => (
          <button
            key={k}
            className={`tab ${on === k ? 'on' : ''}`}
            onClick={() => go(k)}
            aria-current={on === k}
          >
            <Icon size={23} strokeWidth={1.8} />
            {k === 'inbox' && on !== 'inbox' && unread && <span className="dot" />}
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <button
        className="fab"
        aria-label={fab === 'event' ? 'New event' : 'Compose'}
        onClick={() => go(fab === 'event' ? 'calendar?new=1' : 'compose')}
      >
        {fab === 'event' ? <Plus size={26} /> : <PenLine size={25} />}
      </button>
    </>
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
