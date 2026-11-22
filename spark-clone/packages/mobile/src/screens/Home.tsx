import { Bell, ChevronRight, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { MobileEvent, MobileThread } from '../data/types';
import { AiMark, Avatar, TabBar } from '../components/ui';
import {
  clock,
  dayLabel,
  displayName,
  firstName,
  greeting,
  startOfDay,
  workdayPercent,
} from '../lib/format';
import { go } from '../lib/router';
import { useStore } from '../lib/store';
import { useNow } from '../lib/useNow';

type AiCard = 'reply' | 'plate' | 'prep' | null;

export function Home() {
  const { threads, me, api, accounts } = useStore();
  const nowMs = useNow();
  const now = useMemo(() => new Date(nowMs), [nowMs]);
  const [events, setEvents] = useState<MobileEvent[]>([]);
  const [card, setCard] = useState<AiCard>('reply');

  useEffect(() => {
    const from = startOfDay(nowMs);
    void api.events(from, from + 3 * 86_400_000).then(setEvents);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, threads]);

  const priority = useMemo(
    () => threads.filter((t) => t.priority).sort((a, b) => a.lastMessageAt - b.lastMessageAt),
    [threads],
  );
  const needsReply = useMemo(
    () =>
      priority
        .filter((t) => t.unreadCount > 0)
        .slice(-3)
        .reverse(),
    [priority],
  );
  const timeline = priority.filter((t) => t.lastMessageAt > nowMs - 4 * 86_400_000);
  const meetingsLeft = events.filter(
    (e) =>
      !e.allDay &&
      !e.free &&
      e.startMs > now.getTime() &&
      e.startMs < startOfDay(now.getTime()) + 86_400_000,
  ).length;
  const nextMeetings = events
    .filter((e) => !e.allDay && !e.free && e.endMs > now.getTime())
    .slice(0, 3);
  const full = accounts.find((a) => a.email === me?.email)?.displayName ?? '';
  const name = /\s/.test(full)
    ? firstName({ email: '', name: full })
    : (me?.email.split(/[.@]/)[0] ?? 'there');

  // Group the timeline by day for the eyebrow labels.
  const groups: { label: string; items: MobileThread[] }[] = [];
  for (const t of timeline) {
    const label = dayLabel(t.lastMessageAt);
    const g = groups[groups.length - 1];
    if (g?.label === label) g.items.push(t);
    else groups.push({ label, items: [t] });
  }

  return (
    <>
      <div className="wash" />
      <div className="screen">
        <div className="navbar" style={{ padding: '0 18px' }}>
          <button className="row-flex" aria-label="Settings" onClick={() => go('settings')}>
            <Avatar who={{ email: me?.email ?? 'me', name: me?.email }} size={30} />
            <span style={{ fontWeight: 700, fontSize: 17 }}>Uniox</span>
          </button>
          <div className="row-flex">
            <button
              className="navbtn g"
              aria-label="Notifications"
              onClick={() => go('notifications')}
            >
              <Bell size={20} />
            </button>
            <button
              className="navbtn g accent"
              aria-label="Assistant"
              onClick={() => go('assistant')}
            >
              <AiMark size={24} />
            </button>
          </div>
        </div>

        <div className="pad" style={{ marginTop: 10 }}>
          <div className="eyebrow">
            {now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}
          </div>
          <div
            style={{ fontSize: 30, letterSpacing: '-.02em', marginTop: 8, color: 'var(--muted)' }}
          >
            {greeting(now)},{' '}
            <span style={{ color: 'var(--ink)', fontWeight: 600, textTransform: 'capitalize' }}>
              {name}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 22, marginTop: 16 }}>
            <div>
              <div
                style={{ fontSize: 54, fontWeight: 700, letterSpacing: '-.04em', lineHeight: 0.9 }}
              >
                {workdayPercent(now)}
                <span style={{ fontSize: 22, color: 'var(--muted)', fontWeight: 500 }}>%</span>
              </div>
              <div className="eyebrow" style={{ marginTop: 8, fontSize: 10 }}>
                of 9:00 – 18:00
              </div>
            </div>
            <Stat
              n={priority.filter((t) => t.unreadCount > 0).length}
              label="unread priority"
              onClick={() => go('inbox')}
            />
            <Stat
              n={meetingsLeft}
              label={meetingsLeft === 1 ? 'meeting left' : 'meetings left'}
              onClick={() => go('calendar')}
            />
          </div>
        </div>

        <div className="chips" style={{ paddingTop: 18 }}>
          <button
            className={`chip ${card === 'reply' ? 'glass' : ''}`}
            onClick={() => setCard(card === 'reply' ? null : 'reply')}
          >
            <AiMark size={20} /> Needs reply · {needsReply.length}
          </button>
          <button
            className={`chip ${card === 'plate' ? 'glass' : ''}`}
            onClick={() => setCard(card === 'plate' ? null : 'plate')}
          >
            Your plate
          </button>
          <button
            className={`chip ${card === 'prep' ? 'glass' : ''}`}
            onClick={() => setCard(card === 'prep' ? null : 'prep')}
          >
            Next meetings
          </button>
          <button
            className="chip"
            onClick={() => go('assistant?q=What%20is%20new%20in%20my%20newsletters%3F')}
          >
            News
          </button>
        </div>

        {card && (
          <div
            className="glass pop"
            key={card}
            style={{ margin: '10px 14px 0', borderRadius: 22, padding: '14px 16px' }}
          >
            <div className="row-flex" style={{ gap: 10 }}>
              <AiMark />
              <b style={{ fontSize: 15 }}>
                {card === 'reply'
                  ? 'Needs your reply'
                  : card === 'plate'
                    ? 'On your plate'
                    : 'Coming up'}
              </b>
              <button
                className="muted"
                style={{ marginLeft: 'auto' }}
                aria-label="Close"
                onClick={() => setCard(null)}
              >
                <X size={17} />
              </button>
            </div>
            {card === 'reply' &&
              (needsReply.length ? (
                needsReply.map((t) => <MiniRow key={t.id} t={t} />)
              ) : (
                <div className="muted" style={{ fontSize: 14, marginTop: 10 }}>
                  You're all caught up.
                </div>
              ))}
            {card === 'plate' &&
              priority
                .filter((t) => t.pinned || t.unreadCount > 0)
                .slice(-4)
                .reverse()
                .map((t) => <MiniRow key={t.id} t={t} />)}
            {card === 'prep' &&
              (nextMeetings.length ? (
                nextMeetings.map((e) => (
                  <button
                    key={e.id}
                    className="row-flex"
                    style={{ width: '100%', marginTop: 12, textAlign: 'left' }}
                    onClick={() => go(`calendar?event=${encodeURIComponent(e.id)}`)}
                  >
                    <span
                      style={{
                        width: 4,
                        alignSelf: 'stretch',
                        borderRadius: 2,
                        background: e.color,
                      }}
                    />
                    <div className="grow">
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{e.title}</div>
                      <div className="muted" style={{ fontSize: 13.5 }}>
                        {dayLabel(e.startMs)} · {clock(e.startMs)}
                        {e.attendees.length ? ` · ${e.attendees.length} guests` : ''}
                      </div>
                    </div>
                    <ChevronRight size={16} color="var(--faint)" />
                  </button>
                ))
              ) : (
                <div className="muted" style={{ fontSize: 14, marginTop: 10 }}>
                  Nothing else on the calendar.
                </div>
              ))}
          </div>
        )}

        <div
          className="row-flex"
          style={{ justifyContent: 'space-between', padding: '20px 18px 8px' }}
        >
          <div className="eyebrow">Priority timeline</div>
        </div>
        <div style={{ position: 'relative', padding: '0 14px 0 62px' }}>
          <div
            style={{
              position: 'absolute',
              left: 52,
              top: 4,
              bottom: 10,
              width: 2,
              background: 'linear-gradient(var(--aqua), var(--azure))',
              opacity: 0.8,
            }}
          />
          {groups.map((g) => (
            <div key={g.label}>
              <div className="eyebrow" style={{ margin: '6px 0 8px' }}>
                {g.label}
              </div>
              {g.items.map((t) => (
                <button
                  key={t.id}
                  style={{
                    position: 'relative',
                    display: 'block',
                    width: '100%',
                    marginBottom: 9,
                    textAlign: 'left',
                  }}
                  onClick={() => go(`thread/${encodeURIComponent(t.id)}`)}
                >
                  <span
                    className="faint"
                    style={{
                      position: 'absolute',
                      left: -58,
                      top: 14,
                      fontSize: 12,
                      width: 40,
                      textAlign: 'right',
                    }}
                  >
                    {clock(t.lastMessageAt)}
                  </span>
                  <div className="card" style={{ padding: '11px 14px', borderRadius: 16 }}>
                    <div className="row-flex" style={{ gap: 6 }}>
                      {t.unreadCount > 0 && <span className="unread-dot" />}
                      <b style={{ fontSize: 15 }} className="ellipsis">
                        {displayName(t.lastFrom)}
                      </b>
                    </div>
                    <div className="muted ellipsis" style={{ fontSize: 14, marginTop: 2 }}>
                      {t.subject}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ))}
          <div className="row-flex" style={{ position: 'relative', marginTop: 2 }}>
            <span
              style={{
                position: 'absolute',
                left: -15,
                width: 10,
                height: 10,
                borderRadius: 5,
                background: 'var(--ink)',
              }}
            />
            <div style={{ flex: 1, borderTop: '1px solid var(--faint)', marginLeft: 4 }} />
            <b style={{ fontSize: 13 }}>Now · {clock(now.getTime())}</b>
          </div>
        </div>
      </div>
      <TabBar on="home" />
    </>
  );
}

function Stat({ n, label, onClick }: { n: number; label: string; onClick: () => void }) {
  return (
    <button style={{ paddingBottom: 4, textAlign: 'left' }} onClick={onClick}>
      <div style={{ fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{n}</div>
      <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
        {label}
      </div>
    </button>
  );
}

function MiniRow({ t }: { t: MobileThread }) {
  return (
    <button
      className="row-flex"
      style={{ width: '100%', marginTop: 12, gap: 10, textAlign: 'left' }}
      onClick={() => go(`thread/${encodeURIComponent(t.id)}`)}
    >
      <Avatar who={t.lastFrom} size={30} />
      <div className="grow">
        <div style={{ fontSize: 14, fontWeight: 600 }}>{displayName(t.lastFrom)}</div>
        <div className="muted ellipsis" style={{ fontSize: 13.5 }}>
          {t.subject}
        </div>
      </div>
      <ChevronRight size={16} color="var(--faint)" />
    </button>
  );
}
