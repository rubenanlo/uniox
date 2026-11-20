import type { MessageMeta, ThreadSummary } from '@app/shared';
import { CalendarClock, Forward, Sparkles, SquareArrowOutUpRight } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useUi } from '../../state/store';
import { cn } from '../../lib/utils';
import { AiMenu, type AiMenuPick } from '../quickreply/AiMenu';
import {
  AssistantRead,
  Bubble,
  ChatSurface,
  ForwardNote,
  NotesList,
  OutgoingList,
  ReplyField,
  TimesNote,
} from '../quickreply/ChatParts';
import { nameOf, useChatThread } from '../quickreply/useChatThread';
import {
  DraftItem,
  ThreadHeader,
  focusPaneOnBackground,
  paneEscape,
  useOpenMarksRead,
} from './ThreadView';

/** Threads longer than this fold their older messages into one row. */
const FOLD_OVER = 8;
/** How many of the newest messages stay out when folded. */
const FOLD_KEEP = 6;

const dayKey = (ms: number) => new Date(ms).toDateString();
const dayLabel = (ms: number) => {
  const d = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
};
const timeLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

/** The small sender · time line above a bubble. */
function BubbleMeta({ message, mine }: { message: MessageMeta; mine: boolean }) {
  return (
    <span
      className={cn(
        'text-ink-faint flex items-center gap-1.5 px-1 text-[11.5px]',
        mine && 'justify-end',
      )}
    >
      {!message.seen && !mine && (
        <span className="bg-accent h-1.5 w-1.5 rounded-full" aria-label="Unread" />
      )}
      <span className={cn('text-ink-muted', !message.seen && !mine && 'text-ink font-semibold')}>
        {mine ? 'You' : nameOf(message.from)}
      </span>
      <span>·</span>
      <span className="tabular-nums">{timeLabel(message.date)}</span>
      {mine && message.to.length > 0 && (
        <span className="truncate">
          to {message.to.map((a) => a.name?.split(' ')[0] || a.email).join(', ')}
        </span>
      )}
    </span>
  );
}

/**
 * The reading pane as a chat, the same conversation the ⌥⌘N island shows:
 * messages as bubbles (yours on the right), the assistant's read with reply
 * ideas, suggested times, forward and answers from the AI menu, and a reply
 * field at the bottom that sends with Undo.
 */
export function ChatThreadView({ thread }: { thread: ThreadSummary }) {
  useOpenMarksRead(thread);
  const chat = useChatThread(thread.id, { accountIdHint: thread.accountId, withDrafts: true });
  const { messages, mail, bodies, own, loaded, latest, ideas, times, notes, outgoing, forwarding } =
    chat;
  const [menu, setMenu] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const openComposer = useUi((s) => s.openComposer);

  // Open on the newest message, like a chat.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && loaded) el.scrollTop = el.scrollHeight;
  }, [loaded]);

  // New messages and anything you asked for scroll into view; the assistant's
  // own read and times only follow when you're already at the bottom.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages.length, notes.length, outgoing.length, forwarding]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el && atBottom.current) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [ideas, times]);

  const onMenuPick = (pick: AiMenuPick) => {
    setMenu(false);
    void chat.runAiPick(pick);
  };

  const openInComposer = () => {
    if (!latest) return;
    const text = chat.replyText();
    openComposer({
      mode: chat.all ? 'reply-all' : 'reply',
      accountId: chat.accountId,
      replyTo: latest,
      subject: latest.subject,
      ...(text ? { initialBody: text } : {}),
    });
    chat.setDraft('');
  };

  // Inside the pane, ⌘J opens the chat's AI menu (as on the island) instead of
  // the global palette; ⌘⇧A checks availability, ⌘⇧F forwards.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (paneEscape(e)) return;
    const meta = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (meta && !e.shiftKey && !e.altKey && k === 'j') {
      e.preventDefault();
      e.stopPropagation();
      setMenu((m) => !m);
    } else if (meta && e.shiftKey && k === 'a') {
      e.preventDefault();
      e.stopPropagation();
      chat.showTimes();
    } else if (meta && e.shiftKey && k === 'f') {
      e.preventDefault();
      e.stopPropagation();
      chat.setForwarding(true);
    }
  };

  const folded = !showOlder && mail.length > FOLD_OVER;
  const hiddenIds = new Set(folded ? mail.slice(0, mail.length - FOLD_KEEP).map((m) => m.id) : []);
  const shown = messages.filter((m) => !hiddenIds.has(m.id));
  const isMine = (m: MessageMeta) => !!m.from && own.has(m.from.email.toLowerCase());

  const tool = 'hover:text-ink flex items-center gap-1 rounded-md';

  return (
    <ChatSurface.Provider value="pane">
      <div
        className="reading-pane chat-pane flex h-full min-w-0 flex-col focus:outline-none"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onMouseDown={focusPaneOnBackground}
      >
        <ThreadHeader thread={thread} />
        <div className="chat-wash flex min-h-0 flex-1 flex-col">
          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto"
            onScroll={(e) => {
              const el = e.currentTarget;
              atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
            }}
          >
            <div className="mx-auto flex w-full max-w-[860px] flex-col gap-3.5 px-6 pb-4 pt-5">
              {folded && (
                <button
                  onClick={() => setShowOlder(true)}
                  className="text-ink-faint hover:text-ink-muted self-center text-[11.5px]"
                >
                  {hiddenIds.size} earlier messages
                </button>
              )}
              {shown.map((m, i) => {
                const prev = shown[i - 1];
                const newDay = !prev || dayKey(prev.date) !== dayKey(m.date);
                const mine = isMine(m);
                return (
                  <Fragment key={m.id}>
                    {newDay && (
                      <div className="text-ink-faint my-1 flex items-center gap-3 text-[11px] font-medium">
                        <span className="bg-hairline h-px flex-1" />
                        {dayLabel(m.date)}
                        <span className="bg-hairline h-px flex-1" />
                      </div>
                    )}
                    {m.draft ? (
                      <div className="ml-auto w-full max-w-[75%]">
                        <DraftItem message={m} />
                      </div>
                    ) : (
                      <div
                        className="qr-msg-in"
                        style={{ animationDelay: `${Math.min(i, 4) * 40}ms` }}
                      >
                        <Bubble
                          message={m}
                          body={bodies[m.id]}
                          mine={mine}
                          narrow
                          meta={<BubbleMeta message={m} mine={mine} />}
                        />
                      </div>
                    )}
                  </Fragment>
                );
              })}

              {latest && <AssistantRead chat={chat} />}
              {/* Room for cards about the email itself, e.g. an invite's Accept / Decline / Propose card. */}
              <TimesNote chat={chat} />
              <ForwardNote chat={chat} />
              <NotesList chat={chat} />
              <OutgoingList chat={chat} />
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[860px] shrink-0 px-6 pb-4 pt-1">
            {menu && (
              <AiMenu
                hasDraft={!!chat.draft.trim()}
                onPick={onMenuPick}
                onClose={() => setMenu(false)}
                className="ai-glass bottom-[calc(100%+6px)] left-6"
              />
            )}
            <ReplyField
              chat={chat}
              className="chat-reply"
              tools={
                <>
                  <button
                    data-ai-toggle
                    onClick={() => setMenu((m) => !m)}
                    title="Assistant  ⌘J"
                    className={cn(tool, 'text-accent font-medium')}
                  >
                    <Sparkles size={13} /> Assistant
                  </button>
                  <button
                    onClick={chat.showTimes}
                    title="Check my availability  ⌘⇧A"
                    className={tool}
                  >
                    <CalendarClock size={13} /> Times
                  </button>
                  <button
                    onClick={() => chat.setForwarding(true)}
                    title="Forward  ⌘⇧F"
                    className={tool}
                  >
                    <Forward size={13} /> Forward
                  </button>
                  <button onClick={openInComposer} title="Open in the composer" className={tool}>
                    <SquareArrowOutUpRight size={12} /> Composer
                  </button>
                  <span className="bg-hairline h-3 w-px" />
                </>
              }
            />
          </div>
        </div>
      </div>
    </ChatSurface.Provider>
  );
}
