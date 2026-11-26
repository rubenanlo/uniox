import { ArrowUp, Mic } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ParticleOrb } from '../components/ParticleOrb';
import { AiMark } from '../components/ui';
import '../components/ask.css';
import type { AssistantTurn, MobileEvent } from '../data/types';
import { clock12, greeting } from '../lib/format';
import { useRoute } from '../lib/router';
import { useStore } from '../lib/store';

const CHIPS: [label: string, question: string][] = [
  ['When am I free?', 'When am I free this week?'],
  ['Who waited longest?', 'Who has waited longest?'],
  ['Draft replies', 'Draft my replies'],
  ['Newsletters', 'What’s new in my newsletters?'],
];

type SpeechCtor = new () => {
  lang: string;
  interimResults: boolean;
  onresult: (e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
  onend: () => void;
  start: () => void;
  stop: () => void;
};
const Speech: SpeechCtor | undefined =
  (window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor })
    .SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: SpeechCtor }).webkitSpeechRecognition;

/**
 * The full Assistant: a page in the Inbox voice. A greeting sentence sums up
 * the evening, chips start common asks, every answer is a frosted card. Swipe
 * from the left edge to go back.
 */
export function Assistant() {
  const { api, threads } = useStore();
  const q = useRoute().query.get('q');
  const [turns, setTurns] = useState<AssistantTurn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [next, setNext] = useState<MobileEvent | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const now = Date.now();
    void api
      .events(now, now + 2 * 86_400_000)
      .then((ev) => setNext(ev.find((e) => !e.allDay && !e.free && e.startMs > now) ?? null))
      .catch(() => {});
  }, [api]);

  const ask = async (text: string) => {
    if (!text.trim() || busy) return;
    const nextTurns: AssistantTurn[] = [...turns, { role: 'user', text: text.trim() }];
    setTurns(nextTurns);
    setInput('');
    setBusy(true);
    try {
      const reply = await api.assistant(nextTurns);
      setTurns([...nextTurns, { role: 'assistant', text: reply }]);
    } catch (e) {
      setTurns([
        ...nextTurns,
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
    if (turns.length) end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [turns, busy]);

  const rec = useRef<InstanceType<SpeechCtor> | null>(null);
  const dictate = () => {
    if (!Speech) return;
    if (listening) {
      rec.current?.stop();
      return;
    }
    const r = new Speech();
    r.lang = navigator.language || 'en-US';
    r.interimResults = false;
    r.onresult = (e) => {
      const t = e.results[0]?.[0]?.transcript;
      if (t) setInput((v) => (v ? `${v} ${t}` : t));
    };
    r.onend = () => setListening(false);
    rec.current = r;
    setListening(true);
    r.start();
  };

  const waiting = threads.filter((t) => t.inInbox && t.priority && t.unreadCount > 0).length;
  const today = new Date().toLocaleDateString([], {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });

  return (
    <div className="ib-page">
      <div className="wash" />
      <div className="screen no-tabs fa" ref={ref}>
        <div className="fa-top">
          <span className="eyebrow">Assistant · {today}</span>
          <span className="ib-orb po" aria-hidden>
            <ParticleOrb size={40} />
          </span>
        </div>
        <p className="fa-sent">
          {greeting()}.{' '}
          {waiting > 0 ? (
            <>
              <button
                className="w"
                onClick={() => void ask('Who is waiting on my reply, and for what?')}
              >
                {waiting} {waiting === 1 ? 'person' : 'people'}
              </button>{' '}
              {waiting === 1 ? 'waits' : 'wait'} on you
            </>
          ) : (
            <>Nobody is waiting on you</>
          )}
          {next ? (
            <>
              , and your next meeting is{' '}
              <b>
                {next.title} at {clock12(next.startMs)}
              </b>
              .
            </>
          ) : (
            '.'
          )}
        </p>
        <div className="fa-chips">
          {CHIPS.map(([label, q]) => (
            <button key={label} className="glass" onClick={() => void ask(q)}>
              <AiMark size={16} />
              {label}
            </button>
          ))}
        </div>
        {turns.length > 0 && <div className="fa-day">Today</div>}
        <div className="fa-conv">
          {turns.map((t, i) =>
            t.role === 'user' ? (
              <div key={i} className="fa-q">
                {t.text}
              </div>
            ) : (
              <div key={i} className="fa-a glass">
                <div className="lb">
                  <AiMark size={18} />
                  Assistant
                </div>
                <div className="ask-text">{t.text}</div>
              </div>
            ),
          )}
          {busy && (
            <div className="fa-a glass">
              <div className="ask-think" aria-label="Thinking">
                <i />
                <i />
                <i />
              </div>
            </div>
          )}
          <div ref={end} />
        </div>
      </div>
      <form
        className="fa-bar glass"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <input
          placeholder={listening ? 'Listening…' : 'Ask about mail, people, your calendar…'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        {Speech && (
          <button
            type="button"
            className={`mic ${listening ? 'on' : ''}`}
            aria-label="Dictate"
            onClick={dictate}
          >
            <Mic size={18} />
          </button>
        )}
        <button className="send" disabled={!input.trim() || busy} aria-label="Ask">
          <ArrowUp size={19} />
        </button>
      </form>
    </div>
  );
}
