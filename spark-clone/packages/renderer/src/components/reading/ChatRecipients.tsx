import type { Address, MessageMeta } from '@app/shared';
import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

/** How many names each of To and Cc shows on the line before folding into "+N". */
const SHOW = 3;

const key = (a: Address) => a.email.trim().toLowerCase();

/** "Gillian" from a name, or "patricia" from patricia.navarro@oecd.org. */
const shortName = (a: Address, own: Set<string>) =>
  own.has(key(a)) ? 'You' : a.name?.trim().split(/\s+/)[0] || a.email.split('@')[0];

const fullName = (a: Address, own: Set<string>) => (own.has(key(a)) ? 'You' : a.name?.trim() || a.email);

/** You first (you're the one who wants to know you're on it), then the rest in order. */
function capped(list: Address[], own: Set<string>) {
  const ordered = [...list.filter((a) => own.has(key(a))), ...list.filter((a) => !own.has(key(a)))];
  const shown = ordered.slice(0, SHOW);
  return { shown, more: list.length - shown.length };
}

/** Copies an address and remembers which one, for a short "Copied" flash. */
function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = (a: Address) => {
    void navigator.clipboard.writeText(a.email).catch(() => {});
    setCopied(key(a));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(null), 1400);
  };
  return { copied, copy };
}

/** Whether a message has anyone worth naming beyond its one obvious recipient. */
export function hasRecipientLine(m: MessageMeta, mine: boolean) {
  return m.cc.length > 0 || m.to.length > 1 || (mine && m.to.length > 0);
}

/**
 * The quiet "· to Gillian, Abigail · cc You, Stephanie +12" on a bubble's meta
 * line. Names copy their address on click; the "+N" pill folds the full list
 * open below (and reads "Hide" while it's open).
 */
export function RecipientWords({
  message,
  own,
  open,
  onToggle,
}: {
  message: MessageMeta;
  own: Set<string>;
  open: boolean;
  onToggle: () => void;
}) {
  const { copied, copy } = useCopy();
  const to = capped(message.to, own);
  const cc = capped(message.cc, own);
  const more = to.more + cc.more;
  const names = (list: Address[]) =>
    list.map((a, i) => (
      <span key={key(a)}>
        {i > 0 && ', '}
        <button
          type="button"
          title={`${a.email} · click to copy`}
          onClick={() => copy(a)}
          className={cn('hover:text-ink-muted decoration-dotted hover:underline', copied === key(a) && 'text-accent')}
        >
          {copied === key(a) ? 'Copied' : shortName(a, own)}
        </button>
      </span>
    ));
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span>·</span>
      <span className="min-w-0 truncate">
        {message.to.length > 0 && <>to {names(to.shown)}</>}
        {message.cc.length > 0 && (
          <>
            {message.to.length > 0 && <span className="mx-1">·</span>}
            <span className="text-ink-muted">cc</span> {names(cc.shown)}
          </>
        )}
      </span>
      {more > 0 && (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          title={open ? 'Hide everyone' : 'Show everyone on this email'}
          className={cn(
            'shrink-0 rounded-full px-1.5 py-px text-[11px] font-medium transition-colors',
            open ? 'bg-accent/15 text-accent' : 'bg-sunken text-ink-muted hover:text-ink',
          )}
        >
          {open ? 'Hide' : `+${more}`}
        </button>
      )}
    </span>
  );
}

/** Everyone on the email, To then Cc, with addresses; click a person to copy theirs. Unfolds in place. */
export function RecipientList({ message, own, open }: { message: MessageMeta; own: Set<string>; open: boolean }) {
  const { copied, copy } = useCopy();
  const groups = (
    [
      ['To', message.to],
      ['Cc', message.cc],
    ] as const
  ).filter(([, list]) => list.length > 0);
  return (
    <div
      inert={!open}
      className={cn(
        'grid w-full transition-[grid-template-rows,opacity] duration-[240ms] ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none',
        open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0',
      )}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="border-hairline mx-1 my-0.5 flex flex-col gap-2 border-l-2 py-0.5 pl-3 text-[12px]">
          {groups.map(([label, list]) => (
            <div key={label} className="flex gap-3">
              <span className="text-ink-faint w-5 shrink-0 pt-px text-[11px] font-semibold">{label}</span>
              <div className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-x-4 gap-y-0.5">
                {list.map((a) => {
                  const done = copied === key(a);
                  return (
                    <button
                      type="button"
                      key={key(a)}
                      onClick={() => copy(a)}
                      title={`Copy ${a.email}`}
                      className={cn(
                        'group/addr -mx-1.5 flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-px text-left transition-colors',
                        done ? 'bg-accent/10' : 'hover:bg-sunken',
                      )}
                    >
                      <span className="text-ink-muted shrink-0 font-medium">{fullName(a, own)}</span>
                      {done ? (
                        <span className="text-accent flex items-center gap-1 text-[11px] font-medium">
                          <Check size={11} strokeWidth={2.5} /> Copied
                        </span>
                      ) : (
                        <span className="text-ink-faint min-w-0 truncate text-[11px]">{a.email}</span>
                      )}
                      {!done && (
                        <Copy
                          size={11}
                          className="text-ink-faint ml-auto shrink-0 opacity-0 transition-opacity group-hover/addr:opacity-100"
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Whether the line folds anyone into "+N" (so there's a list to open). */
export function recipientsOverflow(m: MessageMeta) {
  return m.to.length > SHOW || m.cc.length > SHOW;
}
