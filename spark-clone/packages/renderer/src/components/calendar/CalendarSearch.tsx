import { Loader2, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CalendarEvent } from '@app/shared';
import { api } from '../../lib/api';
import { startOfDay } from '../../lib/calendarMonth';
import { eventMatches, mergeSearchResults, resultWhen, searchWords } from '../../lib/calendarSearch';
import { cn } from '../../lib/utils';
import { useCalendar } from '../../state/calendar';
import { useUi } from '../../state/store';
import { useNotionEvents, useNotionVisible } from './useNotionEvents';

const HOUR_PX = 48; // TimeGrid's hour height

/**
 * ⌘F in the calendar: find any event, past or future. Stored events answer
 * as you type; Google is asked (debounced) for the years outside the synced
 * window. Picking a result jumps the grid to its day and opens its details.
 */
export function CalendarSearch() {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().view !== 'calendar' || useUi.getState().composer) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        e.stopImmediatePropagation(); // not the mail search behind the calendar
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  return open ? <SearchDialog close={close} /> : null;
}

function SearchDialog({ close }: { close(): void }) {
  const [query, setQuery] = useState('');
  const [local, setLocal] = useState<CalendarEvent[]>([]);
  // Google's hits with the query they answer; `q` also matches attendees, so
  // they can't be re-filtered locally as the query changes.
  const [remote, setRemote] = useState<{ q: string; events: CalendarEvent[] }>({
    q: '',
    events: [],
  });
  const [active, setActive] = useState(0);
  const [now] = useState(() => Date.now());
  const listRef = useRef<HTMLDivElement>(null);
  const calendars = useCalendar((s) => s.calendars);
  const notion = useNotionEvents();
  const notionVisible = useNotionVisible((s) => s.visible);

  // Stored events: one indexed-table scan, cheap enough to run per keystroke
  // after a short pause. Google: a network round trip, so a longer pause.
  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let live = true;
    const t1 = setTimeout(() => {
      void api.query('calendar:search', { query: q }).then((r) => live && setLocal(r));
    }, 60);
    const t2 = setTimeout(() => {
      void api
        .query('calendar:search:remote', { query: q })
        .catch(() => [] as CalendarEvent[])
        .then((r) => live && setRemote({ q, events: r }));
    }, 400);
    return () => {
      live = false;
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [query]);

  const results = useMemo(() => {
    const words = searchWords(query);
    const notionHits = notionVisible ? notion.filter((e) => eventMatches(e, words)) : [];
    const remoteHits = remote.q === query.trim() ? remote.events : [];
    return mergeSearchResults([local, notionHits, remoteHits], now);
  }, [query, local, remote, notion, notionVisible, now]);
  const remoteBusy = !!query.trim() && remote.q !== query.trim();
  const flat = useMemo(() => [...results.upcoming, ...results.past], [results]);
  const remoteOnly = useMemo(() => {
    const stored = new Set(local.map((e) => e.id));
    return new Set(remote.events.filter((e) => !stored.has(e.id)).map((e) => e.id));
  }, [local, remote]);

  const pick = async (e: CalendarEvent) => {
    close();
    // An out-of-window Google hit isn't stored yet; keep it so its chip renders.
    if (remoteOnly.has(e.id)) await api.command('calendar:search:keep', { id: e.id });
    const st = useCalendar.getState();
    st.setCursor(startOfDay(e.startMs));
    st.openDetails(e);
    if (!e.allDay) {
      requestAnimationFrame(() => {
        const hours = (e.startMs - startOfDay(e.startMs)) / 3_600_000;
        document
          .querySelector('[data-timegrid]')
          ?.scrollTo({ top: Math.max(0, (hours - 1) * HOUR_PX), behavior: 'smooth' });
      });
    }
  };

  // Capture-phase so Esc/arrows/Enter act here before the calendar's own keys.
  const state = useRef({ flat, active, pick });
  useEffect(() => {
    state.current = { flat, active, pick };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const { flat, active, pick } = state.current;
      const own = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (e.key === 'Escape') {
        own();
        close();
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        own();
        if (!flat.length) return;
        const dir = e.key === 'ArrowDown' ? 1 : -1;
        setActive((active + dir + flat.length) % flat.length);
      } else if (e.key === 'Enter' && !e.isComposing) {
        own();
        const hit = flat[active];
        if (hit) void pick(hit);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [close]);

  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const colorOf = (e: CalendarEvent) =>
    e.color ?? calendars.find((c) => c.id === e.calendarId)?.color ?? 'var(--color-accent)';
  let index = 0;
  const section = (heading: string, events: CalendarEvent[]) =>
    events.length > 0 && (
      <div className="py-1">
        <div className="text-ink-faint px-2.5 pt-1.5 pb-1 font-mono text-[10px] font-semibold tracking-[0.14em] uppercase">
          {heading}
        </div>
        {events.map((e) => {
          const i = index++;
          return (
            <button
              key={e.id}
              data-index={i}
              onMouseMove={() => i !== active && setActive(i)}
              onClick={() => void pick(e)}
              className={cn(
                'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left',
                i === active ? 'bg-accent-soft' : '',
              )}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: colorOf(e) }}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    'block truncate text-[12.5px] font-medium',
                    i === active ? 'text-accent' : 'text-ink',
                  )}
                >
                  {e.title || '(No title)'}
                </span>
                {e.location && (
                  <span className="text-ink-faint block truncate text-[11px]">{e.location}</span>
                )}
              </span>
              <span className="text-ink-muted shrink-0 text-[11.5px] tabular-nums">
                {resultWhen(e, now)}
              </span>
            </button>
          );
        })}
      </div>
    );

  const q = query.trim();
  return (
    <div
      onMouseDown={close}
      className="no-drag fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]"
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Search events"
        className="border-hairline bg-surface w-[600px] max-w-[92vw] overflow-hidden rounded-2xl border shadow-2xl"
      >
        <div className="border-hairline flex items-center gap-2.5 border-b px-4">
          <Search size={15} className="text-ink-faint shrink-0" />
          <input
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            placeholder="Search events, past and upcoming…"
            aria-label="Search events"
            className="placeholder:text-ink-faint w-full bg-transparent py-3 text-[13.5px] focus:outline-none"
          />
          {remoteBusy && (
            <Loader2 size={14} className="text-ink-faint shrink-0 animate-spin" aria-label="Searching" />
          )}
        </div>
        {q && (
          <div ref={listRef} className="max-h-[52vh] overflow-y-auto p-1.5">
            {section('Upcoming', results.upcoming)}
            {section('Past', results.past)}
            {!flat.length && (
              <div className="text-ink-muted px-4 py-6 text-center text-[12.5px]">
                {remoteBusy ? 'Searching…' : 'No events found'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
