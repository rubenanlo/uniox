import { CalendarSearch } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { parseDateInput } from '../../lib/parseDate';
import { useCalendar } from '../../state/calendar';
import { useGoToDate } from '../../state/goToDate';
import { useUi } from '../../state/store';

const EXAMPLES = 'e.g. 15 nov, 2026-12-03, next fri, +2w';

function fmtLong(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function GoToDateDialog() {
  const open = useGoToDate((s) => s.open);
  if (!open) return null;
  return <Dialog />;
}

function Dialog() {
  const setOpen = useGoToDate((s) => s.setOpen);
  const [text, setText] = useState('');
  const close = () => setOpen(false);
  useEscapeClose(true, close);
  const day = useMemo(() => parseDateInput(text), [text]);

  const go = () => {
    if (day === null) return;
    close();
    useUi.getState().setView('calendar');
    useCalendar.getState().setCursor(day);
  };

  return (
    <div
      className="no-drag pointer-events-auto absolute inset-0 z-50 flex items-start justify-center bg-black/30 pt-[18vh]"
      onMouseDown={close}
    >
      <div
        role="dialog"
        aria-label="Go to date"
        onMouseDown={(e) => e.stopPropagation()}
        className="border-hairline bg-surface w-[380px] max-w-[92vw] rounded-2xl border p-4 shadow-2xl"
      >
        <div className="mb-3 flex items-center gap-2">
          <CalendarSearch size={15} className="text-accent" />
          <h2 className="flex-1 text-[13.5px] font-bold">Go to date</h2>
        </div>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              go();
            }
          }}
          placeholder={EXAMPLES}
          aria-label="Date"
          className="border-hairline bg-sunken text-ink placeholder:text-ink-faint focus:border-accent h-9 w-full rounded-lg border px-3 text-[13px] outline-none"
        />
        <p className="mt-2 min-h-[16px] text-[11.5px]">
          {!text.trim() ? (
            <span className="text-ink-faint">Type a date, then press ↩</span>
          ) : day === null ? (
            <span className="text-ink-faint">Not a date yet</span>
          ) : (
            <span className="text-ink-muted">
              ↩ <span className="text-ink font-medium">{fmtLong(day)}</span>
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
