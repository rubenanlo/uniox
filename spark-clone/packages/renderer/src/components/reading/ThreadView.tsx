import type { Address, MessageMeta, ThreadSummary } from '@app/shared';
import { textToHtml } from '@app/email-render';
import {
  AlarmClock,
  Bell,
  Forward,
  Layers,
  MessagesSquare,
  Printer,
  Reply,
  ReplyAll,
  Rows3,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ACTIONS, keysFor, markThreadRead } from '../../actions/registry';
import { api } from '../../lib/api';
import { focusPanelLeft } from '../../lib/panels';
import { printThread } from '../../lib/print';
import { cn, formatFullDate, initials, senderLabel } from '../../lib/utils';
import { useThreadMessages } from '../../state/queries';
import { useUi } from '../../state/store';
import { Keycaps } from '../ui/Keycap';
import { Tip } from '../ui/Tip';
import { InviteCard } from '../invite/InviteCard';
import { AvailabilitySuggestions } from './AvailabilitySuggestions';
import { ChatThreadView } from './ChatThreadView';
import { MessageBody } from './MessageBody';
import { PriorityButton, PriorityMark } from './PriorityBolt';

const UNDO_SEND_MS = 5000;

/**
 * A stored draft inside the thread, Spark-style: DRAFT chip, recipients, and
 * Delete / Edit / Send inline. Send reuses the normal send pipeline and then
 * removes the draft from the server.
 */
export function DraftItem({ message }: { message: MessageMeta }) {
  const openComposer = useUi((s) => s.openComposer);
  const recipients = message.to.map((a) => a.name || a.email);
  const toLabel = recipients.length
    ? `${recipients[0]}${recipients.length > 1 ? ` +${recipients.length - 1}` : ''}`
    : 'no recipients';

  const edit = () =>
    openComposer({
      mode: 'edit-draft',
      accountId: message.accountId,
      draftMessage: message,
      subject: message.subject,
    });

  const remove = () => {
    void api.command('task:enqueue', {
      type: 'delete-draft',
      accountId: message.accountId,
      messageId: message.id,
    });
    toast('Draft deleted');
  };

  const send = () => {
    if (!message.to.length) {
      toast('Add a recipient first');
      edit();
      return;
    }
    void api.query('message:body', { messageId: message.id }).then((body) => {
      if (!body) {
        toast('Draft is still downloading — try again in a moment');
        return;
      }
      const draft = {
        accountId: message.accountId,
        to: message.to,
        cc: message.cc,
        bcc: [],
        subject: message.subject || '(no subject)',
        html: body.html ?? textToHtml(body.text ?? ''),
        text: body.text ?? '',
        deleteDraftMessageId: message.id,
        attachments: [],
      };
      // Undo Send: the task is enqueued only after the window elapses.
      let cancelled = false;
      const timer = setTimeout(() => {
        if (!cancelled) void api.command('task:enqueue', { type: 'send-draft', draft });
      }, UNDO_SEND_MS);
      toast('Sending…', {
        duration: UNDO_SEND_MS,
        action: {
          label: 'Undo',
          onClick: () => {
            cancelled = true;
            clearTimeout(timer);
            toast('Send cancelled');
          },
        },
      });
    });
  };

  return (
    <article className="border-hairline bg-paper mb-2 overflow-hidden rounded-xl border">
      <div className="border-hairline flex items-center gap-2.5 border-b px-4 py-2">
        <span className="bg-sunken text-ink-muted flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold">
          {initials(senderLabel(message.from))}
        </span>
        <span className="border-hairline text-ink-muted shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] font-bold tracking-wide">
          DRAFT
        </span>
        <span className="text-accent min-w-0 truncate text-[12px]">to {toLabel}</span>
        <span className="flex-1" />
        <button
          onClick={remove}
          className="border-hairline text-ink-muted hover:text-danger rounded-full border px-3 py-1 text-[12px] font-semibold"
        >
          Delete
        </button>
        <button
          onClick={edit}
          className="border-hairline text-ink-muted hover:text-ink rounded-full border px-3 py-1 text-[12px] font-semibold"
        >
          Edit
        </button>
        <span className="bg-hairline mx-1 h-4 w-px" />
        <button
          onClick={send}
          className="border-accent text-accent hover:bg-accent-soft rounded-full border px-3 py-1 text-[12px] font-semibold"
        >
          Send
        </button>
      </div>
      <MessageBody messageId={message.id} />
    </article>
  );
}

/**
 * A person in From/To/Cc: click toggles between their name and email address
 * AND copies the address to the clipboard.
 */
function AddressLabel({ addr }: { addr: Address }) {
  const [showEmail, setShowEmail] = useState(false);
  const hasName = !!addr.name && addr.name !== addr.email;
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard.writeText(addr.email);
    toast(`Copied ${addr.email}`);
    if (hasName) setShowEmail((v) => !v);
  };
  return (
    <span
      className="cursor-pointer decoration-dotted hover:underline"
      title={hasName && !showEmail ? `${addr.email} — click to copy` : 'Click to copy'}
      onClick={copy}
    >
      {hasName && !showEmail ? addr.name : addr.email}
    </span>
  );
}

function AddressList({ addrs }: { addrs: Address[] }) {
  return (
    <>
      {addrs.map((a, i) => (
        <span key={`${a.email}-${i}`}>
          {i > 0 && ', '}
          <AddressLabel addr={a} />
        </span>
      ))}
    </>
  );
}

function MessageItem({
  message,
  expandedDefault,
  latest,
}: {
  message: MessageMeta;
  expandedDefault: boolean;
  /** The thread's newest sent/received message (gets availability suggestions). */
  latest: boolean;
}) {
  const [override, setOverride] = useState<boolean | null>(null);
  const expanded = override ?? expandedDefault;
  const setExpanded = (fn: (v: boolean) => boolean) => setOverride(fn(expanded));
  const from = senderLabel(message.from);

  return (
    <article className="border-hairline bg-paper mb-2 overflow-hidden rounded-xl border">
      <button
        onClick={() => setExpanded((v) => !v)}
        className={cn(
          'group/hdr focus-visible:bg-sunken hover:bg-sunken flex w-full items-center gap-2.5 px-4 py-2.5 text-left',
          expanded && 'border-hairline border-b',
        )}
        aria-expanded={expanded}
      >
        <span className="bg-sunken text-ink-muted flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold">
          {initials(from)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className={cn('truncate text-[12.5px]', !message.seen && 'font-bold')}>
              {message.from ? <AddressLabel addr={message.from} /> : from}
            </span>
            <PriorityMark email={message.from?.email} className="self-center" />
            <span className="text-ink-faint shrink-0 text-[11px]">
              {formatFullDate(message.date)}
            </span>
          </span>
          {expanded ? (
            <span className="text-ink-muted block truncate text-[11.5px]">
              to {message.to.length ? <AddressList addrs={message.to} /> : 'me'}
              {message.cc.length > 0 && (
                <>
                  {' · cc '}
                  <AddressList addrs={message.cc} />
                </>
              )}
            </span>
          ) : (
            <span className="text-ink-muted block truncate text-[12px]">{message.snippet}</span>
          )}
        </span>
        <span
          className="text-ink-faint flex shrink-0 items-center gap-1.5 text-[11px] opacity-0 transition-opacity group-hover/hdr:opacity-100 group-focus-visible/hdr:opacity-100"
          aria-hidden
        >
          <Keycaps keys={['↩']} /> {expanded ? 'collapse' : 'expand'}
        </span>
      </button>
      {expanded && (
        <div className="pt-3 empty:hidden">
          <InviteCard messageId={message.id} />
        </div>
      )}
      {expanded && <MessageBody messageId={message.id} />}
      {expanded && latest && <AvailabilitySuggestions message={message} />}
    </article>
  );
}

/**
 * Opening a thread marks it read. Deliberately opening it (click / Enter /
 * notification) marks it read immediately, Spark-style. Arrow-key browsing in
 * split view previews: settling on an unread email for a beat marks it read
 * (so it reads once you move on), while quickly passing over mail leaves it
 * unread — as does mail explicitly marked unread with U. Single pane: showing
 * is opening.
 */
export function useOpenMarksRead(thread: ThreadSummary) {
  const auto = useUi((s) => s.selectionAuto);
  const split = useUi((s) => s.split);
  useEffect(() => {
    if (thread.unreadCount === 0) return;
    if (!auto || !split) {
      markThreadRead(thread);
      return;
    }
    const timer = window.setTimeout(() => markThreadRead(thread), 500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.id, auto, split]);
}

/** Esc goes back to the list, unless a sheet or the composer has it. */
export function paneEscape(e: React.KeyboardEvent): boolean {
  if (e.key !== 'Escape' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false;
  const ui = useUi.getState();
  if (ui.commandOpen || ui.composer || ui.picker || ui.shortcutsOpen || ui.settingsOpen)
    return false;
  e.preventDefault();
  e.stopPropagation();
  focusPanelLeft();
  return true;
}

/**
 * Keys that read the open email once focus is in the reading pane (arrived
 * with → from the list, or a click into the email): ↑/↓ scroll a line, Space
 * / ⇧Space and PgUp/PgDn a page, Home/End to the ends. Without this, ↑/↓
 * fell through to the list and switched emails instead. Message headers and
 * form controls keep their own keys.
 */
export function paneScrollKeys(e: React.KeyboardEvent<HTMLElement>): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const el = e.target as HTMLElement;
  if (el.closest('article > button, button, a, input, textarea, select, [contenteditable="true"]')) return false;
  const scroller = e.currentTarget.querySelector<HTMLElement>('[data-reading-scroll]');
  if (!scroller) return false;
  const page = Math.max(80, scroller.clientHeight - 60);
  const by: Record<string, number> = {
    ArrowDown: 64,
    ArrowUp: -64,
    PageDown: page,
    PageUp: -page,
    ' ': e.shiftKey ? -page : page,
  };
  if (e.shiftKey && e.key !== ' ') return false;
  if (e.key === 'Home' || e.key === 'End') {
    scroller.scrollTo({ top: e.key === 'Home' ? 0 : scroller.scrollHeight });
  } else if (e.key in by) {
    scroller.scrollBy({ top: by[e.key]! });
  } else return false;
  e.preventDefault();
  e.stopPropagation();
  return true;
}

/** Plain clicks on the pane background make it the keyboard section; controls keep their own focus. */
export function focusPaneOnBackground(e: React.MouseEvent<HTMLElement>) {
  const el = e.target as HTMLElement;
  if (!el.closest('button, a, input, textarea, iframe, [contenteditable]')) e.currentTarget.focus();
}

const iconBtn = 'text-ink-muted hover:bg-sunken hover:text-ink rounded-md p-1.5';

/** The thread's subject and actions, with the reading-layout switch (cards or chat). */
export function ThreadHeader({ thread }: { thread: ThreadSummary }) {
  const layout = useUi((s) => s.readingLayout);
  const setLayout = useUi((s) => s.setReadingLayout);
  const respond = (id: string) => ACTIONS.find((a) => a.id === id)?.perform(thread.id);
  return (
    <div className="border-hairline flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
      <h2 className="min-w-0 flex-1 text-[15px] leading-snug font-bold tracking-tight">
        {thread.subject || '(no subject)'}
      </h2>
      <div className="flex shrink-0 items-center gap-1">
        <div
          className="bg-sunken mr-1 flex items-center rounded-lg p-0.5"
          role="group"
          aria-label="Reading layout"
        >
          {(
            [
              { id: 'classic', icon: Rows3, label: 'Read as cards' },
              { id: 'chat', icon: MessagesSquare, label: 'Read as a chat' },
            ] as const
          ).map(({ id, icon: Icon, label }) => (
            <Tip key={id} label={label} keys={keysFor('toggle-reading-chat')}>
              <button
                onClick={() => setLayout(id)}
                aria-pressed={layout === id}
                aria-label={label}
                className={cn(
                  'rounded-md px-1.5 py-1',
                  layout === id ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
                )}
              >
                <Icon size={14} />
              </button>
            </Tip>
          ))}
        </div>
        <PriorityButton thread={thread} className={iconBtn} />
        <Tip label="Snooze" keys={keysFor('snooze')}>
          <button onClick={() => respond('snooze')} className={iconBtn}>
            <AlarmClock size={15} />
          </button>
        </Tip>
        <Tip label="Set Aside" keys={keysFor('set-aside')}>
          <button onClick={() => respond('set-aside')} className={iconBtn}>
            <Layers size={15} />
          </button>
        </Tip>
        <Tip label="Remind me" keys={keysFor('remind')}>
          <button onClick={() => respond('remind')} className={iconBtn}>
            <Bell size={15} />
          </button>
        </Tip>
        <Tip label="Print" keys={keysFor('print')}>
          <button onClick={() => void printThread(thread.id)} className={iconBtn}>
            <Printer size={15} />
          </button>
        </Tip>
        <span className="bg-hairline mx-1 h-4 w-px" />
        <Tip label="Reply" keys={keysFor('reply')}>
          <button onClick={() => respond('reply')} className={iconBtn}>
            <Reply size={15} />
          </button>
        </Tip>
        <Tip label="Reply All" keys={keysFor('reply-all')}>
          <button onClick={() => respond('reply-all')} className={iconBtn}>
            <ReplyAll size={15} />
          </button>
        </Tip>
        <Tip label="Forward" keys={keysFor('forward')} align="end">
          <button onClick={() => respond('forward')} className={iconBtn}>
            <Forward size={15} />
          </button>
        </Tip>
      </div>
    </div>
  );
}

/** The open thread, in the reading layout picked in its header (cards or chat). */
export function ThreadView({ thread }: { thread: ThreadSummary }) {
  const layout = useUi((s) => s.readingLayout);
  return layout === 'chat' ? (
    <ChatThreadView thread={thread} />
  ) : (
    <CardsThreadView thread={thread} />
  );
}

function CardsThreadView({ thread }: { thread: ThreadSummary }) {
  const messages = useThreadMessages(thread.id);
  useOpenMarksRead(thread);

  const lastId = useMemo(() => messages[messages.length - 1]?.id, [messages]);
  const latestMailId = useMemo(() => [...messages].reverse().find((m) => !m.draft)?.id, [messages]);

  // ← is handled by the global panel navigation; Esc mirrors it here, and
  // ↑/↓ on a message header walk the thread's messages instead of moving
  // the mail-list selection out from under the reader.
  const onPaneKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (paneEscape(e)) return;
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) {
      paneScrollKeys(e);
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const headers = [...e.currentTarget.querySelectorAll<HTMLElement>('article > button')];
      const idx = headers.indexOf(e.target as HTMLElement);
      if (idx >= 0) {
        e.preventDefault();
        e.stopPropagation();
        const next = headers[idx + (e.key === 'ArrowDown' ? 1 : -1)];
        if (next) next.focus();
        else if (e.key === 'ArrowDown') {
          // Past the newest header: step into the email itself and read on.
          const scroller = e.currentTarget.querySelector<HTMLElement>('[data-reading-scroll]');
          scroller?.focus({ preventScroll: true });
          scroller?.scrollBy({ top: 64 });
        }
        return;
      }
    }
    paneScrollKeys(e);
  };

  return (
    <div
      className="reading-pane flex h-full min-w-0 flex-col focus:outline-none"
      tabIndex={-1}
      onKeyDown={onPaneKeyDown}
      onMouseDown={focusPaneOnBackground}
    >
      <ThreadHeader thread={thread} />
      <div data-reading-scroll tabIndex={-1} className="flex-1 overflow-y-auto p-3 focus:outline-none">
        {messages.map((m) =>
          m.draft ? (
            <DraftItem key={m.id} message={m} />
          ) : (
            <MessageItem
              key={m.id}
              message={m}
              expandedDefault={m.id === lastId || m.id === latestMailId || !m.seen}
              latest={m.id === latestMailId}
            />
          ),
        )}
      </div>
    </div>
  );
}

export function EmptyReadingPane() {
  return (
    <div className="text-ink-faint flex h-full flex-col items-center justify-center gap-3">
      <p className="text-[13px]">Select an email to read it here.</p>
      <div className="text-ink-muted flex flex-col items-start gap-1.5 text-[12px]">
        <span className="flex items-center gap-2">
          <Keycaps keys={['↑']} />
          <Keycaps keys={['↓']} /> move · hover targets
        </span>
        <span className="flex items-center gap-2">
          <Keycaps keys={['←']} />
          <Keycaps keys={['→']} /> switch panes
        </span>
        <span className="flex items-center gap-2">
          <Keycaps keys={['E']} /> done · <Keycaps keys={['R']} /> reply all ·{' '}
          <Keycaps keys={['⌘', 'K']} /> everything
        </span>
      </div>
    </div>
  );
}
