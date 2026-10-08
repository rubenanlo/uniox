import type { MailView } from '@app/shared';
import {
  AlarmClock,
  Archive,
  CalendarClock,
  CalendarDays,
  FileText,
  Home,
  Inbox,
  KanbanSquare,
  Layers,
  PanelLeftClose,
  PanelLeftOpen,
  Pin,
  Plus,
  Send,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { focusList } from '../lib/panels';
import { cn, defaultAccountColor } from '../lib/utils';
import { kanbanNewCount, openSprintBoard, useKanban } from '../state/kanban';
import { useAccounts, useSyncStatuses, useThreads } from '../state/queries';
import { useUi } from '../state/store';
import { AccountIcon } from './ui/AccountIcon';
import { Keycaps } from './ui/Keycap';
import { useShallow } from 'zustand/react/shallow';

export const NAV: { view: MailView; label: string; icon: typeof Inbox; keys?: string[] }[] = [
  { view: 'home', label: 'Home', icon: Home },
  { view: 'inbox', label: 'Inbox', icon: Inbox },
  { view: 'pinned', label: 'Pinned', icon: Pin, keys: ['⌘', 'D'] },
  { view: 'snoozed', label: 'Snoozed', icon: AlarmClock, keys: ['⌘', 'S'] },
  { view: 'set_aside', label: 'Set Aside', icon: Layers, keys: ['⌘', 'G'] },
  { view: 'archive', label: 'Done', icon: Archive, keys: ['⌘', 'E'] },
  { view: 'outbox', label: 'Outbox', icon: CalendarClock },
  { view: 'sent', label: 'Sent', icon: Send },
  { view: 'drafts', label: 'Drafts', icon: FileText },
  { view: 'spam', label: 'Spam', icon: ShieldAlert },
  { view: 'calendar', label: 'Calendar', icon: CalendarDays },
  { view: 'trash', label: 'Trash', icon: Trash2 },
];

// Expand/collapse motion: the rail's width, the label fade and the FLIP glide
// of everything that changes place all share one curve.
const SLIDE_MS = 220;
const SLIDE_EASE = 'cubic-bezier(0.2, 0, 0, 1)';

type FlipRects = Map<Element, { x: number; y: number }>;

/** Positions of the rail's [data-flip] elements, relative to the rail itself. */
function measureFlip(root: HTMLElement | null): FlipRects {
  const rects: FlipRects = new Map();
  if (!root) return rects;
  const base = root.getBoundingClientRect();
  root.querySelectorAll('[data-flip]').forEach((el) => {
    const r = el.getBoundingClientRect();
    rects.set(el, { x: r.left - base.left, y: r.top - base.top });
  });
  return rects;
}

/** Fades a row's label in once the rail starts opening, and out right away. */
function labelFade(expanded: boolean): string {
  return cn(
    'flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden transition-opacity',
    expanded ? 'opacity-100 delay-75 duration-200' : 'pointer-events-none opacity-0 duration-100',
  );
}

export function Sidebar({ onAddAccount }: { onAddAccount: () => void }) {
  const { view, setView, sidebarExpanded, toggleSidebar, accountFilter, setAccountFilter } = useUi(
    useShallow((s) => ({
      view: s.view,
      setView: s.setView,
      sidebarExpanded: s.sidebarExpanded,
      toggleSidebar: s.toggleSidebar,
      accountFilter: s.accountFilter,
      setAccountFilter: s.setAccountFilter,
    })),
  );
  const accountAvatars = useUi((s) => s.accountAvatars);
  const accountColors = useUi((s) => s.accountColors);
  const { accounts } = useAccounts();
  const statuses = useSyncStatuses();
  const { threads: inboxThreads } = useThreads({
    view: 'inbox',
    accountId: accountFilter,
    search: '',
  });
  const unread = inboxThreads.reduce((n, t) => n + (t.unreadCount > 0 ? 1 : 0), 0);
  const newRequests = useKanban((s) => kanbanNewCount(s.board, s.seenAt));
  const kanbanConfigured = useKanban((s) => s.configured);
  const kanbanOpen = useUi((s) => s.kanbanOpen);

  // Home gets an auto-hiding sidebar: it sits off-canvas and slides in when the
  // pointer reaches the left edge or focus lands inside it (← from the list).
  // Calendar's full-window takeover gets the same treatment (its own
  // CalendarSidebar is the primary rail there). Every other view keeps the
  // classic sticky rail that `/` expands.
  const autoHide = view === 'home' || view === 'calendar';
  const [hover, setHover] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const open = hover || focusWithin;

  // Esc closes the open Home drawer before anything else (capture phase),
  // so it doesn't double as "leave the kanban" while the drawer is up.
  useEffect(() => {
    if (!autoHide || !open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setHover(false);
      setFocusWithin(false);
      (document.activeElement as HTMLElement | null)?.blur();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [autoHide, open]);

  const navRef = useRef<HTMLDivElement>(null);

  // Expanding switches the account switcher from a column to wrapped rows and
  // the footer from stacked to inline, so things change place, not just size.
  // FLIP them: note where they sit in the outgoing layout, then glide each one
  // from there to its new spot.
  const railRef = useRef<HTMLElement>(null);
  const flipFrom = useRef<FlipRects | null>(null);
  useEffect(
    () =>
      // The store notifies synchronously on toggle, before React re-renders,
      // so the DOM still shows the outgoing layout here.
      useUi.subscribe((s, prev) => {
        if (s.sidebarExpanded !== prev.sidebarExpanded) {
          flipFrom.current = measureFlip(railRef.current);
        }
      }),
    [],
  );
  useLayoutEffect(() => {
    const from = flipFrom.current;
    flipFrom.current = null;
    if (!from || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const [el, to] of measureFlip(railRef.current)) {
      const start = from.get(el);
      if (!start) continue;
      const dx = start.x - to.x;
      const dy = start.y - to.y;
      el.getAnimations().forEach((a) => a.cancel());
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: SLIDE_MS,
        easing: SLIDE_EASE,
      });
    }
  }, [sidebarExpanded]);
  const wasExpanded = useRef(sidebarExpanded);
  useEffect(() => {
    if (sidebarExpanded && !wasExpanded.current) {
      const active =
        navRef.current?.querySelector<HTMLButtonElement>('button[data-active="true"]') ??
        navRef.current?.querySelector<HTMLButtonElement>('button[data-nav]');
      active?.focus();
    }
    wasExpanded.current = sidebarExpanded;
  }, [sidebarExpanded]);

  const onNavKeyDown = (e: React.KeyboardEvent) => {
    // ArrowRight bubbles to the global panel navigation (sidebar → list).
    if (e.key === 'Enter' && (e.target as HTMLElement).closest('button[data-nav]')) {
      // the button's native click switches the view; then step into the list
      setTimeout(focusList);
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const buttons = Array.from(
      navRef.current?.querySelectorAll<HTMLButtonElement>('button[data-nav]') ?? [],
    );
    if (!buttons.length) return;
    // Keep arrows inside the sidebar instead of moving the thread selection.
    e.preventDefault();
    e.stopPropagation();
    const idx = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      idx === -1
        ? buttons[e.key === 'ArrowDown' ? 0 : buttons.length - 1]
        : buttons[
            Math.min(buttons.length - 1, Math.max(0, idx + (e.key === 'ArrowDown' ? 1 : -1)))
          ];
    next?.focus();
  };

  return (
    <>
      {/* Left-edge sensor + a faint grip, so the hidden Home sidebar is
          discoverable. Kept mounted so it never unmounts from under the cursor
          mid-reveal; the open drawer (z-40) covers it, so it only catches hover
          while hidden. */}
      {autoHide && (
        <div
          className="absolute top-0 left-0 z-30 h-full w-2.5"
          onMouseEnter={() => setHover(true)}
          aria-hidden
        >
          {!open && (
            <span className="bg-ink/15 absolute top-1/2 left-1 h-10 w-1 -translate-y-1/2 rounded-full" />
          )}
        </div>
      )}
      <nav
        ref={railRef}
        onMouseEnter={autoHide ? () => setHover(true) : undefined}
        onMouseLeave={autoHide ? () => setHover(false) : undefined}
        onFocus={autoHide ? () => setFocusWithin(true) : undefined}
        onBlur={
          autoHide
            ? (e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusWithin(false);
              }
            : undefined
        }
        className={cn(
          'border-hairline flex h-full flex-col overflow-hidden border-r',
          'transition-[width,translate] duration-[220ms] ease-[cubic-bezier(0.2,0,0,1)]',
          sidebarExpanded ? 'w-52' : 'w-[52px]',
          // The rail is transparent everywhere so the shell backdrop runs
          // through it — Home's auto-hide drawer included (it must look like
          // the docked rail on the mail views). A soft blur keeps the icons
          // legible when the drawer happens to slide over kanban content.
          autoHide
            ? cn(
                'absolute top-0 left-0 z-40 bg-transparent backdrop-blur-md',
                open ? 'translate-x-0' : '-translate-x-full',
              )
            : 'shrink-0 bg-transparent',
        )}
        aria-label="Mailboxes"
      >
        <div ref={navRef} onKeyDown={onNavKeyDown} className="flex-1 overflow-x-hidden overflow-y-auto px-2 pt-2.5">
        {/* account switcher */}
        <div
          className={cn(
            'mb-3 flex gap-1.5',
            // Expanded rows get the open rail's inner width up front, so they
            // wrap into their final layout at once instead of re-wrapping
            // frame by frame while the rail widens.
            sidebarExpanded ? 'w-48 flex-row flex-wrap' : 'flex-col items-center',
          )}
        >
          <button
            data-flip
            onClick={(e) => {
              setAccountFilter(undefined);
              if (autoHide) (e.currentTarget as HTMLButtonElement).blur();
            }}
            title="All accounts"
            className={cn(
              'flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold',
              accountFilter === undefined
                ? 'bg-accent text-white'
                : 'bg-sunken text-ink-muted hover:text-ink',
            )}
          >
            All
          </button>
          {accounts.map((a, i) => {
            const state = statuses.get(a.id)?.state;
            return (
              <button
                key={a.id}
                data-flip
                onClick={(e) => {
                  setAccountFilter(a.id);
                  if (autoHide) (e.currentTarget as HTMLButtonElement).blur();
                }}
                title={`${a.email}${state ? ` — ${state}` : ''}`}
                className={cn(
                  'relative flex h-7 w-7 items-center justify-center rounded-lg',
                  accountFilter === a.id ? 'ring-accent ring-2 ring-offset-1' : '',
                )}
              >
                <AccountIcon
                  label={a.displayName || a.email}
                  index={i}
                  avatar={accountAvatars[a.id]}
                  color={accountColors[a.id] ?? defaultAccountColor(i)}
                  className="h-full w-full text-[11px]"
                />
                {(state === 'connecting' || state === 'backfilling' || state === 'syncing') && (
                  <span className="absolute -right-0.5 -bottom-0.5 h-2 w-2 animate-pulse rounded-full bg-amber-400 ring-1 ring-white" />
                )}
                {state === 'error' && (
                  <span className="bg-danger absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full ring-1 ring-white" />
                )}
              </button>
            );
          })}
        </div>

        {NAV.map(({ view: v, label, icon: Icon, keys }) => (
          <button
            key={v}
            data-nav
            data-flip
            data-active={view === v || undefined}
            onClick={(e) => {
              setView(v);
              // On Home the drawer auto-hides, so drop focus after picking
              // (also when heading to Home, whose drawer starts hidden).
              if (autoHide || v === 'home') (e.currentTarget as HTMLButtonElement).blur();
            }}
            title={sidebarExpanded ? undefined : label}
            className={cn(
              'group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left',
              view === v
                ? 'bg-accent-soft text-accent font-semibold'
                : 'text-ink-muted hover:bg-accent-soft/30 hover:text-ink focus-visible:bg-accent-soft/30 focus-visible:text-ink',
            )}
          >
            <Icon size={16} strokeWidth={2.2} className="shrink-0" />
            <span className={labelFade(sidebarExpanded)} aria-hidden={!sidebarExpanded}>
              <span className="flex-1 overflow-hidden text-[12.5px] whitespace-nowrap">
                {label}
              </span>
              {v === 'inbox' && unread > 0 && (
                <span className="text-accent text-[11px] font-bold tabular-nums">{unread}</span>
              )}
              {keys && <Keycaps keys={keys} />}
            </span>
            {!sidebarExpanded && v === 'inbox' && unread > 0 && (
              <span className="bg-accent absolute ml-5 mt-[-10px] h-1.5 w-1.5 rounded-full" />
            )}
          </button>
        ))}

        {/* The Notion Sprint board, reachable from every view. It carries the
            new-request indicator (same dot vocabulary as the account circles). */}
        {kanbanConfigured && (
          <button
            data-nav
            data-flip
            data-active={(view === 'home' && kanbanOpen) || undefined}
            onClick={(e) => {
              openSprintBoard();
              (e.currentTarget as HTMLButtonElement).blur();
            }}
            title={sidebarExpanded ? undefined : 'Sprint board'}
            className={cn(
              'group mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left',
              view === 'home' && kanbanOpen
                ? 'bg-accent-soft text-accent font-semibold'
                : 'text-ink-muted hover:bg-accent-soft/30 hover:text-ink focus-visible:bg-accent-soft/30 focus-visible:text-ink',
            )}
          >
            <KanbanSquare size={16} strokeWidth={2.2} className="shrink-0" />
            <span className={labelFade(sidebarExpanded)} aria-hidden={!sidebarExpanded}>
              <span className="flex-1 overflow-hidden text-[12.5px] whitespace-nowrap">
                Sprint board
              </span>
              {newRequests > 0 && (
                <span className="text-danger text-[11px] font-bold tabular-nums">
                  {newRequests}
                </span>
              )}
            </span>
            {!sidebarExpanded && newRequests > 0 && (
              <span className="bg-danger absolute ml-5 mt-[-10px] h-1.5 w-1.5 rounded-full" />
            )}
          </button>
        )}
      </div>

      <div
        className={cn(
          'shrink-0 px-2 pb-2',
          sidebarExpanded ? 'flex items-center gap-1' : 'flex flex-col items-center gap-1',
        )}
      >
        <button
          data-flip
          onClick={onAddAccount}
          title={sidebarExpanded ? undefined : 'Add account'}
          className={cn(
            'text-ink-muted hover:bg-sunken hover:text-ink flex items-center gap-2.5 rounded-lg',
            sidebarExpanded ? 'flex-1 px-2 py-1.5 text-left' : 'h-7 w-7 overflow-hidden px-1.5',
          )}
        >
          <Plus size={16} strokeWidth={2.2} className="shrink-0" />
          <span className={labelFade(sidebarExpanded)} aria-hidden={!sidebarExpanded}>
            <span className="overflow-hidden text-[12.5px] whitespace-nowrap">Add account</span>
          </span>
        </button>
        <button
          data-flip
          onClick={toggleSidebar}
          title={sidebarExpanded ? 'Collapse to icons' : 'Expand with labels'}
          aria-expanded={sidebarExpanded}
          className="text-ink-muted hover:bg-sunken hover:text-ink flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
        >
          {sidebarExpanded ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
        </button>
      </div>
      </nav>
    </>
  );
}
