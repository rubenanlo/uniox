import { ChevronDown, ChevronLeft, ChevronRight, PanelRight } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { rangeForView, viewTitle, type CalView } from '../../lib/calendarMonth';
import { cn } from '../../lib/utils';
import { assistantOwnsEscape } from '../../state/assistant';
import { newDraft, useCalendar } from '../../state/calendar';
import { useUi } from '../../state/store';
import { CalendarSidebar } from './CalendarSidebar';
import { MonthView } from './MonthView';
import { RightPane } from './RightPane';
import { TimeGrid } from './TimeGrid';

const VIEWS: { id: CalView; label: string }[] = [
  { id: 'month', label: 'Month' },
  { id: 'week', label: 'Week' },
  { id: 'day', label: 'Day' },
];

function inEditable(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return (
    !!t &&
    (t.tagName === 'INPUT' ||
      t.tagName === 'TEXTAREA' ||
      t.tagName === 'SELECT' ||
      t.isContentEditable)
  );
}

/** Focus a native select and pop its option list (Chromium's showPicker). */
function openSelect(select: HTMLSelectElement) {
  select.focus();
  try {
    select.showPicker();
  } catch {
    // No user activation or unsupported: focus alone still lets ↑/↓ change it.
  }
}

export function CalendarView({ onAddAccount }: { onAddAccount(): void }) {
  const s = useCalendar();
  const { view, anchor } = s;

  // Capture-phase so calendar keys win over KeymapProvider's bubble listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().view !== 'calendar') return;
      if (e.key === 'Escape' && assistantOwnsEscape()) return; // it closes the assistant first
      const st = useCalendar.getState();
      const meta = e.metaKey || e.ctrlKey;
      const stop = () => {
        e.preventDefault();
        e.stopPropagation();
      };

      if (meta && e.key === '\\') {
        stop();
        st.toggleSidebar();
        return;
      }
      if (meta && e.key === '/') {
        stop();
        st.toggleRightPane();
        return;
      }
      // ⌥↓ opens the event form's Account dropdown from anywhere in the form.
      if (e.altKey && !meta && e.key === 'ArrowDown') {
        const select = document.querySelector<HTMLSelectElement>('select[data-account-select]');
        if (select) {
          stop();
          openSelect(select);
        }
        return;
      }
      if (meta || e.altKey || inEditable(e)) return;
      // The revealed mail rail owns its keys (arrows walk it, Esc tucks it
      // away), just like on Home — don't swallow them here.
      if ((e.target as HTMLElement | null)?.closest?.('nav[aria-label="Mailboxes"]')) return;

      switch (e.key) {
        case 't':
          stop();
          st.goToday();
          return;
        case 'c':
          stop();
          st.openForm(newDraft(st.cursor, st.calendars));
          return;
        case 'm':
          stop();
          st.setView('month');
          return;
        case 'w':
          stop();
          st.setView('week');
          return;
        case 'd':
          stop();
          st.setView('day');
          return;
        case 'Enter':
          if ((e.target as HTMLElement | null)?.closest?.('button, a, input')) return;
          stop();
          st.openForm(newDraft(st.cursor, st.calendars));
          return;
        case 'ArrowRight':
          stop();
          st.moveCursorBy(1);
          return;
        case 'ArrowLeft':
          // Mirrors →: steps back a day and pages into past weeks/months. The
          // mail rail stays reachable with / (never ← here, which used to
          // reveal it at the range's left edge and block going back).
          stop();
          st.moveCursorBy(-1);
          return;
        case 'ArrowDown':
        case 'ArrowUp': {
          stop();
          const dir = e.key === 'ArrowDown' ? 1 : -1;
          if (st.view === 'month') st.moveCursorBy(dir * 7);
          // Week/Day: arrows scroll the time grid by one hour step (spec §1).
          else document.querySelector('[data-timegrid]')?.scrollBy({ top: dir * 48 });
          return;
        }
        case 'Escape':
          // stopImmediatePropagation: the Sidebar drawer also listens
          // capture-phase on window; stopPropagation alone wouldn't stop a
          // same-target sibling, and one Esc must do exactly one thing.
          e.preventDefault();
          e.stopImmediatePropagation();
          if (st.rightPane.kind !== 'shortcuts') {
            st.closePane();
            return;
          }
          useUi.getState().setView('home');
          return;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => {
    s.refresh();
    void s.loadCalendars();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const days = useMemo(() => rangeForView(view, anchor).days, [view, anchor]);

  return (
    <div className="flex h-full min-w-0 flex-1 py-10">
      <CalendarSidebar onAddAccount={onAddAccount} />
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* With the TopBar hidden, this header is the window-drag surface; when
            the calendar sidebar is collapsed it also clears the macOS traffic
            lights (same 84px inset the TopBar uses). */}
        <header className={cn('titlebar-drag flex items-center gap-2 px-5 pt-4 pb-3')}>
          <h1 className="text-ink text-[19px] font-bold tracking-tight">{viewTitle(anchor)}</h1>
          <div className="ml-auto flex items-center gap-1.5">
            <div className="border-hairline relative flex h-8 items-center rounded-lg border">
              <select
                value={view}
                onChange={(e) => s.setView(e.target.value as CalView)}
                aria-label="Calendar view"
                className="text-ink h-full appearance-none bg-transparent pr-7 pl-3 text-[12.5px] font-medium outline-none"
              >
                {VIEWS.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={13}
                className="text-ink-faint pointer-events-none absolute right-2"
              />
            </div>
            <button
              onClick={s.goToday}
              className="border-hairline text-ink-muted hover:bg-sunken hover:text-ink h-8 rounded-lg border px-3 text-[12.5px] font-medium"
            >
              Today
            </button>
            <button
              onClick={() => s.page(-1)}
              aria-label="Previous"
              className="text-ink-muted hover:bg-sunken hover:text-ink flex h-8 w-8 items-center justify-center rounded-lg"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => s.page(1)}
              aria-label="Next"
              className="text-ink-muted hover:bg-sunken hover:text-ink flex h-8 w-8 items-center justify-center rounded-lg"
            >
              <ChevronRight size={16} />
            </button>
            <button
              onClick={s.toggleRightPane}
              aria-label="Toggle side panel"
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg',
                s.rightPaneOpen ? 'text-ink' : 'text-ink-muted hover:text-ink',
              )}
            >
              <PanelRight size={15} />
            </button>
          </div>
        </header>
        {view === 'month' ? <MonthView /> : <TimeGrid days={days} />}
      </div>
      <RightPane />
    </div>
  );
}
