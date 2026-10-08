import { Check, ChevronDown, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import { searchZones, zoneOption, type ZoneOption } from '../../lib/zones';

function localTime(id: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: id,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(Date.now());
  } catch {
    return '';
  }
}

/**
 * A time zone dropdown in the app's own style: a pill like Settings' selects
 * that opens a searchable list (city, country, offset), ↑/↓ to move, ↵ to
 * pick, Esc to close just the list.
 */
export function ZoneSelect({
  value,
  zones,
  onChange,
  autoFocus,
  label,
}: {
  value: string;
  zones: string[];
  onChange: (zone: string) => void;
  autoFocus?: boolean;
  label: string;
}) {
  // The pill's position while the list is open (null when closed).
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const open = !!anchor;
  const toggle = (on: boolean) =>
    setAnchor(on ? (buttonRef.current?.getBoundingClientRect() ?? null) : null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const current = value ? zoneOption(value) : null;

  useEffect(() => {
    if (autoFocus) buttonRef.current?.focus();
  }, [autoFocus]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => toggle(!open)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === ' ') {
            e.preventDefault();
            toggle(true);
          }
        }}
        className="border-hairline bg-sunken hover:border-ink-faint focus:ring-accent flex min-w-[170px] items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12.5px] focus:ring-2 focus:outline-none"
      >
        {current ? (
          <>
            <span className="truncate font-medium">{current.city}</span>
            <span className="text-ink-faint text-[11px] tabular-nums">{current.offset}</span>
          </>
        ) : (
          <span className="text-ink-faint">Choose a time zone</span>
        )}
        <ChevronDown size={13} className="text-ink-muted ml-auto shrink-0" />
      </button>
      {anchor && (
        <ZoneList
          anchor={anchor}
          zones={zones}
          value={value}
          onPick={(z) => {
            onChange(z);
            toggle(false);
            buttonRef.current?.focus();
          }}
          onClose={() => {
            toggle(false);
            buttonRef.current?.focus();
          }}
        />
      )}
    </>
  );
}

function ZoneList({
  anchor,
  zones,
  value,
  onPick,
  onClose,
}: {
  anchor: DOMRect;
  zones: string[];
  value: string;
  onPick: (zone: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const all = useMemo<ZoneOption[]>(() => zones.map((z) => zoneOption(z)), [zones]);
  const options = useMemo(() => searchZones(all, query).slice(0, 200), [all, query]);
  const [active, setActive] = useState(() =>
    Math.max(
      0,
      options.findIndex((o) => o.id === value),
    ),
  );
  const listRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      // The pill toggles the list itself.
      if (t.closest?.('[aria-haspopup="listbox"][aria-expanded="true"]')) return;
      if (!boxRef.current?.contains(t)) onClose();
    };
    window.addEventListener('mousedown', onDown, true);
    return () => window.removeEventListener('mousedown', onDown, true);
  }, [onClose]);

  const width = Math.max(anchor.width, 280);
  const below = window.innerHeight - anchor.bottom > 300;
  return createPortal(
    <div
      ref={boxRef}
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        position: 'fixed',
        left: Math.max(8, Math.min(anchor.right - width, window.innerWidth - width - 8)),
        width,
        ...(below ? { top: anchor.bottom + 4 } : { bottom: window.innerHeight - anchor.top + 4 }),
      }}
      className="border-hairline bg-surface text-ink z-[80] overflow-hidden rounded-xl border shadow-2xl"
    >
      <div className="border-hairline flex items-center gap-2 border-b px-2.5 py-2">
        <Search size={13} className="text-ink-faint shrink-0" />
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            // The list owns these keys; keep them from the dialog and the app.
            e.stopPropagation();
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (options[active]) onPick(options[active].id);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Search city or country"
          aria-label="Search time zones"
          role="combobox"
          aria-expanded
          aria-controls="zone-list"
          className="placeholder:text-ink-faint min-w-0 flex-1 bg-transparent text-[12.5px] focus:outline-none"
        />
      </div>
      <div
        ref={listRef}
        id="zone-list"
        role="listbox"
        aria-label="Time zones"
        className="max-h-64 overflow-y-auto p-1"
      >
        {options.length === 0 && (
          <p className="text-ink-faint px-3 py-2 text-[12px]">No time zone matches.</p>
        )}
        {options.map((o, i) => (
          <button
            key={o.id}
            type="button"
            data-index={i}
            role="option"
            aria-selected={o.id === value}
            onMouseEnter={() => setActive(i)}
            onClick={() => onPick(o.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px]',
              i === active ? 'bg-accent-soft/60 text-ink' : 'text-ink-muted',
            )}
          >
            <span className="min-w-0 truncate">
              <span className="text-ink font-medium">{o.city}</span>
              {o.region && <span className="text-ink-faint"> · {o.region}</span>}
            </span>
            <span className="text-ink-faint ml-auto shrink-0 text-[11px] tabular-nums">
              {o.offset} · {localTime(o.id)}
            </span>
            <Check
              size={13}
              className={cn('text-accent shrink-0', o.id === value ? 'opacity-100' : 'opacity-0')}
            />
          </button>
        ))}
      </div>
    </div>,
    document.body,
  );
}
