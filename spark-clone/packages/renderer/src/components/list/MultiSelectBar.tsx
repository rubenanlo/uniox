import { Archive, MailOpen, Trash2, X } from 'lucide-react';
import { ACTIONS, keysFor } from '../../actions/registry';
import { useUi } from '../../state/store';
import { Tip } from '../ui/Tip';

const btn =
  'text-ink-muted hover:bg-sunken hover:text-ink flex h-7 items-center gap-1 rounded-lg px-2 text-[11.5px] font-semibold';

function run(actionId: string) {
  ACTIONS.find((a) => a.id === actionId)?.perform(null);
}

/** Shown while several emails are picked (⇧↑/↓, ⇧/⌘-click): count + bulk triage. */
export function MultiSelectBar() {
  const count = useUi((s) => s.multiSelected.length);
  const clear = useUi((s) => s.clearMultiSelect);
  if (count < 2) return null;
  return (
    <div className="border-hairline bg-accent-soft/40 flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
      <span className="text-accent flex-1 text-[12px] font-bold tabular-nums">{count} selected</span>
      <Tip label="Done" keys={keysFor('done')}>
        <button className={btn} onClick={() => run('done')} aria-label="Done">
          <Archive size={13} />
        </button>
      </Tip>
      <Tip label="Delete" keys={keysFor('delete')}>
        <button className={btn} onClick={() => run('delete')} aria-label="Delete">
          <Trash2 size={13} />
        </button>
      </Tip>
      <Tip label="Mark read / unread" keys={keysFor('toggle-read')}>
        <button className={btn} onClick={() => run('toggle-read')} aria-label="Mark read / unread">
          <MailOpen size={13} />
        </button>
      </Tip>
      <Tip label="Clear selection" keys={['Esc']} align="end">
        <button className={btn} onClick={clear} aria-label="Clear selection">
          <X size={13} />
        </button>
      </Tip>
    </div>
  );
}
