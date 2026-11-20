import type { QuickReplyItem } from '@app/shared';
import {
  Archive,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Forward,
  Mail,
  Pin,
  SquareArrowOutUpRight,
  Sparkles,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { Keycaps } from '../ui/Keycap';
import { AiMenu, type AiMenuPick } from './AiMenu';
import {
  AssistantRead,
  Bubble,
  ChatAvatar,
  ForwardNote,
  NotesList,
  OutgoingList,
  ReplyField,
  TimesNote,
} from './ChatParts';
import { nameOf, useChatThread } from './useChatThread';

/** Older messages beyond this many fold into one "N earlier messages" row. */
const SHOWN_MESSAGES = 3;

const metaKey = (e: KeyboardEvent | React.KeyboardEvent) => e.metaKey || e.ctrlKey;

/**
 * Measures a content element and returns a pixel height for its scroll box
 * (plus `extra` for the box's own padding). The box animates to it through
 * CSS (.qr-convo); the first measurement lands without a transition.
 */
function useAutoHeight(extra: number) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!el) return;
    const measure = () => setHeight(Math.ceil(el.getBoundingClientRect().height) + extra);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // Animate only changes after the first frame, not the opening size.
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setSettled(true)));
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [el, extra]);
  return { setContent: setEl, height, settled };
}

/** Notification Center replies already sent, by seq: a remount or a later state push mustn't send twice. */
const sentFromNotificationCenter = new Set<number>();

/**
 * The quick-reply widget: the whole thread as a chat, the assistant's read of
 * it with reply ideas, suggested times and files as cards, and a reply field
 * that sends with Undo. The rail on the right holds the quick actions.
 */
export function ReplyWidget({
  item,
  position,
  send: written,
  onStep,
  onClose,
  onEscape = onClose,
  onDone,
}: {
  item: QuickReplyItem;
  position: { index: number; total: number };
  /** A reply typed in Notification Center: sent as soon as the thread is loaded, with Undo. */
  send?: { text: string; seq: number } | null;
  /** 1 = older email in the queue, -1 = newer. */
  onStep: (dir: 1 | -1) => void;
  onClose: () => void;
  /** Esc: back to the list it was opened from, else close (defaults to onClose). */
  onEscape?: () => void;
  /** Archived: move on to the next email. */
  onDone: () => void;
}) {
  const threadId = item.threadId!;
  const chat = useChatThread(threadId, { accountIdHint: item.accountId, markRead: true });
  const {
    messages,
    own,
    bodies,
    ready,
    ideas,
    times,
    notes,
    outgoing,
    forwarding,
    setForwarding,
    draft,
    latest,
    accountId,
    all,
    fieldRef,
  } = chat;
  const [menu, setMenu] = useState(false);
  const [unread, setUnread] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  // The conversation's height follows its content on a transition, so the
  // widget grows and shrinks smoothly as the email, the AI read and replies arrive.
  const { setContent: setConvoContent, height: convoHeight, settled: convoSettled } = useAutoHeight(4);

  // Keep the newest thing in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, ideas, times, notes.length, outgoing.length, forwarding]);

  // A reply typed in Notification Center goes out once the thread, accounts and signatures are in.
  useEffect(() => {
    if (!written || !latest || !ready.own || !ready.sigs) return;
    if (sentFromNotificationCenter.has(written.seq)) return;
    const t = setTimeout(() => {
      sentFromNotificationCenter.add(written.seq);
      chat.send(written.text);
    }, 0);
    return () => clearTimeout(t);
  });

  const onMenuPick = (pick: AiMenuPick) => {
    setMenu(false);
    void chat.runAiPick(pick);
  };

  const toggleUnread = () => {
    if (!latest) return;
    const next = !unread;
    void api.command('task:enqueue', { type: 'set-seen', accountId, messageIds: [latest.id], seen: !next });
    setUnread(next);
    toast(next ? 'Marked as unread' : 'Marked as read');
  };

  /** ⌘K: keep this email in the ⌥⌘N list after it's read (or let it go again). */
  const toggleKeep = () => {
    const on = !item.kept;
    void api.command('quick-reply:keep', { id: item.id, keep: on });
    toast(on ? 'Kept in the list' : 'No longer kept');
  };

  const showTimes = chat.showTimes;

  const done = () => {
    void api.command('task:enqueue', { type: 'move-thread', accountId, threadId, toRole: 'archive' });
    toast('Marked as done');
    onDone();
  };

  const openInComposer = () => {
    if (!latest) return;
    const text = chat.replyText();
    void api.command('quick-reply:open-in-app', {
      threadId,
      accountId,
      composer: {
        mode: all ? 'reply-all' : 'reply',
        accountId,
        replyTo: latest,
        subject: latest.subject,
        ...(text ? { initialBody: text } : {}),
      },
    });
  };

  // Keys. The field keeps plain keys; the rest are ⌘ chords so typing never triggers them.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'TEXTAREA' || t.tagName === 'INPUT';
      const k = e.key.toLowerCase();
      if (e.key === 'Escape') {
        e.preventDefault();
        if (forwarding) setForwarding(false);
        else onEscape();
        return;
      }
      if (metaKey(e) && !e.altKey && !e.shiftKey && k === 'j') {
        e.preventDefault();
        setMenu((m) => !m);
      } else if (metaKey(e) && !e.altKey && !e.shiftKey && k === 'k') {
        e.preventDefault();
        toggleKeep();
      } else if (metaKey(e) && !e.altKey && !e.shiftKey && k === 'u') {
        e.preventDefault();
        toggleUnread();
      } else if (metaKey(e) && e.shiftKey && k === 'a') {
        e.preventDefault();
        showTimes();
      } else if (metaKey(e) && e.shiftKey && k === 'f') {
        e.preventDefault();
        setForwarding(true);
      } else if (metaKey(e) && !e.shiftKey && k === 'e') {
        e.preventDefault();
        done();
      } else if (metaKey(e) && e.shiftKey && k === 'o') {
        e.preventDefault();
        openInComposer();
      } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.shiftKey) {
        // ⌥⌘←/→ anywhere; bare ←/→ when not typing (or the reply is still empty).
        const chord = e.altKey && metaKey(e);
        const bare = !e.altKey && !metaKey(e) && (!typing || (t === fieldRef.current && !draft));
        if (!chord && !bare) return;
        e.preventDefault();
        onStep(e.key === 'ArrowRight' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });


  const older = messages.slice(0, Math.max(0, messages.length - SHOWN_MESSAGES));
  const shown = showOlder ? messages : messages.slice(-SHOWN_MESSAGES);

  type RailId = 'ai' | 'unread' | 'keep' | 'times' | 'forward' | 'done';
  const rail: { id: RailId; icon: React.ReactNode; label: string; keys: string[]; on?: boolean; ai?: boolean }[] = [
    { id: 'ai', icon: <Sparkles size={19} />, label: 'Assistant', keys: ['⌘', 'J'], on: menu, ai: true },
    {
      id: 'unread',
      icon: (
        <span className="relative inline-flex">
          <Mail size={19} />
          {unread && <span className="bg-accent absolute -right-[3px] -top-[2px] h-2 w-2 rounded-full" />}
        </span>
      ),
      label: unread ? 'Mark as read' : 'Mark as unread',
      keys: ['⌘', 'U'],
      on: unread,
    },
    {
      id: 'keep',
      icon: <Pin size={19} className="-rotate-45" />,
      label: item.kept ? 'Kept in the list' : 'Keep in the list',
      keys: ['⌘', 'K'],
      on: !!item.kept,
    },
    {
      id: 'times',
      icon: <CalendarClock size={19} />,
      label: 'Check my availability',
      keys: ['⌘', '⇧', 'A'],
      on: !!times && times !== 'none',
    },
    { id: 'forward', icon: <Forward size={19} />, label: 'Forward', keys: ['⌘', '⇧', 'F'], on: forwarding },
    { id: 'done', icon: <Archive size={19} />, label: 'Done', keys: ['⌘', 'E'] },
  ];

  function runRail(id: RailId) {
    if (id === 'ai') setMenu((m) => !m);
    else if (id === 'unread') toggleUnread();
    else if (id === 'keep') toggleKeep();
    else if (id === 'times') showTimes();
    else if (id === 'forward') setForwarding((f) => !f);
    else done();
  }

  return (
    <div
      className="qr-enter absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-4"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div
        role="dialog"
        aria-label={`Reply to ${nameOf(item.fromEmail ? { email: item.fromEmail, name: item.title } : null)}`}
        className="qr-glass flex max-h-[86vh] w-[680px] max-w-[calc(100vw-120px)] flex-col rounded-[28px] px-[26px] pb-5 pt-[22px]"
      >
        <div className="qr-tint" />
        {/* Header: who, what, where in the queue */}
        <div className="relative mb-4 flex items-center gap-2.5">
          <ChatAvatar who={latest ? nameOf(latest.from) : item.title} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-semibold">{latest ? nameOf(latest.from) : item.title}</div>
            <div className="text-ink-muted truncate text-[12px]">
              {latest?.subject || item.body || '(no subject)'}
              {messages.length > 1 && ` · ${messages.length} messages`}
            </div>
          </div>
          {position.total > 1 && (
            <div className="flex items-center gap-0.5 text-[12px]">
              <button
                aria-label="Newer email"
                disabled={position.index <= 0}
                onClick={() => onStep(-1)}
                className="text-ink-muted hover:text-ink disabled:text-ink-faint/50 rounded p-0.5"
              >
                <ChevronLeft size={15} />
              </button>
              <b className="tabular-nums">
                {position.index + 1} of {position.total}
              </b>
              <button
                aria-label="Older email"
                disabled={position.index >= position.total - 1}
                onClick={() => onStep(1)}
                className="text-ink-muted hover:text-ink disabled:text-ink-faint/50 rounded p-0.5"
              >
                <ChevronRight size={15} />
              </button>
            </div>
          )}
          <button onClick={onClose} aria-label="Close" className="ml-2">
            <Keycaps keys={['esc']} />
          </button>
        </div>

        {/* The conversation */}
        <div
          ref={scrollRef}
          className="qr-convo relative -mx-2 min-h-0 shrink overflow-y-auto px-2 pb-1"
          data-settled={convoSettled || undefined}
          style={{ height: convoHeight }}
        >
          <div ref={setConvoContent} className="flex flex-col gap-3.5">
          {!showOlder && older.length > 0 && (
            <button
              onClick={() => setShowOlder(true)}
              className="text-ink-faint hover:text-ink-muted self-center text-[11.5px]"
            >
              {older.length} earlier message{older.length > 1 ? 's' : ''}
            </button>
          )}
          {shown.map((m, i) => (
            <div key={m.id} className="qr-msg-in" style={{ animationDelay: `${Math.min(i, 4) * 50}ms` }}>
              <Bubble message={m} body={bodies[m.id]} mine={!!m.from && own.has(m.from.email.toLowerCase())} />
            </div>
          ))}

          {latest && <AssistantRead chat={chat} />}
          <TimesNote chat={chat} />
          <ForwardNote chat={chat} />
          <NotesList chat={chat} />
          <OutgoingList chat={chat} />
          </div>
        </div>

        {/* The reply field: drop times here, ⌘↩ sends */}
        <ReplyField chat={chat} className="mt-3.5" autoFocus />
      </div>

      {/* Quick actions */}
      <div className="relative">
        <div className="qr-glass flex flex-col gap-2 rounded-full p-[9px]">
          {rail.map((r) => (
            <button
              key={r.label}
              {...(r.ai ? { 'data-ai-toggle': true } : {})}
              title={`${r.label}  ${r.keys.join('')}`}
              aria-label={r.label}
              onClick={() => runRail(r.id)}
              data-on={r.on && !r.ai}
              className={cn('qr-rail-btn', r.ai && 'qr-ai !text-white')}
            >
              {r.icon}
            </button>
          ))}
          <div className="bg-ink/10 mx-2 h-px" />
          <button
            title="Open in the composer  ⌘⇧O"
            aria-label="Open in the composer"
            onClick={openInComposer}
            className="qr-rail-btn !text-ink-muted hover:!text-accent"
          >
            <SquareArrowOutUpRight size={18} />
          </button>
        </div>
        {menu && <AiMenu hasDraft={!!draft.trim()} onPick={(p) => onMenuPick(p)} onClose={() => setMenu(false)} />}
      </div>
    </div>
  );
}
