import { Globe2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { isValidZone } from '../../lib/availability';
import { cn } from '../../lib/utils';
import { allZones, answerZones, useZonePrompt, type ZoneQuestion } from '../../state/contactZones';

function nowIn(tz: string): string {
  if (!isValidZone(tz)) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  }).format(Date.now());
}

/**
 * Asks once for the zone of each person whose Google calendar doesn't show
 * one, before times are offered to them. Answers are remembered.
 */
export function TimeZonePrompt() {
  const questions = useZonePrompt((s) => s.questions);
  if (!questions) return null;
  return <PromptDialog key={questions.map((q) => q.email).join()} questions={questions} />;
}

function PromptDialog({ questions }: { questions: ZoneQuestion[] }) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.email, q.guess])),
  );
  const zones = useMemo(() => allZones(), []);
  useEscapeClose(true, () => answerZones(null));
  const valid = questions.every((q) => isValidZone(values[q.email] ?? ''));
  const save = () => valid && answerZones(values);

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/30"
      onMouseDown={() => answerZones(null)}
    >
      <div
        role="dialog"
        aria-label="Time zones"
        onMouseDown={(e) => e.stopPropagation()}
        className="border-hairline bg-surface text-ink w-[400px] max-w-[92vw] rounded-2xl border p-4 shadow-2xl"
      >
        <div className="mb-2 flex items-center gap-2">
          <Globe2 size={15} className="text-accent" />
          <h2 className="flex-1 text-[13.5px] font-bold">Where are they?</h2>
          <button
            onClick={() => answerZones(null)}
            aria-label="Close"
            className="text-ink-muted hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
        <p className="text-ink-muted mb-3 text-[12px] leading-relaxed">
          Their calendars don’t show a time zone. Pick one so the times you offer fall in their
          working day and show their local time. Uniox remembers it for next time; change it later
          in Settings › Scheduling.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="space-y-2"
        >
          {questions.map((q, i) => {
            const v = values[q.email] ?? '';
            return (
              <label key={q.email} className="block text-[12px]">
                <span className="flex items-baseline gap-1.5">
                  <span className="font-semibold">{q.name || q.email}</span>
                  {q.name && <span className="text-ink-faint truncate">{q.email}</span>}
                  <span className="text-ink-faint ml-auto tabular-nums">{nowIn(v)}</span>
                </span>
                <input
                  list="tz-options"
                  autoFocus={i === 0}
                  value={v}
                  onChange={(e) => setValues((s) => ({ ...s, [q.email]: e.target.value }))}
                  onFocus={(e) => e.currentTarget.select()}
                  className={cn(
                    'border-hairline bg-surface mt-1 w-full rounded-md border px-2 py-1 text-[12.5px] outline-none',
                    v && !isValidZone(v) ? 'border-red-400' : 'focus:border-accent',
                  )}
                  placeholder="e.g. America/New_York"
                />
              </label>
            );
          })}
          <datalist id="tz-options">
            {zones.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => answerZones(null)}
              className="text-ink-muted hover:text-ink rounded-full px-3 py-1 text-[12px] font-semibold"
            >
              Skip
            </button>
            <button
              type="submit"
              disabled={!valid}
              className="bg-accent rounded-full px-3 py-1 text-[12px] font-semibold text-white disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
