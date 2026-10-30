import { MessageSquare } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { runAssistantAction, type AssistantAction } from '../../lib/assistantContext';
import { cn } from '../../lib/utils';
import { useAssistant } from '../../state/assistant';
import { LanguagePicker } from '../orb/LanguagePicker';
import { RobotIcon } from '../orb/OrbCorner';
import { orbActionsFor } from '../orb/orbActions';

/** True while the chip's menu is up, so the composer leaves Esc to it. */
let menuUp = false;
export function assistantChipOwnsEscape(): boolean {
  return menuUp;
}

/**
 * The assistant in a popped-out composer, where there is no corner orb: a
 * labelled chip in the footer toolbar that opens the composer actions
 * (rewrite, tone, translate) upward, plus the chat. ⌘I opens the palette.
 */
export function AssistantChip() {
  const [open, setOpen] = useState(false);
  /** The action waiting on a language pick, while the picker is showing. */
  const [languageFor, setLanguageFor] = useState<AssistantAction | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const actions = orbActionsFor('inbox', true, null);

  const close = () => {
    setOpen(false);
    setLanguageFor(null);
  };

  // A click outside or Esc closes the menu (the language picker's Esc goes back).
  useEffect(() => {
    menuUp = open;
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || languageFor) return;
      e.preventDefault();
      close();
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      menuUp = false;
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, languageFor]);

  return (
    <div ref={rootRef} className="relative ml-1.5">
      {open && (
        <div
          role="menu"
          aria-label="Assistant actions"
          className="orb-menu-in border-hairline bg-surface absolute bottom-full left-0 z-50 mb-2 w-72 rounded-2xl border p-1.5 shadow-2xl"
        >
          {languageFor ? (
            <LanguagePicker
              onBack={() => setLanguageFor(null)}
              onPick={(language) => {
                const action = languageFor;
                close();
                void runAssistantAction(action, { language });
              }}
            />
          ) : (
            <>
              {actions.map(({ label, icon: Icon, action, pickLanguage }) => (
                <button
                  key={label}
                  role="menuitem"
                  onClick={() => {
                    if (!action) return;
                    if (pickLanguage) return setLanguageFor(action);
                    close();
                    void runAssistantAction(action);
                  }}
                  className="text-ink-muted hover:bg-accent-soft/40 hover:text-ink flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12.5px]"
                >
                  <Icon size={14} className="text-accent shrink-0" />
                  {label}
                </button>
              ))}
              <div className="bg-hairline mx-2 my-1 h-px" />
              <button
                role="menuitem"
                onClick={() => {
                  close();
                  useAssistant.getState().setOpen(true);
                }}
                className="text-ink-muted hover:bg-accent-soft/40 hover:text-ink flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12.5px]"
              >
                <MessageSquare size={14} className="text-accent shrink-0" />
                Open the assistant chat
              </button>
            </>
          )}
        </div>
      )}
      <button
        onClick={() => (open ? close() : setOpen(true))}
        title="Assistant — ⌘I"
        aria-label="Assistant"
        aria-expanded={open}
        className={cn(
          'text-accent flex h-7 items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-semibold',
          'bg-accent-soft/60 hover:bg-accent-soft',
          open && 'bg-accent-soft',
        )}
      >
        <RobotIcon size={15} />
        Assistant
      </button>
    </div>
  );
}
