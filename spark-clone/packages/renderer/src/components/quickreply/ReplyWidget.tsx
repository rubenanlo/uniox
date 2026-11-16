import type { Address, MessageBodyPayload, MessageMeta, OutgoingDraft, QuickReplyItem } from '@app/shared';
import {
  Archive,
  ArrowUp,
  CalendarCheck,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Forward,
  Loader2,
  Mail,
  SquareArrowOutUpRight,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { formatSlotForPeople, templateGroupReply, type GroupSlot, type Participant } from '../../lib/availability';
import {
  cardAttachments,
  prefixedSubject,
  quoteBlock,
  replyRecipients,
  textToHtml,
  type ReplyIdeas,
} from '../../lib/quickReply';
import {
  askAbout,
  draftFromIntent,
  messageVisibleText,
  replyIdeas,
  rewriteDraft,
  summarizeThread,
  threadContext,
} from '../../lib/quickReplyAi';
import { deferSend } from '../../lib/sendDraft';
import { normalizeSignatureHtml, signatureBlock, signatureText } from '../../lib/signature';
import { cn, hueOf, initials } from '../../lib/utils';
import { useAssistant } from '../../state/assistant';
import { detectAvailabilityAsk, othersOn, suggestGroupSlots } from '../../state/availability';
import { useDelta } from '../../state/queries';
import { Keycaps } from '../ui/Keycap';
import { AiMenu, type AiMenuPick } from './AiMenu';
import { FileCard, SLOT_DRAG_TYPE, SlotCard, slotDay } from './Cards';
import { ForwardCard } from './ForwardCard';

/** Older messages beyond this many fold into one "N earlier messages" row. */
const SHOWN_MESSAGES = 3;
/** Time cards offered in the chat. */
const SLOT_CARDS = 3;

interface Note {
  id: string;
  /** What was asked (shown as your bubble), for "Ask anything". */
  question?: string;
  text: string;
  busy?: boolean;
}

interface Outgoing {
  id: string;
  kind: 'reply' | 'forward';
  text: string;
  label: string;
  status: 'pending' | 'sent';
  cancel: () => boolean;
}

type Times = { slots: GroupSlot[]; people: Participant[] } | 'loading' | 'none' | null;

function Avatar({ who, small }: { who: string; small?: boolean }) {
  const h = hueOf(who);
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full font-semibold text-white',
        small ? 'h-[22px] w-[22px] text-[10px]' : 'h-[30px] w-[30px] text-[12px]',
      )}
      style={{ background: `linear-gradient(135deg, hsl(${h} 62% 58%), hsl(${(h + 40) % 360} 62% 48%))` }}
    >
      {initials(who)}
    </span>
  );
}

function AiMark() {
  return (
    <span className="qr-ai flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[9px]">
      <Sparkles size={14} strokeWidth={2} />
    </span>
  );
}

interface LoadedThread {
  msgs: MessageMeta[];
  bodies: Record<string, MessageBodyPayload>;
}

/** The thread's messages (drafts left out) and their bodies. */
async function fetchThread(threadId: string): Promise<LoadedThread> {
  const msgs = (await api.query('thread:messages', { threadId })).filter((m) => !m.draft);
  const loaded = await Promise.all(msgs.map((m) => api.query('message:body', { messageId: m.id })));
  return {
    msgs,
    bodies: Object.fromEntries(loaded.filter((b): b is MessageBodyPayload => !!b).map((b) => [b.messageId, b])),
  };
}

const nameOf = (a: Address | null | undefined) => a?.name || a?.email || 'Unknown';
const firstName = (a: Address | null | undefined) => (a?.name || a?.email || '').split(/[\s@]/)[0] || '';
/** "You, Maya, Laura and Antonio". */
const listNames = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '');
const metaKey = (e: KeyboardEvent | React.KeyboardEvent) => e.metaKey || e.ctrlKey;

/** One message as a chat bubble (yours on the right), with its files as cards below. */
function Bubble({ message, body, mine }: { message: MessageMeta; body?: MessageBodyPayload; mine: boolean }) {
  const [open, setOpen] = useState(false);
  const text = messageVisibleText(body, message.snippet);
  const long = text.length > 700;
  const files = body ? cardAttachments(body.attachments, body.html) : [];
  return (
    <div className={cn('flex gap-2.5', mine ? 'flex-col items-end' : 'items-start')}>
      {!mine && (
        <span className="mt-0.5">
          <Avatar who={nameOf(message.from)} small />
        </span>
      )}
      <div className={cn('flex min-w-0 flex-col gap-2', mine ? 'max-w-[75%] items-end' : 'max-w-[calc(100%-32px)]')}>
        <div
          className={cn(
            'whitespace-pre-wrap break-words px-3.5 py-2.5 leading-[1.55] select-text',
            mine
              ? 'qr-bubble-out text-ink-muted rounded-[17px_17px_6px_17px] text-[13px]'
              : 'qr-bubble-in rounded-[6px_17px_17px_17px] text-[13.5px]',
            long && !open && 'line-clamp-[10]',
          )}
        >
          {text || <span className="text-ink-faint italic">Loading…</span>}
        </div>
        {long && (
          <button onClick={() => setOpen(!open)} className="text-ink-faint hover:text-ink -mt-1 text-[11.5px]">
            {open ? 'Show less' : 'Show the whole email'}
          </button>
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

/**
 * The quick-reply widget: the whole thread as a chat, the assistant's read of
 * it with reply ideas, suggested times and files as cards, and a reply field
 * that sends with Undo. The rail on the right holds the quick actions.
 */
export function ReplyWidget({
  item,
  position,
  onStep,
  onClose,
  onDone,
}: {
  item: QuickReplyItem;
  position: { index: number; total: number };
  /** 1 = older email in the queue, -1 = newer. */
  onStep: (dir: 1 | -1) => void;
  onClose: () => void;
  /** Archived: move on to the next email. */
  onDone: () => void;
}) {
  const threadId = item.threadId!;
  const [messages, setMessages] = useState<MessageMeta[]>([]);
  const [bodies, setBodies] = useState<Record<string, MessageBodyPayload>>({});
  const [own, setOwn] = useState<Set<string>>(() => new Set());
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  const [ideas, setIdeas] = useState<ReplyIdeas | 'loading' | 'error' | null>(null);
  const [times, setTimes] = useState<Times>(null);
  const [picks, setPicks] = useState<GroupSlot[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);
  const [outgoing, setOutgoing] = useState<Outgoing[]>([]);
  const [forwarding, setForwarding] = useState(false);
  const [menu, setMenu] = useState(false);
  const [unread, setUnread] = useState(false);
  const [showOlder, setShowOlder] = useState(false);
  const [draft, setDraft] = useState('');
  const [writing, setWriting] = useState(false);
  const [replyAll, setReplyAll] = useState<boolean | null>(null);
  const [dropping, setDropping] = useState(false);
  const configured = useAssistant((s) => s.configured);
  const fieldRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const applyThread = useCallback(({ msgs, bodies: loaded }: LoadedThread) => {
    setMessages(msgs);
    setBodies(loaded);
  }, []);

  // Open: load the thread, mark it read (as opening it in the app does), and
  // pick up accounts and signatures for the reply.
  useEffect(() => {
    void fetchThread(threadId).then((loaded) => {
      applyThread(loaded);
      const byAccount = new Map<string, string[]>();
      for (const m of loaded.msgs.filter((x) => !x.seen)) {
        byAccount.set(m.accountId, [...(byAccount.get(m.accountId) ?? []), m.id]);
      }
      for (const [accountId, messageIds] of byAccount) {
        void api.command('task:enqueue', { type: 'set-seen', accountId, messageIds, seen: true });
      }
    });
    void api.query('accounts:list', undefined).then((a) => setOwn(new Set(a.map((x) => x.email.toLowerCase()))));
    void api.query('signatures:list', undefined).then((sigs) => {
      setSignatures(Object.fromEntries(sigs.map((s) => [s.id, normalizeSignatureHtml(s.bodyHtml)])));
    });
  }, [threadId, applyThread]);

  useDelta((e) => {
    if ((e.kind === 'message-body' && e.threadIds.includes(threadId)) || e.kind === 'threads-changed') {
      void fetchThread(threadId).then(applyThread);
    }
  });

  const latest = messages[messages.length - 1];
  const latestBody = latest ? bodies[latest.id] : undefined;
  const accountId = latest?.accountId ?? item.accountId ?? '';
  const context = useMemo(() => threadContext(messages, bodies, own), [messages, bodies, own]);
  const others = useMemo(() => (latest ? othersOn(latest, own) : []), [latest, own]);
  const all = replyAll ?? others.length > 1;
  const recipients = useMemo(
    () => (latest ? replyRecipients(latest, own, all) : { to: [], cc: [] }),
    [latest, own, all],
  );

  /** Times were asked for already (by the keyword check, the assistant or the rail). */
  const timesStarted = useRef(false);
  const loadTimes = useCallback(
    async (durationMin: number, senderZone: string | null) => {
      if (!latest) return;
      timesStarted.current = true;
      setTimes('loading');
      try {
        const hints = senderZone && latest.from ? { [latest.from.email.toLowerCase()]: senderZone } : {};
        const s = await suggestGroupSlots(others, durationMin, hints);
        setTimes(s.slots.length ? { slots: s.slots.slice(0, SLOT_CARDS), people: s.participants } : 'none');
      } catch {
        setTimes('none');
      }
    },
    [latest, others],
  );

  // An email asking when you're free gets time cards straight away.
  const timesFor = useRef<string | null>(null);
  useEffect(() => {
    if (!latest || !latestBody || timesFor.current === latest.id) return;
    timesFor.current = latest.id;
    void detectAvailabilityAsk(latest).then((ask) => {
      if (ask.asks && !timesStarted.current) void loadTimes(ask.durationMinutes, ask.senderTimeZone);
    });
  }, [latest, latestBody, loadTimes]);

  // The assistant's first read: a summary, reply ideas and a forward if one is asked for.
  const ideasFor = useRef<string | null>(null);
  useEffect(() => {
    if (!latest || !latestBody || !configured || ideasFor.current === latest.id) return;
    ideasFor.current = latest.id;
    setIdeas('loading');
    replyIdeas(context).then(
      (read) => {
        setIdeas(read);
        // The assistant spotted a meeting ask the keyword check missed.
        if (read.meetingMinutes && !timesStarted.current) void loadTimes(read.meetingMinutes, null);
      },
      () => setIdeas('error'),
    );
  }, [latest, latestBody, configured, context, loadTimes]);

  // Keep the newest thing in view.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, ideas, times, notes.length, outgoing.length, forwarding]);

  // Grow the field with its text, up to ~6 lines.
  useEffect(() => {
    const el = fieldRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [draft]);

  const people = times && typeof times === 'object' ? times.people : [];
  const timeLines = picks.map((s) => `• ${formatSlotForPeople(s, people)}`);

  const togglePick = (slot: GroupSlot) =>
    setPicks((p) =>
      p.some((x) => x.startMs === slot.startMs) ? p.filter((x) => x.startMs !== slot.startMs) : [...p, slot].sort((a, b) => a.startMs - b.startMs),
    );

  /** The reply text as sent: what was typed, plus any picked times not already in it. */
  const replyText = (): string => {
    const typed = draft.trim();
    if (!picks.length) return typed;
    if (!typed) return templateGroupReply(picks, people, people.length === 1 ? firstName(people[0]) : undefined);
    const missing = timeLines.filter((l) => !typed.includes(l.slice(2)));
    return missing.length ? `${typed}\n\n${missing.join('\n')}` : typed;
  };

  const send = () => {
    if (!latest) return;
    const text = replyText();
    if (!text) return fieldRef.current?.focus();
    if (!recipients.to.length) return void toast('Nobody to reply to on this email');
    const sig = signatures[accountId] ?? '';
    const draftOut: OutgoingDraft = {
      accountId,
      to: recipients.to,
      cc: recipients.cc,
      bcc: [],
      subject: prefixedSubject('Re', latest.subject),
      html: `<div>${textToHtml(text)}</div>${signatureBlock(sig)}${quoteBlock(latest, latestBody ?? { html: null, text: latest.snippet })}`,
      text: text + (sig ? `\n\n-- \n${signatureText(sig)}` : ''),
      inReplyToMessageId: latest.id,
      attachments: [],
    };
    queue('reply', draftOut, text, recipients.to.map((a) => firstName(a)).join(', '));
    setDraft('');
    setPicks([]);
  };

  const queue = (kind: Outgoing['kind'], out: OutgoingDraft, text: string, label: string) => {
    const id = crypto.randomUUID();
    const { cancel } = deferSend(out, () =>
      setOutgoing((o) => o.map((x) => (x.id === id ? { ...x, status: 'sent' } : x))),
    );
    setOutgoing((o) => [...o, { id, kind, text, label, status: 'pending', cancel }]);
  };

  const undo = (o: Outgoing) => {
    if (!o.cancel()) return;
    setOutgoing((list) => list.filter((x) => x.id !== o.id));
    if (o.kind === 'reply') {
      setDraft(o.text);
      fieldRef.current?.focus();
    } else setForwarding(true);
  };

  const writeFromIntent = async (intent: string) => {
    if (!configured) return void toast('Add your Claude API key in Settings to use the assistant.');
    setWriting(true);
    try {
      setDraft(await draftFromIntent(context, intent, timeLines));
      fieldRef.current?.focus();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The assistant couldn’t write that.');
    } finally {
      setWriting(false);
    }
  };

  const addNote = async (run: () => Promise<string>, question?: string) => {
    const id = crypto.randomUUID();
    setNotes((n) => [...n, { id, question, text: '', busy: true }]);
    try {
      const text = await run();
      setNotes((n) => n.map((x) => (x.id === id ? { ...x, text, busy: false } : x)));
    } catch (e) {
      const text = e instanceof Error ? e.message : 'The assistant couldn’t answer.';
      setNotes((n) => n.map((x) => (x.id === id ? { ...x, text, busy: false } : x)));
    }
  };

  const onMenuPick = async (pick: AiMenuPick) => {
    setMenu(false);
    if (!configured) return void toast('Add your Claude API key in Settings to use the assistant.');
    if (pick.kind === 'summarize') return void addNote(() => summarizeThread(context));
    if (pick.kind === 'ask') return void addNote(() => askAbout(context, pick.question), pick.question);
    if (pick.kind === 'write') return void writeFromIntent('Whatever reply fits best');
    setWriting(true);
    try {
      const out = await rewriteDraft(pick.action, draft, accountId, pick.language);
      if (out) setDraft(out);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The assistant couldn’t rewrite the reply.');
    } finally {
      setWriting(false);
      fieldRef.current?.focus();
    }
  };

  const toggleUnread = () => {
    if (!latest) return;
    const next = !unread;
    void api.command('task:enqueue', { type: 'set-seen', accountId, messageIds: [latest.id], seen: !next });
    setUnread(next);
    toast(next ? 'Marked as unread' : 'Marked as read');
  };

  const showTimes = () => {
    if (times && times !== 'none') return;
    void loadTimes(30, null);
  };

  const done = () => {
    void api.command('task:enqueue', { type: 'move-thread', accountId, threadId, toRole: 'archive' });
    toast('Marked as done');
    onDone();
  };

  const openInComposer = () => {
    if (!latest) return;
    const text = replyText();
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
        else onClose();
        return;
      }
      if (metaKey(e) && !e.altKey && !e.shiftKey && k === 'j') {
        e.preventDefault();
        setMenu((m) => !m);
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

  useEffect(() => {
    fieldRef.current?.focus();
  }, []);

  const older = messages.slice(0, Math.max(0, messages.length - SHOWN_MESSAGES));
  const shown = showOlder ? messages : messages.slice(-SHOWN_MESSAGES);
  const ideasReady = ideas && typeof ideas === 'object' ? ideas : null;
  const files = latestBody ? cardAttachments(latestBody.attachments, latestBody.html) : [];
  const toLabel = recipients.to.concat(recipients.cc).map((a) => firstName(a));

  type RailId = 'ai' | 'unread' | 'times' | 'forward' | 'done';
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
    { id: 'times', icon: <CalendarClock size={19} />, label: 'Check my availability', keys: ['⌘', '⇧', 'A'], on: !!times && times !== 'none' },
    { id: 'forward', icon: <Forward size={19} />, label: 'Forward', keys: ['⌘', '⇧', 'F'], on: forwarding },
    { id: 'done', icon: <Archive size={19} />, label: 'Done', keys: ['⌘', 'E'] },
  ];

  function runRail(id: RailId) {
    if (id === 'ai') setMenu((m) => !m);
    else if (id === 'unread') toggleUnread();
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
          <Avatar who={latest ? nameOf(latest.from) : item.title} />
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
        <div ref={scrollRef} className="relative -mx-2 flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-2 pb-1">
          {!showOlder && older.length > 0 && (
            <button
              onClick={() => setShowOlder(true)}
              className="text-ink-faint hover:text-ink-muted self-center text-[11.5px]"
            >
              {older.length} earlier message{older.length > 1 ? 's' : ''}
            </button>
          )}
          {shown.map((m) => (
            <Bubble
              key={m.id}
              message={m}
              body={bodies[m.id]}
              mine={!!m.from && own.has(m.from.email.toLowerCase())}
            />
          ))}

          {/* The assistant's read */}
          {latest && (
            <div className="flex items-start gap-2.5">
              <AiMark />
              <div className="min-w-0 flex-1 pt-0.5">
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
              </div>
            </div>
          )}

          {/* Suggested times */}
          {times && (
            <div className="flex items-start gap-2.5">
              <AiMark />
              <div className="min-w-0 flex-1 pt-0.5">
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
              </div>
            </div>
          )}

          {/* Forward */}
          {forwarding && latest && (
            <div className="flex items-start gap-2.5">
              <AiMark />
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="mb-2 text-[14.5px] leading-normal">
                  {ideasReady?.forwardTo
                    ? `Forward this to ${firstName(ideasReady.forwardTo)}?`
                    : 'Who should get this email?'}
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
              </div>
            </div>
          )}
          {!forwarding && ideasReady?.forwardTo && !outgoing.some((o) => o.kind === 'forward') && (
            <div className="flex items-start gap-2.5">
              <AiMark />
              <p className="flex-1 pt-0.5 text-[14.5px] leading-normal">
                {firstName(latest?.from)} asked you to send something to {nameOf(ideasReady.forwardTo)}.{' '}
                <button onClick={() => setForwarding(true)} className="text-accent font-medium hover:underline">
                  Forward it
                </button>
              </p>
            </div>
          )}

          {/* Answers from the AI menu */}
          {notes.map((n) => (
            <div key={n.id} className="flex flex-col gap-3">
              {n.question && (
                <div className="qr-bubble-out text-ink-muted self-end rounded-[17px_17px_6px_17px] px-3.5 py-2 text-[13px]">
                  {n.question}
                </div>
              )}
              <div className="flex items-start gap-2.5">
                <AiMark />
                <p className="flex-1 whitespace-pre-wrap pt-0.5 text-[14px] leading-normal select-text">
                  {n.busy ? (
                    <span className="text-ink-muted flex items-center gap-2">
                      <Loader2 size={14} className="animate-spin" /> Thinking…
                    </span>
                  ) : (
                    n.text
                  )}
                </p>
              </div>
            </div>
          ))}

          {/* What you sent, with Undo while it waits */}
          {outgoing.map((o) => (
            <div key={o.id} className="flex flex-col items-end gap-1">
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
                    <button onClick={() => undo(o)} className="text-accent font-medium hover:underline">
                      Undo
                    </button>
                  </>
                ) : (
                  <>Sent{o.kind === 'reply' && o.label ? ` to ${o.label}` : ''}</>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* The reply field: drop times here, ⌘↩ sends */}
        <div
          className={cn('qr-field relative mt-3.5 rounded-2xl px-4 py-2.5', dropping && 'qr-drop')}
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
                    {slotDay(s)} · {new Date(s.startMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </span>
                  <button aria-label="Remove time" onClick={() => togglePick(s)} className="text-ink-faint hover:text-ink">
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2.5">
            <textarea
              ref={fieldRef}
              rows={1}
              value={draft}
              disabled={writing}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && metaKey(e)) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder={writing ? 'Writing…' : `Reply to ${firstName(latest?.from) || 'them'}…`}
              className="placeholder:text-ink-faint max-h-[140px] min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[14.5px] leading-[1.5] outline-none select-text"
            />
            <span className="text-ink-faint mb-2 flex shrink-0 items-center gap-1 text-[11.5px]">
              <Keycaps keys={['⌘', '↩']} /> send
            </span>
            <button
              onClick={send}
              aria-label="Send"
              disabled={writing || (!draft.trim() && !picks.length)}
              className="bg-accent mb-0.5 flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] text-white disabled:opacity-50"
            >
              {writing ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} strokeWidth={2.2} />}
            </button>
          </div>
          <div className="text-ink-faint mt-1 flex items-center gap-3 text-[11.5px]">
            {others.length > 1 ? (
              <button onClick={() => setReplyAll(!all)} className="hover:text-ink-muted">
                {all ? 'Reply all' : 'Reply'} · {toLabel.slice(0, 3).join(', ')}
                {toLabel.length > 3 ? ` +${toLabel.length - 3}` : ''}
              </button>
            ) : (
              <span>To {toLabel.join(', ') || '…'}</span>
            )}
            <span>Undo Send on</span>
          </div>
        </div>
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
        {menu && <AiMenu hasDraft={!!draft.trim()} onPick={(p) => void onMenuPick(p)} onClose={() => setMenu(false)} />}
      </div>
    </div>
  );
}
