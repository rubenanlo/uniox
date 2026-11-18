import {
  KANBAN_COLUMNS,
  KANBAN_STATUSES,
  type KanbanBoard,
  type KanbanCard,
  type NotionBlock,
} from '@app/shared';
import {
  ArrowDownUp,
  Check,
  CalendarClock,
  ChevronDown,
  Columns3,
  ExternalLink,
  Flame,
  Folder,
  Globe,
  Home,
  Inbox,
  LayoutGrid,
  ListFilter,
  Mail,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  SquareKanban,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { toastWithUndo } from '../../lib/undo';
import { cn } from '../../lib/utils';
import { assistantOwnsEscape } from '../../state/assistant';
import { useKanban } from '../../state/kanban';
import { useUi } from '../../state/store';
import {
  buildColumns,
  DEFAULT_PREFS,
  filterCount,
  matchesFilters,
  matchesQuery,
  matchesView,
  NO_FILTERS,
  NO_PRIORITY,
  NO_PROJECT,
  readPrefs,
  sortCards,
  type BoardFilters,
  type BoardPrefs,
  type GroupBy,
  type SortKey,
  type ViewId,
} from './boardModel';
import { TerrainField } from './TerrainField';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

/** Pastel tones for chips and avatars; hues live in app.css (.sb-chip). */
type Tone = 'green' | 'teal' | 'blue' | 'lavender' | 'peach' | 'amber' | 'rose' | 'neutral';

const STATUS_TONE: Record<string, Tone> = {
  Requests: 'rose',
  'Not started': 'neutral',
  'In progress': 'blue',
  'Review requested': 'amber',
  Approved: 'green',
  Done: 'teal',
  Dropped: 'neutral',
};

const PRIORITY_TONE: Record<string, Tone> = {
  High: 'rose',
  Medium: 'amber',
  Low: 'neutral',
};

const HASHED_TONES: Tone[] = ['green', 'lavender', 'blue', 'peach', 'teal'];
function hashTone(name: string): Tone {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return HASHED_TONES[Math.abs(h) % HASHED_TONES.length]!;
}

const SOURCE_BADGE: Record<string, { label: string; icon: typeof Mail }> = {
  email: { label: 'Email', icon: Mail },
  fable: { label: 'FABLE', icon: Globe },
  unsdsn: { label: 'UNSDSN', icon: Globe },
  sdgtc: { label: 'SDG TC', icon: Globe },
};

function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="sb-chip" data-tone={tone}>
      {children}
    </span>
  );
}

function Avatar({ name, size = 18 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <span
      className="sb-avatar inline-flex shrink-0 items-center justify-center rounded-full font-semibold"
      data-tone={hashTone(name)}
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      title={name}
    >
      {initials}
    </span>
  );
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

function Card({
  card,
  selected,
  focused,
  kb,
  hideStatus,
  status,
  now,
  compact,
  showIds,
  onClick,
}: {
  card: KanbanCard;
  selected: boolean;
  /** keyboard cursor is on this card */
  focused: boolean;
  /** "col:row" anchor for scroll-into-view on keyboard moves */
  kb: string;
  /** grouped by status already, so the status chip would repeat the column */
  hideStatus: boolean;
  status: string;
  /** board mount time, for the overdue tint */
  now: number;
  /** Options → Compact cards: title, priority and a one-line footer */
  compact: boolean;
  showIds: boolean;
  onClick: () => void;
}) {
  const badge = card.source ? SOURCE_BADGE[card.source] : null;
  // The pipeline badge only adds information when no project chip already says it.
  const source =
    badge &&
    !card.projects.some((p) => p.toLowerCase().includes(badge.label.toLowerCase().split(' ')[0]!))
      ? badge
      : null;
  const overdue = card.dueDate !== null && Date.parse(card.dueDate) < now - 86_400_000;
  return (
    <button
      onClick={onClick}
      data-kb={kb}
      className={cn(
        'sb-card border-hairline bg-surface w-full cursor-pointer rounded-xl border px-3 py-2.5 text-left transition-colors',
        selected || focused
          ? 'border-[color-mix(in_oklab,var(--color-violet)_60%,var(--color-hairline))] ring-[3px] ring-[color-mix(in_oklab,var(--color-violet)_14%,transparent)]'
          : 'hover:border-[color-mix(in_oklab,var(--color-ink)_18%,var(--color-hairline))]',
      )}
    >
      <div className="text-ink text-[13px] leading-snug">{card.title}</div>
      {compact
        ? null
        : (card.projects.length > 0 || card.priority.length > 0 || source || !hideStatus) && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {!hideStatus && <Chip tone={STATUS_TONE[status] ?? 'neutral'}>{status}</Chip>}
              {card.projects.map((p) => (
                <Chip key={p} tone={hashTone(p)}>
                  <span className="max-w-36 truncate">{p}</span>
                </Chip>
              ))}
              {card.priority.map((p) => (
                <Chip key={p} tone={PRIORITY_TONE[p] ?? 'neutral'}>
                  {p}
                </Chip>
              ))}
              {source && (
                <Chip tone="lavender">
                  <source.icon size={10} />
                  {source.label}
                </Chip>
              )}
            </div>
          )}
      {(card.requestedBy || card.dueDate || (showIds && card.taskId !== null) || compact) && (
        <div
          className={cn(
            'text-ink-faint flex items-center gap-1.5 text-[11.5px]',
            compact ? 'mt-1.5' : 'mt-2.5',
          )}
        >
          {card.requestedBy && (
            <>
              <Avatar name={card.requestedBy} />
              {!compact && (
                <span className="text-ink-muted min-w-0 truncate">{card.requestedBy}</span>
              )}
            </>
          )}
          {compact &&
            card.priority.map((p) => (
              <Chip key={p} tone={PRIORITY_TONE[p] ?? 'neutral'}>
                {p}
              </Chip>
            ))}
          <span className="flex-1" />
          {card.dueDate && (
            <span className={cn('whitespace-nowrap tabular-nums', overdue && 'text-danger')}>
              {shortDate(card.dueDate)}
            </span>
          )}
          {showIds && card.taskId !== null && (
            <span className="font-mono text-[10.5px]">#{card.taskId}</span>
          )}
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
  const [loaded, setLoaded] = useState<{
    id: string;
    blocks: NotionBlock[];
  } | null>(null);
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

  const props: { label: string; value: ReactNode }[] = [
    {
      label: 'Priority',
      value: card.priority.length ? (
        <span className="flex flex-wrap justify-end gap-1">
          {card.priority.map((p) => (
            <Chip key={p} tone={PRIORITY_TONE[p] ?? 'neutral'}>
              {p}
            </Chip>
          ))}
        </span>
      ) : (
        '—'
      ),
    },
    {
      label: 'Projects',
      value: card.projects.length ? (
        <span className="flex flex-wrap justify-end gap-1">
          {card.projects.map((p) => (
            <Chip key={p} tone={hashTone(p)}>
              {p}
            </Chip>
          ))}
        </span>
      ) : (
        '—'
      ),
    },
    {
      label: 'Due date',
      value: card.dueDate ? new Date(card.dueDate).toLocaleDateString() : '—',
    },
    {
      label: 'Requested by',
      value: card.requestedBy ? (
        <span className="flex items-center gap-1.5">
          <Avatar name={card.requestedBy} />
          {card.requestedBy}
        </span>
      ) : (
        '—'
      ),
    },
    {
      label: 'Created',
      value: new Date(card.createdTime).toLocaleDateString(),
    },
  ];

  return (
    // Overlays the board's right edge (absolute, not a flex sibling) so
    // opening a task never shifts the columns. The outer aside animates its
    // width in; the inner wrapper keeps the real width so the content slides
    // in from the right instead of reflowing.
    <aside className="kanban-panel-in border-hairline bg-paper absolute inset-y-0 right-0 z-20 w-80 overflow-hidden border-l shadow-2xl">
      <div className="flex h-full w-80 flex-col overflow-y-auto px-5 py-5">
        <div className="flex items-center gap-2">
          {card.taskId !== null && (
            <span className="text-ink-faint font-mono text-[11px] font-semibold tracking-wide">
              #{card.taskId}
            </span>
          )}
          <Chip tone={STATUS_TONE[status] ?? 'neutral'}>{status}</Chip>
          <span className="flex-1" />
          <a
            href={card.url}
            target="_blank"
            rel="noreferrer noopener"
            title="Open in Notion"
            aria-label="Open in Notion"
            className="text-ink-muted hover:text-ink"
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

        <h3 className="text-ink mt-3 text-[17px] leading-snug font-semibold tracking-tight">
          {card.title}
        </h3>

        {/* property table: label left, value right, hairline rows */}
        <div className="border-hairline bg-surface mt-4 rounded-xl border">
          {props.map((pr) => (
            <div
              key={pr.label}
              className="border-hairline flex min-h-9 items-center justify-between gap-3 border-b px-3 py-1.5 text-[12.5px] last:border-b-0"
            >
              <span className="text-ink-muted shrink-0">{pr.label}</span>
              <span className="text-ink min-w-0 truncate text-right">{pr.value}</span>
            </div>
          ))}
        </div>

        <p className="text-ink-muted mt-5 text-[12px]">Move to</p>
        <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Task status">
          {KANBAN_STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => onSetStatus(s)}
              aria-pressed={s === status}
              className="sb-pill rounded-lg px-2.5 py-1 text-[12px] transition-colors"
            >
              {s}
            </button>
          ))}
        </div>

        <div className="mt-5 min-h-16">
          {blocks === null && <p className="text-ink-faint text-[12px]">Loading content…</p>}
          {blocks?.length === 0 && (
            <div className="border-hairline rounded-xl border border-dashed px-3 py-5 text-center">
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

const GROUP_TABS: { id: GroupBy; label: string; icon: typeof SquareKanban }[] = [
  { id: 'status', label: 'By status', icon: SquareKanban },
  { id: 'project', label: 'By project', icon: Folder },
  { id: 'priority', label: 'By priority', icon: Flame },
];

const VIEWS: { id: ViewId; label: string; icon: typeof LayoutGrid }[] = [
  { id: 'all', label: 'All tasks', icon: LayoutGrid },
  { id: 'high', label: 'High priority', icon: Flame },
  { id: 'week', label: 'Due this week', icon: CalendarClock },
  { id: 'requests', label: 'Incoming requests', icon: Inbox },
];

const PRIORITY_KEYS = ['High', 'Medium', 'Low', NO_PRIORITY];

const SORTS: { id: SortKey; label: string }[] = [
  { id: 'board', label: 'Board order' },
  { id: 'due', label: 'Due date' },
  { id: 'priority', label: 'Priority' },
  { id: 'newest', label: 'Newest first' },
  { id: 'id', label: 'Task ID' },
];

const SOURCES: { id: string; label: string }[] = [
  { id: 'email', label: 'From email' },
  { id: 'web', label: 'From a website form' },
  { id: 'none', label: 'Added in Notion' },
];

const MENU_ITEM =
  'data-highlighted:bg-sunken text-ink flex cursor-default items-center gap-2 rounded-lg px-2 py-1.5 outline-none select-none';

/** A toolbar control that opens a small menu (Filter, Sort, Columns, Options). */
function ToolbarMenu({
  icon: Icon,
  label,
  badge,
  active,
  children,
}: {
  icon: typeof ListFilter;
  label: string;
  /** a count shown beside the label, e.g. active filters */
  badge?: number;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            'hover:text-ink data-[state=open]:text-ink data-[state=open]:bg-sunken/70 flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px] transition-colors outline-none',
            active ? 'text-ink' : 'text-ink-muted',
          )}
        >
          <Icon size={14} strokeWidth={1.75} />
          {label}
          {!!badge && (
            <span className="sb-chip !px-1.5 !text-[10px] !leading-4" data-tone="lavender">
              {badge}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          data-kanban-menu
          className="border-hairline bg-surface z-50 max-h-[70vh] min-w-52 overflow-y-auto rounded-xl border p-1 text-[12.5px] shadow-xl"
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu.Label className="text-ink-faint px-2 pt-2 pb-1 text-[11px]">
      {children}
    </DropdownMenu.Label>
  );
}

function MenuCheck({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <DropdownMenu.CheckboxItem
      checked={checked}
      onCheckedChange={onChange}
      // stay open so several boxes can be ticked in one go
      onSelect={(e) => e.preventDefault()}
      className={MENU_ITEM}
    >
      <span
        className={cn(
          'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
          checked
            ? 'border-[var(--color-violet)] bg-[var(--color-violet)] text-white'
            : 'border-hairline',
        )}
      >
        <DropdownMenu.ItemIndicator>
          <Check size={10} strokeWidth={3} />
        </DropdownMenu.ItemIndicator>
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate">{children}</span>
    </DropdownMenu.CheckboxItem>
  );
}

const toggle = (list: string[], v: string, on: boolean) =>
  on ? [...new Set([...list, v])] : list.filter((x) => x !== v);

export function KanbanView({ board, onBack }: { board: KanbanBoard | null; onBack: () => void }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Optimistic status moves, applied on top of the polled board until the
  // next fetch reflects them server-side. Reverted if the write fails.
  const [moves, setMoves] = useState<Record<string, string>>({});
  // Grouping, sort, hidden columns and card options persist across launches;
  // the view, search and filters are per visit.
  const [prefs, setPrefs] = useState<BoardPrefs>(DEFAULT_PREFS);
  useEffect(() => {
    let cancelled = false;
    void api.query('settings:get', { key: 'sprintBoardPrefs' }).then((v) => {
      if (!cancelled && v) setPrefs(readPrefs(v));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const updatePrefs = (patch: Partial<BoardPrefs>) =>
    setPrefs((p) => {
      const next = { ...p, ...patch };
      void api.command('settings:set', { key: 'sprintBoardPrefs', value: next });
      return next;
    });
  const { groupBy, railOpen } = prefs;
  const [filters, setFilters] = useState<BoardFilters>(NO_FILTERS);
  const [view, setView] = useState<ViewId>('all');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [now] = useState(() => Date.now());

  const effective = useMemo(() => (c: KanbanCard) => moves[c.id] ?? c.status, [moves]);
  const everyCard = useMemo(() => (board?.columns ?? []).flatMap((c) => c.cards), [board]);
  const projectNames = useMemo(
    () => [...new Set(everyCard.flatMap((c) => c.projects))].sort((a, b) => a.localeCompare(b)),
    [everyCard],
  );

  const liveCards = useMemo(
    () =>
      everyCard.filter((c) =>
        KANBAN_COLUMNS.includes(effective(c) as (typeof KANBAN_COLUMNS)[number]),
      ),
    [everyCard, effective],
  );
  const toneOf = (key: string): Tone =>
    groupBy === 'status'
      ? (STATUS_TONE[key] ?? 'neutral')
      : groupBy === 'priority'
        ? (PRIORITY_TONE[key] ?? 'neutral')
        : key === NO_PROJECT
          ? 'neutral'
          : hashTone(key);
  // Every column the grouping offers (for the Columns menu), then the ones
  // actually shown: minus hidden ones, minus empty ones when asked.
  const allColumns = useMemo(() => {
    const cards = liveCards
      .filter((c) => matchesView(c, view, now))
      .filter((c) => matchesFilters(c, filters))
      .filter((c) => matchesQuery(c, query));
    return buildColumns(sortCards(cards, prefs.sort), groupBy, effective, liveCards);
  }, [liveCards, effective, view, now, filters, query, groupBy, prefs.sort]);
  const columns = useMemo(() => {
    const hidden = prefs.hidden[groupBy];
    return allColumns.filter(
      (c) => !hidden.includes(c.key) && !(prefs.hideEmpty && c.cards.length === 0),
    );
  }, [allColumns, prefs.hidden, prefs.hideEmpty, groupBy]);

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
      // an open toolbar menu owns its arrows, Enter and Esc
      if (t?.closest('[role="menu"]') || document.querySelector('[data-kanban-menu]')) return;
      const sidebarNav = document.querySelector('nav[aria-label="Mailboxes"]');
      const sidebarActive =
        sidebarNav instanceof HTMLElement &&
        (sidebarNav.matches(':hover') || sidebarNav.contains(document.activeElement));
      if (e.key === 'Escape') {
        if (sidebarActive) return; // the drawer's own Esc closes it first
        if (assistantOwnsEscape()) return; // the assistant's own Esc closes it first
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
  const selected = everyCard.find((c) => c.id === selectedId) ?? null;
  const counts = useMemo(() => {
    const live = liveCards;
    const out: Record<string, number> = {};
    for (const v of VIEWS) out[v.id] = live.filter((c) => matchesView(c, v.id, now)).length;
    for (const p of projectNames)
      out[`project:${p}`] = live.filter((c) => c.projects.includes(p)).length;
    return out;
  }, [liveCards, now, projectNames]);

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
    <div data-kanban-view className="sb-canvas relative flex h-full min-h-0 flex-col">
      {/* header band: Turnout's terrain ridge runs behind the title and
          tabs; its own edge fade keeps the board line clean */}
      <div className="relative min-h-[250px] shrink-0 overflow-hidden">
        <TerrainField className="pointer-events-none absolute inset-0 h-full w-full" />
        {/* title bar: home + search on the left, Notion actions on the right */}
        <header className="relative flex shrink-0 items-center gap-3 px-6 pt-5">
          <button
            onClick={onBack}
            title="Back to Home (Esc)"
            aria-label="Back to Home"
            className="text-ink-muted hover:text-ink flex items-center gap-0.5 rounded-lg p-1"
          >
            <Home size={17} strokeWidth={1.75} />
            <ChevronDown size={13} strokeWidth={1.75} />
          </button>
          <button
            onClick={() => setSearchOpen(true)}
            aria-label="Search tasks"
            className="text-ink-muted hover:text-ink rounded-lg p-1"
          >
            <Search size={16} strokeWidth={1.75} />
          </button>
          <h1 className="text-ink ml-2 text-[19px] font-semibold tracking-tight">Sprint board</h1>
          <span className="flex-1" />
          <button
            onClick={() => useKanban.getState().refresh()}
            className="text-ink-muted hover:text-ink flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px]"
          >
            <RefreshCw size={14} strokeWidth={1.75} />
            Refresh
          </button>
          <a
            href="https://www.notion.so"
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink-muted hover:text-ink flex items-center gap-1.5 rounded-lg px-2 py-1 text-[12.5px]"
          >
            <ExternalLink size={14} strokeWidth={1.75} />
            Open in Notion
          </a>
        </header>

        {/* grouping tabs: soft outlined pills, the active one tinted */}
        <div
          role="tablist"
          aria-label="Group tasks"
          className="relative flex shrink-0 gap-2 px-6 pt-5 pb-4"
        >
          {GROUP_TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={groupBy === t.id}
              onClick={() => {
                updatePrefs({ groupBy: t.id });
                setFocus(null);
              }}
              className="sb-pill flex items-center gap-2 rounded-xl px-3.5 py-1.5 text-[13px] transition-colors"
            >
              <t.icon size={15} strokeWidth={1.75} />
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="border-hairline relative flex min-h-0 flex-1 border-t">
        {/* view rail */}
        {railOpen && (
          <nav
            aria-label="Board views"
            className="no-scrollbar w-56 shrink-0 overflow-y-auto px-3 py-4"
          >
            {VIEWS.map((v) => (
              <button
                key={v.id}
                aria-current={view === v.id}
                onClick={() => {
                  setView(v.id);
                  setFocus(null);
                }}
                className="sb-view text-ink-muted hover:text-ink flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors"
              >
                <v.icon size={15} strokeWidth={1.75} />
                <span className="flex-1 truncate text-left">{v.label}</span>
                <span className="text-ink-faint text-[11px] tabular-nums">{counts[v.id] ?? 0}</span>
              </button>
            ))}
            {projectNames.length > 0 && (
              <>
                <p className="text-ink-faint mt-5 mb-1 px-2.5 text-[11px]">Projects</p>
                {projectNames.map((p) => {
                  const id = `project:${p}` as ViewId;
                  return (
                    <button
                      key={p}
                      aria-current={view === id}
                      onClick={() => {
                        setView(id);
                        setFocus(null);
                      }}
                      className="sb-view text-ink-muted hover:text-ink flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors"
                    >
                      <span
                        className="sb-dot h-2 w-2 shrink-0 rounded-full"
                        data-tone={hashTone(p)}
                      />
                      <span className="flex-1 truncate text-left">{p}</span>
                      <span className="text-ink-faint text-[11px] tabular-nums">
                        {counts[id] ?? 0}
                      </span>
                    </button>
                  );
                })}
              </>
            )}
          </nav>
        )}

        <main
          className={cn(
            'flex min-h-0 min-w-0 flex-1 flex-col',
            railOpen && 'border-hairline border-l',
          )}
        >
          {/* toolbar */}
          <div className="flex shrink-0 items-center gap-1 px-4 py-2.5">
            <button
              onClick={() => updatePrefs({ railOpen: !railOpen })}
              aria-label={railOpen ? 'Hide views' : 'Show views'}
              className="text-ink-muted hover:text-ink rounded-lg p-1"
            >
              {railOpen ? (
                <PanelLeftClose size={16} strokeWidth={1.75} />
              ) : (
                <PanelLeftOpen size={16} strokeWidth={1.75} />
              )}
            </button>
            <span className="text-ink-faint ml-2 text-[12px] tabular-nums">
              {allCards.length} {allCards.length === 1 ? 'task' : 'tasks'}
            </span>
            <span className="flex-1" />
            <ToolbarMenu
              icon={ListFilter}
              label="Filter"
              badge={filterCount(filters)}
              active={filterCount(filters) > 0}
            >
              <MenuLabel>Priority</MenuLabel>
              {[...PRIORITY_KEYS].map((p) => (
                <MenuCheck
                  key={p}
                  checked={filters.priority.includes(p)}
                  onChange={(on) =>
                    setFilters((f) => ({ ...f, priority: toggle(f.priority, p, on) }))
                  }
                >
                  <Chip tone={PRIORITY_TONE[p] ?? 'neutral'}>{p}</Chip>
                </MenuCheck>
              ))}
              {projectNames.length > 0 && <MenuLabel>Project</MenuLabel>}
              {[...projectNames, NO_PROJECT].map((p) => (
                <MenuCheck
                  key={p}
                  checked={filters.projects.includes(p)}
                  onChange={(on) =>
                    setFilters((f) => ({ ...f, projects: toggle(f.projects, p, on) }))
                  }
                >
                  <Chip tone={p === NO_PROJECT ? 'neutral' : hashTone(p)}>{p}</Chip>
                </MenuCheck>
              ))}
              <MenuLabel>Came in</MenuLabel>
              {SOURCES.map((src) => (
                <MenuCheck
                  key={src.id}
                  checked={filters.sources.includes(src.id)}
                  onChange={(on) =>
                    setFilters((f) => ({ ...f, sources: toggle(f.sources, src.id, on) }))
                  }
                >
                  {src.label}
                </MenuCheck>
              ))}
              {filterCount(filters) > 0 && (
                <>
                  <DropdownMenu.Separator className="bg-hairline my-1 h-px" />
                  <DropdownMenu.Item className={MENU_ITEM} onSelect={() => setFilters(NO_FILTERS)}>
                    <X size={13} className="text-ink-faint" />
                    Clear filters
                  </DropdownMenu.Item>
                </>
              )}
            </ToolbarMenu>
            <ToolbarMenu icon={ArrowDownUp} label="Sort" active={prefs.sort !== 'board'}>
              <MenuLabel>Order cards by</MenuLabel>
              <DropdownMenu.RadioGroup
                value={prefs.sort}
                onValueChange={(v) => updatePrefs({ sort: v as SortKey })}
              >
                {SORTS.map((o) => (
                  <DropdownMenu.RadioItem key={o.id} value={o.id} className={MENU_ITEM}>
                    <span className="flex w-3.5 justify-center">
                      <DropdownMenu.ItemIndicator>
                        <Check size={13} className="text-[var(--color-violet)]" />
                      </DropdownMenu.ItemIndicator>
                    </span>
                    {o.label}
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
            </ToolbarMenu>
            <ToolbarMenu
              icon={Columns3}
              label="Columns"
              badge={prefs.hidden[groupBy].length}
              active={prefs.hidden[groupBy].length > 0 || prefs.hideEmpty}
            >
              <MenuLabel>Show columns</MenuLabel>
              {allColumns.map((c) => (
                <MenuCheck
                  key={c.key}
                  checked={!prefs.hidden[groupBy].includes(c.key)}
                  onChange={(on) => {
                    updatePrefs({
                      hidden: {
                        ...prefs.hidden,
                        [groupBy]: toggle(prefs.hidden[groupBy], c.key, !on),
                      },
                    });
                    setFocus(null);
                  }}
                >
                  <Chip tone={toneOf(c.key)}>{c.key}</Chip>
                  <span className="text-ink-faint ml-auto text-[11px] tabular-nums">
                    {c.cards.length}
                  </span>
                </MenuCheck>
              ))}
              <DropdownMenu.Separator className="bg-hairline my-1 h-px" />
              <MenuCheck
                checked={prefs.hideEmpty}
                onChange={(on) => {
                  updatePrefs({ hideEmpty: on });
                  setFocus(null);
                }}
              >
                Hide empty columns
              </MenuCheck>
            </ToolbarMenu>
            <ToolbarMenu icon={SlidersHorizontal} label="Options">
              <MenuLabel>Cards</MenuLabel>
              <MenuCheck checked={prefs.compact} onChange={(on) => updatePrefs({ compact: on })}>
                Compact cards
              </MenuCheck>
              <MenuCheck checked={prefs.showIds} onChange={(on) => updatePrefs({ showIds: on })}>
                Show task IDs
              </MenuCheck>
              <MenuLabel>Layout</MenuLabel>
              <MenuCheck checked={railOpen} onChange={(on) => updatePrefs({ railOpen: on })}>
                Show views sidebar
              </MenuCheck>
              <DropdownMenu.Separator className="bg-hairline my-1 h-px" />
              <DropdownMenu.Item
                className={MENU_ITEM}
                onSelect={() => {
                  setPrefs(DEFAULT_PREFS);
                  void api.command('settings:set', {
                    key: 'sprintBoardPrefs',
                    value: DEFAULT_PREFS,
                  });
                  setFilters(NO_FILTERS);
                  setFocus(null);
                }}
              >
                <RotateCcw size={13} className="text-ink-faint" />
                Reset board layout
              </DropdownMenu.Item>
            </ToolbarMenu>
            {searchOpen ? (
              <div className="border-hairline bg-surface ml-1 flex items-center gap-1.5 rounded-lg border px-2 py-1">
                <Search size={13} className="text-ink-faint" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      e.stopPropagation();
                      setQuery('');
                      setSearchOpen(false);
                    }
                  }}
                  placeholder="Search tasks"
                  className="text-ink placeholder:text-ink-faint w-40 bg-transparent text-[12.5px] outline-none"
                />
              </div>
            ) : (
              <button
                onClick={() => setSearchOpen(true)}
                aria-label="Search tasks"
                className="bg-sunken/70 text-ink-muted hover:text-ink ml-1 rounded-lg p-1.5"
              >
                <Search size={15} strokeWidth={1.75} />
              </button>
            )}
          </div>

          {!board ? (
            <p className="text-ink-faint px-6 pt-4 text-[12.5px]">Loading board…</p>
          ) : (
            <div className="no-scrollbar min-h-0 flex-1 overflow-x-auto">
              <div className="flex h-full">
                {columns.map((col, ci) => (
                  <section
                    key={col.key}
                    className="border-hairline flex min-w-56 flex-1 basis-0 flex-col border-r last:border-r-0"
                  >
                    {/* column header reads like a table header cell */}
                    <div className="border-hairline flex items-center gap-2 border-y px-3 py-2">
                      <Chip tone={toneOf(col.key)}>{col.key}</Chip>
                      <span className="text-ink-faint text-[11.5px] tabular-nums">
                        {col.cards.length}
                      </span>
                      <span className="flex-1" />
                      <ChevronDown size={13} className="text-ink-faint" />
                    </div>
                    <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5">
                      {col.cards.map((card, ri) => (
                        <Card
                          key={card.id}
                          card={card}
                          status={effective(card)}
                          now={now}
                          hideStatus={groupBy === 'status'}
                          compact={prefs.compact}
                          showIds={prefs.showIds}
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
                        <p className="text-ink-faint px-1.5 py-4 text-center text-[11.5px]">
                          No tasks
                        </p>
                      )}
                    </div>
                  </section>
                ))}
              </div>
            </div>
          )}
        </main>
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
