import { ArrowUp, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { AssistantTurn } from '../data/types';
import { AiMark, Spinner } from '../components/ui';
import { back, useRoute } from '../lib/router';
import { useStore } from '../lib/store';

const STARTERS = [
  'What do I need to do before Monday?',
  'Summarize my unread priority mail',
  'Prep me for my next meeting',
  "What's new in my newsletters?",
];

/** The ⌘J assistant, as a frosted full-height sheet. */
export function Assistant() {
  const api = useStore((s) => s.api);
  const q = useRoute().query.get('q');
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  const ask = async (text: string) => {
    if (!text.trim() || busy) return;
    const next: AssistantTurn[] = [...turns, { role: 'user', text: text.trim() }];
    setTurns(next);
    setInput('');
    setBusy(true);
    try {
      const reply = await api.assistant(next);
      setTurns([...next, { role: 'assistant', text: reply }]);
    } catch (e) {
      setTurns([
        ...next,
        { role: 'assistant', text: `Sorry, that failed: ${(e as Error).message}` },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const asked = useRef(false);
  useEffect(() => {
    if (q && !asked.current) {
      asked.current = true;
      void ask(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth' });
  }, [turns, busy]);

  return (
    <>
      <div className="wash" />
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'color-mix(in srgb, var(--app) 30%, transparent)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          zIndex: 43,
        }}
        onClick={() => back('home')}
      />
      <div
        className="glass pop"
        style={{
          position: 'fixed',
          left: 10,
          right: 10,
          top: 'calc(var(--safe-top) + 16px)',
          bottom: 'calc(var(--safe-bottom) + 12px)',
          borderRadius: 32,
          zIndex: 45,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div className="row-flex" style={{ padding: '16px 16px 8px', gap: 10 }}>
          <AiMark size={34} />
          <div className="grow">
            <b style={{ fontSize: 17 }}>Assistant</b>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Knows your mail and calendar
            </div>
          </div>
          <button className="navbtn" aria-label="Close" onClick={() => back('home')}>
            <X size={20} />
          </button>
        </div>
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: '8px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          {turns.length === 0 && (
            <div className="muted" style={{ fontSize: 15, lineHeight: 1.5, marginTop: 8 }}>
              Ask about your inbox or calendar. For example:
            </div>
          )}
          {turns.map((t, i) =>
            t.role === 'user' ? (
              <div key={i} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div className="bubble-out" style={{ maxWidth: '80%' }}>
                  {t.text}
                </div>
              </div>
            ) : (
              <div key={i} className="mail-text pop" style={{ fontSize: 15, lineHeight: 1.5 }}>
                {t.text}
              </div>
            ),
          )}
          {busy && (
            <div className="row-flex muted" style={{ fontSize: 14 }}>
              <Spinner /> Thinking…
            </div>
          )}
          <div ref={end} />
        </div>
        <div style={{ padding: '0 16px 16px' }}>
          <div className="chips" style={{ padding: '0 0 10px' }}>
            {(turns.length
              ? ['Draft replies for these', 'Anything urgent?', 'What about tomorrow?']
              : STARTERS
            ).map((s) => (
              <button key={s} className="chip" onClick={() => void ask(s)}>
                {s}
              </button>
            ))}
          </div>
          <form
            className="row-flex"
            style={{
              height: 48,
              borderRadius: 24,
              padding: '0 6px 0 16px',
              background: 'color-mix(in srgb, var(--surface) 75%, transparent)',
              border: '1px solid color-mix(in oklch, var(--ink) 10%, transparent)',
            }}
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
            }}
          >
            <input
              className="grow"
              style={{ fontSize: 16 }}
              placeholder="Ask anything…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button className="send" disabled={!input.trim() || busy} aria-label="Ask">
              <ArrowUp size={20} />
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
