import {
  KANBAN_COLUMNS,
  KANBAN_STATUSES,
  type KanbanBoard,
  type KanbanCard,
  type NotionBlock,
} from '@app/shared';
import { ArrowLeft, CalendarDays, ExternalLink, Globe, Mail, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { toastWithUndo } from '../../lib/undo';
import { cn } from '../../lib/utils';
import { useAssistant } from '../../state/assistant';
import { useUi } from '../../state/store';

const STATUS_DOT: Record<string, string> = {
  Requests: 'bg-red-500',
  'Not started': 'bg-zinc-400',
  'In progress': 'bg-blue-500',
  'Review requested': 'bg-yellow-500',
  Approved: 'bg-emerald-500',
};

const PRIORITY_CHIP: Record<string, string> = {
  High: 'bg-red-500/15 text-red-500',
  Medium: 'bg-emerald-500/15 text-emerald-600',
  Low: 'bg-yellow-500/15 text-yellow-600',
};

const SOURCE_BADGE: Record<string, { label: string; icon: typeof Mail }> = {
  email: { label: 'Email', icon: Mail },
  fable: { label: 'FABLE', icon: Globe },
  unsdsn: { label: 'UNSDSN', icon: Globe },
  sdgtc: { label: 'SDG TC', icon: Globe },
};

function Card({
  card,
  selected,
  focused,
  kb,
  onClick,
}: {
  card: KanbanCard;
  selected: boolean;
  /** keyboard cursor is on this card */
  focused: boolean;
  /** "col:row" anchor for scroll-into-view on keyboard moves */
  kb: string;
  onClick: () => void;
}) {
  const source = card.source ? SOURCE_BADGE[card.source] : null;
  return (
    <button
      onClick={onClick}
      data-kb={kb}
      className={cn(
        'border-hairline bg-surface w-full rounded-xl border p-2.5 text-left shadow-sm transition-colors cursor-pointer',
        selected
          ? 'border-accent ring-accent bg-accent-soft/30 ring-[0.5px]'
          : focused
            ? 'border-accent ring-accent ring-[0.5px]'
            : 'hover:border-accent/50',
      )}
    >
      <div className="text-ink text-[12.5px] leading-snug font-medium">{card.title}</div>
      {(card.priority.length > 0 || card.projects.length > 0 || source) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {card.priority.map((pr) => (
            <span
              key={pr}
              className={cn(
                'rounded-md px-1.5 py-0.5 text-[10px] font-semibold',
                PRIORITY_CHIP[pr] ?? 'bg-sunken text-ink-muted',
              )}
            >
              {pr}
            </span>
          ))}
          {card.projects.map((proj) => (
            <span
              key={proj}
              className="bg-sunken text-ink-muted max-w-36 truncate rounded-md px-1.5 py-0.5 text-[10px]"
            >
              {proj}
            </span>
          ))}
          {source && (
            <span className="bg-accent-soft text-accent flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold">
              <source.icon size={9} />
              {source.label}
            </span>
          )}
        </div>
      )}
      {card.dueDate && (
        <div className="text-ink-faint mt-1.5 flex items-center gap-1 text-[10.5px]">
          <CalendarDays size={10} />
          {new Date(card.dueDate).toLocaleDateString([], { month: 'short', day: 'numeric' })}
        </div>
      )}
    </button>
  );
}

function BlockLine({ block }: { block: NotionBlock }) {
  switch (block.type) {
    case 'heading':
      return <h4 className="text-ink mt-3 text-[12.5px] font-bold">{block.text}</h4>;
    case 'bullet':
      return <p className="text-ink-muted pl-3 text-[12px] leading-relaxed">• {block.text}</p>;
    case 'number':
      return <p className="text-ink-muted pl-3 text-[12px] leading-relaxed">– {block.text}</p>;
    case 'todo':
      return (
        <p className="text-ink-muted text-[12px] leading-relaxed">
          {block.checked ? '☑' : '☐'} {block.text}
        </p>
      );
    case 'quote':
      return (
        <p className="border-hairline text-ink-faint border-l-2 pl-2 text-[12px] italic">
          {block.text}
        </p>
      );
    case 'code':
      return (
        <pre className="bg-sunken overflow-x-auto rounded-lg p-2 font-mono text-[11px]">
          {block.text}
        </pre>
      );
    case 'divider':
      return <hr className="border-hairline my-2" />;
    default:
      return <p className="text-ink-muted text-[12px] leading-relaxed">{block.text}</p>;
  }
}

/** Master-detail side panel: stage control, properties, page content. */
function CardPanel({
  card,
  status,
  onSetStatus,
  onClose,
}: {
  card: KanbanCard;
  status: string;
  onSetStatus: (status: string) => void;
  onClose: () => void;
}) {
  // Keyed by card id so switching cards shows "loading" without a sync reset.
  const [loaded, setLoaded] = useState<{ id: string; blocks: NotionBlock[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void api.query('notion:page', { pageId: card.id }).then((blocks) => {
      if (!cancelled) setLoaded({ id: card.id, blocks });
    });
    return () => {
      cancelled = true;
    };
  }, [card.id]);
  const blocks = loaded?.id === card.id ? loaded.blocks : null;

  const props: { label: string; value: string }[] = [
    { label: 'Priority', value: card.priority.join(', ') || '—' },
    { label: 'Projects', value: card.projects.join(', ') || '—' },
    { label: 'Due date', value: card.dueDate ? new Date(card.dueDate).toLocaleDateString() : '—' },
    { label: 'Requested by', value: card.requestedBy ?? '—' },
    { label: 'Created', value: new Date(card.createdTime).toLocaleDateString() },
  ];

  return (
    // Overlays the board's right edge (absolute, not a flex sibling) so
    // opening a task never shifts the centered columns. The outer aside
    // animates its width in; the inner wrapper keeps the real width so the
    // content slides in from the right instead of reflowing.
    <aside className="kanban-panel-in border-hairline bg-paper absolute inset-y-0 right-0 z-20 w-80 overflow-hidden border-l shadow-2xl">
      <div className="flex h-full w-80 flex-col overflow-y-auto px-4 py-4">
        {/* eyebrow: task id + current status pill, close on the right */}
        <div className="flex items-center gap-2">
          {card.taskId !== null && (
            <span className="text-ink-faint font-mono text-[11px] font-semibold tracking-wide">
              #{card.taskId}
            </span>
          )}
          <span className="bg-sunken text-ink flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold">
            <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[status] ?? 'bg-zinc-400')} />
            {status}
          </span>
          <span className="flex-1" />
          <a
            href={card.url}
            target="_blank"
            rel="noreferrer noopener"
            title="Open in Notion"
            aria-label="Open in Notion"
            className="text-ink-muted hover:text-accent"
          >
            <ExternalLink size={14} />
          </a>
          <button
            onClick={onClose}
            aria-label="Close card"
            className="text-ink-muted hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        <h3 className="text-ink mt-3 text-[16px] leading-snug font-bold tracking-tight">
          {card.title}
        </h3>

        {/* stacked properties card: label left, value right */}
        <div className="border-hairline mt-4 rounded-2xl border p-1.5">
          {props.map((pr) => (
            <div
              key={pr.label}
              className="bg-sunken/70 mb-1.5 flex items-center justify-between gap-3 rounded-xl px-3 py-2 last:mb-0"
            >
              <span className="text-ink-faint text-[12px]">{pr.label}</span>
              <span className="text-ink min-w-0 truncate text-[12px] font-semibold">
                {pr.value}
              </span>
            </div>
          ))}
        </div>

        {/* stage control: pill per status, current one filled */}
        <p className="text-ink-muted mt-4 text-[12px] font-semibold">Move to</p>
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Task status">
          {KANBAN_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => onSetStatus(s)}
              aria-pressed={s === status}
              className={cn(
                'rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold transition-colors',
                s === status
                  ? 'bg-accent text-white'
                  : 'border-hairline bg-surface text-ink-muted hover:text-ink border',
              )}
            >
              {s}
            </button>
          ))}
        </div>

        {/* the card's page content */}
        <div className="mt-4 min-h-16">
          {blocks === null && <p className="text-ink-faint text-[12px]">Loading content…</p>}
          {blocks?.length === 0 && (
            <div className="bg-sunken/70 rounded-xl px-3 py-5 text-center">
              <p className="text-ink-faint text-[12px]">This card has no content.</p>
            </div>
          )}
          {blocks?.map((b, i) => (
            <BlockLine key={i} block={b} />
          ))}
        </div>
      </div>
    </aside>
  );
}

export function KanbanView({ board, onBack }: { board: KanbanBoard | null; onBack: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Optimistic status moves, applied on top of the polled board until the
  // next fetch reflects them server-side. Reverted if the write fails.
  const [moves, setMoves] = useState<Record<string, string>>({});

  const columns = useMemo(() => {
    const cards = (board?.columns ?? []).flatMap((c) => c.cards);
    const effective = (c: KanbanCard) => moves[c.id] ?? c.status;
    return KANBAN_COLUMNS.map((status) => ({
      status,
      cards: cards.filter((c) => effective(c) === status),
    }));
  }, [board, moves]);

  // Keyboard cursor over the board, threadlist-style: ←/→ hop columns,
  // ↑/↓ walk a column, Enter opens the card, Esc dismisses in layers
  // (card panel, then Home). Silent while an overlay owns the keys or the
  // user is typing in a field. Until the user moves it, the cursor sits on
  // the first card (derived, not set) so navigation works immediately.
  const [focus, setFocus] = useState<{ col: number; row: number } | null>(null);
  const cursor = useMemo(() => {
    if (focus) return focus;
    const first = columns.findIndex((c) => c.cards.length > 0);
    return first === -1 ? null : { col: first, row: 0 };
  }, [focus, columns]);
  const overlayOpen = useUi(
    (s) => !!s.composer || s.settingsOpen || s.commandOpen || s.shortcutsOpen || !!s.picker,
  );

  // While the sidebar drawer is engaged (hovered or holding DOM focus), the
  // board cursor hides — the user is navigating mailboxes, not tasks.
  const [sidebarEngaged, setSidebarEngaged] = useState(false);
  useEffect(() => {
    // mouseover fires for every element the cursor crosses; coalesce the
    // querySelector + :hover probe to one run per animation frame.
    let raf = 0;
    const update = () => {
      raf = 0;
      const nav = document.querySelector('nav[aria-label="Mailboxes"]');
      setSidebarEngaged(
        nav instanceof HTMLElement &&
          (nav.matches(':hover') || nav.contains(document.activeElement)),
      );
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener('focusin', schedule);
    window.addEventListener('focusout', schedule);
    window.addEventListener('mouseover', schedule);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('focusin', schedule);
      window.removeEventListener('focusout', schedule);
      window.removeEventListener('mouseover', schedule);
    };
  }, []);
  useEffect(() => {
    if (overlayOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === 'INPUT' ||
          t.tagName === 'TEXTAREA' ||
          t.tagName === 'SELECT' ||
          t.isContentEditable)
      ) {
        return;
      }
      const sidebarNav = document.querySelector('nav[aria-label="Mailboxes"]');
      const sidebarActive =
        sidebarNav instanceof HTMLElement &&
        (sidebarNav.matches(':hover') || sidebarNav.contains(document.activeElement));
      if (e.key === 'Escape') {
        if (sidebarActive) return; // the drawer's own Esc closes it first
        if (useAssistant.getState().open) return; // the modal's own Esc closes it
        e.preventDefault();
        e.stopPropagation();
        setSelectedId((sel) => {
          if (sel === null) onBack();
          return null;
        });
        return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) return;
      // The sidebar drawer owns its own arrow/Enter navigation while the
      // pointer or DOM focus is on it — except →, which steps back onto the
      // board: dropping focus tucks the drawer away and the cursor returns.
      if (sidebarActive) {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          e.stopPropagation();
          (document.activeElement as HTMLElement | null)?.blur();
        }
        return;
      }
      if (t && t.closest('button, a, select') && !t.closest('[data-kanban-view]')) return;
      const nonEmpty = columns.map((_, i) => i).filter((i) => columns[i]!.cards.length > 0);
      if (!nonEmpty.length || !cursor) return;
      // ← at the leftmost column steps out of the board: hand the key to the
      // mail keymap, which reveals and focuses the sidebar drawer.
      if (e.key === 'ArrowLeft' && nonEmpty.indexOf(cursor.col) <= 0) return;
      e.preventDefault();
      // Claimed: the mail keymap's panel-hop / thread-selection must not
      // also act on these keys while the board is open.
      e.stopPropagation();
      if (e.key === 'Enter') {
        const card = columns[cursor.col]?.cards[cursor.row];
        if (card) setSelectedId(card.id);
        return;
      }
      let { col, row } = cursor;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const at = Math.max(0, nonEmpty.indexOf(col));
        const next = Math.min(
          nonEmpty.length - 1,
          Math.max(0, at + (e.key === 'ArrowRight' ? 1 : -1)),
        );
        col = nonEmpty[next]!;
        row = Math.min(row, columns[col]!.cards.length - 1);
      } else {
        row = Math.min(
          columns[col]!.cards.length - 1,
          Math.max(0, row + (e.key === 'ArrowDown' ? 1 : -1)),
        );
      }
      setFocus({ col, row });
    };
    // Capture phase: the board must claim arrows before the mail keymap's
    // bubble-phase listener steals them for panel navigation.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [overlayOpen, onBack, columns, cursor]);

  // Keep the keyboard cursor visible as it moves.
  useEffect(() => {
    if (!focus) return;
    document
      .querySelector(`[data-kb="${focus.col}:${focus.row}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [focus]);

  const allCards = useMemo(() => columns.flatMap((c) => c.cards), [columns]);
  const selected = allCards.find((c) => c.id === selectedId) ?? null;

  const setStatus = (card: KanbanCard, status: string) => {
    const prev = moves[card.id] ?? card.status;
    if (status === prev) return;
    setMoves((m) => ({ ...m, [card.id]: status }));
    // Done/Dropped leave the board; close the panel rather than orphan it.
    if (status === 'Done' || status === 'Dropped') setSelectedId(null);
    void api.command('notion:set-status', { pageId: card.id, status }).then((res) => {
      if (res.ok) {
        // toastWithUndo arms app-wide ⌘Z (menu accelerator) while the toast is up.
        toastWithUndo(`Moved to ${status}`, () => {
          setMoves((m) => ({ ...m, [card.id]: prev }));
          void api.command('notion:set-status', { pageId: card.id, status: prev }).then((undo) => {
            if (!undo.ok) toast(`Could not undo: ${undo.error ?? 'unknown error'}`);
          });
        });
      } else {
        setMoves((m) => ({ ...m, [card.id]: prev }));
        toast(`Could not move the task: ${res.error ?? 'unknown error'}`);
      }
    });
  };

  return (
    <div data-kanban-view className="relative flex h-full min-h-0">
      {/* min-w-0 lets this area shrink so the columns scroll internally and
          the side panel stays pinned to the window edge at any width. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* the back control stays put top-left; the title travels with the
            board below so it never floats detached in a corner */}
        <header className="shrink-0 px-6 pt-6">
          <button
            onClick={onBack}
            className="text-ink-muted hover:text-ink flex items-center gap-1.5 text-[12.5px] font-semibold"
          >
            <ArrowLeft size={14} />
            Home
          </button>
        </header>
        {!board ? (
          <p className="text-ink-faint px-6 pt-4 text-[12.5px]">Loading board…</p>
        ) : (
          // The board sits vertically centered at 60% of the viewport height;
          // w-max + mx-auto centers it horizontally when the columns fit and
          // hands over to the scroll region when they don't. The title is part
          // of the centered block, aligned to the board's left edge.
          <div className="flex min-h-0 flex-1 flex-col justify-center">
            <div className="no-scrollbar overflow-x-auto px-6 pb-6">
              <div className="mx-auto w-max">
                <div className="mb-3 flex items-baseline justify-between px-1">
                  <h1 className="text-ink text-[17px] font-bold tracking-tight">Sprint board</h1>
                  <span className="text-ink-faint text-[11.5px] tabular-nums">
                    {allCards.length} {allCards.length === 1 ? 'task' : 'tasks'}
                  </span>
                </div>
                <div className="flex h-[60vh] gap-3">
                  {columns.map((col, ci) => (
                    <section
                      key={col.status}
                      className="flex w-60 shrink-0 flex-col rounded-2xl p-2"
                    >
                      <div className="flex items-center gap-2 px-1.5 pt-1 pb-2">
                        <span
                          className={cn(
                            'h-2 w-2 rounded-full',
                            STATUS_DOT[col.status] ?? 'bg-zinc-400',
                          )}
                        />
                        <h2 className="text-ink flex-1 text-[11.5px] font-bold">{col.status}</h2>
                        <span className="text-ink-faint text-[11px] tabular-nums">
                          {col.cards.length}
                        </span>
                      </div>
                      <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
                        {col.cards.map((card, ri) => (
                          <Card
                            key={card.id}
                            card={card}
                            selected={selectedId === card.id}
                            focused={!sidebarEngaged && cursor?.col === ci && cursor?.row === ri}
                            kb={`${ci}:${ri}`}
                            onClick={() => {
                              setSelectedId(card.id);
                              setFocus({ col: ci, row: ri });
                            }}
                          />
                        ))}
                        {col.cards.length === 0 && (
                          <p className="text-ink-faint px-1.5 py-3 text-center text-[11px]">
                            No tasks
                          </p>
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      {selected && (
        <CardPanel
          card={selected}
          status={moves[selected.id] ?? selected.status}
          onSetStatus={(s) => setStatus(selected, s)}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
