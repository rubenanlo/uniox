import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useState } from 'react';
import {
  addDays,
  addMonths,
  isSameMonth,
  isToday,
  monthGrid,
  monthLabel,
  startOfDay,
  startOfMonth,
} from '../../lib/calendarMonth';
import { cn } from '../../lib/utils';

const MINI_DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const dayLabel = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * First/last-day picker in the calendar sidebar's mini-month style. `endMs`
 * is exclusive (midnight after the last day), matching all-day events; the
 * grid shows and picks the last day itself. Either end may be open (null).
 */
export function DateRangeCalendar({
  startMs,
  endMs,
  onChange,
  disabled,
}: {
  startMs: number | null;
  endMs: number | null;
  onChange(range: { startMs: number | null; endMs: number | null }): void;
  disabled?: boolean;
}) {
  // Gmail may hand back times that aren't midnight: compare by local day.
  const firstDay = startMs == null ? null : startOfDay(startMs);
  const lastDay = endMs == null ? null : startOfDay(endMs - 1);
  // Which end the calendar is picking; null = calendar closed.
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const [month, setMonth] = useState(() => startOfMonth(startMs ?? Date.now()));
  const { days } = monthGrid(month);

  const pick = (dayMs: number) => {
    if (picking === 'start') {
      // A first day after the current last day drops the last day.
      const keepEnd = lastDay != null && lastDay >= dayMs;
      onChange({ startMs: dayMs, endMs: keepEnd ? endMs : null });
      setPicking('end');
    } else if (firstDay != null && dayMs < firstDay) {
      // Clicking before the first day moves the first day instead.
      onChange({ startMs: dayMs, endMs });
    } else {
      onChange({ startMs, endMs: addDays(dayMs, 1) });
      setPicking(null); // range complete
    }
  };

  // A chip opens the calendar on its own date; clicking it again closes it.
  const toggle = (which: 'start' | 'end') => {
    if (picking === which) return setPicking(null);
    const at = which === 'start' ? firstDay : (lastDay ?? firstDay);
    if (at != null) setMonth(startOfMonth(at));
    setPicking(which);
  };

  const chip = (which: 'start' | 'end', label: string, value: number | null, empty: string) => (
    <div
      className={cn(
        'flex min-w-0 flex-1 items-center rounded-lg border px-2.5 py-1.5',
        picking === which ? 'border-accent ring-accent/30 ring-2' : 'border-hairline',
      )}
    >
      <button
        type="button"
        onClick={() => toggle(which)}
        aria-expanded={picking === which}
        className="min-w-0 flex-1 text-left"
      >
        <span className="text-ink-muted block text-[11px]">{label}</span>
        <span
          className={cn(
            'block truncate text-[12.5px]',
            value == null ? 'text-ink-faint' : 'font-medium',
          )}
        >
          {value == null ? empty : dayLabel(value)}
        </span>
      </button>
      {value != null && (
        <button
          type="button"
          aria-label={`Clear ${label.toLowerCase()}`}
          onClick={() =>
            onChange(which === 'start' ? { startMs: null, endMs } : { startMs, endMs: null })
          }
          className="text-ink-faint hover:text-ink ml-1 shrink-0 rounded p-0.5"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );

  return (
    <div className={cn('flex flex-col', disabled && 'pointer-events-none')}>
      <div className="flex gap-2.5">
        {chip('start', 'First day', startMs, 'Starts now')}
        {chip('end', 'Last day', lastDay, 'No end date')}
      </div>
      {/* Same 0fr → 1fr reveal as the account cards; inert while hidden. */}
      <div
        inert={picking == null}
        className={cn(
          'grid transition-[grid-template-rows,opacity] duration-200 ease-out motion-reduce:transition-none',
          picking != null ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          <div
            className={cn(
              'pt-2.5 transition-transform duration-200 ease-out motion-reduce:transition-none',
              picking == null && '-translate-y-1.5',
            )}
          >
            <div className="border-hairline rounded-lg border px-3 pt-2.5 pb-2">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="text-ink ml-1 text-[12px] font-semibold">{monthLabel(month)}</p>
                <div className="flex items-center">
                  <button
                    type="button"
                    onClick={() => setMonth((m) => addMonths(m, -1))}
                    aria-label="Previous month"
                    className="text-ink-muted hover:text-ink flex h-6 w-6 items-center justify-center rounded"
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setMonth((m) => addMonths(m, 1))}
                    aria-label="Next month"
                    className="text-ink-muted hover:text-ink flex h-6 w-6 items-center justify-center rounded"
                  >
                    <ChevronDown size={13} />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-7 gap-y-0.5 text-center">
                {MINI_DAYS.map((d) => (
                  <span key={d} className="text-ink-faint text-[10px] font-semibold">
                    {d}
                  </span>
                ))}
                {days.map((dayMs) => {
                  const day = startOfDay(dayMs);
                  const isStart = firstDay != null && day === firstDay;
                  const isEnd = lastDay != null && day === lastDay;
                  const inRange =
                    firstDay != null && lastDay != null && day > firstDay && day < lastDay;
                  return (
                    <div
                      key={dayMs}
                      className={cn(
                        'flex justify-center',
                        inRange && 'bg-accent-soft',
                        isStart &&
                          lastDay != null &&
                          lastDay > firstDay! &&
                          'bg-accent-soft rounded-l-full',
                        isEnd &&
                          firstDay != null &&
                          lastDay! > firstDay &&
                          'bg-accent-soft rounded-r-full',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => pick(day)}
                        aria-label={dayLabel(day)}
                        aria-pressed={isStart || isEnd}
                        className={cn(
                          'flex h-6 w-6 items-center justify-center rounded-full text-[11px] tabular-nums',
                          isStart || isEnd
                            ? 'bg-accent font-bold text-white'
                            : isToday(day)
                              ? 'text-danger hover:bg-sunken font-bold'
                              : inRange
                                ? 'text-ink hover:bg-sunken'
                                : isSameMonth(day, month)
                                  ? 'text-ink-muted hover:bg-sunken'
                                  : 'text-ink-faint/50 hover:bg-sunken',
                        )}
                      >
                        {new Date(day).getDate()}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
