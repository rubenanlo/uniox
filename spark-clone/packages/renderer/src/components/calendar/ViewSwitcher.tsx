import type { CalView } from '../../lib/calendarMonth';
import { cn } from '../../lib/utils';

const VIEWS: { id: CalView; label: string; key: string }[] = [
  { id: 'month', label: 'Month', key: 'M' },
  { id: 'week', label: 'Week', key: 'W' },
  { id: 'day', label: 'Day', key: 'D' },
  { id: 'agenda', label: 'Agenda', key: 'A' },
];

/**
 * Shows only the active view. Hovering (or focusing) grows it to the left to
 * reveal the others, so the active view stays pinned on the right and never
 * changes position. A one-shot width transition on the panes' 220ms curve —
 * nothing runs while idle.
 */
export function ViewSwitcher({ view, onChange }: { view: CalView; onChange(v: CalView): void }) {
  const active = VIEWS.find((v) => v.id === view)!;
  const others = VIEWS.filter((v) => v.id !== view);
  return (
    <div
      role="radiogroup"
      aria-label="Calendar view"
      className="group/views border-hairline flex h-8 items-center rounded-lg border p-0.5 text-[12.5px] font-medium"
    >
      <div className="grid grid-cols-[0fr] overflow-hidden transition-[grid-template-columns] duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)] group-focus-within/views:grid-cols-[1fr] group-hover/views:grid-cols-[1fr]">
        <div className="flex min-w-0 items-center opacity-0 transition-opacity duration-[220ms] group-focus-within/views:opacity-100 group-hover/views:opacity-100">
          {others.map((v) => (
            <button
              key={v.id}
              role="radio"
              aria-checked={false}
              onClick={() => onChange(v.id)}
              className="text-ink-muted hover:text-ink flex h-7 items-center gap-1.5 rounded-md px-2.5 whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]"
            >
              {v.label}
              <kbd className="text-ink-faint font-mono text-[10px]">{v.key}</kbd>
            </button>
          ))}
        </div>
      </div>
      <button
        role="radio"
        aria-checked
        className={cn(
          'bg-sunken text-ink flex h-7 items-center gap-1.5 rounded-md px-2.5 whitespace-nowrap outline-none',
          'focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]',
        )}
      >
        {active.label}
        <kbd className="text-ink-faint font-mono text-[10px]">{active.key}</kbd>
      </button>
    </div>
  );
}
