import DOMPurify from 'dompurify';
import {
  Archive,
  ArrowUp,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  Clock,
  Forward,
  MoreHorizontal,
  Paperclip,
  Pin,
  Rows3,
  Reply,
  ReplyAll,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEdgeBackAndPull } from '../lib/gestures';
import type { FirstRead, MobileMessage, MobileThread } from '../data/types';
import { AskSheet } from '../components/AskSheet';
import { InviteCard } from '../components/InviteCard';
import { tomorrowMorning } from '../components/ThreadRow';
import { AiMark, Avatar, Sheet, Spinner } from '../components/ui';
import { clock12, displayName, firstName, listTime, shortDate, splitQuoted } from '../lib/format';
import { cachedThread, cacheThread } from '../lib/offline';
import { back, go } from '../lib/router';
import { useStore } from '../lib/store';
import './thread.css';

export function ThreadScreen({ id }: { id: string }) {
  const { api, settings, act, send, showToast, accounts } = useStore();
  const [data, setData] = useState<{ thread: MobileThread; messages: MobileMessage[] } | null>(() =>
    cachedThread(id),
  );
  const [ai, setAi] = useState<FirstRead | null>(null);
  const [more, setMore] = useState(false);
  // The phone always opens on the conversation page. The reading layout setting
  // is shared with the desktop, so switching to cards here is just for this email.
  const [layout, setLayout] = useState<'cards' | 'chat'>('chat');

  useEffect(() => {
    let live = true;
    void api
      .thread(id)
      .then((d) => {
        if (!live) return;
        setData(d);
        cacheThread(id, d);
        if (d.thread.unreadCount > 0) void act(d.thread, { kind: 'read', read: true });
      })
      .catch((e) => !cachedThread(id) && showToast({ text: (e as Error).message }));
    return () => {
      live = false;
    };
  }, [api, id, act, showToast]);

  const hasInvite = data?.messages.some((m) => m.invite);
  // AI first read only for priority mail (Ruben's rule).
  const wantAi = !!settings.aiFirstRead && !!data?.thread.priority && !hasInvite;
  const aiLoading = wantAi && !!data && !ai;
  useEffect(() => {
    if (!wantAi || !data) return;
    let live = true;
    void api
      .firstRead(id)
      .then((r) => live && setAi(r))
      .catch(() => live && setAi({ summary: '', replyIdeas: [] }));
    return () => {
      live = false;
    };
  }, [api, id, wantAi, data]);

  if (!data) {
    return (
      <div className="screen no-tabs" style={{ display: 'grid', placeItems: 'center' }}>
        <Spinner />
      </div>
    );
  }
  const { thread, messages } = data;
  const last = messages[messages.length - 1];
  const others = [
    ...new Set(messages.filter((m) => !m.fromMe && m.from).map((m) => firstName(m.from))),
  ];
  const account = accounts.find((a) => a.id === thread.accountId);

  const archive = () => {
    void act(thread, { kind: 'archive' }, 'Archived');
    back('inbox');
  };
  const snooze = () => {
    void act(thread, { kind: 'snooze', until: tomorrowMorning() }, 'Snoozed until tomorrow 8:00');
    back('inbox');
  };

  const actionsSheet = more && (
    <Sheet onClose={() => setMore(false)}>
      <div style={{ padding: '10px 16px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
        {[
          {
            icon: Pin,
            label: thread.pinned ? 'Unpin' : 'Pin',
            run: () => void act(thread, { kind: 'pin', pinned: !thread.pinned }),
          },
          { icon: Clock, label: 'Snooze until tomorrow 8:00', run: snooze },
          {
            icon: Rows3,
            label: layout === 'chat' ? 'Show as cards' : 'Show as conversation',
            run: () => setLayout(layout === 'chat' ? 'cards' : 'chat'),
          },
          {
            icon: Reply,
            label: 'Mark as unread',
            run: () => (void act(thread, { kind: 'read', read: false }), back('inbox')),
          },
          {
            icon: Trash2,
            label: 'Move to Trash',
            run: () => (void act(thread, { kind: 'trash' }, 'Moved to Trash'), back('inbox')),
            danger: true,
          },
        ].map(({ icon: Icon, label, run, danger }) => (
          <button
            key={label}
            className="gi"
            style={{ color: danger ? 'var(--danger)' : undefined, borderRadius: 12 }}
            onClick={() => (setMore(false), run())}
          >
            <Icon size={20} /> {label}
          </button>
        ))}
      </div>
    </Sheet>
  );

  const aiBlock = wantAi ? (
    <AiFirstRead
      ai={ai}
      loading={aiLoading}
      onIdea={(idea) =>
        go(`compose?reply=${encodeURIComponent(id)}&ask=${encodeURIComponent(idea)}`)
      }
      onSlot={(s) =>
        go(
          `compose?reply=${encodeURIComponent(id)}&slots=${encodeURIComponent(JSON.stringify([s]))}`,
        )
      }
    />
  ) : null;

  if (layout === 'chat') {
    const sendQuick = async (body: string) => {
      const r = await send({
        accountId: thread.accountId,
        to: replyTo(last),
        cc: [],
        subject: reSubject(thread.subject),
        body,
        threadId: thread.id,
      });
      showToast({
        text: r === 'queued' ? 'No connection. Reply will send when you are back online' : 'Sent',
      });
      if (r === 'sent') void api.thread(id).then(setData);
    };
    return (
      <>
        <ConversationE
          thread={thread}
          messages={messages}
          accountName={
            account && accounts.length > 1 ? (account.displayName.split(' ')[0] ?? '') : ''
          }
          ai={wantAi ? ai : undefined}
          aiLoading={aiLoading}
          onArchive={archive}
          onSnooze={snooze}
          onMore={() => setMore(true)}
          onRefresh={() => api.thread(id).then(setData)}
          onIdea={(idea) =>
            go(`compose?reply=${encodeURIComponent(id)}&ask=${encodeURIComponent(idea)}`)
          }
          onSlot={(s) =>
            go(
              `compose?reply=${encodeURIComponent(id)}&slots=${encodeURIComponent(JSON.stringify([s]))}`,
            )
          }
          reply={<QuickReply thread={thread} last={last} onSend={sendQuick} />}
        />
        {actionsSheet}
      </>
    );
  }

  // Cards layout
  return (
    <>
      <div
        className="screen no-tabs"
        style={{ background: 'var(--paper)', paddingBottom: 'calc(100px + var(--safe-bottom))' }}
      >
        <div className="navbar">
          <button className="navbtn accent" onClick={() => back('inbox')}>
            <ChevronLeft size={24} />
            <span style={{ fontSize: 17 }}>Inbox</span>
          </button>
          <div className="row-flex" style={{ gap: 2 }}>
            <button className="navbtn" aria-label="Snooze" onClick={snooze}>
              <Clock size={20} />
            </button>
            <button className="navbtn" aria-label="Archive" onClick={archive}>
              <Archive size={20} />
            </button>
            <button className="navbtn" aria-label="More" onClick={() => setMore(true)}>
              <MoreHorizontal size={20} />
            </button>
          </div>
        </div>
        <div className="pad" style={{ paddingTop: 6 }}>
          <div style={{ fontSize: 23, fontWeight: 700, letterSpacing: '-.01em', lineHeight: 1.2 }}>
            {thread.subject || '(no subject)'}
          </div>
          <div className="row-flex" style={{ marginTop: 10, flexWrap: 'wrap' }}>
            {thread.priority && (
              <span
                className="chip"
                style={{
                  height: 26,
                  fontSize: 12.5,
                  color: 'var(--priority)',
                  borderColor: 'color-mix(in oklch, var(--priority) 40%, transparent)',
                }}
              >
                <Zap size={12} /> Priority
              </span>
            )}
            {account && accounts.length > 1 && (
              <span className="chip" style={{ height: 26, fontSize: 12.5 }}>
                <span className="swatch" style={{ background: account.color }} />
                {account.displayName.split(' ')[0]}
              </span>
            )}
            <span className="chip" style={{ height: 26, fontSize: 12.5 }}>
              {messages.length} {messages.length === 1 ? 'message' : 'messages'}
            </span>
          </div>
        </div>
        <LayoutToggle layout={layout} onChange={setLayout} />
        <div style={{ margin: '10px 14px 0' }}>{aiBlock}</div>
        <CardsStack messages={messages} threadId={id} />
      </div>
      <div
        className="replybar glass"
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
      >
        <div style={{ display: 'flex', flex: 1, justifyContent: 'space-around' }}>
          <button aria-label="Reply" onClick={() => go(`compose?reply=${encodeURIComponent(id)}`)}>
            <Reply size={21} />
          </button>
          <button
            aria-label="Reply all"
            onClick={() => go(`compose?reply=${encodeURIComponent(id)}&all=1`)}
          >
            <ReplyAll size={21} />
          </button>
          <button
            aria-label="Forward"
            onClick={() => go(`compose?forward=${encodeURIComponent(id)}`)}
          >
            <Forward size={21} />
          </button>
          <button
            aria-label="Reply with AI"
            style={{ color: 'var(--accent)' }}
            onClick={() => go(`compose?reply=${encodeURIComponent(id)}&ai=1`)}
          >
            <Sparkles size={21} />
          </button>
        </div>
        <button
          className="send"
          style={{ width: 'auto', padding: '0 16px', fontWeight: 600, fontSize: 15 }}
          onClick={() => go(`compose?reply=${encodeURIComponent(id)}`)}
        >
          Reply
        </button>
      </div>
      {actionsSheet}
    </>
  );
}

export const reSubject = (s: string) => (/^re:/i.test(s) ? s : `Re: ${s}`);
export function replyTo(m: MobileMessage | undefined) {
  if (!m) return [];
  return m.fromMe ? m.to : m.from ? [m.from] : [];
}

function LayoutToggle({
  layout,
  onChange,
}: {
  layout: 'cards' | 'chat';
  onChange: (l: 'cards' | 'chat') => void;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}>
      <div className="pill-seg glass-flat">
        <button className={layout === 'cards' ? 'on' : ''} onClick={() => onChange('cards')}>
          Cards
        </button>
        <button className={layout === 'chat' ? 'on' : ''} onClick={() => onChange('chat')}>
          Chat
        </button>
      </div>
    </div>
  );
}

function safeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    FORBID_TAGS: ['style', 'form', 'input', 'button'],
    ADD_ATTR: ['target'],
  });
}

function Body({ m }: { m: MobileMessage }) {
  const html = useMemo(() => (m.html ? safeHtml(m.html) : null), [m.html]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelectorAll('a').forEach((a) => {
      a.target = '_blank';
      a.rel = 'noreferrer';
    });
  }, [html]);
  if (html)
    return <div ref={ref} className="mail-html" dangerouslySetInnerHTML={{ __html: html }} />;
  return <div className="mail-text">{m.text ?? m.snippet}</div>;
}

function Attachments({ m }: { m: MobileMessage }) {
  if (!m.attachments.length) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 14 }}>
      {m.attachments.map((a) => (
        <div
          key={a.id}
          className="row-flex"
          style={{ gap: 10, padding: '10px 12px', borderRadius: 12, background: 'var(--sunken)' }}
        >
          <Paperclip size={18} color="var(--muted)" />
          <div className="grow">
            <div className="ellipsis" style={{ fontSize: 14, fontWeight: 600 }}>
              {a.filename}
            </div>
            <div className="muted" style={{ fontSize: 12.5 }}>
              {Math.max(1, Math.round(a.size / 1024))} KB
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CardsStack({ messages, threadId }: { messages: MobileMessage[]; threadId: string }) {
  const [open, setOpen] = useState<Set<string>>(
    () =>
      new Set(messages.filter((m, i) => m.unread || i === messages.length - 1).map((m) => m.id)),
  );
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <div style={{ margin: '12px 14px 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
      {messages.map((m) =>
        open.has(m.id) ? (
          <div key={m.id} className="card pop" style={{ padding: 16 }}>
            {/* Tapping the sender row folds the message back to one line. */}
            <div
              className="row-flex"
              role="button"
              tabIndex={0}
              aria-expanded="true"
              aria-label={`Collapse message from ${m.fromMe ? 'you' : displayName(m.from)}`}
              style={{ gap: 11, cursor: 'pointer' }}
              onClick={() => toggle(m.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggle(m.id);
                }
              }}
            >
              <Avatar who={m.from} />
              <div className="grow">
                <div style={{ fontWeight: 600, fontSize: 15.5 }}>
                  {m.fromMe ? 'You' : displayName(m.from)}
                </div>
                <div className="muted ellipsis" style={{ fontSize: 13 }}>
                  to {m.to.map((a) => (a.name ? a.name.split(' ')[0] : a.email)).join(', ')} ·{' '}
                  {shortDate(m.date)}, {clock12(m.date)}
                </div>
              </div>
              <button
                className="muted"
                aria-label="Reply"
                onClick={(e) => {
                  e.stopPropagation();
                  go(`compose?reply=${encodeURIComponent(threadId)}`);
                }}
              >
                <Reply size={20} />
              </button>
            </div>
            <div style={{ marginTop: 14 }}>
              {m.invite ? (
                <InviteCard invite={m.invite} accountId={m.accountId} threadId={threadId} />
              ) : (
                <Body m={m} />
              )}
            </div>
            <Attachments m={m} />
          </div>
        ) : (
          <button
            key={m.id}
            className="card row-flex"
            style={{ padding: '12px 14px', gap: 10, textAlign: 'left' }}
            aria-expanded="false"
            onClick={() => toggle(m.id)}
          >
            <Avatar who={m.from} size={30} />
            <span style={{ fontWeight: 600, fontSize: 14.5 }}>
              {m.fromMe ? 'You' : displayName(m.from)}
            </span>
            <span className="muted ellipsis grow" style={{ fontSize: 13.5 }}>
              {m.snippet}
            </span>
            <span className="muted" style={{ fontSize: 12.5 }}>
              {listTime(m.date)}
            </span>
          </button>
        ),
      )}
    </div>
  );
}

/** Text of a bubble when it is folded to one line. */
function preview(m: MobileMessage): string {
  return (splitQuoted(m.text ?? m.snippet).main || m.snippet || '').replace(/\s+/g, ' ').trim();
}

/**
 * One message in the chat layout, styled like the desktop chat view: a
 * "Name · time" line over a bubble. Tapping the bubble folds it to one line
 * or opens it again; links, buttons and selected text keep their meaning.
 */
function ChatMessage({
  m,
  threadId,
  open,
  onToggle,
}: {
  m: MobileMessage;
  threadId: string;
  open: boolean;
  onToggle: () => void;
}) {
  const { main, quoted } = splitQuoted(m.text ?? m.snippet);
  // A bare forward has nothing above the history, so show the history itself.
  const text = main || quoted;
  const fold = main ? quoted : '';
  const isFwd = /forwarded|transféré/i.test(fold.split('\n', 1)[0] ?? '');
  const [showQuoted, setShowQuoted] = useState(false);
  if (m.invite) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div className="row-flex" style={{ alignItems: 'flex-start' }}>
          <AiMark size={32} />
          <div style={{ fontSize: 15, lineHeight: 1.45, paddingTop: 4 }}>
            {firstName(m.invite.organizer ?? m.from)} invited you to {m.invite.title} on{' '}
            {shortDate(m.invite.startMs)} at {clock12(m.invite.startMs)}.
          </div>
        </div>
        <InviteCard invite={m.invite} accountId={m.accountId} threadId={threadId} />
      </div>
    );
  }
  const tap = (e: React.MouseEvent) => {
    if (!open) return onToggle();
    if ((e.target as Element).closest('a, button, input, textarea')) return;
    if (window.getSelection()?.toString()) return;
    onToggle();
  };
  const out = m.fromMe;
  return (
    <div className={`te-msg${out ? ' out' : ''}`}>
      {!out && <Avatar who={m.from} size={28} />}
      <div className="te-col">
        <div className="te-meta">
          {m.unread && <span className="dot" aria-label="Unread" />}
          <b>{out ? 'You' : firstName(m.from) || displayName(m.from)}</b>
          <span>·</span>
          <span>{listTime(m.date)}</span>
          {open && (
            <button className="te-foldbtn" onClick={onToggle}>
              Fold
            </button>
          )}
        </div>
        <div
          className={`te-bubble${open ? ' mail-text' : ' shut'}`}
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={tap}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
              e.preventDefault();
              onToggle();
            }
          }}
        >
          {open ? (
            <>
              {text || m.snippet}
              {fold &&
                (showQuoted ? (
                  <>
                    <div className="te-quoted">{fold}</div>
                    <button className="te-qbtn" onClick={() => setShowQuoted(false)}>
                      Hide {isFwd ? 'forwarded message' : 'quoted text'}
                    </button>
                  </>
                ) : (
                  <button className="te-qbtn" onClick={() => setShowQuoted(true)}>
                    <MoreHorizontal size={14} /> Show {isFwd ? 'forwarded message' : 'quoted text'}
                  </button>
                ))}
              {m.attachments.length > 0 && (
                <div className="muted row-flex" style={{ fontSize: 13, marginTop: 6 }}>
                  <Paperclip size={13} /> {m.attachments.map((a) => a.filename).join(', ')}
                </div>
              )}
            </>
          ) : (
            <span className="te-pv">
              <span>{preview(m)}</span>
              {m.attachments.length > 0 && <Paperclip size={13} />}
              <ChevronDown size={15} />
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function AiFirstRead({
  ai,
  loading,
  onIdea,
  onSlot,
}: {
  ai: FirstRead | null;
  loading: boolean;
  onIdea: (idea: string) => void;
  onSlot: (s: { startMs: number; endMs: number }) => void;
}) {
  if ((!ai || !ai.summary) && !loading) return null;
  return (
    <div className="row-flex pop" style={{ alignItems: 'flex-start', gap: 8 }}>
      <AiMark size={32} />
      <div
        className="glass"
        style={{ borderRadius: 20, padding: '12px 14px', flex: 1, minWidth: 0 }}
      >
        {!ai ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skeleton" style={{ height: 12, width: '90%' }} />
            <div className="skeleton" style={{ height: 12, width: '70%' }} />
          </div>
        ) : (
          <>
            <div style={{ fontSize: 14.5, lineHeight: 1.45 }}>{ai.summary}</div>
            {ai.freeSlots && ai.freeSlots.length > 0 && (
              <>
                <div className="muted row-flex" style={{ fontSize: 13, marginTop: 10 }}>
                  <CalendarClock size={14} /> You're free at:
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8, overflowX: 'auto' }}>
                  {ai.freeSlots.map((s) => (
                    <button
                      key={s.startMs}
                      onClick={() => onSlot(s)}
                      style={{
                        flex: 'none',
                        width: 120,
                        borderRadius: 14,
                        padding: '9px 10px',
                        textAlign: 'left',
                        background: 'color-mix(in srgb, var(--surface) 75%, transparent)',
                        border: '1px solid color-mix(in oklch, var(--ink) 9%, transparent)',
                      }}
                    >
                      <div
                        className="eyebrow"
                        style={{ fontSize: 9.5, letterSpacing: '.1em', color: 'var(--muted)' }}
                      >
                        {new Date(s.startMs).toLocaleDateString([], {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </div>
                      <div style={{ fontWeight: 700, fontSize: 14.5, marginTop: 5 }}>
                        {clock12(s.startMs)}
                      </div>
                      <div className="muted" style={{ fontSize: 12 }}>
                        30 min
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
            {ai.replyIdeas.length > 0 && (
              <div style={{ display: 'flex', gap: 7, marginTop: 10, flexWrap: 'wrap' }}>
                {ai.replyIdeas.map((r) => (
                  <button key={r} className="chip sm" onClick={() => onIdea(r)}>
                    {r}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function QuickReply({
  thread,
  last,
  onSend,
}: {
  thread: MobileThread;
  last: MobileMessage | undefined;
  onSend: (body: string) => Promise<void>;
}) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const to = replyTo(last);
  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await onSend(body.trim());
      setBody('');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="te-reply">
      <div className="row-flex" style={{ alignItems: 'flex-end', gap: 8 }}>
        <textarea
          rows={Math.min(5, Math.max(1, body.split('\n').length))}
          placeholder={`Reply to ${firstName(to[0]) || 'everyone'}…`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          style={{ padding: '8px 0' }}
        />
        <button
          className="send"
          disabled={!body.trim() || busy}
          aria-label="Send"
          onClick={() => void submit()}
        >
          {busy ? <Spinner /> : <ArrowUp size={20} />}
        </button>
      </div>
      <div className="row-flex muted" style={{ gap: 16, fontSize: 12.5 }}>
        <button
          className="row-flex"
          style={{ gap: 4, color: 'var(--accent)' }}
          onClick={() =>
            go(
              `compose?reply=${encodeURIComponent(thread.id)}&ai=1&body=${encodeURIComponent(body)}`,
            )
          }
        >
          <Sparkles size={14} /> Assistant
        </button>
        <button
          className="row-flex"
          style={{ gap: 4 }}
          onClick={() =>
            go(
              `compose?reply=${encodeURIComponent(thread.id)}&times=1&body=${encodeURIComponent(body)}`,
            )
          }
        >
          <CalendarClock size={14} /> Times
        </button>
        <button
          className="row-flex"
          style={{ gap: 4 }}
          onClick={() => go(`compose?forward=${encodeURIComponent(thread.id)}`)}
        >
          <Forward size={14} /> Forward
        </button>
        <button
          onClick={() =>
            go(`compose?reply=${encodeURIComponent(thread.id)}&body=${encodeURIComponent(body)}`)
          }
        >
          Composer
        </button>
      </div>
    </div>
  );
}

/** Hours since the newest message from someone else, when it waits on you. */
function waitingHours(messages: MobileMessage[]): number | null {
  const last = messages[messages.length - 1];
  if (!last || last.fromMe) return null;
  return Math.max(0, (Date.now() - last.date) / 3_600_000);
}

/**
 * Design E conversation page: eyebrow + actions, the sender with a waiting
 * ring, a frosted "what they want" card for priority mail, earlier messages
 * folded, AI quick replies above the reply box. Swipe from the left edge goes
 * back; pull down refreshes.
 */
function ConversationE({
  thread,
  messages,
  accountName,
  ai,
  aiLoading,
  onArchive,
  onSnooze,
  onMore,
  onRefresh,
  onIdea,
  onSlot,
  reply,
}: {
  thread: MobileThread;
  messages: MobileMessage[];
  accountName: string;
  ai: FirstRead | null | undefined;
  aiLoading: boolean;
  onArchive: () => void;
  onSnooze: () => void;
  onMore: () => void;
  onRefresh: () => Promise<unknown>;
  onIdea: (idea: string) => void;
  onSlot: (s: { startMs: number; endMs: number }) => void;
  reply: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { pull, refreshing } = useEdgeBackAndPull(ref, () => back('inbox'), onRefresh);
  const [unfold, setUnfold] = useState(false);
  const [ask, setAsk] = useState(false);
  const lastOther = [...messages].reverse().find((m) => !m.fromMe && m.from);
  const who = lastOther?.from ?? thread.lastFrom;
  const first = firstName(who);
  const h = thread.priority ? waitingHours(messages) : null;
  const C = 2 * Math.PI * 29;
  const frac = h == null ? 0 : Math.min(1, Math.max(0.05, h / 10));
  // The newest message (and any unread one) starts open, older ones folded to
  // one line; tapping any bubble flips it. Past seven messages the oldest
  // hide behind one button.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const lastId = messages[messages.length - 1]?.id;
  const isOpen = (m: MobileMessage) => toggled[m.id] ?? (m.id === lastId || m.unread);
  const flip = (m: MobileMessage) => setToggled((t) => ({ ...t, [m.id]: !isOpen(m) }));
  const foldN = !unfold && messages.length > 7 ? messages.length - 7 : 0;
  const shown = messages.slice(foldN);
  const latestRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = latestRef.current;
    const box = ref.current;
    if (!el || !box || messages.length < 2) return;
    const top = el.getBoundingClientRect().top - box.getBoundingClientRect().top;
    // Only jump when the newest message starts below the first screen.
    if (top > box.clientHeight * 0.55) box.scrollTop += top - 90;
  }, [lastId]); // eslint-disable-line react-hooks/exhaustive-deps
  let gist: ReactNode = ai?.summary ?? null;
  if (ai?.summary && first && ai.summary.startsWith(first))
    gist = (
      <>
        <b>{first}</b>
        {ai.summary.slice(first.length)}
      </>
    );
  return (
    <div className="ib-page te-page">
      <div className="screen no-tabs te" ref={ref}>
        <div className="ib-ptr" style={{ height: pull }} aria-hidden={!pull}>
          {pull > 0 &&
            (refreshing ? <Spinner /> : <ArrowUp size={18} style={{ rotate: '180deg' }} />)}
        </div>
        <div className="te-top">
          <span className="eyebrow">
            {accountName ? `${accountName} · ` : ''}
            {messages.length} {messages.length === 1 ? 'message' : 'messages'}
          </span>
          <button className="te-ic" aria-label="Snooze" onClick={onSnooze}>
            <Clock size={18} />
          </button>
          <button className="te-ic" aria-label="Archive" onClick={onArchive}>
            <Archive size={18} />
          </button>
          <button className="te-ic" aria-label="More" onClick={onMore}>
            <MoreHorizontal size={19} />
          </button>
          <button className="ib-orb glass" aria-label="Assistant" onClick={() => setAsk(true)}>
            <Sparkles size={17} />
          </button>
        </div>
        <div className="te-head">
          <span className="ring">
            {h != null && (
              <svg viewBox="0 0 62 62" aria-hidden>
                <defs>
                  <linearGradient id="te-g">
                    <stop offset="0" stopColor="var(--aqua)" />
                    <stop offset=".6" stopColor="var(--azure)" />
                    <stop offset="1" stopColor="var(--violet)" />
                  </linearGradient>
                </defs>
                <circle cx="31" cy="31" r="29" fill="none" stroke="var(--hair)" strokeWidth="3" />
                <circle
                  cx="31"
                  cy="31"
                  r="29"
                  fill="none"
                  stroke="url(#te-g)"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={`${C * frac} ${C}`}
                />
              </svg>
            )}
            <Avatar who={who} size={50} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h2>{thread.subject || '(no subject)'}</h2>
            <p>
              {displayName(who)}
              {h != null &&
                ` · waiting ${h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : `${Math.round(h)} h`}`}
            </p>
          </div>
        </div>
        {ai !== undefined && (aiLoading || ai?.summary) && (
          <div className="te-gist glass pop">
            <div className="lb">
              <AiMark size={20} />
              What {first || 'they'} want{first ? 's' : ''}
            </div>
            {!ai ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                <div className="skeleton" style={{ height: 14, width: '92%' }} />
                <div className="skeleton" style={{ height: 14, width: '64%' }} />
              </div>
            ) : (
              <>
                <div className="tx">{gist}</div>
                {ai.freeSlots && ai.freeSlots.length > 0 && (
                  <div className="te-slots">
                    <span>
                      <CalendarClock size={13} /> You're free at
                    </span>
                    {ai.freeSlots.map((s) => (
                      <button key={s.startMs} onClick={() => onSlot(s)}>
                        {new Date(s.startMs).toLocaleDateString([], { weekday: 'short' })}{' '}
                        {clock12(s.startMs)}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        <div className="te-msgs">
          {foldN > 0 && (
            <button className="te-fold" onClick={() => setUnfold(true)}>
              {foldN} older message{foldN > 1 ? 's' : ''}
            </button>
          )}
          {shown.map((m, i) => {
            const prev = shown[i - 1];
            const newDay =
              !prev || new Date(prev.date).toDateString() !== new Date(m.date).toDateString();
            return (
              <div
                key={m.id}
                ref={m.id === lastId ? latestRef : undefined}
                style={{ display: 'contents' }}
              >
                {newDay && (
                  <div className="te-day">
                    <i />
                    {dayWord(m.date)}
                    <i />
                  </div>
                )}
                <ChatMessage m={m} threadId={thread.id} open={isOpen(m)} onToggle={() => flip(m)} />
              </div>
            );
          })}
        </div>
        {ai?.replyIdeas && ai.replyIdeas.length > 0 && (
          <div className="te-quick">
            {ai.replyIdeas.map((r) => (
              <button key={r} onClick={() => onIdea(r)}>
                <AiMark size={16} />
                {r}
              </button>
            ))}
          </div>
        )}
        {reply}
      </div>
      {ask && <AskSheet thread={thread} onClose={() => setAsk(false)} />}
    </div>
  );
}

function dayWord(ms: number): string {
  const d = new Date(ms).toDateString();
  if (d === new Date().toDateString()) return 'Today';
  if (d === new Date(Date.now() - 86_400_000).toDateString()) return 'Yesterday';
  return shortDate(ms);
}
