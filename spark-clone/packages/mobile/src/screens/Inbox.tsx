import { Bell, ChevronLeft, ChevronRight, Newspaper, RefreshCw, Sparkles, Zap } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Category, MobileThread } from '../data/types';
import { ThreadRow } from '../components/ThreadRow';
import { Empty, Spinner, TabBar } from '../components/ui';
import { dayLabel, displayName } from '../lib/format';
import { go, useRoute } from '../lib/router';
import { useStore } from '../lib/store';
import { useNow } from '../lib/useNow';

const BUNDLES: { key: Category; label: string; color: string; Icon: typeof Bell }[] = [
  { key: 'newsletters', label: 'Newsletters', color: '#c98a3c', Icon: Newspaper },
  { key: 'notifications', label: 'Notifications', color: '#3aa765', Icon: Bell },
  { key: 'promotions', label: 'Promotions', color: '#d4386c', Icon: Sparkles },
];

export function Inbox() {
  const { threads, accounts, accountFilter, setAccountFilter, loading, refresh, api } = useStore();
  const route = useRoute();
  const bundle = route.query.get('bundle') as Category | null;
  const now = useNow();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [showAllPriority, setShowAllPriority] = useState(false);
  const color = (id: string) =>
    accounts.length > 1 ? accounts.find((a) => a.id === id)?.color : undefined;

  const visible = useMemo(
    () =>
      threads
        .filter((t) => !accountFilter || t.accountId === accountFilter)
        .filter((t) => !unreadOnly || t.unreadCount > 0)
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt),
    [threads, accountFilter, unreadOnly],
  );

  const pullRefresh = async () => {
    await api.syncNow().catch(() => undefined);
    await refresh();
  };

  if (bundle) {
    const list = visible.filter((t) => t.category === bundle);
    const meta = BUNDLES.find((b) => b.key === bundle);
    return (
      <>
        <div className="screen">
          <div className="navbar">
            <button className="navbtn accent" onClick={() => go('inbox')}>
              <ChevronLeft size={24} />
              <span style={{ fontSize: 17 }}>Inbox</span>
            </button>
          </div>
          <div className="pad">
            <div className="bigtitle">{meta?.label ?? bundle}</div>
          </div>
          <div style={{ marginTop: 10 }}>
            {list.map((t) => (
              <ThreadRow key={t.id} thread={t} accountColor={color(t.accountId)} />
            ))}
            {!list.length && <Empty title="Nothing here" />}
          </div>
        </div>
        <TabBar on="inbox" />
      </>
    );
  }

  const personal = visible.filter((t) => t.category === 'personal' || t.category === 'invites');
  const priority = personal.filter((t) => t.priority && (t.unreadCount > 0 || t.pinned));
  const rest = personal.filter((t) => !priority.includes(t));
  const unreadTotal = visible.filter((t) => t.unreadCount > 0).length;

  // Group the rest by day.
  const groups: { label: string; items: MobileThread[] }[] = [];
  for (const t of rest) {
    const age = now - t.lastMessageAt;
    const label =
      age < 2 * 86_400_000
        ? dayLabel(t.lastMessageAt)
        : age < 7 * 86_400_000
          ? 'This week'
          : 'Earlier';
    const g = groups[groups.length - 1];
    if (g?.label === label) g.items.push(t);
    else groups.push({ label, items: [t] });
  }

  return (
    <>
      <div className="screen">
        <div className="navbar">
          <button className="navbtn" aria-label="Refresh" onClick={() => void pullRefresh()}>
            {loading ? <Spinner /> : <RefreshCw size={19} />}
          </button>
          <button className="navbtn accent" aria-label="Assistant" onClick={() => go('assistant')}>
            <Sparkles size={20} />
          </button>
        </div>
        <div className="pad row-flex" style={{ alignItems: 'baseline', gap: 10 }}>
          <div className="bigtitle">Inbox</div>
          <span className="muted" style={{ fontSize: 15 }}>
            {unreadTotal ? `${unreadTotal} unread` : ''}
          </span>
        </div>
        <div className="chips">
          <button
            className={`chip ${!accountFilter && !unreadOnly ? 'on' : ''}`}
            onClick={() => (setAccountFilter(null), setUnreadOnly(false))}
          >
            All
          </button>
          {accounts.length > 1 &&
            accounts.map((a) => (
              <button
                key={a.id}
                className={`chip ${accountFilter === a.id ? 'on' : ''}`}
                onClick={() => setAccountFilter(accountFilter === a.id ? null : a.id)}
              >
                <span className="swatch" style={{ background: a.color }} />
                {a.displayName.split(' ')[0] || a.email}
              </button>
            ))}
          <button
            className={`chip ${unreadOnly ? 'on' : ''}`}
            onClick={() => setUnreadOnly(!unreadOnly)}
          >
            Unread
          </button>
        </div>

        {priority.length > 0 && (
          <div className="priority-band" style={{ marginTop: 6 }}>
            <div className="sect" style={{ paddingTop: 12, color: 'var(--priority)' }}>
              <Zap size={14} />
              <span className="eyebrow" style={{ color: 'var(--priority)' }}>
                Priority · {priority.length}
              </span>
            </div>
            {(showAllPriority ? priority : priority.slice(0, 3)).map((t) => (
              <ThreadRow key={t.id} thread={t} accountColor={color(t.accountId)} />
            ))}
            {priority.length > 3 && (
              <button
                style={{
                  width: '100%',
                  padding: '10px 0 12px',
                  color: 'var(--priority)',
                  fontWeight: 600,
                  fontSize: 14.5,
                }}
                onClick={() => setShowAllPriority(!showAllPriority)}
              >
                {showAllPriority ? 'Show less' : `Show all (${priority.length})`}
              </button>
            )}
          </div>
        )}

        {BUNDLES.map(({ key, label, color: c, Icon }) => {
          const items = visible.filter((t) => t.category === key);
          if (!items.length) return null;
          const unread = items.filter((t) => t.unreadCount > 0).length;
          const names = [...new Set(items.map((t) => displayName(t.lastFrom)))]
            .slice(0, 3)
            .join(' · ');
          return (
            <button
              key={key}
              className="row"
              style={{ alignItems: 'center', width: '100%', textAlign: 'left' }}
              onClick={() => go(`inbox?bundle=${key}`)}
            >
              <div className="av" style={{ background: c }}>
                <Icon size={19} />
              </div>
              <div className="meta">
                <div className="top">
                  <span className="from">{label}</span>
                  {unread > 0 && (
                    <span className="faint" style={{ fontSize: 13 }}>
                      {unread}
                    </span>
                  )}
                  <span className="time">
                    <ChevronRight size={15} />
                  </span>
                </div>
                <div className="snip">{names}</div>
              </div>
            </button>
          );
        })}

        {groups.map((g) => (
          <div key={g.label}>
            <div className="sect">
              <span className="eyebrow">{g.label}</span>
            </div>
            {g.items.map((t) => (
              <ThreadRow key={t.id} thread={t} accountColor={color(t.accountId)} />
            ))}
          </div>
        ))}
        {!visible.length && !loading && <Empty title="Inbox zero" sub="Nothing waiting on you." />}
      </div>
      <TabBar on="inbox" />
    </>
  );
}
