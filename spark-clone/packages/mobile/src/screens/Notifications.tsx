import { Check, Pin, Reply, X } from 'lucide-react';
import { useState } from 'react';
import type { MobileThread } from '../data/types';
import { Avatar, Empty } from '../components/ui';
import { displayName, listTime } from '../lib/format';
import { back, go } from '../lib/router';
import { useStore } from '../lib/store';

/** The ⌥⌘N island on the phone: unread mail as glass cards, or the whole inbox. */
export function Notifications() {
  const { threads, accounts, act } = useStore();
  const [mode, setMode] = useState<'unread' | 'inbox'>('unread');
  const [acct, setAcct] = useState<string | null>(null);
  const list = threads
    .filter((t) => (mode === 'unread' ? t.unreadCount > 0 : true))
    .filter((t) => t.category !== 'promotions')
    .filter((t) => !acct || t.accountId === acct)
    .sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  const unread = threads.filter((t) => t.unreadCount > 0 && t.category !== 'promotions').length;

  return (
    <>
      <div className="wash" />
      <div className="screen no-tabs">
        <div className="navbar">
          <button className="navbtn g" aria-label="Close" onClick={() => back('home')}>
            <X size={20} />
          </button>
          <div className="pill-seg glass-flat" style={{ fontSize: 14 }}>
            <button className={mode === 'unread' ? 'on' : ''} onClick={() => setMode('unread')}>
              Unread · {unread}
            </button>
            <button className={mode === 'inbox' ? 'on' : ''} onClick={() => setMode('inbox')}>
              Inbox
            </button>
          </div>
          <button
            className="navbtn g"
            aria-label="Mark all read"
            onClick={() =>
              list
                .filter((t) => t.unreadCount)
                .forEach((t) => void act(t, { kind: 'read', read: true }))
            }
          >
            <Check size={20} />
          </button>
        </div>
        {accounts.length > 1 && (
          <div className="chips">
            <button className={`chip ${!acct ? 'on' : ''}`} onClick={() => setAcct(null)}>
              All accounts
            </button>
            {accounts.map((a) => (
              <button
                key={a.id}
                className={`chip ${acct === a.id ? 'on' : ''}`}
                onClick={() => setAcct(a.id)}
              >
                <span className="swatch" style={{ background: a.color }} />
                {a.displayName.split(' ')[0] || a.email}
              </button>
            ))}
          </div>
        )}
        <div style={{ padding: '14px 12px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {list.map((t, i) => (
            <Card
              key={t.id}
              t={t}
              expanded={i === 0}
              color={accounts.find((a) => a.id === t.accountId)?.color}
            />
          ))}
          {!list.length && <Empty title="All read" sub="New mail will show up here." />}
        </div>
      </div>
    </>
  );
}

function Card({ t, expanded, color }: { t: MobileThread; expanded: boolean; color?: string }) {
  const act = useStore((s) => s.act);
  return (
    <div className="glass pop" style={{ borderRadius: 22, padding: '13px 14px' }}>
      <button
        className="row-flex"
        style={{ alignItems: 'flex-start', gap: 10, width: '100%', textAlign: 'left' }}
        onClick={() => go(`thread/${encodeURIComponent(t.id)}`)}
      >
        <Avatar who={t.lastFrom} size={36} />
        <div className="grow">
          <div className="row-flex" style={{ gap: 6 }}>
            <b className="ellipsis" style={{ fontSize: 15 }}>
              {displayName(t.lastFrom)}
            </b>
            {color && (
              <span className="swatch" style={{ background: color, width: 7, height: 7 }} />
            )}
            <span className="muted" style={{ marginLeft: 'auto', fontSize: 12.5, flex: 'none' }}>
              {listTime(t.lastMessageAt)}
            </span>
          </div>
          <div className="ellipsis" style={{ fontSize: 14.5, fontWeight: 600, marginTop: 1 }}>
            {t.subject}
          </div>
          <div className="muted ellipsis" style={{ fontSize: 14 }}>
            {t.snippet}
          </div>
        </div>
      </button>
      {expanded && (
        <div className="row-flex" style={{ marginTop: 11, paddingLeft: 46 }}>
          <button className="chip" onClick={() => go(`thread/${encodeURIComponent(t.id)}`)}>
            <Reply size={15} /> Reply
          </button>
          {t.unreadCount > 0 && (
            <button className="chip" onClick={() => void act(t, { kind: 'read', read: true })}>
              <Check size={15} /> Read
            </button>
          )}
          <button
            className="chip"
            onClick={() =>
              void act(t, { kind: 'pin', pinned: !t.pinned }, t.pinned ? 'Unpinned' : 'Kept')
            }
          >
            <Pin size={15} /> {t.pinned ? 'Unpin' : 'Keep'}
          </button>
        </div>
      )}
    </div>
  );
}
