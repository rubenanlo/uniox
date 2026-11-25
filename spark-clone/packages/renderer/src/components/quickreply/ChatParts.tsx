import type { Address, InviteInfo, MessageBodyPayload, MessageMeta } from '@app/shared';
import { ArrowUp, CalendarCheck, Forward, Loader2, Sparkles, X } from 'lucide-react';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, Extension, useEditor } from '@tiptap/react';
import { cardAttachments, htmlNeedsRender, inviteAnswerLine, looksLikeMarkup, textToHtml } from '../../lib/quickReply';
import { markupSource, messageVisibleText } from '../../lib/quickReplyAi';
import { cn, hueOf, initials } from '../../lib/utils';
import { Keycaps } from '../ui/Keycap';
import { FileCard, SLOT_DRAG_TYPE, SlotCard, slotDay } from './Cards';
import { useInvite } from '../invite/InviteCard';
import { InviteChatCard } from './InviteChatCard';
import { ForwardCard } from './ForwardCard';
import { RenderedEmail } from './RenderedEmail';
import { AddressField } from '../composer/Composer';
import { FormatButtons, LinkPrompt, mailEditorExtensions, useLinkEditor } from '../composer/mailEditor';
import { firstName, listNames, nameOf, type ChatThread } from './useChatThread';

/**
 * Where the chat is drawn. The island sits on glass, so the assistant's notes
 * are plain text beside its mark; the reading pane is opaque, so each note
 * gets its own frosted bubble (the AI design rule).
 */
export const ChatSurface = createContext<'island' | 'pane'>('island');

export function ChatAvatar({ who, small }: { who: string; small?: boolean }) {
  const h = hueOf(who);
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        small ? 'h-[22px] w-[22px] text-[10px]' : 'h-[30px] w-[30px] text-[12px]',
      )}
      style={{
        background: `linear-gradient(135deg, hsl(${h} 62% 58%), hsl(${(h + 40) % 360} 62% 48%))`,
      }}
    >
      {initials(who)}
    </span>
  );
}

export function AiMark() {
  return (
    <span className="qr-ai flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[9px]">
      <Sparkles size={14} strokeWidth={2} />
    </span>
  );
}

/** One assistant turn: its mark and what it says (framed on the reading pane). */
function AiRow({ children, className }: { children: React.ReactNode; className?: string }) {
  const surface = useContext(ChatSurface);
  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <AiMark />
      <div
        className={cn(
          'min-w-0 flex-1',
          surface === 'pane'
            ? 'ai-glass chat-ai-bubble max-w-[640px] rounded-[6px_17px_17px_17px] px-3.5 py-2.5'
            : 'pt-0.5',
        )}
      >
        {children}
      </div>
    </div>
  );
}

/** "Patricia" from a name, or from an address like patricia.navarro@oecd.org. */
const senderFirst = (a: Address | null) => {
  const n = a?.name?.trim().split(/\s+/)[0] || (a?.email.split('@')[0] ?? '').split(/[._+-]/)[0] || '';
  return n.charAt(0).toUpperCase() + n.slice(1);
};

/** One message as a chat bubble (yours on the right), shown in full, with its files as cards below. */
export function Bubble({
  message,
  body,
  mine,
  meta,
  narrow,
}: {
  message: MessageMeta;
  body?: MessageBodyPayload;
  mine: boolean;
  /** A small line above the bubble (sender and time), used on the reading pane. */
  meta?: React.ReactNode;
  /** Keep text bubbles to a readable chat width (the wide reading pane). */
  narrow?: boolean;
}) {
  const text = messageVisibleText(body, message.snippet);
  // An invite's calendar part is answered on the invite card, not opened as a file.
  const files = body
    ? cardAttachments(body.attachments, body.html).filter(
        (f) => !/^(text\/calendar|application\/ics)/i.test(f.contentType) && !/\.ics$/i.test(f.filename),
      )
    : [];
  // A designed or image-led email (or one whose text is really markup) shows as itself.
  const source = markupSource(body);
  const render = !mine && !!source && (htmlNeedsRender(source) || looksLikeMarkup(text) || !text.trim());
  return (
    <div className={cn('flex gap-2.5', mine ? 'flex-col items-end' : 'items-start')}>
      {!mine && (
        <span className={meta ? 'mt-[22px]' : 'mt-0.5'}>
          <ChatAvatar who={nameOf(message.from)} small />
        </span>
      )}
      <div
        className={cn(
          'flex min-w-0 flex-col gap-2',
          mine ? 'max-w-[75%] items-end' : 'max-w-[calc(100%-32px)]',
          narrow && !render && (mine ? 'max-w-[min(75%,600px)]' : 'max-w-[min(80%,680px)]'),
          render && 'w-full',
        )}
      >
        {meta}
        {render ? (
          <RenderedEmail html={source} attachments={body?.attachments ?? []} />
        ) : (
          <div
            className={cn(
              'whitespace-pre-wrap break-words px-3.5 py-2.5 leading-[1.55] select-text',
              mine
                ? 'qr-bubble-out text-ink-muted rounded-[17px_17px_6px_17px] text-[13px]'
                : 'qr-bubble-in rounded-[6px_17px_17px_17px] text-[13.5px]',
            )}
          >
            {text ||
              (body ? (
                inviteAnswerLine(message.subject, senderFirst(message.from)) || (
                  <span className="text-ink-faint italic">No message text</span>
                )
              ) : (
                <span className="text-ink-faint italic">Loading…</span>
              ))}
          </div>
        )}
        {files.length > 0 && (
          <div className={cn('flex flex-wrap gap-2', mine && 'justify-end')}>
            {files.map((f) => (
              <FileCard key={f.id} att={f} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** The assistant's read of the thread: a summary and reply ideas that write the reply. */
export function AssistantRead({ chat }: { chat: ChatThread }) {
  const { configured, ideas, ideasReady, aiPhase, writing, writeFromIntent } = chat;
  // Invites skip the AI read: the invite card below says it all.
  if (aiPhase === 'skipped') return null;
  return (
    <AiRow key={`ai-${aiPhase}`} className="qr-msg-in">
      {!configured ? (
        <p className="text-ink-muted text-[13.5px] leading-normal">
          Add your Claude API key in Settings to get a summary and suggested replies here.
        </p>
      ) : ideas === 'loading' || ideas === null ? (
        <p className="text-ink-muted flex items-center gap-2 text-[13.5px]">
          <Loader2 size={14} className="animate-spin" /> Reading the email…
        </p>
      ) : ideas === 'error' ? (
        <p className="text-ink-muted text-[13.5px]">The assistant couldn’t read this one.</p>
      ) : (
        <>
          <p className="text-[14.5px] leading-normal select-text">{ideasReady!.summary}</p>
          {ideasReady!.suggestions.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {ideasReady!.suggestions.map((s) => (
                <button
                  key={s}
                  disabled={writing}
                  onClick={() => void writeFromIntent(s)}
                  className="qr-field hover:border-accent/40 h-[30px] rounded-full px-3 text-[12.5px] font-medium"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </AiRow>
  );
}

/**
 * Invites often name the organizer only by email. Borrow a name from the
 * guest list or from the email's sender (Google sends invites as
 * "Name <calendar-notification@google.com>" or from the organizer).
 */
function withOrganizerName(info: InviteInfo, from: Address | null): InviteInfo {
  const org = info.organizer;
  if (!org || org.name?.trim()) return info;
  const same = (e?: string) => !!e && e.toLowerCase() === org.email.toLowerCase();
  const name =
    info.attendees.find((p) => same(p.email) && p.name?.trim())?.name ||
    (from?.name?.trim() && (same(from.email) || /calendar-notification@google\.com$/i.test(from.email))
      ? from.name
      : undefined);
  return name ? { ...info, organizer: { ...org, name } } : info;
}

/** A meeting invite in the thread: answer it on the invite itself (Accept / Maybe / Decline / Propose). */
export function InviteNote({ chat }: { chat: ChatThread }) {
  const { latest } = chat;
  const { info } = useInvite(latest?.id);
  if (!latest || !info || info.isOrganizer) return null;
  return (
    <AiRow className="qr-msg-in">
      <InviteChatCard info={withOrganizerName(info, latest.from)} />
    </AiRow>
  );
}

/** Suggested times as cards to pick (or drag into the reply). */
export function TimesNote({ chat }: { chat: ChatThread }) {
  const { times, picks, togglePick } = chat;
  if (!times) return null;
  return (
    <AiRow key={`times-${times === 'loading' ? 'loading' : 'done'}`} className="qr-msg-in">
      {times === 'loading' ? (
        <p className="text-ink-muted flex items-center gap-2 text-[13.5px]">
          <Loader2 size={14} className="animate-spin" /> Checking calendars…
        </p>
      ) : times === 'none' ? (
        <p className="text-ink-muted text-[13.5px]">I couldn’t find a time that suits everyone this week.</p>
      ) : (
        <>
          <p className="text-[14.5px] leading-normal">
            {times.people.length
              ? `${listNames(['You', ...times.people.map((p) => firstName(p))])} are free at:`
              : 'You’re free at:'}
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2.5">
            {times.slots.map((s) => (
              <SlotCard
                key={s.startMs}
                slot={s}
                people={times.people}
                picked={picks.some((p) => p.startMs === s.startMs)}
                onToggle={() => togglePick(s)}
              />
            ))}
          </div>
        </>
      )}
    </AiRow>
  );
}

/** The forward card, or the assistant pointing out a forward the email asks for. */
export function ForwardNote({ chat }: { chat: ChatThread }) {
  const { forwarding, setForwarding, latest, latestBody, files, accountId, ideasReady, outgoing, queue } = chat;
  if (forwarding && latest) {
    return (
      <AiRow className="qr-msg-in">
        <p className="mb-2 text-[14.5px] leading-normal">
          {ideasReady?.forwardTo ? `Forward this to ${firstName(ideasReady.forwardTo)}?` : 'Who should get this email?'}
        </p>
        <ForwardCard
          message={latest}
          body={latestBody}
          files={files}
          accountId={accountId}
          suggestedTo={ideasReady?.forwardTo ?? null}
          onCancel={() => setForwarding(false)}
          onForward={(out, label) => {
            setForwarding(false);
            queue('forward', out, '', label);
          }}
        />
      </AiRow>
    );
  }
  if (!ideasReady?.forwardTo || outgoing.some((o) => o.kind === 'forward')) return null;
  return (
    <AiRow>
      <p className="text-[14.5px] leading-normal">
        {firstName(latest?.from)} asked you to send something to {nameOf(ideasReady.forwardTo)}.{' '}
        <button onClick={() => setForwarding(true)} className="text-accent font-medium hover:underline">
          Forward it
        </button>
      </p>
    </AiRow>
  );
}

/** Answers from the AI menu, each under the question asked. */
export function NotesList({ chat }: { chat: ChatThread }) {
  return (
    <>
      {chat.notes.map((n) => (
        <div key={n.id} className="qr-msg-in flex flex-col gap-3">
          {n.question && (
            <div className="qr-bubble-out text-ink-muted self-end rounded-[17px_17px_6px_17px] px-3.5 py-2 text-[13px]">
              {n.question}
            </div>
          )}
          <AiRow>
            <p className="whitespace-pre-wrap text-[14px] leading-normal select-text">
              {n.busy ? (
                <span className="text-ink-muted flex items-center gap-2">
                  <Loader2 size={14} className="animate-spin" /> Thinking…
                </span>
              ) : (
                n.text
              )}
            </p>
          </AiRow>
        </div>
      ))}
    </>
  );
}

/** What you sent, with Undo while it waits. */
export function OutgoingList({ chat }: { chat: ChatThread }) {
  return (
    <>
      {chat.outgoing.map((o) => (
        <div key={o.id} className="qr-out-fold" data-landed={chat.landed.has(o.id) || undefined}>
          <div className="qr-msg-in flex min-h-0 flex-col items-end gap-1 overflow-hidden">
            {o.kind === 'reply' ? (
              <div className="qr-bubble-out max-w-[75%] whitespace-pre-wrap rounded-[17px_17px_6px_17px] px-3.5 py-2.5 text-[13.5px] leading-[1.55]">
                {o.text}
              </div>
            ) : (
              <div className="qr-card flex items-center gap-2 px-3 py-2 text-[12.5px]">
                <Forward size={14} className="text-accent" /> Forwarded to {o.label}
              </div>
            )}
            <div className="text-ink-faint flex items-center gap-2 text-[11.5px]">
              {o.status === 'pending' ? (
                <>
                  <span className="bg-ink/10 relative h-[3px] w-14 overflow-hidden rounded-full">
                    <span className="qr-countdown bg-accent absolute inset-y-0 left-0 w-full rounded-full" />
                  </span>
                  Sending…
                  <button onClick={() => chat.undo(o)} className="text-accent font-medium hover:underline">
                    Undo
                  </button>
                </>
              ) : (
                <>Sent{o.kind === 'reply' && o.label ? ` to ${o.label}` : ''}</>
              )}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

/**
 * The reply field: drop times here, ⌘↩ sends. `tools` sit at the start of the
 * footer line (the reading pane puts the assistant and availability there).
 */
export function ReplyField({
  chat,
  className,
  tools,
  autoFocus,
}: {
  chat: ChatThread;
  className?: string;
  tools?: React.ReactNode;
  autoFocus?: boolean;
}) {
  const { draft, setDraft, writing, picks, togglePick, times, latest, others, all, setReplyAll, toLabel, fieldRef } =
    chat;
  const [dropping, setDropping] = useState(false);
  const { ccOpen, setCcOpen, ccText, setCcText } = chat;
  const ccRef = useRef<HTMLInputElement>(null);
  // ⌘⇧C (or the Cc button) opens the Cc line, ready to type a name.
  useEffect(() => {
    if (ccOpen) ccRef.current?.focus();
  }, [ccOpen]);

  // The box is the composer's editor (same formatting and shortcuts: ⌘B/⌘I/⌘U,
  // ⇧⌘8/⇧⌘7 lists, "- " / "1. " at a line start, ⇧⌘K link), so a reply goes
  // out as real HTML. `draft` mirrors its text for the assistant and checks.
  const keys = useRef({ send: () => {}, link: () => {} });
  const placeholder = writing ? 'Writing…' : `Reply to ${firstName(chat.recipients.to[0] ?? latest?.from) || 'them'}…`;
  const synced = useRef(draft);
  const editor = useEditor({
    extensions: [
      ...mailEditorExtensions(({ editor: ed }) => ed.view.dom.getAttribute('data-reply-placeholder') ?? ''),
      Extension.create({
        name: 'replyKeys',
        priority: 1000,
        addKeyboardShortcuts: () => ({
          'Mod-Enter': () => (keys.current.send(), true),
          'Mod-Shift-k': () => (keys.current.link(), true),
        }),
      }),
    ],
    content: textToHtml(draft),
    editorProps: {
      attributes: {
        'aria-label': 'Reply',
        class: 'outline-none select-text',
      },
    },
    onUpdate: ({ editor: ed }) => {
      const text = ed.isEmpty ? '' : ed.getText({ blockSeparator: '\n\n' });
      synced.current = text;
      setDraft(text);
    },
  });
  const link = useLinkEditor(editor);
  useEffect(() => {
    keys.current = { send: () => chat.send(), link: link.openEditor };
  });

  // Hand the editor to the chat (HTML on send, focus from r / Undo / AI).
  const { editorRef } = chat;
  useEffect(() => {
    editorRef.current = editor;
    fieldRef.current = editor?.view.dom ?? null;
    return () => {
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [editor, editorRef, fieldRef]);

  // The placeholder names who you reply to (or says the assistant is writing).
  useEffect(() => {
    if (!editor) return;
    editor.view.dom.setAttribute('data-reply-placeholder', placeholder);
    editor.view.dispatch(editor.state.tr.setMeta('placeholder', placeholder));
  }, [editor, placeholder]);

  // Text set from outside (assistant draft, undo, sent → cleared) replaces the box.
  useEffect(() => {
    if (!editor || draft === synced.current) return;
    synced.current = draft;
    editor.commands.setContent(textToHtml(draft), { emitUpdate: false });
    if (draft) editor.commands.focus('end');
  }, [draft, editor]);

  useEffect(() => {
    editor?.setEditable(!writing);
  }, [editor, writing]);

  useEffect(() => {
    if (autoFocus) editor?.commands.focus('end');
  }, [autoFocus, editor]);

  // Right-click on selected text: the format menu (no bar the rest of the time).
  const [fmtAt, setFmtAt] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!fmtAt) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      if (e.target instanceof Element && e.target.closest('[data-format-menu]')) return;
      if (e instanceof KeyboardEvent) {
        e.preventDefault();
        e.stopPropagation();
      }
      setFmtAt(null);
    };
    window.addEventListener('mousedown', close, true);
    window.addEventListener('keydown', close, true);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('mousedown', close, true);
      window.removeEventListener('keydown', close, true);
      window.removeEventListener('blur', close);
    };
  }, [fmtAt]);

  return (
    <div
      className={cn('qr-field relative rounded-2xl px-4 py-2.5', dropping && 'qr-drop', className)}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(SLOT_DRAG_TYPE)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        setDropping(false);
        const ms = Number(e.dataTransfer.getData(SLOT_DRAG_TYPE));
        const slot = times && typeof times === 'object' ? times.slots.find((s) => s.startMs === ms) : undefined;
        if (slot && !picks.some((p) => p.startMs === ms)) togglePick(slot);
      }}
    >
      {picks.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {picks.map((s) => (
            <span key={s.startMs} className="qr-card flex items-center gap-2 rounded-[10px] px-2.5 py-1.5">
              <CalendarCheck size={14} className="text-accent" />
              <span className="text-[12.5px] font-semibold">
                {slotDay(s)} ·{' '}
                {new Date(s.startMs).toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </span>
              <button aria-label="Remove time" onClick={() => togglePick(s)} className="text-ink-faint hover:text-ink">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {ccOpen && (
        <div className="border-hairline mb-1 flex items-center gap-2 border-b pb-1">
          <span className="text-ink-faint shrink-0 text-[11.5px]">Cc</span>
          <div
            className="min-w-0 flex-1"
            onKeyDown={(e) => {
              // Esc on an empty Cc line closes it and goes back to the reply.
              if (e.key === 'Escape' && !ccText.trim()) {
                e.preventDefault();
                e.stopPropagation();
                setCcOpen(false);
                fieldRef.current?.focus();
              }
            }}
          >
            <AddressField
              inputRef={ccRef}
              value={ccText}
              onChange={setCcText}
              ariaLabel="Cc"
              placeholder="Add someone in Cc"
              className="placeholder:text-ink-faint w-full bg-transparent py-1 text-[13px] outline-none"
            />
          </div>
          <button
            aria-label="Remove Cc"
            onClick={() => {
              setCcText('');
              setCcOpen(false);
              fieldRef.current?.focus();
            }}
            className="text-ink-faint hover:text-ink shrink-0"
          >
            <X size={12} />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2.5">
        <div
          className="reply-editor max-h-[140px] min-w-0 flex-1 overflow-y-auto py-1.5 text-[14.5px] leading-[1.5]"
          onClick={() => editor?.commands.focus()}
          onContextMenu={(e) => {
            if (!editor || editor.state.selection.empty) return;
            e.preventDefault();
            setFmtAt({ x: e.clientX, y: e.clientY });
          }}
        >
          <EditorContent editor={editor} />
        </div>
        <span className="text-ink-faint mb-2 flex shrink-0 items-center gap-1 text-[11.5px]">
          <Keycaps keys={['⌘', '↩']} /> send
        </span>
        <button
          onClick={() => chat.send()}
          aria-label="Send"
          disabled={writing || (!draft.trim() && !picks.length)}
          className="bg-accent mb-0.5 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] text-white disabled:opacity-50"
        >
          {writing ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} strokeWidth={2.2} />}
        </button>
      </div>
      <LinkPrompt link={link} className="absolute right-3 bottom-[calc(100%+6px)]" />
      {fmtAt &&
        editor &&
        createPortal(
          <div
            data-format-menu
            data-owns-escape
            className="fixed z-[100]"
            style={{ left: Math.min(fmtAt.x, window.innerWidth - 260), top: Math.max(8, fmtAt.y - 46) }}
          >
            <FormatButtons editor={editor} onLink={link.openEditor} lists onDone={() => setFmtAt(null)} />
          </div>,
          document.body,
        )}
      <div className="text-ink-faint mt-1 flex items-center gap-3 text-[11.5px]">
        {tools}
        {others.length > 1 ? (
          <button onClick={() => setReplyAll(!all)} className="hover:text-ink-muted">
            {all ? 'Reply all' : 'Reply'} · {toLabel.slice(0, 3).join(', ')}
            {toLabel.length > 3 ? ` +${toLabel.length - 3}` : ''}
          </button>
        ) : (
          <span>To {toLabel.join(', ') || '…'}</span>
        )}
        {!ccOpen && (
          <button onClick={() => setCcOpen(true)} title="Add someone in Cc  ⌘⇧C" className="hover:text-ink-muted">
            + Cc
          </button>
        )}
        <span>Undo Send on</span>
      </div>
    </div>
  );
}
