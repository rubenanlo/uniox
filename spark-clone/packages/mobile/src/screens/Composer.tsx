import type { Address } from '@app/shared';
import { ArrowUp, CalendarClock, ChevronDown, Mic, Paperclip, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { MobileMessage, MobileThread } from '../data/types';
import { ParticleOrb } from '../components/ParticleOrb';
import { RichBody, type RichBodyHandle, textToHtml } from '../components/RichBody';
import { AiMark, Spinner } from '../components/ui';
import { clearKeptDraft, keepDraft, takeKeptDraft } from '../lib/draftKeep';
import { clock12, displayName, firstName } from '../lib/format';
import { back, go, useRoute } from '../lib/router';
import { describeSlots, freeSlots } from '../lib/slots';
import { useStore } from '../lib/store';
import { replyTo, reSubject } from './Thread';
import './composer.css';

function parseAddrs(s: string): Address[] {
  return s
    .split(/[,;\s]+/)
    .map((x) => x.trim().toLowerCase())
    .filter((x) => /.+@.+\..+/.test(x))
    .map((email) => ({ email }));
}

const QUICK = ['Shorter', 'Warmer', 'More formal', 'Fix grammar', 'Translate to Spanish'];

export function Composer() {
  const { api, accounts, send, showToast } = useStore();
  const q = useRoute().query;
  const replyId = q.get('reply') ?? q.get('forward');
  const forward = q.has('forward');
  const [ctx, setCtx] = useState<{ thread: MobileThread; messages: MobileMessage[] } | null>(null);
  // A draft set aside from the island (to look at the Inbox, Calendar or
  // Search) comes back when the composer is opened again.
  const [kept] = useState(() => takeKeptDraft(q.toString()));
  const [accountId, setAccountId] = useState(kept?.accountId || (accounts[0]?.id ?? ''));
  const [to, setTo] = useState<Address[]>(kept?.to ?? []);
  const [cc, setCc] = useState<Address[]>(kept?.cc ?? []);
  const [bcc, setBcc] = useState<Address[]>(kept?.bcc ?? []);
  const [toInput, setToInput] = useState('');
  const [ccInput, setCcInput] = useState('');
  const [bccInput, setBccInput] = useState('');
  const [ccOpen, setCcOpen] = useState(!!kept && kept.cc.length + kept.bcc.length > 0);
  const [subject, setSubject] = useState(kept?.subject ?? '');
  // `body` is the plain-text twin (AI, send check, text/plain part); `html`
  // is the formatted body, set only when there is formatting to keep.
  const [body, setBody] = useState(kept?.body ?? q.get('body') ?? '');
  const [html, setHtml] = useState<string | undefined>(kept?.html);
  const [initialHtml] = useState(() => kept?.html ?? (body ? textToHtml(body) : undefined));
  const [busy, setBusy] = useState(false);
  const [aiOpen, setAiOpen] = useState(q.has('ai') || q.has('ask'));
  const [aiBusy, setAiBusy] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [aiNote, setAiNote] = useState<string | null>(null);
  const bodyRef = useRef<RichBodyHandle>(null);

  // Load the thread being answered and prefill.
  useEffect(() => {
    if (!replyId) return;
    let live = true;
    void api.thread(replyId).then((d) => {
      if (!live) return;
      setCtx(d);
      if (kept) return; // the kept draft already holds the prefill
      setAccountId(d.thread.accountId);
      const last = d.messages[d.messages.length - 1];
      if (forward) {
        setSubject(
          /^fwd?:/i.test(d.thread.subject) ? d.thread.subject : `Fwd: ${d.thread.subject}`,
        );
        bodyRef.current?.appendText(
          `---------- Forwarded message ----------\nFrom: ${displayName(last?.from)}\n\n${last?.text ?? last?.snippet ?? ''}`,
        );
      } else {
        setSubject(reSubject(d.thread.subject));
        const me = accounts.find((a) => a.id === d.thread.accountId)?.email;
        setTo(replyTo(last));
        if (q.has('all') && last) {
          const others = [...last.to, ...last.cc].filter(
            (a) => a.email !== me && !replyTo(last).some((r) => r.email === a.email),
          );
          setCc(others);
          if (others.length) setCcOpen(true);
        }
      }
    });
    return () => {
      live = false;
    };
  }, [api, replyId, forward, accounts, q, kept]);

  const contextText = () => {
    const last = ctx?.messages[ctx.messages.length - 1];
    return last
      ? `Email from ${displayName(last.from)}:\n${(last.text ?? last.snippet).slice(0, 3000)}`
      : '';
  };

  const runAi = async (instr: string) => {
    if (!instr.trim()) return;
    setAiBusy(true);
    try {
      const draft = body.trim()
        ? await api.rewrite(body, instr)
        : await api.rewrite(
            '',
            `Write a short reply that does this: ${instr}. Sign off as me.\n\n${contextText()}`,
          );
      bodyRef.current?.setText(draft);
      setAiNote(instr.toLowerCase());
      setInstruction('');
    } catch (e) {
      showToast({ text: (e as Error).message });
    } finally {
      setAiBusy(false);
    }
  };

  const insertTimes = async (slots?: { startMs: number; endMs: number }[]) => {
    const now = Date.now();
    const list = slots ?? freeSlots(await api.events(now, now + 12 * 86_400_000));
    if (!list.length) return showToast({ text: 'No free slots in the next days' });
    const text = `${q.has('propose') ? 'Could we move this to one of these times instead?' : 'I can do any of these:'}\n${describeSlots(list)}`;
    if (body.trim()) bodyRef.current?.appendText(text);
    else bodyRef.current?.setText(`Hi ${firstName(to[0])},\n\n${text}\n\nBest,`);
    setAiNote('added your free times');
  };

  // One-shot actions from the URL (AI idea chip, time slot, Times button).
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || (replyId && !ctx)) return;
    ran.current = true;
    if (kept) return;
    const ask = q.get('ask');
    const slots = q.get('slots');
    // Deferred so the prefill from the thread lands first.
    setTimeout(() => {
      if (ask) void runAi(ask);
      else if (slots) void insertTimes(JSON.parse(slots));
      else if (q.has('times') || q.has('propose')) void insertTimes();
      else bodyRef.current?.focus();
    }, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx]);

  const recipients = [...to, ...parseAddrs(toInput)];
  const ccAll = [...cc, ...parseAddrs(ccInput)];
  const bccAll = [...bcc, ...parseAddrs(bccInput)];

  const close = () => {
    clearKeptDraft();
    back('inbox');
  };
  /** Set the draft aside and go look at another screen. */
  const leaveFor = (path: string) => {
    keepDraft({
      query: q.toString(),
      accountId,
      to: recipients,
      cc: ccAll,
      bcc: bccAll,
      subject,
      body,
      ...(html ? { html } : {}),
    });
    showToast({ text: 'Draft kept. Open Write to come back to it' });
    go(path);
  };
  const canSend = recipients.length > 0 && body.trim().length > 0 && !!accountId;

  const doSend = async () => {
    setBusy(true);
    try {
      const r = await send({
        accountId,
        to: recipients,
        cc: ccAll,
        ...(bccAll.length ? { bcc: bccAll } : {}),
        subject,
        body: body.trim(),
        ...(html ? { html } : {}),
        ...(ctx && !forward ? { threadId: ctx.thread.id } : {}),
      });
      showToast({
        text: r === 'queued' ? 'No connection. It will send when you are back online' : 'Sent',
      });
      close();
    } catch (e) {
      showToast({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const account = accounts.find((a) => a.id === accountId);
  return (
    <div className="sheet-wrap">
      <div className="scrim" onClick={close} />
      <div className="sheet full cmp">
        <div className="grab" />
        <div
          className="row-flex"
          style={{ justifyContent: 'space-between', padding: '6px 16px 8px' }}
        >
          <button style={{ color: 'var(--accent)', fontSize: 17 }} onClick={close}>
            Cancel
          </button>
          <b className="ellipsis" style={{ fontSize: 17, maxWidth: '55%' }}>
            {subject || 'New message'}
          </b>
          <button
            className="send"
            disabled={!canSend || busy}
            aria-label="Send"
            onClick={() => void doSend()}
          >
            {busy ? <Spinner /> : <ArrowUp size={20} />}
          </button>
        </div>
        <div className="sheet-body" style={{ fontSize: 16 }}>
          <AddrRow
            label="To"
            list={to}
            setList={setTo}
            input={toInput}
            setInput={setToInput}
            accent
            trailing={
              <button
                className="cmp-cclink"
                aria-expanded={ccOpen}
                aria-controls="cmp-cc"
                onClick={() => setCcOpen(!ccOpen)}
              >
                {ccOpen ? 'Hide Cc/Bcc' : 'Cc/Bcc'}
              </button>
            }
          />
          <div id="cmp-cc" className={`cmp-fold${ccOpen ? ' open' : ''}`} inert={!ccOpen}>
            <div>
              <AddrRow label="Cc" list={cc} setList={setCc} input={ccInput} setInput={setCcInput} />
              <AddrRow
                label="Bcc"
                list={bcc}
                setList={setBcc}
                input={bccInput}
                setInput={setBccInput}
              />
            </div>
          </div>
          <label
            className="row-flex"
            style={{
              padding: '11px 18px',
              borderTop: '1px solid var(--hair)',
              position: 'relative',
            }}
          >
            <span className="muted">From:</span>
            <span className="grow ellipsis">{account?.email ?? '—'}</span>
            {accounts.length > 1 && <ChevronDown size={16} color="var(--muted)" />}
            {accounts.length > 1 && (
              <select
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                style={{ position: 'absolute', inset: 0, opacity: 0 }}
                aria-label="From account"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email}
                  </option>
                ))}
              </select>
            )}
          </label>
          {!replyId || forward ? (
            <input
              style={{
                display: 'block',
                width: '100%',
                padding: '11px 18px',
                borderTop: '1px solid var(--hair)',
              }}
              placeholder="Subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          ) : null}
          <RichBody
            ref={bodyRef}
            initialHtml={initialHtml}
            placeholder="Write your message…"
            onChange={(t, h) => {
              setBody(t);
              setHtml(h);
            }}
          />
        </div>

        {aiOpen && (
          <div
            className="glass pop"
            style={{ margin: '0 10px 8px', borderRadius: 22, padding: '11px 12px 12px' }}
          >
            <div className="row-flex">
              <AiMark size={24} />
              <b style={{ fontSize: 14 }}>Assistant</b>
              {aiNote && (
                <span className="muted ellipsis grow" style={{ fontSize: 12.5 }}>
                  · {aiNote}
                </span>
              )}
              {aiBusy && <Spinner />}
              <button
                className="muted"
                style={{ marginLeft: 'auto' }}
                aria-label="Close assistant"
                onClick={() => setAiOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <div className="chips" style={{ padding: '9px 0 0' }}>
              {(body.trim()
                ? QUICK
                : ['Say yes', 'Politely decline', 'Ask for more details', 'Thank them']
              ).map((c) => (
                <button key={c} className="chip sm" disabled={aiBusy} onClick={() => void runAi(c)}>
                  {c}
                </button>
              ))}
            </div>
            <form
              className="row-flex"
              style={{
                marginTop: 9,
                height: 40,
                borderRadius: 20,
                padding: '0 6px 0 14px',
                background: 'color-mix(in srgb, var(--surface) 70%, transparent)',
                border: '1px solid color-mix(in oklch, var(--ink) 10%, transparent)',
              }}
              onSubmit={(e) => {
                e.preventDefault();
                void runAi(instruction);
              }}
            >
              <input
                className="grow"
                style={{ fontSize: 15 }}
                placeholder={
                  body.trim()
                    ? 'Ask the assistant to change it…'
                    : 'Tell the assistant what to write…'
                }
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
              />
              {instruction ? (
                <button className="send" style={{ width: 30, height: 30 }} aria-label="Ask">
                  <ArrowUp size={16} />
                </button>
              ) : (
                <Mic
                  size={18}
                  color="var(--muted)"
                  aria-label="Dictate with the keyboard microphone"
                />
              )}
            </form>
          </div>
        )}

        <div className="cmp-bar">
          <button
            className="cmp-tool"
            aria-label="Attach (coming soon)"
            onClick={() => showToast({ text: 'Attachments from the phone are coming next' })}
          >
            <Paperclip size={18} />
          </button>
          <button
            className="cmp-tool"
            aria-label="Insert free times"
            onClick={() => void insertTimes()}
          >
            <CalendarClock size={18} />
          </button>
          <button
            className="cmp-orb"
            aria-label="Assistant"
            aria-expanded={aiOpen}
            onClick={() => setAiOpen(!aiOpen)}
          >
            <ParticleOrb size={44} />
          </button>
        </div>
        <ComposerIsland leaveFor={leaveFor} />
      </div>
    </div>
  );
}

/** One recipients line: label, picked addresses as chips, and a field for more. */
function AddrRow({
  label,
  list,
  setList,
  input,
  setInput,
  accent,
  trailing,
}: {
  label: string;
  list: Address[];
  setList: (l: Address[]) => void;
  input: string;
  setInput: (s: string) => void;
  accent?: boolean;
  trailing?: ReactNode;
}) {
  const commit = () => {
    const more = parseAddrs(input);
    if (more.length) setList([...list, ...more]);
    setInput('');
  };
  return (
    <div className="cmp-row">
      <span className="muted cmp-lb">{label}:</span>
      <div className="cmp-addrs">
        {list.map((a) => (
          <button
            key={a.email}
            className={`chip cmp-addr${accent ? ' accent' : ''}`}
            aria-label={`Remove ${a.name || a.email}`}
            onClick={() => setList(list.filter((x) => x !== a))}
          >
            {a.name || a.email}
          </button>
        ))}
        <input
          aria-label={label}
          value={input}
          inputMode="email"
          autoCapitalize="off"
          autoCorrect="off"
          onChange={(e) => setInput(e.target.value)}
          onBlur={commit}
        />
      </div>
      {trailing}
    </div>
  );
}

/**
 * The Inbox's bottom island, inside the composer: the same glass handle
 * unfolds into the same sentence card, but its words lead out of the draft to
 * the Inbox, the Calendar and Search. The draft is kept while you look.
 */
function ComposerIsland({ leaveFor }: { leaveFor: (path: string) => void }) {
  const api = useStore((s) => s.api);
  const unread = useStore((s) => s.threads.some((t) => t.unreadCount > 0 && t.priority));
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState<{ title: string; startMs: number } | null>(null);
  const drag = useRef<number | null>(null);
  useEffect(() => {
    if (!open) return;
    const now = Date.now();
    void api
      .events(now, now + 86_400_000)
      .then((ev) => setNext(ev.find((e) => !e.allDay && !e.free && e.startMs > now) ?? null))
      .catch(() => setNext(null));
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, api]);
  const tab = open ? 0 : -1;
  return (
    <div className="cmp-island">
      <div className={`dock-catch ${open ? 'on' : ''}`} onClick={() => setOpen(false)} />
      <nav
        className={`dock ${open ? 'open' : ''}`}
        aria-label="Leave the draft for"
        aria-hidden={!open}
        onPointerDown={(e) => (drag.current = e.clientY)}
        onPointerMove={(e) => {
          if (drag.current != null && e.clientY - drag.current > 26) {
            drag.current = null;
            setOpen(false);
          }
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <div className="dk-sent glass">
          <p>
            Your draft stays put. Peek at the{' '}
            <button className="w" tabIndex={tab} onClick={() => leaveFor('inbox')}>
              Inbox
            </button>
            , check the{' '}
            <button className="w" tabIndex={tab} onClick={() => leaveFor('calendar')}>
              Calendar
            </button>
            {next ? ` before ${next.title} at ${clock12(next.startMs)}` : ''}, or{' '}
            <button className="w" tabIndex={tab} onClick={() => leaveFor('search')}>
              search
            </button>{' '}
            for something to add.
          </p>
        </div>
      </nav>
      <button
        className={`dock-handle glass ${open ? 'hide' : ''}`}
        aria-label="Open navigation"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <i />
        {unread && <span className="hd" />}
      </button>
    </div>
  );
}
