import type { MessageMeta, ThreadSummary } from '@app/shared';
import { CalendarClock, Forward, Sparkles, SquareArrowOutUpRight } from 'lucide-react';
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useUi } from '../../state/store';
import { registerIdleBlocker } from '../../lib/idleHome';
import { registerChatReply } from '../../lib/chatReply';
import { Composer } from '../composer/Composer';
import { cn } from '../../lib/utils';
import { AiMenu, type AiMenuPick } from '../quickreply/AiMenu';
import {
  AssistantRead,
  InviteNote,
  Bubble,
  ChatSurface,
  ForwardNote,
  NotesList,
  OutgoingList,
  ReplyField,
  TimesNote,
} from '../quickreply/ChatParts';
import { nameOf, useChatThread } from '../quickreply/useChatThread';
import { PriorityMark } from './PriorityBolt';
import { RecipientList, RecipientWords, hasRecipientLine, recipientsOverflow } from './ChatRecipients';
import {
  DraftItem,
  ThreadHeader,
  focusPaneOnBackground,
  paneEscape,
  paneScrollKeys,
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

/** The small sender · time line above a bubble, with who else it went to. */
function BubbleMeta({
  message,
  mine,
  own,
  open,
  onToggle,
}: {
  message: MessageMeta;
  mine: boolean;
  own: Set<string>;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <span
      className={cn(
        'text-ink-faint flex min-w-0 items-center gap-1.5 px-1 text-[11.5px]',
        mine && 'justify-end',
      )}
    >
      {!message.seen && !mine && (
        <span className="bg-accent h-1.5 w-1.5 shrink-0 rounded-full" aria-label="Unread" />
      )}
      <span className={cn('text-ink-muted shrink-0', !message.seen && !mine && 'text-ink font-semibold')}>
        {mine ? 'You' : nameOf(message.from)}
      </span>
      {!mine && <PriorityMark email={message.from?.email} />}
      <span>·</span>
      <span className="shrink-0 tabular-nums">{timeLabel(message.date)}</span>
      {hasRecipientLine(message, mine) && (
        <RecipientWords message={message} own={own} open={open} onToggle={onToggle} />
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
  // Messages whose full To/Cc list is unfolded under the name.
  const [peopleOpen, setPeopleOpen] = useState<Set<string>>(() => new Set());
  const togglePeople = (id: string) =>
    setPeopleOpen((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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

  // The reply box grows into the full composer (formatting, attachments,
  // Cc/Bcc, templates, send later, signature) right here, carrying what was
  // typed.
  const composer = useUi((s) => s.composer);
  const docked = composer?.docked && composer.replyTo?.threadId === thread.id ? composer : null;
  const openInComposer = (
    mode: 'reply' | 'reply-all' | 'forward' = chat.all ? 'reply-all' : 'reply',
  ) => {
    if (!latest) return;
    const text = mode === 'forward' ? '' : chat.replyText();
    openComposer({
      mode,
      accountId: chat.accountId,
      replyTo: latest,
      subject: latest.subject,
      docked: true,
      ...(text ? { initialBody: text, initialBodyHtml: chat.replyHtml() } : {}),
    });
    if (text) chat.setDraft('');
  };
  // r / ⇧R / f while this chat is open answer from its own reply box: r puts
  // the cursor there replying to everyone, ⇧R to the sender, f forwards.
  const answerRef = useRef<(mode: 'reply' | 'reply-all' | 'forward') => void>(() => {});
  useEffect(() => {
    answerRef.current = (mode) => {
      if (mode === 'forward') return chat.setForwarding(true);
      if (chat.others.length > 1) chat.setReplyAll(mode === 'reply-all');
      chat.fieldRef.current?.focus();
    };
  });
  useEffect(() => registerChatReply(thread.id, (mode) => answerRef.current(mode)), [thread.id]);
  // Text in the reply box (or a forward in progress) lives only here, so hold
  // the idle return to Home until it's sent or cleared.
  const unsentRef = useRef(false);
  const unsent = !!chat.draft.trim() || forwarding;
  useEffect(() => {
    unsentRef.current = unsent;
  }, [unsent]);
  useEffect(() => registerIdleBlocker(() => unsentRef.current), []);

  // Inside the pane, ⌘. opens the chat's one AI menu: the reply rewrites (as on
  // the island) plus ⌘.'s email actions (summary, write a reply, translate).
  // ⌘⇧A checks availability, ⌘⇧F forwards.
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (paneEscape(e)) return;
    if (paneScrollKeys(e)) return;
    const meta = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (meta && !e.shiftKey && !e.altKey && k === '.') {
      e.preventDefault();
      e.stopPropagation();
      setMenu((m) => !m);
    } else if (meta && e.shiftKey && k === 'a') {
      e.preventDefault();
      e.stopPropagation();
      chat.showTimes();
    } else if (meta && e.shiftKey && k === 'c') {
      e.preventDefault();
      e.stopPropagation();
      chat.setCcOpen(true);
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
            data-reading-scroll
            tabIndex={-1}
            className="min-h-0 flex-1 overflow-y-auto focus:outline-none"
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
                          meta={
                            <div className="flex min-w-0 flex-col">
                              <BubbleMeta
                                message={m}
                                mine={mine}
                                own={own}
                                open={peopleOpen.has(m.id)}
                                onToggle={() => togglePeople(m.id)}
                              />
                              {recipientsOverflow(m) && (
                                <RecipientList message={m} own={own} open={peopleOpen.has(m.id)} />
                              )}
                            </div>
                          }
                        />
                      </div>
                    )}
                  </Fragment>
                );
              })}

              {latest && <AssistantRead chat={chat} />}
              <InviteNote chat={chat} />
              <TimesNote chat={chat} />
              <ForwardNote chat={chat} />
              <NotesList chat={chat} />
              <OutgoingList chat={chat} />
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[860px] shrink-0 px-6 pb-4 pt-1">
            {docked ? (
              <Composer key={`${docked.mode}-${docked.replyTo?.id ?? 'new'}`} state={docked} />
            ) : (
              <>
                {menu && (
                  <AiMenu
                    hasDraft={!!chat.draft.trim()}
                    onPick={onMenuPick}
                    onClose={() => setMenu(false)}
                    translate
                    className="ai-glass chat-menu bottom-[calc(100%+6px)] left-6"
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
                        title="Assistant  ⌘."
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
                      <button
                        onClick={() => openInComposer()}
                        title="Open the full composer here"
                        className={tool}
                      >
                        <SquareArrowOutUpRight size={12} /> Composer
                      </button>
                      <span className="bg-hairline h-3 w-px" />
                    </>
                  }
                />
              </>
            )}
          </div>
        </div>
      </div>
    </ChatSurface.Provider>
  );
}
