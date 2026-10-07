import type { MailView } from '@app/shared';
import { Command } from 'cmdk';
import { KanbanSquare, Users } from 'lucide-react';
import { useEffect } from 'react';
import { ACTIONS, comboLabel } from '../actions/registry';
import { focusList } from '../lib/panels';
import { openSprintBoard, useKanban } from '../state/kanban';
import { useAccounts } from '../state/queries';
import { keyboardTargetId, useUi } from '../state/store';
import { senderLabel } from '../lib/utils';
import { NAV } from './Sidebar';
import { AccountIcon } from './ui/AccountIcon';
import { Keycaps } from './ui/Keycap';
import { useShallow } from 'zustand/react/shallow';

const groupCls =
  '[&_[cmdk-group-heading]]:text-ink-faint [&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:tracking-[0.14em] [&_[cmdk-group-heading]]:uppercase';
const itemCls =
  'data-[selected=true]:bg-accent-soft data-[selected=true]:text-accent data-[disabled=true]:text-ink-faint flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-[12.5px]';

/** Extra words each place answers to, so "scheduled" finds Outbox and so on. */
const ALIASES: Partial<Record<MailView, string>> = {
  inbox: 'email mail',
  archive: 'archive archived',
  outbox: 'scheduled send later',
  trash: 'deleted bin',
  spam: 'junk',
  calendar: 'events agenda',
};

/** Views with a mail list, which open scoped to the selected account. */
const NON_MAIL: MailView[] = ['home', 'calendar'];

function goTo(view: MailView) {
  const ui = useUi.getState();
  ui.setSearchQuery(''); // a live search would cover the destination's list
  ui.setView(view);
  if (!NON_MAIL.includes(view)) setTimeout(focusList);
}

/**
 * ⌘L — jump anywhere: every sidebar place plus the Sprint board, and the
 * account switcher. Mail places open for the account selected in the sidebar
 * (the group heading names it), so switching account first narrows them.
 */
function GoToItems({ close }: { close(): void }) {
  const { accounts } = useAccounts();
  const accountFilter = useUi((s) => s.accountFilter);
  const accountAvatars = useUi((s) => s.accountAvatars);
  const accountColors = useUi((s) => s.accountColors);
  const kanbanConfigured = useKanban((s) => s.configured);
  const scope = accounts.find((a) => a.id === accountFilter)?.email ?? 'All accounts';

  const pickAccount = (id: string | undefined) => {
    const ui = useUi.getState();
    ui.setAccountFilter(id);
    if (NON_MAIL.includes(ui.view)) goTo('inbox'); // nothing account-scoped to show there
  };

  return (
    <>
      <Command.Group heading={`Go to · ${scope}`} className={groupCls}>
        {NAV.map(({ view, label, icon: Icon }) => (
          <Command.Item
            key={view}
            value={`${label} ${view} ${ALIASES[view] ?? ''}`}
            onSelect={() => {
              close();
              goTo(view);
            }}
            className={itemCls}
          >
            <Icon size={14} strokeWidth={2.2} className="shrink-0 opacity-70" />
            <span className="flex-1">{label}</span>
          </Command.Item>
        ))}
        {kanbanConfigured && (
          <Command.Item
            value="Sprint board kanban notion"
            onSelect={() => {
              close();
              openSprintBoard();
            }}
            className={itemCls}
          >
            <KanbanSquare size={14} strokeWidth={2.2} className="shrink-0 opacity-70" />
            <span className="flex-1">Sprint board</span>
          </Command.Item>
        )}
      </Command.Group>
      {accounts.length > 1 && (
        <Command.Group heading="Account" className={groupCls}>
          <Command.Item
            value="All accounts unified"
            onSelect={() => {
              close();
              pickAccount(undefined);
            }}
            className={itemCls}
          >
            <Users size={14} strokeWidth={2.2} className="shrink-0 opacity-70" />
            <span className="flex-1">All accounts</span>
            {!accountFilter && <span className="text-ink-faint text-[11px]">current</span>}
          </Command.Item>
          {accounts.map((a, i) => (
            <Command.Item
              key={a.id}
              value={`account ${a.email} ${a.displayName}`}
              onSelect={() => {
                close();
                pickAccount(a.id);
              }}
              className={itemCls}
            >
              <AccountIcon
                label={a.displayName || a.email}
                index={i}
                avatar={accountAvatars[a.id]}
                color={accountColors[a.id]}
                className="h-3.5 w-3.5 shrink-0 text-[7px]"
              />
              <span className="flex-1 truncate">{a.email}</span>
              {accountFilter === a.id && <span className="text-ink-faint text-[11px]">current</span>}
            </Command.Item>
          ))}
        </Command.Group>
      )}
    </>
  );
}

/**
 * ⌘K — every action, searchable, acting on the highlighted (hovered) email
 * (Spark's Command Center semantics). ⌘L opens the same palette as a go-to bar.
 */
export function CommandCenter() {
  const { commandOpen, commandMode, setCommandOpen, visibleThreads } = useUi(
    useShallow((s) => ({
      commandOpen: s.commandOpen,
      commandMode: s.commandMode,
      setCommandOpen: s.setCommandOpen,
      visibleThreads: s.visibleThreads,
    })),
  );
  const targetId = keyboardTargetId();
  const targetThread = visibleThreads.find((t) => t.id === targetId);

  useEffect(() => {
    if (!commandOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCommandOpen(false);
      // The keymap stands down while the palette is open, so ⌘K / ⌘L switch
      // between its two modes here.
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (meta && (key === 'k' || key === 'l')) {
        e.preventDefault();
        setCommandOpen(true, key === 'l' ? 'goto' : 'actions');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commandOpen, setCommandOpen]);

  if (!commandOpen) return null;

  const goto = commandMode === 'goto';
  const sections = [...new Set(ACTIONS.map((a) => a.section))];

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]"
      onMouseDown={() => setCommandOpen(false)}
    >
      <div onMouseDown={(e) => e.stopPropagation()} className="w-[560px] max-w-[92vw]">
        <Command
          // remount per mode so the query and highlight start fresh
          key={commandMode}
          label={goto ? 'Go to' : 'Command Center'}
          className="border-hairline bg-surface overflow-hidden rounded-2xl border shadow-2xl"
        >
          <Command.Input
            autoFocus
            placeholder={
              goto
                ? 'Go to…'
                : targetThread
                ? `Act on “${targetThread.subject || senderLabel(targetThread.participants[0])}”…`
                : 'Type a command…'
            }
            className="placeholder:text-ink-faint border-hairline w-full border-b bg-transparent px-4 py-3 text-[13.5px] focus:outline-none"
          />
          <Command.List className="max-h-[46vh] overflow-y-auto p-1.5">
            <Command.Empty className="text-ink-muted px-4 py-6 text-center text-[12.5px]">
              {goto ? 'No matching place.' : 'No matching action.'}
            </Command.Empty>
            {goto && <GoToItems close={() => setCommandOpen(false)} />}
            {!goto && sections.map((section) => (
              <Command.Group key={section} heading={section} className={groupCls}>
                {ACTIONS.filter((a) => a.section === section).map((action) => (
                  <Command.Item
                    key={action.id}
                    value={`${action.label} ${action.id}`}
                    disabled={action.context === 'thread' && !targetId && !action.disabledReason}
                    onSelect={() => {
                      setCommandOpen(false);
                      action.perform(targetId);
                    }}
                    className={itemCls}
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
