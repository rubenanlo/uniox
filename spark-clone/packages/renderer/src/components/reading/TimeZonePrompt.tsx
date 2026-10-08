import { Globe2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { isValidZone } from '../../lib/availability';
import { ZoneSelect } from '../ui/ZoneSelect';
import { allZones, answerZones, useZonePrompt, type ZoneQuestion } from '../../state/contactZones';

const SOURCE: Record<ZoneQuestion['source'], string> = {
  saved: 'saved',
  google: 'from Google',
  thread: 'from the email',
  assistant: 'guessed from the email',
  yours: 'not found, set to your zone',
};

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
      className="no-drag fixed inset-0 z-[70] flex items-center justify-center bg-black/30"
      onMouseDown={() => answerZones(null)}
    >
      <div
        role="dialog"
        aria-label="Time zones"
        onMouseDown={(e) => e.stopPropagation()}
        className="border-hairline bg-surface text-ink w-[460px] max-w-[92vw] rounded-2xl border p-4 shadow-2xl"
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
          Times you offer fall in each person’s 9:00–18:00 and show their local time. Uniox
          remembers your answers; change them later with the globe button or in Settings ›
          Scheduling.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div className="border-hairline border-t">
            {questions.map((q, i) => {
              const v = values[q.email] ?? '';
              const name = q.name && q.name.toLowerCase() !== q.email ? q.name : null;
              return (
                <div
                  key={q.email}
                  className="border-hairline flex items-center gap-4 border-b py-2.5 text-[12.5px]"
                >
                  <div className="min-w-0 flex-1" title={q.email}>
                    <p className="truncate font-medium">{name ?? q.email}</p>
                    <p className="text-ink-faint truncate text-[11px]">
                      {v === q.guess ? SOURCE[q.source] : 'changed'}
                      {v && isValidZone(v) ? ` · ${nowIn(v)} there` : ''}
                    </p>
                  </div>
                  <ZoneSelect
                    value={v}
                    zones={zones}
                    autoFocus={i === 0}
                    label={`Time zone for ${name ?? q.email}`}
                    onChange={(z) => setValues((s) => ({ ...s, [q.email]: z }))}
                  />
                </div>
              );
            })}
          </div>
          <div className="flex justify-end gap-2 pt-3">
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
