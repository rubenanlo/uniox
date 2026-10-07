import {
  LayoutList,
  List,
  PanelRightOpen,
  Rows2,
  Rows3,
  Rows4,
  Search,
  Settings2,
  Sparkles,
  SquarePen,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ACTIONS, keysFor, moveSelection } from '../actions/registry';
import { api } from '../lib/api';
import { NO_RECENT, nextRecentIndex } from '../lib/searchNav';
import { cn } from '../lib/utils';
import { useUi, type ListDensity, type ListLayout } from '../state/store';
import { Tip } from './ui/Tip';
import { useShallow } from 'zustand/react/shallow';

const VIEW_TITLES: Record<string, string> = {
  inbox: 'Inbox',
  pinned: 'Pinned',
  snoozed: 'Snoozed',
  set_aside: 'Set Aside',
  archive: 'Done',
  outbox: 'Outbox',
  sent: 'Sent',
  drafts: 'Drafts',
  spam: 'Spam',
  trash: 'Trash',
};

const LAYOUTS: { id: ListLayout; icon: typeof List; label: string }[] = [
  { id: 'focused', icon: Rows3, label: 'Focused List' },
  { id: 'cards', icon: LayoutList, label: 'Unread Cards' },
  { id: 'simple', icon: List, label: 'Simple List' },
];

const DENSITIES: { id: ListDensity; icon: typeof List; label: string }[] = [
  { id: 'compressed', icon: Rows4, label: 'Compressed — flush rows' },
  { id: 'expanded', icon: Rows2, label: 'Expanded — space between emails' },
];

/** Spark-style search assist: operator chips and recent searches. */
const SEARCH_TOKENS: { token: string; label: string; hint: string }[] = [
  { token: 'from:', label: 'From', hint: 'sender' },
  { token: 'to:', label: 'To', hint: 'recipient' },
  { token: 'subject:', label: 'Subject', hint: 'subject line' },
  { token: 'has:attachment', label: 'Attachment', hint: 'with files' },
];

function SearchPanel({
  open,
  query,
  recents,
  activeRecent,
  onHoverRecent,
  onPickRecent,
  onInsertToken,
}: {
  open: boolean;
  query: string;
  recents: string[];
  /** Index the arrow keys are sitting on, or NO_RECENT. */
  activeRecent: number;
  onHoverRecent: (index: number) => void;
  onPickRecent: (q: string) => void;
  onInsertToken: (token: string) => void;
}) {
  // Always mounted so both directions transition; `inert` keeps the hidden
  // panel out of the tab order and off the accessibility tree.
  return (
    <div
      inert={!open}
      className={cn(
        'border-hairline bg-surface absolute top-full right-0 left-0 z-50 mt-1.5 rounded-xl border p-2 shadow-lg',
        'origin-top transition duration-150 ease-out',
        open
          ? 'translate-y-0 scale-100 opacity-100'
          : 'pointer-events-none -translate-y-1 scale-[0.98] opacity-0',
      )}
    >
      <div className="flex flex-wrap gap-1.5">
        {SEARCH_TOKENS.map((t) => (
          <button
            key={t.token}
            // onMouseDown so the click wins the race against the input's blur
            onMouseDown={(e) => {
              e.preventDefault();
              onInsertToken(t.token);
            }}
            title={`Filter by ${t.hint}`}
            className="border-hairline bg-sunken text-ink-muted hover:text-ink rounded-lg border px-2 py-1 text-[11px] font-semibold"
          >
            {t.label}
          </button>
        ))}
      </div>
      {!query.trim() && recents.length > 0 && (
        <div className="mt-2" id="search-recents" role="listbox" aria-label="Recent searches">
          <p className="text-ink-faint px-1 pb-0.5 font-mono text-[9.5px] font-semibold tracking-[0.14em] uppercase">
            Recent
          </p>
          {recents.map((r, i) => (
            <button
              key={r}
              id={`recent-${i}`}
              role="option"
              aria-selected={i === activeRecent}
              // Hovering moves the highlight so mouse and keyboard agree.
              onMouseEnter={() => onHoverRecent(i)}
              onMouseDown={(e) => {
                e.preventDefault();
                onPickRecent(r);
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-[12px]',
                i === activeRecent ? 'bg-sunken text-ink' : 'text-ink-muted hover:text-ink',
              )}
            >
              <Search size={11} className="text-ink-faint shrink-0" />
              <span className="truncate">{r}</span>
            </button>
          ))}
        </div>
      )}
      <p className="text-ink-faint mt-2 px-1 text-[10.5px]">
        Searches subject, sender, and message text across all mail
      </p>
    </div>
  );
}

function Separator() {
  return (
    <svg aria-hidden viewBox="0 0 1 20" className="text-hairline shrink-0" width="1" height="20">
      <rect width="1" height="20" fill="currentColor" />
    </svg>
  );
}

export function TopBar() {
  const {
    view,
    searchQuery,
    setSearchQuery,
    searchFocusTick,
    listLayout,
    setListLayout,
    density,
    setDensity,
    toggleSplit,
    split,
    smartInbox,
    toggleSmartInbox,
    setSettingsOpen,
  } = useUi(
    useShallow((s) => ({
      view: s.view,
      searchQuery: s.searchQuery,
      setSearchQuery: s.setSearchQuery,
      searchFocusTick: s.searchFocusTick,
      listLayout: s.listLayout,
      setListLayout: s.setListLayout,
      density: s.density,
      setDensity: s.setDensity,
      toggleSplit: s.toggleSplit,
      split: s.split,
      smartInbox: s.smartInbox,
      toggleSmartInbox: s.toggleSmartInbox,
      setSettingsOpen: s.setSettingsOpen,
    })),
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchFocused, setSearchFocused] = useState(false);
  // Open on focus, gone the moment there is something to search for.
  const panelOpen = searchFocused && !searchQuery.trim();
  // Which recent the arrows are sitting on; NO_RECENT = the caret owns the box.
  const [activeRecent, setActiveRecent] = useState(NO_RECENT);
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    void api.query('settings:get', { key: 'recentSearches' }).then((v) => {
      if (Array.isArray(v)) setRecents(v.filter((r): r is string => typeof r === 'string'));
    });
  }, []);
  const saveRecent = (q: string) => {
    const t = q.trim();
    if (!t) return;
    const next = [t, ...recents.filter((r) => r !== t)].slice(0, 6);
    setRecents(next);
    void api.command('settings:set', { key: 'recentSearches', value: next });
  };

  useEffect(() => {
    if (searchFocusTick > 0) searchRef.current?.focus();
  }, [searchFocusTick]);

  // clear the macOS traffic lights (x:16 + ~52px button group + gap)
  const isMac = navigator.platform.startsWith('Mac');

  return (
    <header
      className={cn(
        'titlebar-drag border-hairline flex h-11 shrink-0 items-center gap-2 border-b pr-3 justify-between',
        isMac ? 'pl-[84px]' : 'pl-3',
      )}
    >
      <div
        className="relative mx-2 max-w-md"
        onFocusCapture={() => setSearchFocused(true)}
        onBlurCapture={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setSearchFocused(false);
            setActiveRecent(NO_RECENT);
          }
        }}
      >
        <Search
          size={13}
          className="text-ink-faint pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2"
        />
        <input
          ref={searchRef}
          value={searchQuery}
          onChange={(e) => {
            // Typing dismisses the recents, so the highlight goes with them.
            setActiveRecent(NO_RECENT);
            setSearchQuery(e.target.value);
          }}
          onKeyDown={(e) => {
            const browsingRecents = panelOpen && recents.length > 0;
            if (e.key === 'Escape') {
              // Step out of the recents first, then clear the box.
              if (activeRecent !== NO_RECENT) {
                e.preventDefault();
                setActiveRecent(NO_RECENT);
                return;
              }
              setSearchQuery('');
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === 'Enter') {
              // A highlighted recent runs instead of the (empty) box.
              if (browsingRecents && activeRecent !== NO_RECENT) {
                e.preventDefault();
                const picked = recents[activeRecent]!;
                setActiveRecent(NO_RECENT);
                setSearchQuery(picked);
                saveRecent(picked);
                (e.target as HTMLInputElement).blur();
                return;
              }
              saveRecent(searchQuery);
              // Commit the search: drop focus so the assist panel closes;
              // the query stays applied to the list.
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              // With recents on screen the arrows walk them; otherwise
              // ArrowDown hands off to the results as before.
              if (browsingRecents) {
                e.preventDefault();
                setActiveRecent(nextRecentIndex(e.key, activeRecent, recents.length));
                return;
              }
              if (e.key !== 'ArrowDown') return;
              e.preventDefault();
              saveRecent(searchQuery);
              (e.target as HTMLInputElement).blur();
              useUi.getState().selectThread(null, true);
              moveSelection(1);
            }
          }}
          placeholder="Search  ⌘F"
          aria-label="Search mail"
          role="combobox"
          aria-expanded={panelOpen && recents.length > 0}
          aria-controls="search-recents"
          aria-activedescendant={activeRecent === NO_RECENT ? undefined : `recent-${activeRecent}`}
          className={cn(
            'bg-transparent placeholder:text-ink-faint h-7 w-full rounded-lg pr-7 pl-7 text-[12.5px]',
            'focus:bg-surface focus:ring-accent border border-transparent focus:ring-[0.5px] focus:outline-none',
          )}
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            aria-label="Clear search"
            className="text-ink-muted hover:text-ink absolute top-1/2 right-2 -translate-y-1/2"
          >
            <X size={13} />
          </button>
        )}
        {/* The panel sits over the top of the result list, so it steps aside
            as soon as there is a query to show results for. */}
        <SearchPanel
          open={panelOpen}
          query={searchQuery}
          recents={recents}
          activeRecent={activeRecent}
          onHoverRecent={setActiveRecent}
          onPickRecent={(q) => {
            setActiveRecent(NO_RECENT);
            setSearchQuery(q);
            searchRef.current?.focus();
          }}
          onInsertToken={(token) => {
            setSearchQuery(searchQuery ? `${searchQuery.trimEnd()} ${token}` : token);
            searchRef.current?.focus();
          }}
        />
      </div>

      <div className="flex items-center gap-x-5">
        <h1 className="text-[13px] font-bold tracking-tight">{VIEW_TITLES[view] ?? 'Uniox'}</h1>

        <Separator />

        {view === 'inbox' && (
          <button
            onClick={toggleSmartInbox}
            title={
              smartInbox
                ? 'Smart Inbox groups newsletters, promotions, and notifications — switch to Classic (chronological)'
                : 'Classic (chronological) — switch to Smart Inbox grouping'
            }
            aria-pressed={smartInbox}
            className={cn(
              'flex items-center gap-1 rounded-lg px-2 py-1 text-[11.5px] font-semibold',
              smartInbox ? 'bg-accent-soft text-accent' : 'bg-sunken text-ink-muted hover:text-ink',
            )}
          >
            <Sparkles size={13} />
            Smart
          </button>
        )}
        <div
          className="bg-sunken flex items-center rounded-lg p-0.5"
          role="group"
          aria-label="List layout"
        >
          {LAYOUTS.map(({ id, icon: Icon, label }) => (
            <Tip key={id} label={label} keys={keysFor(`layout-${id}`)}>
              <button
                onClick={() => setListLayout(id)}
                aria-pressed={listLayout === id}
                className={cn(
                  'rounded-md px-2 py-1',
                  listLayout === id
                    ? 'bg-surface text-ink shadow-sm'
                    : 'text-ink-muted hover:text-ink',
                )}
              >
                <Icon size={14} />
              </button>
            </Tip>
          ))}
        </div>
        <div
          className="bg-sunken flex items-center rounded-lg p-0.5"
          role="group"
          aria-label="List density"
        >
          {DENSITIES.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setDensity(id)}
              title={label}
              aria-pressed={density === id}
              className={cn(
                'rounded-md px-2 py-1',
                density === id ? 'bg-surface text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
              )}
            >
              <Icon size={14} />
            </button>
          ))}
        </div>
        <Separator />

        <div className="flex items-center gap-x-2">
          <Tip label="Toggle Split View" keys={keysFor('toggle-split')}>
            <button
              onClick={toggleSplit}
              aria-pressed={split}
              className={cn(
                'rounded-md px-2 py-1',
                split ? 'text-accent' : 'text-ink-muted hover:text-ink',
              )}
            >
              <PanelRightOpen size={15} />
            </button>
          </Tip>

          <Tip label="Settings" keys={keysFor('open-settings')}>
            <button
              onClick={() => setSettingsOpen(true)}
              className="rounded-md px-2 py-1 text-ink-muted hover:text-ink"
            >
              <Settings2 size={15} strokeWidth={2.2} />
            </button>
          </Tip>
        </div>
      </div>
      <Tip label="New email" keys={keysFor('compose')} align="end">
        <button
          onClick={() => ACTIONS.find((a) => a.id === 'compose')?.perform(null)}
          className="bg-accent flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold text-white hover:opacity-90"
        >
          <SquarePen size={13} />
          Compose
        </button>
      </Tip>
    </header>
  );
}
