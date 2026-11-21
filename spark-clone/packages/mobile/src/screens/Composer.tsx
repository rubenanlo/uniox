import type { Address } from '@app/shared';
import { ArrowUp, CalendarClock, ChevronDown, Mic, Paperclip, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MobileMessage, MobileThread } from '../data/types';
import { AiMark, Spinner } from '../components/ui';
import { displayName, firstName } from '../lib/format';
import { back, useRoute } from '../lib/router';
import { describeSlots, freeSlots } from '../lib/slots';
import { useStore } from '../lib/store';
import { replyTo, reSubject } from './Thread';

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
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [to, setTo] = useState<Address[]>([]);
  const [cc, setCc] = useState<Address[]>([]);
  const [toInput, setToInput] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState(q.get('body') ?? '');
  const [busy, setBusy] = useState(false);
  const [aiOpen, setAiOpen] = useState(q.has('ai') || q.has('ask'));
  const [aiBusy, setAiBusy] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [aiNote, setAiNote] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Load the thread being answered and prefill.
  useEffect(() => {
    if (!replyId) return;
    let live = true;
    void api.thread(replyId).then((d) => {
      if (!live) return;
      setCtx(d);
      setAccountId(d.thread.accountId);
      const last = d.messages[d.messages.length - 1];
      if (forward) {
        setSubject(
          /^fwd?:/i.test(d.thread.subject) ? d.thread.subject : `Fwd: ${d.thread.subject}`,
        );
        setBody(
          (b) =>
            `${b}\n\n---------- Forwarded message ----------\nFrom: ${displayName(last?.from)}\n\n${last?.text ?? last?.snippet ?? ''}`,
        );
      } else {
        setSubject(reSubject(d.thread.subject));
        const me = accounts.find((a) => a.id === d.thread.accountId)?.email;
        setTo(replyTo(last));
        if (q.has('all') && last)
          setCc(
            [...last.to, ...last.cc].filter(
              (a) => a.email !== me && !replyTo(last).some((r) => r.email === a.email),
            ),
          );
      }
    });
    return () => {
      live = false;
    };
  }, [api, replyId, forward, accounts, q]);

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
      setBody(draft);
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
    setBody((b) =>
      b.trim() ? `${b.trim()}\n\n${text}` : `Hi ${firstName(to[0])},\n\n${text}\n\nBest,`,
    );
    setAiNote('added your free times');
  };

  // One-shot actions from the URL (AI idea chip, time slot, Times button).
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || (replyId && !ctx)) return;
    ran.current = true;
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
  const canSend = recipients.length > 0 && body.trim().length > 0 && !!accountId;

  const doSend = async () => {
    setBusy(true);
    try {
      const r = await send({
        accountId,
        to: recipients,
        cc,
        subject,
        body: body.trim(),
        ...(ctx && !forward ? { threadId: ctx.thread.id } : {}),
      });
      showToast({
        text: r === 'queued' ? 'No connection. It will send when you are back online' : 'Sent',
      });
      back('inbox');
    } catch (e) {
      showToast({ text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const account = accounts.find((a) => a.id === accountId);
  return (
    <div className="sheet-wrap">
      <div className="scrim" onClick={() => back('inbox')} />
      <div className="sheet full">
        <div className="grab" />
        <div
          className="row-flex"
          style={{ justifyContent: 'space-between', padding: '6px 16px 8px' }}
        >
          <button style={{ color: 'var(--accent)', fontSize: 17 }} onClick={() => back('inbox')}>
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
          <div
            className="row-flex"
            style={{ padding: '9px 18px', borderTop: '1px solid var(--hair)', flexWrap: 'wrap' }}
          >
            <span className="muted">To:</span>
            {to.map((a) => (
              <button
                key={a.email}
                className="chip"
                style={{
                  height: 28,
                  fontSize: 14,
                  background: 'var(--accent-soft)',
                  border: 'none',
                  color: 'var(--accent)',
                }}
                onClick={() => setTo(to.filter((x) => x !== a))}
              >
                {a.name || a.email}
              </button>
            ))}
            <input
              className="grow"
              style={{ minWidth: 120, height: 30 }}
              value={toInput}
              inputMode="email"
              autoCapitalize="off"
              onChange={(e) => setToInput(e.target.value)}
              onBlur={() => {
                setTo([...to, ...parseAddrs(toInput)]);
                setToInput('');
              }}
            />
          </div>
          {cc.length > 0 && (
            <div
              className="row-flex"
              style={{ padding: '9px 18px', borderTop: '1px solid var(--hair)', flexWrap: 'wrap' }}
            >
              <span className="muted">Cc:</span>
              {cc.map((a) => (
                <button
                  key={a.email}
                  className="chip"
                  style={{ height: 28, fontSize: 14 }}
                  onClick={() => setCc(cc.filter((x) => x !== a))}
                >
                  {a.name || a.email}
                </button>
              ))}
            </div>
          )}
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
          <textarea
            ref={bodyRef}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Write your message…"
            style={{
              display: 'block',
              width: '100%',
              minHeight: 260,
              padding: '14px 18px',
              borderTop: '1px solid var(--hair)',
              lineHeight: 1.55,
              resize: 'none',
              fontSize: 16,
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

        <div
          className="row-flex muted"
          style={{ gap: 22, padding: '10px 18px', borderTop: '1px solid var(--hair)' }}
        >
          <button
            aria-label="Attach (coming soon)"
            onClick={() => showToast({ text: 'Attachments from the phone are coming next' })}
          >
            <Paperclip size={20} />
          </button>
          <button aria-label="Insert free times" onClick={() => void insertTimes()}>
            <CalendarClock size={20} />
          </button>
          <button
            className="row-flex"
            style={{
              marginLeft: 'auto',
              color: 'var(--accent)',
              fontWeight: 600,
              fontSize: 14,
              gap: 5,
            }}
            onClick={() => setAiOpen(!aiOpen)}
          >
            <Sparkles size={17} /> AI
          </button>
        </div>
      </div>
    </div>
  );
}
