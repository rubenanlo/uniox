import type { GatekeeperPending } from '@app/shared';
import { Check, ShieldQuestion, X } from 'lucide-react';
import { keysFor } from '../actions/registry';
import { api } from '../lib/api';
import { formatListDate, initials } from '../lib/utils';
import { useGatekeeperPending } from '../state/queries';
import { useUi } from '../state/store';
import { Keycaps } from './ui/Keycap';
import { Tip } from './ui/Tip';

const SENDER_HUES = [212, 158, 22, 282, 340, 12, 190];

function decide(
  key: string,
  accountId: string,
  decision: 'accepted' | 'blocked',
  kind: 'address' | 'domain' = 'address',
) {
  void api.command('task:enqueue', { type: 'gatekeeper-decide', accountId, key, kind, decision });
}

function SenderCard({
  pending,
  hue,
  first,
}: {
  pending: GatekeeperPending;
  hue: number;
  /** ⌘T / ⌘B act on the first pending card only — keycaps show just there. */
  first: boolean;
}) {
  const selectThread = useUi((s) => s.selectThread);
  return (
    // Fixed height so the strip reads as one row of equal cards: the content
    // below varies (optional "N threads waiting", one or two snippet lines),
    // which otherwise left the cards ragged. Overflow is trimmed, not wrapped.
    <article className="border-hairline bg-surface flex h-[178px] w-[228px] shrink-0 snap-start flex-col overflow-hidden rounded-xl border p-3 shadow-sm">
      {/* min-h-0 + flex-1 lets the text block give up space instead of pushing
          the decision buttons out of the fixed-height card. */}
      <button
        onClick={() => selectThread(pending.latestThreadId)}
        className="min-h-0 w-full min-w-0 flex-1 overflow-hidden text-left"
        title="Preview the latest email"
      >
        <span className="mb-1.5 flex items-center gap-2">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10.5px] font-bold text-white"
            style={{ background: `hsl(${hue} 55% 45%)` }}
            aria-hidden
          >
            {initials(pending.senderName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-bold">{pending.senderName}</span>
            <span className="text-ink-faint block truncate text-[10.5px]">{pending.key}</span>
          </span>
          <span className="text-ink-faint shrink-0 self-start text-[10px] tabular-nums">
            {pending.latestDate ? formatListDate(pending.latestDate) : ''}
          </span>
        </span>
        <span className="block truncate text-[12px] font-medium">
          {pending.latestSubject || '(no subject)'}
        </span>
        {/* No `block` here: line-clamp needs its own display to take effect.
            break-words (not break-all) splits only what cannot fit, so a long
            tracking URL wraps while ordinary prose keeps its word breaks. */}
        <span className="text-ink-muted line-clamp-2 text-[11.5px] leading-4 break-words">
          {pending.latestSnippet}
        </span>
      </button>

      {pending.threadCount > 1 && (
        <span className="text-ink-faint mt-1.5 shrink-0 text-[10.5px]">
          {pending.threadCount} threads waiting
        </span>
      )}

      {/* shrink-0 + pt keeps the decision row pinned and always visible. */}
      <div className="mt-auto flex shrink-0 items-center gap-1.5 pt-2">
        <Tip
          label="Accept sender"
          keys={first ? keysFor('gatekeeper-accept') : []}
          side="top"
          className="flex-1"
        >
          <button
            onClick={() => decide(pending.key, pending.accountId, 'accepted')}
            className="bg-accent flex w-full items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11.5px] font-semibold text-white hover:opacity-90"
          >
            <Check size={12} /> Accept
          </button>
        </Tip>
        <Tip
          label="Block sender"
          keys={first ? keysFor('gatekeeper-block') : []}
          side="top"
          className="flex-1"
        >
          <button
            onClick={() => decide(pending.key, pending.accountId, 'blocked')}
            className="bg-sunken text-ink-muted hover:text-danger flex w-full items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-[11.5px] font-semibold"
          >
            <X size={12} /> Block
          </button>
        </Tip>
        <button
          onClick={() =>
            decide(
              pending.key.slice(pending.key.indexOf('@') + 1),
              pending.accountId,
              'blocked',
              'domain',
            )
          }
          className="text-ink-faint hover:text-danger shrink-0 px-0.5 text-[10.5px] underline"
          title={`Block everything from @${pending.key.slice(pending.key.indexOf('@') + 1)}`}
        >
          domain
        </button>
      </div>
    </article>
  );
}

/**
 * First-contact screening (report §2.4): each new sender is a card; the row
 * scrolls horizontally when several are waiting. Accept ⌘T / Block ⌘B act
 * on the first card.
 */
export function GatekeeperCard() {
  const allPending = useGatekeeperPending();
  const split = useUi((s) => s.split);
  const accountFilter = useUi((s) => s.accountFilter);
  // Honor the sidebar's account switcher, like the mail list below.
  const pending = accountFilter
    ? allPending.filter((p) => p.accountId === accountFilter)
    : allPending;
  if (!pending.length) return null;

  return (
    <section className="border-hairline border-b px-2 py-8" aria-label="Gatekeeper">
      <header className="flex items-center gap-2 px-1 pb-1.5">
        <ShieldQuestion size={13} className="text-accent shrink-0" />
        <span className="font-mono text-[10px] font-semibold tracking-[0.14em] uppercase whitespace-nowrap">
          {pending.length} new {pending.length === 1 ? 'sender' : 'senders'}
        </span>
        {/* the split pane is too narrow for the shortcut hint */}
        {!split && (
          <span className="text-ink-faint ml-auto flex items-center gap-1.5 text-[10px] whitespace-nowrap">
            first card: <Keycaps keys={['⌘', 'T']} /> accept · <Keycaps keys={['⌘', 'B']} /> block
          </span>
        )}
      </header>
      <div
        // overflow-x-auto forces the y-axis to auto as well, and the Accept/
        // Block tooltips (absolutely positioned inside the row) would count as
        // vertical overflow and summon a scrollbar — clip the y-axis instead;
        // those tooltips open upward so nothing visible is cut off.
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto overflow-y-hidden pb-1.5"
        role="list"
        aria-label="Senders awaiting a decision"
      >
        {pending.slice(0, 25).map((p, i) => (
          <SenderCard
            key={`${p.accountId}:${p.key}`}
            pending={p}
            hue={SENDER_HUES[i % SENDER_HUES.length]!}
            first={i === 0}
          />
        ))}
      </div>
    </section>
  );
}
