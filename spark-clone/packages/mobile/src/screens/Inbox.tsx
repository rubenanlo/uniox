import { Archive, Bell, Check, ChevronLeft, Newspaper, RefreshCw, Sparkles } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { Address, Category, InviteInfo, MobileAccount, MobileThread } from '../data/types';
import { InviteRow } from '../components/InviteRow';
import { ThreadRow } from '../components/ThreadRow';
import { AskSheet } from '../components/AskSheet';
import { Avatar, Empty, Spinner, TabBar } from '../components/ui';
import { displayName, firstName } from '../lib/format';
import { useEdgeBackAndPull } from '../lib/gestures';
import { useGists } from '../lib/gists';
import { go, useRoute } from '../lib/router';
import { useStore } from '../lib/store';
import { useNow } from '../lib/useNow';
import './inbox.css';

const BUNDLES: {
  key: Category;
  label: string;
  color: string;
  Icon: typeof Bell;
}[] = [
  {
    key: 'newsletters',
    label: 'Newsletters',
    color: '#c98a3c',
    Icon: Newspaper,
  },
  {
    key: 'notifications',
    label: 'Notifications',
    color: '#3aa765',
    Icon: Bell,
  },
  { key: 'promotions', label: 'Promotions', color: '#d4386c', Icon: Sparkles },
];

const ACCTS_KEY = 'uniox.inbox.accounts';
function loadAccts(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(ACCTS_KEY) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
}

export function Inbox() {
  const { threads, accounts, loading, refresh, api, settings, act, showToast } = useStore();
  const route = useRoute();
  const bundle = route.query.get('bundle') as Category | null;
  const now = useNow();
  const [unreadOnly, setUnreadOnly] = useState(false);
  /** Accounts shown; empty means all of them. */
  const [accts, setAccts] = useState<Set<string>>(loadAccts);
  const [pickOpen, setPickOpen] = useState(false);
  const [person, setPerson] = useState<string | null>(null);
  const [stack, setStack] = useState<Category | null>(null);
  const [restAll, setRestAll] = useState(false);
  const invRef = useRef<HTMLDivElement>(null);
  const waitRef = useRef<HTMLDivElement>(null);

  // Forget accounts that were removed; keep the choice across visits.
  const known = accounts.map((a) => a.id).join(',');
  useEffect(() => {
    if (!accounts.length) return;
    setAccts((s) => {
      const next = new Set([...s].filter((id) => accounts.some((a) => a.id === id)));
      return next.size === accounts.length ? new Set() : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known]);
  useEffect(() => {
    try {
      localStorage.setItem(ACCTS_KEY, JSON.stringify([...accts]));
    } catch {
      /* private mode: the choice just doesn't persist */
    }
  }, [accts]);

  const on = (id: string) => !accts.size || accts.has(id);
  const color = (id: string) =>
    accounts.length > 1 ? accounts.find((a) => a.id === id)?.color : undefined;

  const visible = useMemo(
    () =>
      threads
        .filter((t) => !accts.size || accts.has(t.accountId))
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt),
    [threads, accts],
  );

  // Invite details for invite threads (date, organizer, your answer).
  const inviteIds = visible
    .filter((t) => t.category === 'invites' && t.inInbox)
    .map((t) => t.id)
    .join(',');
  const [inviteInfo, setInviteInfo] = useState<Record<string, InviteInfo | null>>({});
  useEffect(() => {
    if (!inviteIds) return;
    let live = true;
    for (const id of inviteIds.split(',')) {
      void api
        .thread(id)
        .then(({ messages }) => {
          const m = [...messages].reverse().find((x) => x.invite);
          if (live) setInviteInfo((p) => ({ ...p, [id]: m?.invite ?? null }));
        })
        .catch(() => live && setInviteInfo((p) => ({ ...p, [id]: null })));
    }
    return () => {
      live = false;
    };
  }, [api, inviteIds]);

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

  const shown = unreadOnly ? visible.filter((t) => t.unreadCount > 0) : visible;
  const personal = shown.filter((t) => t.category === 'personal' || t.category === 'invites');
  const priority = personal.filter((t) => t.priority && (t.unreadCount > 0 || t.pinned));
  // Only invites still waiting for an answer get the tiles; answered, past or
  // "X accepted" notices read as ordinary mail.
  const inviteCands = personal.filter((t) => t.category === 'invites' && !priority.includes(t));
  const invites = inviteCands.filter((t) => {
    const i = inviteInfo[t.id];
    return !!i && !i.myAnswer && i.endMs > Date.now();
  });
  const others = personal.filter(
    (t) =>
      !priority.includes(t) &&
      !invites.includes(t) &&
      !(inviteCands.includes(t) && inviteInfo[t.id] === undefined),
  );
  const unread = others.filter((t) => t.unreadCount > 0);
  const read = others.filter((t) => t.unreadCount === 0);
  const lists = BUNDLES.map((b) => ({
    ...b,
    items: visible.filter((t) => t.category === b.key),
  })).filter((b) => b.items.length);
  const listCount = lists.reduce((n, b) => n + b.items.length, 0);
  const gists = useGists(api, priority, settings.aiFirstRead);

  // People waiting on you: priority threads grouped by sender.
  const people: {
    key: string;
    who: Address | null;
    items: MobileThread[];
    newest: number;
  }[] = [];
  for (const t of priority) {
    const key = t.lastFrom?.email?.toLowerCase() ?? t.id;
    const p = people.find((x) => x.key === key);
    if (p) p.items.push(t);
    else
      people.push({
        key,
        who: t.lastFrom,
        items: [t],
        newest: t.lastMessageAt,
      });
  }
  const sel = person && people.some((p) => p.key === person) ? person : null;
  const fromSel = sel
    ? personal.filter((t) => (t.lastFrom?.email?.toLowerCase() ?? t.id) === sel)
    : [];

  const acctLabel = () => {
    if (!accts.size || accounts.length < 2)
      return accounts[0] && accounts.length === 1 ? acctName(accounts[0]) : 'all accounts';
    const names = accounts.filter((a) => accts.has(a.id)).map(acctName);
    return names.length === 1
      ? names[0]
      : names.length === 2
        ? names.join(' and ')
        : `${names.length} accounts`;
  };
  const newIn = (id: string) =>
    threads.filter(
      (t) =>
        t.accountId === id &&
        (t.category === 'personal' || t.category === 'invites') &&
        t.unreadCount > 0,
    ).length;
  const toggle = (id: string) => {
    setPerson(null);
    setAccts((s) => {
      const next = new Set(s.size ? s : accounts.map((a) => a.id));
      if (next.has(id)) {
        if (next.size === 1) {
          showToast({ text: 'Keep at least one account on' });
          return s;
        }
        next.delete(id);
      } else next.add(id);
      return next.size === accounts.length ? new Set() : next;
    });
  };

  const [ask, setAsk] = useState(false);
  const screenRef = useRef<HTMLDivElement>(null);
  const { pull, refreshing } = useEdgeBackAndPull(screenRef, () => go('home'), pullRefresh);

  const archiveAll = (b: (typeof lists)[number]) => {
    for (const t of b.items) void act(t, { kind: 'archive' });
    setStack(null);
    showToast({ text: `Archived ${b.items.length} ${b.label.toLowerCase()}` });
  };

  const sentence: ReactNode = (
    <p className="ib-sent">
      <b>
        {people.length === 0
          ? 'Nobody is'
          : `${people.length} ${people.length === 1 ? 'person is' : 'people are'}`}
      </b>{' '}
      waiting on you,{' '}
      {invites.length > 0 && !unreadOnly && (
        <>
          <button
            className="ib-w"
            onClick={() =>
              invRef.current?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              })
            }
          >
            {invites.length} invite{invites.length > 1 ? 's' : ''}
          </button>{' '}
          to answer,{' '}
        </>
      )}
      <button
        className="ib-w"
        aria-pressed={unreadOnly}
        onClick={() => (setUnreadOnly(!unreadOnly), setPerson(null))}
      >
        {unread.length} unread
      </button>
      , and{' '}
      <button
        className="ib-w"
        onClick={() => {
          setUnreadOnly(false);
          setPerson(null);
          setTimeout(
            () =>
              waitRef.current?.scrollIntoView({
                behavior: 'smooth',
                block: 'start',
              }),
            30,
          );
        }}
      >
        {read.length + listCount} can wait
      </button>
      {accounts.length > 1 ? (
        <>
          , across{' '}
          <button className="ib-w" aria-expanded={pickOpen} onClick={() => setPickOpen(!pickOpen)}>
            {acctLabel()}
            {accts.size > 0 && (
              <span className="ib-stk">
                {accounts
                  .filter((a) => accts.has(a.id))
                  .map((a) => (
                    <i key={a.id} style={{ background: a.color }} />
                  ))}
              </span>
            )}
          </button>
          .
        </>
      ) : (
        '.'
      )}
    </p>
  );

  return (
    <>
      <div className="screen" ref={screenRef}>
        <div className="ib-ptr" style={{ height: pull }} aria-hidden={!pull}>
          {refreshing ? (
            <Spinner />
          ) : (
            <RefreshCw size={17} style={{ transform: `rotate(${pull * 5}deg)` }} />
          )}
        </div>
        <div className="ib-head">
          <div className="ib-top">
            <div className="eyebrow">
              {new Date(now).toLocaleDateString([], {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </div>
            <button className="ib-orb glass" aria-label="Assistant" onClick={() => setAsk(true)}>
              <Sparkles size={18} />
            </button>
          </div>
          {sentence}
          {pickOpen && (
            <>
              <div className="ib-catch" onClick={() => setPickOpen(false)} />
              <AccountChecklist
                accounts={accounts}
                on={on}
                all={!accts.size}
                newIn={newIn}
                onAll={() => (setAccts(new Set()), setPerson(null))}
                onToggle={toggle}
                onOnly={(id) => (
                  setAccts(accounts.length === 1 ? new Set() : new Set([id])),
                  setPerson(null)
                )}
                onDone={() => setPickOpen(false)}
              />
            </>
          )}
        </div>

        {people.length > 0 && (
          <>
            <div className="ib-faces">
              {people.map((p) => {
                const h = (now - p.newest) / 3_600_000;
                const frac = Math.min(1, Math.max(0.04, h / 10));
                const C = 2 * Math.PI * 33;
                const count = p.items.length > 1 ? p.items.length : (p.items[0]?.messageCount ?? 1);
                return (
                  <button
                    key={p.key}
                    className={`ib-face ${sel && sel !== p.key ? 'dim' : ''}`}
                    aria-pressed={sel === p.key}
                    onClick={() => setPerson(sel === p.key ? null : p.key)}
                  >
                    <span className="ib-ring">
                      <svg viewBox="0 0 70 70" aria-hidden>
                        <defs>
                          <linearGradient id="ibg">
                            <stop offset="0" stopColor="var(--aqua)" />
                            <stop offset=".6" stopColor="var(--azure)" />
                            <stop offset="1" stopColor="var(--violet)" />
                          </linearGradient>
                        </defs>
                        <circle
                          cx="35"
                          cy="35"
                          r="33"
                          fill="none"
                          stroke="var(--hair)"
                          strokeWidth="3"
                        />
                        <circle
                          cx="35"
                          cy="35"
                          r="33"
                          fill="none"
                          stroke="url(#ibg)"
                          strokeWidth="3"
                          strokeLinecap="round"
                          strokeDasharray={`${C * frac} ${C}`}
                        />
                      </svg>
                      <Avatar who={p.who} size={58} />
                      {count > 1 && <span className="c">{count}</span>}
                    </span>
                    <b>{firstName(p.who) || displayName(p.who)}</b>
                    <span>
                      waiting{' '}
                      {h < 1
                        ? `${Math.max(1, Math.round(h * 60))} min`
                        : h < 48
                          ? `${Math.round(h)} h`
                          : `${Math.round(h / 24)} d`}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="sect">
              <span className="eyebrow" style={{ color: 'var(--priority)' }}>
                {sel ? `From ${firstName(people.find((p) => p.key === sel)?.who)}` : 'Needs you'}
              </span>
              {sel && (
                <button className="ib-clear" onClick={() => setPerson(null)}>
                  Show everyone
                </button>
              )}
            </div>
            <div className="ib-gist">
              {(sel ? fromSel : priority).map((t) =>
                priority.includes(t) ? (
                  <ThreadRow
                    key={t.id}
                    thread={t}
                    accountColor={color(t.accountId)}
                    gist={gists[t.id] ?? null}
                  />
                ) : (
                  <ThreadRow key={t.id} thread={t} accountColor={color(t.accountId)} />
                ),
              )}
            </div>
          </>
        )}

        {!sel && (
          <>
            {invites.length > 0 && (
              <div ref={invRef} style={{ scrollMarginTop: 12 }}>
                <Section label="Invites" color="var(--violet)" />
                {invites.map((t) => (
                  <InviteRow key={t.id} thread={t} invite={inviteInfo[t.id] ?? null} />
                ))}
              </div>
            )}
            {unread.length > 0 && (
              <>
                <Section label="Unread" />
                {unread.map((t) => (
                  <ThreadRow key={t.id} thread={t} accountColor={color(t.accountId)} />
                ))}
              </>
            )}
            {!unreadOnly && (read.length > 0 || lists.length > 0) && (
              <div ref={waitRef} style={{ scrollMarginTop: 12 }}>
                <Section label="Can wait" />
                {lists.length > 0 && (
                  <div className="ib-stacks">
                    {lists.map(({ key, label, color: c, Icon, items }) => (
                      <button
                        key={key}
                        className={`ib-stack ${stack === key ? 'on' : ''}`}
                        style={{ ['--c' as string]: c }}
                        aria-expanded={stack === key}
                        onClick={() => setStack(stack === key ? null : key)}
                      >
                        <span className="lay" />
                        <span className="lay" />
                        <span className="top glass">
                          <span className="ic">
                            <Icon size={13} />
                          </span>
                          <b>{items.length}</b>
                          <span>{label}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {lists
                  .filter((b) => b.key === stack)
                  .map((b) => (
                    <div key={b.key} className="ib-lopen glass">
                      {b.items.slice(0, 8).map((t) => (
                        <div key={t.id} className="ib-li">
                          <button
                            className="ib-li-main"
                            onClick={() => go(`thread/${encodeURIComponent(t.id)}`)}
                          >
                            <b>{displayName(t.lastFrom)}</b>
                            <span>{t.subject || t.snippet}</span>
                          </button>
                          <button
                            className="ib-li-arch"
                            aria-label="Archive"
                            onClick={() => void act(t, { kind: 'archive' }, 'Archived')}
                          >
                            <Archive size={17} />
                          </button>
                        </div>
                      ))}
                      <div className="ib-li-foot">
                        <button onClick={() => archiveAll(b)}>Archive all {b.items.length}</button>
                        {b.items.length > 8 && (
                          <button onClick={() => go(`inbox?bundle=${b.key}`)}>See all</button>
                        )}
                      </div>
                    </div>
                  ))}
                {(restAll ? read : read.slice(0, 40)).map((t) => (
                  <ThreadRow key={t.id} thread={t} accountColor={color(t.accountId)} />
                ))}
                {!restAll && read.length > 40 && (
                  <button className="ib-more" onClick={() => setRestAll(true)}>
                    Show {read.length - 40} more
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {!visible.length && !loading && <Empty title="Inbox zero" sub="Nothing waiting on you." />}
        <div style={{ height: 90 }} />
      </div>
      {ask && <AskSheet onClose={() => setAsk(false)} />}
      <TabBar on="inbox" />
    </>
  );
}

const acctName = (a: MobileAccount) => a.displayName || a.email.split('@')[0];

function Section({ label, color }: { label: string; color?: string }) {
  return (
    <div className="sect">
      <span className="eyebrow" style={color ? { color } : undefined}>
        {label}
      </span>
    </div>
  );
}

/** The account checklist that drops from "all accounts": untick to hide, Only to jump to one. */
function AccountChecklist({
  accounts,
  on,
  all,
  newIn,
  onAll,
  onToggle,
  onOnly,
  onDone,
}: {
  accounts: MobileAccount[];
  on: (id: string) => boolean;
  all: boolean;
  newIn: (id: string) => number;
  onAll: () => void;
  onToggle: (id: string) => void;
  onOnly: (id: string) => void;
  onDone: () => void;
}) {
  const ring = `conic-gradient(${accounts
    .map(
      (a, i) => `${a.color} ${(i / accounts.length) * 100}% ${((i + 1) / accounts.length) * 100}%`,
    )
    .join(',')})`;
  return (
    <div className="ib-pop glass" role="dialog" aria-label="Accounts">
      <div className="ib-ar" style={{ ['--i' as string]: 0 }}>
        <button className="ib-am" onClick={onAll} aria-pressed={all}>
          <span className="ib-dot" style={{ background: ring }} />
          <span className="tx">
            <b>All accounts</b>
            <span>{accounts.length} accounts</span>
          </span>
          <span className={`ib-ck ${all ? 'on' : ''}`}>
            <Check size={14} strokeWidth={3} />
          </span>
        </button>
      </div>
      <div className="ib-sep" />
      {accounts.map((a, i) => {
        const n = newIn(a.id);
        return (
          <div key={a.id} className="ib-ar" style={{ ['--i' as string]: i + 1 }}>
            <button className="ib-am" onClick={() => onToggle(a.id)} aria-pressed={on(a.id)}>
              <span className="ib-dot" style={{ background: a.color }} />
              <span className="tx">
                <b>{acctName(a)}</b>
                <span>{a.email}</span>
              </span>
              {n > 0 && <em>{n} new</em>}
              <span className={`ib-ck ${on(a.id) ? 'on' : ''}`}>
                <Check size={14} strokeWidth={3} />
              </span>
            </button>
            <button className="ib-only" onClick={() => onOnly(a.id)}>
              Only
            </button>
          </div>
        );
      })}
      <button className="ib-done" onClick={onDone}>
        Done
      </button>
    </div>
  );
}
