import { Command } from 'cmdk';
import { useEffect } from 'react';
import { ACTIONS, comboLabel } from '../actions/registry';
import { keyboardTargetId, useUi } from '../state/store';
import { senderLabel } from '../lib/utils';
import { Keycaps } from './ui/Keycap';

/**
 * ⌘K — every action, searchable, acting on the highlighted (hovered) email
 * (Spark's Command Center semantics).
 */
export function CommandCenter() {
  const { commandOpen, setCommandOpen, visibleThreads } = useUi();
  const targetId = keyboardTargetId();
  const targetThread = visibleThreads.find((t) => t.id === targetId);

  useEffect(() => {
    if (!commandOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCommandOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commandOpen, setCommandOpen]);

  if (!commandOpen) return null;

  const sections = [...new Set(ACTIONS.map((a) => a.section))];

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]"
      onMouseDown={() => setCommandOpen(false)}
    >
      <div onMouseDown={(e) => e.stopPropagation()} className="w-[560px] max-w-[92vw]">
        <Command
          label="Command Center"
          className="border-hairline bg-surface overflow-hidden rounded-2xl border shadow-2xl"
        >
          <Command.Input
            autoFocus
            placeholder={
              targetThread
                ? `Act on “${targetThread.subject || senderLabel(targetThread.participants[0])}”…`
                : 'Type a command…'
            }
            className="placeholder:text-ink-faint border-hairline w-full border-b bg-transparent px-4 py-3 text-[13.5px] focus:outline-none"
          />
          <Command.List className="max-h-[46vh] overflow-y-auto p-1.5">
            <Command.Empty className="text-ink-muted px-4 py-6 text-center text-[12.5px]">
              No matching action.
            </Command.Empty>
            {sections.map((section) => (
              <Command.Group
                key={section}
                heading={section}
                className="[&_[cmdk-group-heading]]:text-ink-faint [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:uppercase"
              >
                {ACTIONS.filter((a) => a.section === section).map((action) => (
                  <Command.Item
                    key={action.id}
                    value={`${action.label} ${action.id}`}
                    disabled={action.context === 'thread' && !targetId && !action.disabledReason}
                    onSelect={() => {
                      setCommandOpen(false);
                      action.perform(targetId);
                    }}
                    className="data-[selected=true]:bg-accent-soft data-[selected=true]:text-accent data-[disabled=true]:text-ink-faint flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px]"
                  >
                    <span className="flex-1">
                      {action.label}
                      {action.disabledReason && (
                        <span className="text-ink-faint ml-2 text-[11px]">{action.disabledReason}</span>
                      )}
                    </span>
                    <Keycaps keys={comboLabel(action.combo)} />
                  </Command.Item>
                ))}
              </Command.Group>
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
