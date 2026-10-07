import { useEffect, useState } from 'react';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';
import { SilkBackground } from './SilkBackground';

const PHRASES = [
  'one inbox for multiple accounts',
  'manage your calendar',
  'add integrations',
  'with AI integrated',
] as const;

// Seconds. Word entrance staggers; the whole line holds, then scales out.
const WORD_STAGGER = 0.07;
const WORD_DUR = 0.65;
const HOLD = 1.0;
const OUT_DUR = 0.65;

function SplitLine({ text, exiting }: { text: string; exiting: boolean }) {
  const words = text.split(' ');
  return (
    <div
      className="intro-line text-[clamp(2rem,6.5vw,4.75rem)] leading-[1.05] font-bold tracking-tight text-white"
      style={exiting ? { animation: `intro-line-out ${OUT_DUR}s ease-in forwards` } : undefined}
    >
      {words.map((w, i) => (
        <span
          key={`${text}-${i}`}
          className="intro-word inline-block"
          style={{
            animation: `intro-word-in ${WORD_DUR}s cubic-bezier(0.2, 0.7, 0.2, 1) both`,
            animationDelay: `${i * WORD_STAGGER}s`,
          }}
        >
          {w}
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </div>
  );
}

export function Intro({ onDone }: { onDone: () => void }) {
  const reduce = usePrefersReducedMotion();
  // 0..PHRASES.length-1 = phrases; === PHRASES.length = the Uniox finale.
  const [step, setStep] = useState(reduce ? PHRASES.length : 0);
  const [exiting, setExiting] = useState(false);

  // Advance the phrase sequence: enter → hold → scale out → next.
  useEffect(() => {
    const phrase = PHRASES[step];
    if (reduce || !phrase) return;
    const wordCount = phrase.split(' ').length;
    const inMs = ((wordCount - 1) * WORD_STAGGER + WORD_DUR) * 1000;
    const outStart = inMs + HOLD * 1000;
    const t1 = window.setTimeout(() => setExiting(true), outStart);
    const t2 = window.setTimeout(
      () => {
        setExiting(false);
        setStep((s) => s + 1);
      },
      outStart + OUT_DUR * 1000,
    );
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [step, reduce]);

  // The splash rests on the wordmark and never advances on its own — the user
  // continues into the app or replays it.
  const atFinale = step >= PHRASES.length;
  const replay = () => {
    setExiting(false);
    setStep(0);
  };

  // Esc skips straight through.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDone();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-[100] overflow-hidden bg-[#0e0e12] select-none">
      <SilkBackground still={reduce} />
      {/* Dark scrim keeps the type legible over the brightest silk streaks. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_50%_50%,transparent_35%,rgba(8,8,12,0.72))]" />

      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center px-8 text-center">
        {!atFinale ? (
          <SplitLine key={step} text={PHRASES[step] ?? ''} exiting={exiting} />
        ) : (
          <div className="flex flex-col items-center gap-9">
            <div className="flex flex-col items-center gap-4">
              <h1
                className="intro-uniox text-gradient text-[clamp(3.5rem,13vw,9rem)] leading-none font-black tracking-tight"
                style={
                  reduce
                    ? undefined
                    : { animation: 'intro-uniox-in 1.25s cubic-bezier(0.2,0.7,0.2,1) both' }
                }
              >
                Uniox
              </h1>
              <p
                className="max-w-[34rem] text-[clamp(0.95rem,2.2vw,1.15rem)] font-medium text-balance text-white/65"
                style={
                  reduce
                    ? undefined
                    : { animation: 'intro-fade-up 0.5s ease-out both', animationDelay: '0.65s' }
                }
              >
                Every account, your calendar, and AI — in one place.
              </p>
            </div>
            <div
              className="flex items-center gap-3"
              style={
                reduce
                  ? undefined
                  : { animation: 'intro-fade-up 0.5s ease-out both', animationDelay: '1.05s' }
              }
            >
              <button
                onClick={onDone}
                className="rounded-full bg-white px-7 py-2.5 text-[13px] font-semibold text-[#0e0e12] transition hover:bg-white/85"
              >
                Get started
              </button>
              <button
                onClick={replay}
                className="rounded-full bg-white/10 px-6 py-2.5 text-[13px] font-semibold text-white/80 backdrop-blur transition hover:bg-white/20 hover:text-white"
              >
                Replay
              </button>
            </div>
          </div>
        )}
      </div>

      {!atFinale && (
        <button
          onClick={onDone}
          className="absolute top-6 right-7 z-20 text-[12.5px] font-medium text-white/45 transition hover:text-white/90"
        >
          Skip
        </button>
      )}
    </div>
  );
}
