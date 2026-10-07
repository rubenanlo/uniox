import { ArrowLeft, Languages } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { languageOptions } from '../../lib/languages';
import { cn } from '../../lib/utils';

const RECENT_KEY = 'translate-recent-languages';

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rememberRecent(language: string): void {
  try {
    const next = [language, ...readRecent().filter((l) => l.toLowerCase() !== language.toLowerCase())];
    localStorage.setItem(RECENT_KEY, JSON.stringify(next.slice(0, 3)));
  } catch {
    // Recents are a convenience only.
  }
}

/**
 * "Translate into…" target picker, shown in place of the orb's action list:
 * type to filter (or enter any language by name), ↑/↓ to move, ↵ to pick,
 * Esc to go back. Recent picks float to the top.
 */
export function LanguagePicker({
  onPick,
  onBack,
}: {
  onPick: (language: string) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [recent] = useState(readRecent);
  const options = useMemo(() => languageOptions(query, recent), [query, recent]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const pick = (language: string | undefined) => {
    if (!language) return;
    rememberRecent(language);
    onPick(language);
  };

  return (
    <div className="flex flex-col">
      <div className="border-hairline flex items-center gap-2 border-b px-2 pb-1.5">
        <button
          onClick={onBack}
          aria-label="Back to assistant actions"
          className="text-ink-faint hover:text-ink rounded-md p-1"
        >
          <ArrowLeft size={13} />
        </button>
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            // Keep the app's global shortcuts out of the field.
            e.stopPropagation();
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(i + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(options[active]);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onBack();
            }
          }}
          placeholder="Translate into…"
          aria-label="Language to translate into"
          role="combobox"
          aria-expanded
          aria-controls="orb-language-list"
          aria-activedescendant={options[active] ? `orb-language-${active}` : undefined}
          className="text-ink placeholder:text-ink-faint min-w-0 flex-1 bg-transparent py-1 text-[12.5px] focus:outline-none"
        />
      </div>
      <div
        ref={listRef}
        id="orb-language-list"
        role="listbox"
        aria-label="Languages"
        className="max-h-64 overflow-y-auto pt-1"
      >
        {options.map((language, i) => (
          <button
            key={language}
            id={`orb-language-${i}`}
            data-index={i}
            role="option"
            aria-selected={i === active}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(language)}
            className={cn(
              'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12.5px]',
              i === active ? 'bg-accent-soft/40 text-ink' : 'text-ink-muted',
            )}
          >
            <Languages size={14} className="text-accent shrink-0" />
            <span className="truncate">{language}</span>
            {i < recent.length && !query.trim() && (
              <span className="text-ink-faint ml-auto text-[10.5px]">Recent</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
