import type { Address, MessageBodyPayload, MessageMeta, OutgoingDraft } from '@app/shared';
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
  rewriteDraft,
  summarizeThread,
  threadContext,
  translateLatest,
} from '../../lib/quickReplyAi';
import { cachedReplyIdeas } from '../../lib/replyIdeasCache';
import { deferSend } from '../../lib/sendDraft';
import { normalizeSignatureHtml, signatureBlock, signatureText } from '../../lib/signature';
import { useAssistant } from '../../state/assistant';
import { detectAvailabilityAsk, othersOn, suggestGroupSlots } from '../../state/availability';
import { useDelta } from '../../state/queries';
import type { AiMenuPick } from './AiMenu';

/** Time cards offered in the chat. */
const SLOT_CARDS = 3;

export interface ChatNote {
  id: string;
  /** What was asked (shown as your bubble), for "Ask anything". */
  question?: string;
  text: string;
  busy?: boolean;
}

export interface ChatOutgoing {
  id: string;
  kind: 'reply' | 'forward';
  text: string;
  label: string;
  status: 'pending' | 'sent';
  cancel: () => boolean;
}

export type ChatTimes = { slots: GroupSlot[]; people: Participant[] } | 'loading' | 'none' | null;

export interface LoadedThread {
  msgs: MessageMeta[];
  bodies: Record<string, MessageBodyPayload>;
}

/** The thread's messages (drafts left out unless asked for) and their bodies. */
export async function fetchThread(threadId: string, withDrafts = false): Promise<LoadedThread> {
  const msgs = (await api.query('thread:messages', { threadId })).filter((m) => withDrafts || !m.draft);
  const loaded = await Promise.all(
    msgs.filter((m) => !m.draft).map((m) => api.query('message:body', { messageId: m.id })),
  );
  return {
    msgs,
    bodies: Object.fromEntries(loaded.filter((b): b is MessageBodyPayload => !!b).map((b) => [b.messageId, b])),
  };
}

export const nameOf = (a: Address | null | undefined) => a?.name || a?.email || 'Unknown';
export const firstName = (a: Address | null | undefined) => (a?.name || a?.email || '').split(/[\s@]/)[0] || '';
/** "You, Maya, Laura and Antonio". */
export const listNames = (names: string[]) =>
  names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '');

/**
 * Everything behind a thread shown as a chat: the messages and bodies, the
 * assistant's read with reply ideas, suggested times, notes from the AI menu,
 * the reply draft and what was sent (with Undo). Shared by the ⌥⌘N island's
 * reply widget and the reading pane's chat layout, so both behave the same.
 */
export function useChatThread(
  threadId: string,
  opts: {
    /** Account to reply from before the thread has loaded. */
    accountIdHint?: string;
    /** Mark unread messages read once loaded (the island; the reading pane has its own rules). */
    markRead?: boolean;
    /** Keep stored drafts in `messages` (the reading pane shows them inline). */
    withDrafts?: boolean;
  } = {},
) {
  const { accountIdHint, markRead = false, withDrafts = false } = opts;
  const [messages, setMessages] = useState<MessageMeta[]>([]);
  const [bodies, setBodies] = useState<Record<string, MessageBodyPayload>>({});
  const [loaded, setLoaded] = useState(false);
  const [own, setOwn] = useState<Set<string>>(() => new Set());
  const [signatures, setSignatures] = useState<Record<string, string>>({});
  // Accounts and signatures have arrived: a Notification Center reply waits for both.
  const [ready, setReady] = useState({ own: false, sigs: false });
  const [ideas, setIdeas] = useState<ReplyIdeas | 'loading' | 'error' | null>(null);
  const [times, setTimes] = useState<ChatTimes>(null);
  const [picks, setPicks] = useState<GroupSlot[]>([]);
  const [notes, setNotes] = useState<ChatNote[]>([]);
  const [outgoing, setOutgoing] = useState<ChatOutgoing[]>([]);
  const [forwarding, setForwarding] = useState(false);
  const [draft, setDraft] = useState('');
  const [writing, setWriting] = useState(false);
  const [replyAll, setReplyAll] = useState<boolean | null>(null);
  const configured = useAssistant((s) => s.configured);
  const fieldRef = useRef<HTMLTextAreaElement>(null);

  const applyThread = useCallback(({ msgs, bodies: b }: LoadedThread) => {
    setMessages(msgs);
    setBodies(b);
    setLoaded(true);
  }, []);

  // Open: load the thread (marking it read if asked) and pick up accounts and
  // signatures for the reply.
  useEffect(() => {
    void fetchThread(threadId, withDrafts).then((t) => {
      applyThread(t);
      if (!markRead) return;
      const byAccount = new Map<string, string[]>();
      for (const m of t.msgs.filter((x) => !x.seen && !x.draft)) {
        byAccount.set(m.accountId, [...(byAccount.get(m.accountId) ?? []), m.id]);
      }
      for (const [accountId, messageIds] of byAccount) {
        void api.command('task:enqueue', { type: 'set-seen', accountId, messageIds, seen: true });
      }
    });
    void api.query('accounts:list', undefined).then((a) => {
      setOwn(new Set(a.map((x) => x.email.toLowerCase())));
      setReady((r) => ({ ...r, own: true }));
    });
    void api.query('signatures:list', undefined).then((sigs) => {
      setSignatures(Object.fromEntries(sigs.map((s) => [s.id, normalizeSignatureHtml(s.bodyHtml)])));
      setReady((r) => ({ ...r, sigs: true }));
    });
  }, [threadId, applyThread, markRead, withDrafts]);

  useDelta((e) => {
    if ((e.kind === 'message-body' && e.threadIds.includes(threadId)) || e.kind === 'threads-changed') {
      void fetchThread(threadId, withDrafts).then(applyThread);
    }
  });

  const mail = useMemo(() => messages.filter((m) => !m.draft), [messages]);
  const latest = mail[mail.length - 1];
  const latestBody = latest ? bodies[latest.id] : undefined;
  const accountId = latest?.accountId ?? accountIdHint ?? '';
  const context = useMemo(() => threadContext(mail, bodies, own), [mail, bodies, own]);
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
    cachedReplyIdeas(latest.id, context).then(
      (read) => {
        setIdeas(read);
        // The assistant spotted a meeting ask the keyword check missed.
        if (read.meetingMinutes && !timesStarted.current) void loadTimes(read.meetingMinutes, null);
      },
      () => setIdeas('error'),
    );
  }, [latest, latestBody, configured, context, loadTimes]);

  const people = times && typeof times === 'object' ? times.people : [];
  const timeLines = picks.map((s) => `• ${formatSlotForPeople(s, people)}`);

  const togglePick = (slot: GroupSlot) =>
    setPicks((p) =>
      p.some((x) => x.startMs === slot.startMs)
        ? p.filter((x) => x.startMs !== slot.startMs)
        : [...p, slot].sort((a, b) => a.startMs - b.startMs),
    );

  /** The reply text as sent: what was typed, plus any picked times not already in it. */
  const replyText = (typedText = draft): string => {
    const typed = typedText.trim();
    if (!picks.length) return typed;
    if (!typed) return templateGroupReply(picks, people, people.length === 1 ? firstName(people[0]) : undefined);
    const missing = timeLines.filter((l) => !typed.includes(l.slice(2)));
    return missing.length ? `${typed}\n\n${missing.join('\n')}` : typed;
  };

  const queue = (kind: ChatOutgoing['kind'], out: OutgoingDraft, text: string, label: string) => {
    const id = crypto.randomUUID();
    const { cancel } = deferSend(out, () =>
      setOutgoing((o) => o.map((x) => (x.id === id ? { ...x, status: 'sent' } : x))),
    );
    setOutgoing((o) => [...o, { id, kind, text, label, status: 'pending', cancel }]);
  };

  const send = (typedText?: string) => {
    if (!latest) return;
    const text = replyText(typedText);
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
    if (typedText === undefined) {
      setDraft('');
      setPicks([]);
    }
  };

  const undo = (o: ChatOutgoing) => {
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

  /** A pick from the AI menu: rewrite the draft, summarize, write, or ask. */
  const runAiPick = async (pick: AiMenuPick) => {
    if (!configured) return void toast('Add your Claude API key in Settings to use the assistant.');
    if (pick.kind === 'summarize') return void addNote(() => summarizeThread(context));
    if (pick.kind === 'translate-thread') return void addNote(() => translateLatest(context));
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

  const showTimes = () => {
    if (times && times !== 'none') return;
    void loadTimes(30, null);
  };

  const ideasReady = ideas && typeof ideas === 'object' ? ideas : null;
  const files = latestBody ? cardAttachments(latestBody.attachments, latestBody.html) : [];
  const toLabel = recipients.to.concat(recipients.cc).map((a) => firstName(a));
  const aiPhase: 'off' | 'loading' | 'error' | 'ready' = !configured
    ? 'off'
    : ideas === 'loading' || ideas === null
      ? 'loading'
      : ideas === 'error'
        ? 'error'
        : 'ready';

  return {
    threadId,
    messages,
    mail,
    bodies,
    loaded,
    own,
    ready,
    configured,
    ideas,
    ideasReady,
    aiPhase,
    times,
    people,
    picks,
    togglePick,
    notes,
    outgoing,
    forwarding,
    setForwarding,
    draft,
    setDraft,
    writing,
    all,
    setReplyAll,
    latest,
    latestBody,
    accountId,
    others,
    recipients,
    files,
    toLabel,
    fieldRef,
    replyText,
    send,
    queue,
    undo,
    writeFromIntent,
    runAiPick,
    showTimes,
  };
}

export type ChatThread = ReturnType<typeof useChatThread>;
