import type { Address, ThreadSummary } from '@app/shared';
import { Check, Zap } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { keysFor } from '../../actions/registry';
import { cn, prioritySenderCandidates } from '../../lib/utils';
import { togglePrioritySender } from '../../state/priority';
import { useAccounts } from '../../state/queries';
import { useUi } from '../../state/store';
import { Tip } from '../ui/Tip';

/** Whether this address is on the Priority list (live). */
export function useIsPrioritySender(email: string | undefined): boolean {
  const key = email?.toLowerCase() ?? '';
  return useUi((s) => !!key && s.priorityEmails.includes(key));
}

/** The small amber bolt beside a Priority person's name in the reader. */
export function PriorityMark({ email, className }: { email: string | undefined; className?: string }) {
  if (!useIsPrioritySender(email)) return null;
  return (
    <Zap
      size={10}
      fill="currentColor"
      strokeWidth={0}
      className={cn('text-priority inline shrink-0', className)}
      aria-label="Priority"
    />
  );
}

/**
 * Toolbar bolt: one other person in the thread → one click flips them; more
 * than one → a short list (latest sender first) with a checkbox each. The
 * bolt fills amber when anyone here is already Priority.
 */
export function PriorityButton({ thread, className }: { thread: ThreadSummary; className: string }) {
  const { accounts } = useAccounts();
  const prio = useUi((s) => s.priorityEmails);
  // Keyed by thread so moving to another email closes the list.
  const [openFor, setOpenFor] = useState<string | null>(null);
  const open = openFor === thread.id;
  const setOpen = (v: boolean | ((v: boolean) => boolean)) =>
    setOpenFor((typeof v === 'function' ? v(open) : v) ? thread.id : null);
  const box = useRef<HTMLDivElement>(null);
  const people = useMemo(
    () => prioritySenderCandidates(thread, new Set(accounts.map((a) => a.email.toLowerCase()))),
    [thread, accounts],
  );
  const isOn = (a: Address) => prio.includes(a.email.toLowerCase());
  const any = people.some(isOn);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpenFor(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setOpenFor(null);
    };
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('mousedown', down);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);

  if (!people.length) return null;
  const click = () => {
    if (people.length === 1) togglePrioritySender(people[0]!, !isOn(people[0]!));
    else setOpen((v) => !v);
  };
  const label =
    people.length === 1
      ? isOn(people[0]!)
        ? `Remove ${people[0]!.name || people[0]!.email} from Priority`
        : `Make ${people[0]!.name || people[0]!.email} Priority`
      : 'Priority senders';

  return (
    <div ref={box} className="relative">
      <Tip label={label} keys={keysFor('priority-sender')} hidden={open}>
        <button
          onClick={click}
          aria-label={label}
          aria-pressed={any}
          aria-expanded={people.length > 1 ? open : undefined}
          className={cn(className, any && 'text-priority hover:text-priority bg-priority/12 hover:bg-priority/18')}
        >
          <Zap size={15} fill={any ? 'currentColor' : 'none'} strokeWidth={any ? 0 : 2} />
        </button>
      </Tip>
      {open && (
        <div
          role="menu"
          data-owns-escape
          className="bg-surface border-hairline absolute top-full right-0 z-30 mt-1.5 w-72 rounded-xl border p-1.5 text-[12.5px] shadow-xl"
        >
          <p className="text-ink-faint px-2 pt-1.5 pb-1 font-mono text-[10px] font-semibold tracking-[0.12em] uppercase">
            Add to Priority
          </p>
          {people.map((a, i) => {
            const on = isOn(a);
            return (
              <button
                key={a.email}
                role="menuitemcheckbox"
                aria-checked={on}
                onClick={() => togglePrioritySender(a, !on)}
                className="hover:bg-sunken focus-visible:bg-sunken flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left"
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border-[1.5px]',
                    on ? 'bg-priority border-priority text-surface' : 'border-ink-faint',
                  )}
                >
                  {on && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-medium">{a.name || a.email}</span>
                  {a.name && <span className="text-ink-faint truncate text-[11px]">{a.email}</span>}
                </span>
                {i === 0 && <span className="text-ink-faint shrink-0 text-[11px]">latest</span>}
              </button>
            );
          })}
          <p className="border-hairline text-ink-muted mt-1 border-t px-2 pt-2 pb-1 text-[11.5px] leading-snug">
            Their mail pins to Priority and shows on Home. Syncs to your phone.
          </p>
        </div>
      )}
    </div>
  );
}
