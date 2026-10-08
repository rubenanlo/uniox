import { MessageSquare, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useEscapeClose } from '../../hooks/useEscapeClose';
import { runAssistantAction, type AssistantAction } from '../../lib/assistantContext';
import { cn } from '../../lib/utils';
import { useAssistant } from '../../state/assistant';
import { useUi } from '../../state/store';
import { Keycaps } from '../ui/Keycap';
import { LanguagePicker } from './LanguagePicker';
import { orbActionsFor, type OrbAction } from './orbActions';

/**
 * ⌘I — the assistant's suggested actions for the current page (the same set
 * the corner orb offers), centered on screen. Type to filter; with text that
 * matches nothing, ↵ asks the assistant that question instead.
 */
export function AssistantPalette() {
  const open = useAssistant((s) => s.paletteOpen);
  if (!open) return null;
  return <Palette />;
}

function Palette() {
  const setPaletteOpen = useAssistant((s) => s.setPaletteOpen);
  const view = useUi((s) => s.view);
  const composerOpen = useUi((s) => !!s.composer);
  const selectedThreadId = useUi((s) => s.selectedThreadId);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  /** The action waiting on a language pick, while the picker is showing. */
  const [languageFor, setLanguageFor] = useState<AssistantAction | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Give focus back to wherever it was (e.g. the composer body) on close.
  const returnFocus = useRef(document.activeElement as HTMLElement | null);

  const close = () => setPaletteOpen(false);
  useEscapeClose(true, close);
  useEffect(() => () => returnFocus.current?.focus?.(), []);

  const q = query.trim().toLowerCase();
  const suggested = orbActionsFor(view, composerOpen, selectedThreadId).filter(
    (a) => !q || a.label.toLowerCase().includes(q),
  );
  const chat: OrbAction = {
    label: query.trim() ? `Ask “${query.trim()}”` : 'Open the assistant chat',
    icon: MessageSquare,
  };
  const items = [...suggested, chat];
  const current = Math.min(active, items.length - 1);

  const pick = (item: OrbAction) => {
    if (item === chat) {
      close();
      const a = useAssistant.getState();
      a.setOpen(true);
      if (query.trim() && a.configured) a.send(query);
      return;
    }
    if (item.action && item.pickLanguage) {
      setLanguageFor(item.action);
      return;
    }
    close();
    if (item.action) void runAssistantAction(item.action);
    else item.run?.();
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/30"
      onMouseDown={close}
    >
      <div
        role="dialog"
        aria-label="Assistant"
        onMouseDown={(e) => e.stopPropagation()}
        className="orb-menu-in border-hairline bg-surface w-[min(520px,calc(100vw-2rem))] overflow-hidden rounded-2xl border p-1.5 shadow-2xl"
      >
        {languageFor ? (
          <LanguagePicker
            onBack={() => {
              setLanguageFor(null);
              requestAnimationFrame(() => inputRef.current?.focus());
            }}
            onPick={(language) => {
              const action = languageFor;
              close();
              void runAssistantAction(action, { language });
            }}
          />
        ) : (
          <>
            <div className="border-hairline flex items-center gap-2.5 border-b px-2.5 pb-2 pt-1">
              <Sparkles size={15} className="text-accent shrink-0" />
              <input
                ref={inputRef}
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive((i) => Math.min(i + 1, items.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive((i) => Math.max(i - 1, 0));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    pick(items[current]!);
                  } else if (e.key === 'Escape') {
                    // Close only this palette, not the chat panel behind it.
                    e.preventDefault();
                    e.stopPropagation();
                    close();
                  }
                }}
                placeholder="Ask the assistant, or pick an action…"
                aria-label="Ask the assistant"
                role="combobox"
                aria-expanded
                aria-controls="assistant-palette-list"
                aria-activedescendant={`assistant-palette-${current}`}
                className="text-ink placeholder:text-ink-faint min-w-0 flex-1 bg-transparent py-1.5 text-[13.5px] focus:outline-none"
              />
              <Keycaps keys={['⌘', 'I']} />
            </div>
            <div
              id="assistant-palette-list"
              role="listbox"
              aria-label="Suggested actions"
              className="pt-1"
            >
              {items.map((item, i) => {
                const Icon = item.icon;
                return [
                  item === chat && suggested.length > 0 && (
                    <div key="divider" className="border-hairline mx-2 my-1 border-t" />
                  ),
                  <button
                    key={item === chat ? 'chat' : item.label}
                    id={`assistant-palette-${i}`}
                    role="option"
                    aria-selected={i === current}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(item)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px]',
                      i === current ? 'bg-accent-soft/40 text-ink' : 'text-ink-muted',
                    )}
                  >
                    <Icon size={15} className="text-accent shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>,
                ];
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
