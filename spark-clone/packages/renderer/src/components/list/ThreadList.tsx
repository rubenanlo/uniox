import type { Category, ThreadSummary } from '@app/shared';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  AlarmClock,
  Archive,
  ArrowLeft,
  Bell,
  CheckCheck,
  ChevronRight,
  Newspaper,
  Paperclip,
  Pencil,
  Percent,
  Pin,
  Tags,
  Trash2,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ACTIONS, keysFor } from '../../actions/registry';
import { useAccountColor } from '../../lib/accountColor';
import { api } from '../../lib/api';
import { markThreadsRead, moveThreads } from '../../lib/bulk';
import { selectRangeTo, toggleInSelection } from '../../lib/multiSelect';
import { fmtWake } from '../../lib/schedule';
import { toastWithUndo } from '../../lib/undo';
import {
  cn,
  dateSection,
  formatListDate,
  hueOf,
  initials,
  isPriorityThread,
  priorityPeers,
  senderLabel,
  withPriorityFrom,
  withSearchFrom,
} from '../../lib/utils';
import { parseSearchQuery } from '@app/shared';
import { HoverCard, type HoverAnchor } from '../ui/HoverCard';
import { assistantOwnsEscape } from '../../state/assistant';
import {
  bundleRowId,
  PRIORITY_TOGGLE_ID,
  useUi,
  type ListLayout,
  type NavRow,
} from '../../state/store';
import { Keycaps } from '../ui/Keycap';
import { Tip } from '../ui/Tip';

type Item =
  | { kind: 'header'; label: string }
  | { kind: 'priority-header'; shown: number; total: number; ids: string[] }
  | { kind: 'priority-toggle'; total: number }
  | { kind: 'thread'; thread: ThreadSummary; priority?: boolean }
  | { kind: 'bundle'; category: Category; threads: ThreadSummary[] };

/** Collapsed: just the newest couple of priority threads; expanded: all of them. */
interface PrioView {
  expanded: boolean;
}

/** How many priority threads stay pinned while the group is collapsed. */
const PRIORITY_COLLAPSED_COUNT = 2;

const CATEGORY_ORDER: { id: Category; label: string }[] = [
  { id: 'personal', label: 'Personal' },
  { id: 'invites', label: 'Invites' },
  { id: 'notifications', label: 'Notifications' },
  { id: 'newsletters', label: 'Newsletters' },
  { id: 'promotions', label: 'Promotions' },
];

/** Categories that collapse into a one-line bundle row (Spark's Smart Inbox). */
const BUNDLED: { id: Category; label: string; icon: typeof Bell; hue: number }[] = [
  { id: 'notifications', label: 'Notifications', icon: Bell, hue: 145 },
  { id: 'newsletters', label: 'Newsletters', icon: Newspaper, hue: 35 },
  { id: 'promotions', label: 'Promotions', icon: Percent, hue: 285 },
];

/** Insert Today/Yesterday/… section headers into a date-sorted entry list. */
function withDateSections(entries: { date: number; item: Item }[]): Item[] {
  const items: Item[] = [];
  let section = '';
  for (const e of entries) {
    const s = dateSection(e.date);
    if (s !== section) {
      section = s;
      items.push({ kind: 'header', label: s });
    }
    items.push(e.item);
  }
  return items;
}

/** Threads with any message sent by a Priority sender (Settings → Priority) vs the rest. */
function partitionPriority(
  threads: ThreadSummary[],
  prio: Set<string>,
): [ThreadSummary[], ThreadSummary[]] {
  if (!prio.size) return [[], threads];
  const yes: ThreadSummary[] = [];
  const no: ThreadSummary[] = [];
  for (const t of threads) {
    (isPriorityThread(t, prio) ? yes : no).push(t);
  }
  return [yes, no];
}

/**
 * The pinned Priority group (Smart Inbox only): collapsed it holds only the
 * newest couple of threads with a "Show all" row for the rest; expanded it
 * holds everything. Priority threads live exclusively here — they never fall
 * back into the regular sections. Returns the items to pin plus the
 * non-priority threads that flow on into the regular sections.
 */
function priorityItems(
  threads: ThreadSummary[],
  prio: Set<string>,
  heldUnreadId: string | null,
  prioView: PrioView,
): { items: Item[]; rest: ThreadSummary[] } {
  const [prioAll, others] = partitionPriority(threads, prio);
  if (!prioAll.length) return { items: [], rest: others };
  // Spark ordering: unread first, then read, newest → oldest within each.
  const ordered = unreadFirst(prioAll, heldUnreadId);
  const shown = prioView.expanded ? ordered : ordered.slice(0, PRIORITY_COLLAPSED_COUNT);
  return {
    items: [
      {
        kind: 'priority-header',
        shown: shown.length,
        total: prioAll.length,
        ids: [...shown.map((t) => t.id), PRIORITY_TOGGLE_ID],
      },
      // Rows display the priority sender, even when they aren't the thread's
      // latest correspondent.
      ...asThreadItems(shown.map((t) => withPriorityFrom(t, prio))).map((it) => ({
        ...it,
        priority: true,
      })),
      // "Show all (N)" / "Show less" only earns a row when there is overflow.
      ...(prioAll.length > PRIORITY_COLLAPSED_COUNT
        ? [{ kind: 'priority-toggle', total: prioAll.length } as Item]
        : []),
    ],
    rest: others,
  };
}

const byDateDesc = (a: ThreadSummary, b: ThreadSummary) => b.lastMessageDate - a.lastMessageDate;

/**
 * A thread belongs to the "unread" group if it's actually unread, or if it's
 * the one just opened and still selected (`heldUnreadId`) — that keeps a
 * just-read email in place until you move to another, instead of dropping it.
 */
const inUnreadGroup = (t: ThreadSummary, heldUnreadId: string | null) =>
  t.unreadCount > 0 || t.id === heldUnreadId;

/** Unread group first, read after; newest → oldest within each. */
function unreadFirst(threads: ThreadSummary[], heldUnreadId: string | null): ThreadSummary[] {
  return [
    ...threads.filter((t) => inUnreadGroup(t, heldUnreadId)).sort(byDateDesc),
    ...threads.filter((t) => !inUnreadGroup(t, heldUnreadId)).sort(byDateDesc),
  ];
}

const asThreadItems = (threads: ThreadSummary[]): Item[] =>
  threads.map((thread) => ({ kind: 'thread' as const, thread }));

/**
 * Smart Inbox (Spark model with Priority): Priority senders' threads pinned on
 * top, then the bundled-category rows, then the remaining unread mail, then
 * everything else under date sections.
 */
function buildSmartItems(
  threads: ThreadSummary[],
  prio: Set<string>,
  heldUnreadId: string | null,
  prioView: PrioView,
): Item[] {
  const { items: prioItems, rest } = priorityItems(threads, prio, heldUnreadId, prioView);
  const items: Item[] = [...prioItems];
  const bundles: { date: number; item: Item }[] = [];
  for (const { id } of BUNDLED) {
    const group = rest.filter((t) => t.category === id);
    if (!group.length) continue;
    bundles.push({
      date: Math.max(...group.map((t) => t.lastMessageDate)),
      item: { kind: 'bundle', category: id, threads: group },
    });
  }
  bundles.sort((a, b) => b.date - a.date);
  items.push(...bundles.map((b) => b.item));

  const bundledIds = new Set(BUNDLED.map((b) => b.id));
  const plain = rest.filter((t) => !bundledIds.has(t.category));
  const unread = plain.filter((t) => inUnreadGroup(t, heldUnreadId)).sort(byDateDesc);
  if (unread.length) {
    items.push({ kind: 'header', label: `Unread · ${unread.length}` });
    items.push(...asThreadItems(unread));
  }
  items.push(
    ...withDateSections(
      plain
        .filter((t) => !inUnreadGroup(t, heldUnreadId))
        .sort(byDateDesc)
        .map((t) => ({ date: t.lastMessageDate, item: { kind: 'thread' as const, thread: t } })),
    ),
  );
  return items;
}

/** The dedicated list behind a bundle row: pure chronology + date sections. */
function buildFocusItems(threads: ThreadSummary[]): Item[] {
  return withDateSections(
    [...threads]
      .sort(byDateDesc)
      .map((t) => ({ date: t.lastMessageDate, item: { kind: 'thread' as const, thread: t } })),
  );
}

function buildItems(
  threads: ThreadSummary[],
  layout: ListLayout,
  smartGrouping: boolean,
  prio: Set<string>,
  inboxSections: boolean,
  heldUnreadId: string | null,
  prioView: PrioView,
): Item[] {
  if (smartGrouping) return buildSmartItems(threads, prio, heldUnreadId, prioView);
  const items: Item[] = [];
  // The pinned Priority group is a Smart-Inbox-only feature (built above). With
  // Smart off, priority threads stay inline in the regular unread/seen sections.
  const rest = threads;
  const unread = rest.filter((t) => inUnreadGroup(t, heldUnreadId)).sort(byDateDesc);
  const seen = rest.filter((t) => !inUnreadGroup(t, heldUnreadId)).sort(byDateDesc);
  if (layout !== 'cards') {
    // Classic inbox still reads unread-first; other views stay chronological.
    if (!inboxSections) return [...items, ...asThreadItems([...rest].sort(byDateDesc))];
    if (unread.length) {
      items.push({ kind: 'header', label: `Unread · ${unread.length}` });
      items.push(...asThreadItems(unread));
    }
    if (seen.length) {
      items.push({ kind: 'header', label: 'Seen' });
      items.push(...asThreadItems(seen));
    }
    return items;
  }
  if (unread.length) {
    items.push({ kind: 'header', label: `New · ${unread.length}` });
    items.push(...asThreadItems(unread));
  }
  if (seen.length) {
    items.push({ kind: 'header', label: 'Seen' });
    items.push(...asThreadItems(seen));
  }
  return items;
}

function SenderChip({ email, s }: { email: string; s: BundleSender }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      <span className={cn('h-1.5 w-1.5 rounded-full', s.unread ? 'bg-accent' : 'bg-transparent')} />
      <span
        className="flex h-4.5 w-4.5 items-center justify-center rounded-full text-[8px] font-bold text-white"
        style={{ background: `hsl(${hueOf(email)} 55% 45%)` }}
        aria-hidden
      >
        {initials(s.name)}
      </span>
      <span className="text-ink text-[12px]">{s.name}</span>
      {s.count > 1 && <span className="text-ink-faint text-[10.5px]">{s.count}</span>}
    </span>
  );
}

interface BundleSender {
  name: string;
  count: number;
  unread: boolean;
  date: number;
}

/**
 * One row per group: icon, label, count, then its senders — a single fading
 * strip in the wide list, or a wrapped preview when the pane is narrow (split).
 */
function BundleRow({ category, threads }: { category: Category; threads: ThreadSummary[] }) {
  // Selector subscriptions (not the whole store): a hover change elsewhere in
  // the list must not re-render every mounted row.
  const setCategoryFocus = useUi((s) => s.setCategoryFocus);
  const split = useUi((s) => s.split);
  const hoverThread = useUi((s) => s.hoverThread);
  const meta = BUNDLED.find((b) => b.id === category)!;
  const Icon = meta.icon;

  // The bundle row is a keyboard target like any thread row: arrow keys land
  // on it, and E / ⌫ / ⌘U act on the whole group.
  const rowId = bundleRowId(category);
  const isSelected = useUi((s) => s.selectedThreadId === rowId || s.multiSelected.includes(rowId));
  const isHovered = useUi((s) => s.hoveredThreadId === rowId);
  const anyHovered = useUi((s) => s.hoveredThreadId !== null);
  const rowProps = {
    role: 'button',
    tabIndex: -1,
    'data-bundle': category,
    onClick: (e: React.MouseEvent) => {
      if (e.shiftKey) selectRangeTo(rowId);
      else if (e.metaKey || e.ctrlKey) toggleInSelection(rowId);
      else setCategoryFocus(category);
    },
    onMouseMove: () => {
      if (!isHovered) hoverThread(rowId);
    },
    onMouseLeave: () => hoverThread(null),
    title: `Open ${meta.label}`,
  } as const;
  const rowClass = cn(
    'border-hairline flex cursor-default border-b px-3 py-2',
    isSelected && 'bg-accent-soft',
    !isSelected && isHovered && 'bg-sunken',
    (isHovered || (isSelected && !anyHovered)) && 'kb-target',
  );

  const senders = useMemo(() => {
    const map = new Map<string, BundleSender>();
    for (const t of threads) {
      const p = t.participants[0];
      if (!p) continue;
      const entry = map.get(p.email) ?? { name: senderLabel(p), count: 0, unread: false, date: 0 };
      entry.count += 1;
      entry.unread = entry.unread || t.unreadCount > 0;
      entry.date = Math.max(entry.date, t.lastMessageDate);
      map.set(p.email, entry);
    }
    return [...map.entries()].sort((a, b) => b[1].date - a[1].date);
  }, [threads]);

  const hasUnread = threads.some((t) => t.unreadCount > 0);
  const shown = split ? senders.slice(0, 4) : senders.slice(0, 12);
  const hidden = senders.length - shown.length;

  const icon = (
    <span
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-white"
      style={{ background: `hsl(${meta.hue} 50% 42%)` }}
      aria-hidden
    >
      <Icon size={13} />
    </span>
  );

  if (split) {
    return (
      <div {...rowProps} className={cn(rowClass, 'gap-2.5')}>
        <div className="mt-0.5 flex shrink-0 items-center gap-2">
          <Unread on={hasUnread} />
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-[12.5px] font-bold">{meta.label}</span>
            <span className="text-ink-faint text-[11px] tabular-nums">{threads.length}</span>
            <ChevronRight size={13} className="text-ink-faint ml-auto shrink-0" />
          </div>
          <div className="mt-1 flex max-h-11 flex-wrap items-center gap-x-3 gap-y-1 overflow-hidden">
            {shown.map(([email, s]) => (
              <SenderChip key={email} email={email} s={s} />
            ))}
            {hidden > 0 && <span className="text-ink-faint text-[11px]">+{hidden}</span>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div {...rowProps} className={cn(rowClass, 'items-center gap-2')}>
      <Unread on={hasUnread} />
      {icon}
      <span className="shrink-0 text-[12.5px] font-bold">{meta.label}</span>
      <span className="text-ink-faint shrink-0 text-[11px] tabular-nums">{threads.length}</span>
      <div className="ml-3 flex min-w-0 flex-1 items-center gap-3 overflow-hidden whitespace-nowrap mask-[linear-gradient(to_right,black_88%,transparent)]">
        {shown.map(([email, s]) => (
          <SenderChip key={email} email={email} s={s} />
        ))}
      </div>
      <ChevronRight size={14} className="text-ink-faint shrink-0" />
    </div>
  );
}

/** Back bar + bulk actions shown while a bundle's dedicated list is open. */
function FocusHeader({ category, threads }: { category: Category; threads: ThreadSummary[] }) {
  const setCategoryFocus = useUi((s) => s.setCategoryFocus);
  const meta = BUNDLED.find((b) => b.id === category);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      if (
        e.key === 'Escape' &&
        !ui.commandOpen &&
        !ui.composer &&
        !ui.picker &&
        !ui.shortcutsOpen &&
        !ui.settingsOpen &&
        !assistantOwnsEscape()
      ) {
        e.stopPropagation();
        setCategoryFocus(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setCategoryFocus]);
  return (
    <div
      data-focus-header
      className="border-hairline flex shrink-0 items-center gap-2 border-b px-2 py-1.5"
    >
      <button
        onClick={() => setCategoryFocus(null)}
        className="text-ink-muted hover:text-ink flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px]"
        title="Back to Inbox — Esc"
      >
        <ArrowLeft size={13} /> Inbox
      </button>
      <span className="text-[12.5px] font-bold">{meta?.label ?? category}</span>
      <span className="text-ink-faint text-[11px] tabular-nums">{threads.length}</span>
      <CardActions threads={threads} />
    </div>
  );
}

/** Group heading in the standard section format, with Spark's amber bolt and
 *  the expand/collapse shortcut alongside. */
function PriorityHeader({ total, ids }: { total: number; ids: string[] }) {
  const expanded = useUi((s) => s.priorityExpanded);
  const setExpanded = useUi((s) => s.setPriorityExpanded);
  // The shortcut hint only appears while the keyboard target sits inside the
  // group — the moment ⌥↓ / ⌥↑ would actually be the natural next keystroke.
  const focusedInGroup = useUi((s) => {
    const target = s.hoveredThreadId ?? s.selectedThreadId;
    return !!target && ids.includes(target);
  });
  return (
    <div
      // Double-clicking the heading is the mouse equivalent of ⌥↓ / ⌥↑.
      onDoubleClick={() => setExpanded(!expanded)}
      role="button"
      tabIndex={-1}
      aria-expanded={expanded}
      title={expanded ? 'Double-click to collapse' : 'Double-click to expand'}
      className="text-ink-faint flex cursor-default items-center gap-1.5 px-3 pt-3 pb-1 font-mono text-[10px] font-semibold tracking-[0.14em] uppercase select-none"
    >
      <Zap size={11} fill="currentColor" strokeWidth={0} className="text-priority" />
      Priority · {total}
      {/* Always mounted: the keycaps are taller than the 10px header text, so
          conditionally rendering them shifted the row height — fade instead. */}
      <span
        aria-hidden={!focusedInGroup}
        className={cn(
          'ml-auto flex items-center gap-1.5 lowercase tracking-normal transition-opacity',
          focusedInGroup ? 'opacity-100' : 'opacity-0',
        )}
      >
        <Keycaps keys={keysFor(expanded ? 'priority-collapse' : 'priority-expand')} />
        {expanded ? 'Collapse' : 'Expand'}
      </span>
    </div>
  );
}

/** Spark's "Show all (N)" row: a real list row — arrow onto it and press ↩. */
function PriorityToggleRow({ total }: { total: number }) {
  const expanded = useUi((s) => s.priorityExpanded);
  const setExpanded = useUi((s) => s.setPriorityExpanded);
  const selectThread = useUi((s) => s.selectThread);
  const hoverThread = useUi((s) => s.hoverThread);
  const isSelected = useUi((s) => s.selectedThreadId === PRIORITY_TOGGLE_ID);
  const isHovered = useUi((s) => s.hoveredThreadId === PRIORITY_TOGGLE_ID);
  const anyHovered = useUi((s) => s.hoveredThreadId !== null);
  return (
    <Tip
      label={expanded ? 'Collapse' : 'Expand'}
      keys={keysFor(expanded ? 'priority-collapse' : 'priority-expand')}
      className="w-full"
    >
      <button
        onClick={() => {
          selectThread(PRIORITY_TOGGLE_ID, true);
          setExpanded(!expanded);
        }}
        onMouseMove={() => {
          if (!isHovered) hoverThread(PRIORITY_TOGGLE_ID);
        }}
        onMouseLeave={() => hoverThread(null)}
        aria-expanded={expanded}
        className={cn(
          'text-priority w-full py-2 text-center text-[12.5px] font-semibold',
          isSelected && 'bg-accent-soft',
          !isSelected && isHovered && 'bg-sunken',
          (isHovered || (isSelected && !anyHovered)) && 'kb-target',
        )}
      >
        {expanded ? 'Show less' : `Show all (${total})`}
      </button>
    </Tip>
  );
}

/** Per-card bulk actions on a Smart Inbox group header. */
function CardActions({ threads }: { threads: ThreadSummary[] }) {
  const btn = 'text-ink-faint hover:text-ink flex items-center gap-1';
  return (
    <span className="ml-auto flex items-center gap-3 pr-2 normal-case tracking-normal">
      {/* No keycaps: in the focus list U / E act on single rows, not the group. */}
      <Tip label="Mark all read">
        <button className={btn} onClick={() => void markThreadsRead(threads)}>
          <CheckCheck size={12} />
        </button>
      </Tip>
      <Tip label="Mark all done" align="end">
        <button
          className={btn}
          onClick={() => {
            moveThreads(threads, 'archive');
            toastWithUndo(`Done · ${threads.length} conversations`, () =>
              moveThreads(threads, 'inbox'),
            );
          }}
        >
          <Archive size={12} />
        </button>
      </Tip>
    </span>
  );
}

/** Sticky per-sender recategorization (report §2.3): correcting one email re-routes the sender. */
function RecategorizeMenu({ thread }: { thread: ThreadSummary }) {
  const sender = thread.participants[0]?.email;
  if (!sender) return null;
  const domain = sender.slice(sender.indexOf('@') + 1);
  const setCat = (category: Category, kind: 'address' | 'domain') =>
    void api.command('task:enqueue', {
      type: 'set-category',
      accountId: thread.accountId,
      key: kind === 'address' ? sender : domain,
      kind,
      category,
    });
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="border-hairline bg-surface text-ink-muted hover:text-ink flex h-6 w-6 items-center justify-center rounded-md border shadow-sm"
          title="Recategorize sender"
          onClick={(e) => e.stopPropagation()}
        >
          <Tags size={12.5} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="border-hairline bg-surface z-50 min-w-44 rounded-xl border p-1 text-[12px] shadow-xl"
          sideOffset={4}
        >
          <DropdownMenu.Label className="text-ink-faint px-2 py-1 text-[10.5px]">
            Mail from {sender}
          </DropdownMenu.Label>
          {CATEGORY_ORDER.map(({ id, label }) => (
            <DropdownMenu.Item
              key={id}
              onSelect={() => setCat(id, 'address')}
              className={cn(
                'data-highlighted:bg-accent-soft data-highlighted:text-accent cursor-default rounded-lg px-2 py-1.5 outline-none',
                thread.category === id && 'text-accent font-semibold',
              )}
            >
              {label}
            </DropdownMenu.Item>
          ))}
          <DropdownMenu.Separator className="bg-hairline my-1 h-px" />
          <DropdownMenu.Item
            onSelect={() =>
              void api.command('task:enqueue', {
                type: 'gatekeeper-decide',
                accountId: thread.accountId,
                key: sender,
                kind: 'address',
                decision: 'blocked',
              })
            }
            className="data-highlighted:bg-accent-soft text-danger cursor-default rounded-lg px-2 py-1.5 outline-none"
          >
            Block sender
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function HoverActions({ thread }: { thread: ThreadSummary }) {
  const run = (id: string) => (e: React.MouseEvent) => {
    e.stopPropagation();
    ACTIONS.find((a) => a.id === id)?.perform(thread.id);
  };
  const btn =
    'flex h-6 w-6 items-center justify-center rounded-md bg-surface border border-hairline text-ink-muted hover:text-ink shadow-sm';
  return (
    <div className="absolute top-1/2 right-2 flex -translate-y-1/2 items-center gap-1">
      <Tip label="Done" keys={keysFor('done')}>
        <button className={btn} onClick={run('done')}>
          <Archive size={12.5} />
        </button>
      </Tip>
      <Tip label="Snooze" keys={keysFor('snooze')}>
        <button className={btn} onClick={run('snooze')}>
          <AlarmClock size={12.5} />
        </button>
      </Tip>
      <Tip label="Pin" keys={keysFor('pin')}>
        <button className={btn} onClick={run('pin')}>
          <Pin size={12.5} />
        </button>
      </Tip>
      <RecategorizeMenu thread={thread} />
      <Tip label="Delete" keys={keysFor('delete')} align="end">
        <button className={btn} onClick={run('delete')}>
          <Trash2 size={12.5} />
        </button>
      </Tip>
    </div>
  );
}

/** Wake-time chip shown in the Snoozed view. */
function WakeChip({ thread }: { thread: ThreadSummary }) {
  const view = useUi((s) => s.view);
  if (view !== 'snoozed') return null;
  return (
    <span className="text-accent bg-accent-soft flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold">
      <AlarmClock size={10} />
      {fmtWake(thread.snoozeWakeAt)}
    </span>
  );
}

function RowShell({
  thread,
  children,
  className,
}: {
  thread: ThreadSummary;
  children: React.ReactNode;
  className?: string;
}) {
  const selectThread = useUi((s) => s.selectThread);
  const hoverThread = useUi((s) => s.hoverThread);
  const isSelected = useUi(
    (s) => s.selectedThreadId === thread.id || s.multiSelected.includes(thread.id),
  );
  const isHovered = useUi((s) => s.hoveredThreadId === thread.id);
  const anyHovered = useUi((s) => s.hoveredThreadId !== null);
  return (
    <div
      role="button"
      tabIndex={-1}
      aria-selected={isSelected}
      onClick={(e) => {
        // ⇧-click picks a range, ⌘-click adds/removes one row; triage keys
        // then act on every picked email.
        if (e.shiftKey) selectRangeTo(thread.id);
        else if (e.metaKey || e.ctrlKey) toggleInSelection(thread.id);
        else selectThread(thread.id);
      }}
      // onMouseMove, not onMouseEnter: rows re-sorting under a stationary
      // cursor must not steal the keyboard target from the selected thread.
      onMouseMove={() => {
        if (!isHovered) hoverThread(thread.id);
      }}
      onMouseLeave={() => hoverThread(null)}
      className={cn(
        'relative cursor-default',
        isSelected && 'bg-accent-soft',
        !isSelected && isHovered && 'bg-sunken',
        (isHovered || (isSelected && !anyHovered)) && 'kb-target',
        className,
      )}
    >
      {children}
      {isHovered && <HoverActions thread={thread} />}
    </div>
  );
}

function Unread({ on, color }: { on: boolean; color?: string }) {
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full"
      style={{ background: on ? (color ?? 'var(--color-accent)') : 'transparent' }}
      aria-label={on ? 'unread' : undefined}
    />
  );
}

/** Sender label with Spark's draft treatment: "Draft, <name>". */
function rowLabel(thread: ThreadSummary): string {
  const from = senderLabel(thread.participants[0]);
  return thread.hasDraft ? `Draft, ${from}` : from;
}

function FocusedRow({ thread, color }: { thread: ThreadSummary; color: string }) {
  const from = rowLabel(thread);
  const unread = thread.unreadCount > 0;
  const density = useUi((s) => s.density);
  // Expanded is the same row, just with more air between emails (taller
  // vertical padding — padding, not margin, so the virtualizer measures it).
  return (
    <RowShell
      thread={thread}
      className={cn(
        'border-hairline flex gap-2.5 border-b px-3',
        density === 'expanded' ? 'py-4' : 'py-2',
      )}
    >
      <FocusedRowBody thread={thread} color={color} from={from} unread={unread} />
    </RowShell>
  );
}

function FocusedRowBody({
  thread,
  color,
  from,
  unread,
}: {
  thread: ThreadSummary;
  color: string;
  from: string;
  unread: boolean;
}) {
  return (
    <>
      <div
        className={cn(
          'text-ink-muted mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold',
          thread.hasDraft ? 'border-hairline border' : 'bg-sunken',
        )}
        aria-hidden
      >
        {thread.hasDraft ? <Pencil size={13} /> : initials(from)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Unread on={unread} color={color} />
          <span
            className={cn('flex-1 truncate text-[12.5px]', unread ? 'font-bold' : 'font-medium')}
          >
            {from}
            {thread.messageCount > 1 && (
              <span className="text-ink-faint font-normal"> · {thread.messageCount}</span>
            )}
          </span>
          {thread.pinned && <Pin size={11} className="text-accent shrink-0" />}
          {thread.hasAttachments && <Paperclip size={11} className="text-ink-faint shrink-0" />}
          <WakeChip thread={thread} />
          <span className="text-ink-faint shrink-0 text-[11px] tabular-nums">
            {formatListDate(thread.lastMessageDate)}
          </span>
        </div>
        <div
          className={cn('truncate text-[12.5px]', unread ? 'text-ink font-semibold' : 'text-ink')}
        >
          {thread.subject || '(no subject)'}
        </div>
        <div className="text-ink-muted truncate text-[12px]">{thread.snippet}</div>
      </div>
    </>
  );
}

function SimpleRow({ thread, color }: { thread: ThreadSummary; color: string }) {
  const from = rowLabel(thread);
  const unread = thread.unreadCount > 0;
  const density = useUi((s) => s.density);
  return (
    <RowShell
      thread={thread}
      className={cn(
        'border-hairline flex items-center gap-2 border-b px-3',
        density === 'expanded' ? 'py-2.5' : 'py-[5px]',
      )}
    >
      <Unread on={unread} color={color} />
      {thread.hasDraft && <Pencil size={11} className="text-ink-muted shrink-0" />}
      <span className={cn('w-36 shrink-0 truncate text-[12.5px]', unread ? 'font-bold' : '')}>
        {from}
      </span>
      <span className={cn('flex-1 truncate text-[12.5px]', unread && 'font-semibold')}>
        {thread.subject || '(no subject)'}
        <span className="text-ink-faint font-normal"> — {thread.snippet}</span>
      </span>
      {thread.pinned && <Pin size={11} className="text-accent shrink-0" />}
      {thread.hasAttachments && <Paperclip size={11} className="text-ink-faint shrink-0" />}
      <span className="text-ink-faint shrink-0 text-[11px] tabular-nums">
        {formatListDate(thread.lastMessageDate)}
      </span>
    </RowShell>
  );
}

function CardRow({ thread, color }: { thread: ThreadSummary; color: string }) {
  const from = rowLabel(thread);
  const unread = thread.unreadCount > 0;
  const density = useUi((s) => s.density);
  return (
    <div className={cn('px-2', density === 'expanded' ? 'py-1.5' : 'py-[3px]')}>
      <RowShell
        thread={thread}
        className={cn(
          'border-hairline rounded-xl border px-3 py-2',
          unread ? 'bg-surface shadow-sm' : 'bg-transparent',
        )}
      >
        <div className="flex items-center gap-1.5">
          <Unread on={unread} color={color} />
          <span
            className={cn('flex-1 truncate text-[12.5px]', unread ? 'font-bold' : 'font-medium')}
          >
            {from}
          </span>
          {thread.pinned && <Pin size={11} className="text-accent shrink-0" />}
          <span className="text-ink-faint shrink-0 text-[11px] tabular-nums">
            {formatListDate(thread.lastMessageDate)}
          </span>
        </div>
        <div className={cn('truncate text-[12.5px]', unread && 'font-semibold')}>
          {thread.subject || '(no subject)'}
        </div>
        {unread && <div className="text-ink-muted truncate text-[12px]">{thread.snippet}</div>}
      </RowShell>
    </div>
  );
}

/** Each empty view says how emails get here, not just that none did. */
function EmptyList({ view, search }: { view: string; search: string }) {
  if (search) {
    return (
      <div className="text-ink-muted flex h-full flex-col items-center justify-center gap-1.5 px-6 text-center text-[12.5px]">
        <p>No results for “{search}”.</p>
        <p className="text-ink-faint text-[12px]">
          Search covers senders, subjects, and message text.
        </p>
      </div>
    );
  }
  const hints: Record<string, { title: string; how?: React.ReactNode }> = {
    inbox: {
      title: 'Inbox zero.',
      how: (
        <>
          <Keycaps keys={['⌘', 'K']} /> opens every action
        </>
      ),
    },
    pinned: {
      title: 'No pinned emails.',
      how: (
        <>
          <Keycaps keys={['D']} /> pins the selected email
        </>
      ),
    },
    snoozed: {
      title: 'Nothing snoozed.',
      how: (
        <>
          <Keycaps keys={['S']} /> snoozes an email — it waits here
        </>
      ),
    },
    set_aside: {
      title: 'Set Aside is empty.',
      how: (
        <>
          <Keycaps keys={['G']} /> parks the selected email here
        </>
      ),
    },
    archive: {
      title: 'Nothing marked done.',
      how: (
        <>
          <Keycaps keys={['E']} /> moves the selected email here
        </>
      ),
    },
    sent: { title: 'Nothing sent yet.' },
    drafts: { title: 'No drafts.' },
    spam: { title: 'No spam.' },
    trash: { title: 'Trash is empty.' },
  };
  const hint = hints[view] ?? { title: 'Nothing here.' };
  return (
    <div className="text-ink-muted flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-[12.5px]">
      <p>{hint.title}</p>
      {hint.how && <p className="flex items-center gap-1.5">{hint.how}</p>}
    </div>
  );
}

export function ThreadList({ threads }: { threads: ThreadSummary[] }) {
  const listLayout = useUi((s) => s.listLayout);
  const density = useUi((s) => s.density);
  const setVisibleRows = useUi((s) => s.setVisibleRows);
  const selectedThreadId = useUi((s) => s.selectedThreadId);
  const view = useUi((s) => s.view);
  const smartInbox = useUi((s) => s.smartInbox);
  const searchQuery = useUi((s) => s.searchQuery);
  const categoryFocus = useUi((s) => s.categoryFocus);
  const setCategoryFocus = useUi((s) => s.setCategoryFocus);
  const split = useUi((s) => s.split);
  const parentRef = useRef<HTMLDivElement>(null);
  const priorityEmails = useUi((s) => s.priorityEmails);
  const priorityExpanded = useUi((s) => s.priorityExpanded);
  const colorFor = useAccountColor();
  const smartGrouping = smartInbox && view === 'inbox' && !searchQuery.trim();

  // Keep the just-opened email pinned in the unread group until you move to
  // another one, instead of dropping it to "seen" the instant it's read. We
  // capture the selection's unread state at click time (before read-marking
  // mutates the thread), then hold it via a ref across the read update.
  const heldRef = useRef<string | null>(null);
  const prevSelectedRef = useRef<string | null>(null);
  if (selectedThreadId !== prevSelectedRef.current) {
    const picked = threads.find((t) => t.id === selectedThreadId);
    heldRef.current = picked && picked.unreadCount > 0 ? selectedThreadId : null;
    prevSelectedRef.current = selectedThreadId;
  }
  const heldUnreadId = heldRef.current;
  // Priority + unread-first sections apply to the inbox, not search results.
  const inboxSections = view === 'inbox' && !searchQuery.trim();
  const focus = smartGrouping ? categoryFocus : null;

  const prio = useMemo(() => new Set(priorityEmails.map((e) => e.toLowerCase())), [priorityEmails]);
  // A from: search labels each hit with the sender that matched, instead of
  // the thread's most recent correspondent.
  const fromTerms = useMemo(() => parseSearchQuery(searchQuery).fromTerms, [searchQuery]);

  // A priority row can only name one person; hovering reveals everyone on the
  // thread who is on the priority list, most recent first.
  const [peers, setPeers] = useState<{ anchor: HoverAnchor; names: string[] } | null>(null);
  const [peersOpen, setPeersOpen] = useState(false);
  const peersTimer = useRef<number | null>(null);
  const showPeers = (el: HTMLElement, thread: ThreadSummary) => {
    const names = priorityPeers(thread, prio).map(senderLabel);
    // One name is already on the row; also dismisses a card left from another.
    if (names.length < 2) return hidePeers();
    if (peersTimer.current) window.clearTimeout(peersTimer.current);
    const r = el.getBoundingClientRect();
    setPeers({
      anchor: { x: r.right + 8, y: Math.min(r.top, window.innerHeight - 40 - names.length * 24) },
      names,
    });
    // Mount closed, then flip so the card has a "from" style to animate out of.
    setPeersOpen(false);
    requestAnimationFrame(() => setPeersOpen(true));
  };
  const hidePeers = () => {
    setPeersOpen(false);
    if (peersTimer.current) window.clearTimeout(peersTimer.current);
    peersTimer.current = window.setTimeout(() => setPeers(null), 150);
  };
  const shownThreads = useMemo(
    () => (fromTerms.length ? threads.map((t) => withSearchFrom(t, fromTerms)) : threads),
    [threads, fromTerms],
  );
  const focusThreads = useMemo(
    () => (focus ? shownThreads.filter((t) => t.category === focus) : []),
    [shownThreads, focus],
  );
  const items = useMemo(
    () =>
      focus
        ? buildFocusItems(focusThreads)
        : buildItems(shownThreads, listLayout, smartGrouping, prio, inboxSections, heldUnreadId, {
            expanded: priorityExpanded,
          }),
    [
      focus,
      focusThreads,
      shownThreads,
      listLayout,
      smartGrouping,
      prio,
      inboxSections,
      heldUnreadId,
      priorityExpanded,
    ],
  );

  // Keyboard nav must follow what is actually rendered: bundle rows are
  // selectable targets, and bundled threads only become navigable inside
  // their dedicated list.
  const navRows = useMemo(
    () =>
      items.flatMap((it): NavRow[] =>
        it.kind === 'thread' || it.kind === 'bundle' || it.kind === 'priority-toggle' ? [it] : [],
      ),
    [items],
  );
  useEffect(() => {
    setVisibleRows(navRows);
  }, [navRows, setVisibleRows]);

  // Leave the dedicated list when its last email is archived/deleted.
  useEffect(() => {
    if (focus && !focusThreads.length) setCategoryFocus(null);
  }, [focus, focusThreads.length, setCategoryFocus]);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (i) => {
      const kind = items[i]?.kind;
      if (kind === 'header' || kind === 'priority-header') return 30;
      if (kind === 'priority-toggle') return 36;
      if (kind === 'bundle') return split ? 64 : 37;
      // Estimates only — measureElement corrects; expanded adds row padding.
      const pad = density === 'expanded' ? 12 : 0;
      return (listLayout === 'focused' ? 66 : listLayout === 'simple' ? 28 : 72) + pad;
    },
    overscan: 12,
  });

  // Jump back to the top whenever we enter or leave a dedicated list.
  useEffect(() => {
    virtualizer.scrollToIndex(0);
  }, [focus, virtualizer]);

  // Priority group toggling: a soft settle animation both ways. Expanding
  // keeps you on the email you were on (the selection effect below scrolls it
  // back into view); collapsing lands on the first pinned priority email —
  // an auto selection, so it previews without marking read.
  const prevExpandedRef = useRef(priorityExpanded);
  useEffect(() => {
    if (prevExpandedRef.current === priorityExpanded) return;
    const collapsing = prevExpandedRef.current && !priorityExpanded;
    prevExpandedRef.current = priorityExpanded;
    const el = parentRef.current;
    if (el) {
      el.classList.remove('list-settle');
      void el.offsetWidth; // restart the animation
      el.classList.add('list-settle');
    }
    if (collapsing) {
      const headerIdx = items.findIndex((it) => it.kind === 'priority-header');
      const first = items.slice(headerIdx + 1).find((it) => it.kind === 'thread');
      if (headerIdx >= 0 && first?.kind === 'thread') {
        useUi.getState().selectThread(first.thread.id, true);
      }
      // The group lives at the very top; scroll there after paint —
      // scrollToIndex against just-rebuilt items uses stale measurements
      // and can leave the ⚡ Priority title resting out of view.
      requestAnimationFrame(() => virtualizer.scrollToOffset(0));
    }
  }, [priorityExpanded, items, virtualizer]);

  // keep selection visible when navigating with arrows
  useEffect(() => {
    if (!selectedThreadId) return;
    const idx = items.findIndex(
      (it) =>
        (it.kind === 'thread' && it.thread.id === selectedThreadId) ||
        (it.kind === 'bundle' && bundleRowId(it.category) === selectedThreadId) ||
        (it.kind === 'priority-toggle' && selectedThreadId === PRIORITY_TOGGLE_ID),
    );
    if (idx >= 0) virtualizer.scrollToIndex(idx, { align: 'auto' });
  }, [selectedThreadId, items, virtualizer]);

  // Arrowing onto a priority row surfaces the same card the mouse does. Runs
  // in a frame callback so it measures after the scroll above has landed.
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const idx = items.findIndex(
        (it) => it.kind === 'thread' && it.thread.id === selectedThreadId,
      );
      const item = idx >= 0 ? items[idx] : null;
      if (!item || item.kind !== 'thread' || !item.priority) return hidePeers();
      const el = parentRef.current?.querySelector<HTMLElement>(`[data-index="${idx}"]`);
      if (el) showPeers(el, item.thread);
      else hidePeers();
    });
    return () => cancelAnimationFrame(raf);
    // showPeers/hidePeers close over per-render state; re-running on selection
    // and list changes is exactly the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedThreadId, items]);

  if (!threads.length) {
    // Still a focus target: panel navigation (← →, Enter on a folder) must be
    // able to land here even when the view is empty.
    return (
      <div data-thread-list tabIndex={-1} className="h-full focus:outline-none">
        <EmptyList view={view} search={searchQuery.trim()} />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {focus && <FocusHeader category={focus} threads={focusThreads} />}
      <div
        ref={parentRef}
        data-thread-list
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-y-auto focus:outline-none"
        role="list"
        aria-label="Email list"
      >
        <div
          style={{
            height: virtualizer.getTotalSize(),
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((vi) => {
            const item = items[vi.index]!;
            return (
              <div
                key={vi.key}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                onMouseEnter={
                  item.kind === 'thread' && item.priority
                    ? (e) => showPeers(e.currentTarget, item.thread)
                    : undefined
                }
                onMouseLeave={item.kind === 'thread' && item.priority ? hidePeers : undefined}
                className={cn(
                  (item.kind === 'priority-header' ||
                    item.kind === 'priority-toggle' ||
                    (item.kind === 'thread' && item.priority)) &&
                    'priority-tint',
                )}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                {item.kind === 'header' ? (
                  <div className="text-ink-faint sticky flex items-center px-3 pt-3 pb-1 font-mono text-[10px] font-semibold tracking-[0.14em] uppercase">
                    {item.label}
                  </div>
                ) : item.kind === 'priority-header' ? (
                  <PriorityHeader total={item.total} ids={item.ids} />
                ) : item.kind === 'priority-toggle' ? (
                  <PriorityToggleRow total={item.total} />
                ) : item.kind === 'bundle' ? (
                  <BundleRow category={item.category} threads={item.threads} />
                ) : listLayout === 'focused' ? (
                  <FocusedRow thread={item.thread} color={colorFor(item.thread.accountId)} />
                ) : listLayout === 'simple' ? (
                  <SimpleRow thread={item.thread} color={colorFor(item.thread.accountId)} />
                ) : (
                  <CardRow thread={item.thread} color={colorFor(item.thread.accountId)} />
                )}
              </div>
            );
          })}
        </div>
      </div>
      <HoverCard open={peersOpen} anchor={peers?.anchor ?? null} label="Priority senders">
        <p className="text-ink-faint px-1 pb-1 font-mono text-[9.5px] font-semibold tracking-[0.14em] uppercase">
          Priority
        </p>
        {peers?.names.map((name) => (
          <p key={name} className="text-ink truncate px-1 py-0.5 text-[12px]">
            {name}
          </p>
        ))}
      </HoverCard>
    </div>
  );
}
