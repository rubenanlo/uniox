import { Users, X } from 'lucide-react';
import { useCalendar } from '../../state/calendar';
import { CalendarList, NotionCalendarRow } from './CalendarSidebar';

/**
 * P: the sidebar's people/accounts calendars as a modal, so they're one key
 * away while the panes are tucked (Agenda). Esc and P are handled by
 * CalendarView's capture-phase key listener.
 */
export function CalendarsDialog({ onAddAccount }: { onAddAccount(): void }) {
  const open = useCalendar((s) => s.calendarsOpen);
  const setOpen = useCalendar((s) => s.setCalendarsOpen);
  if (!open) return null;
  const close = () => setOpen(false);

  return (
    <div
      className="no-drag pointer-events-auto absolute inset-0 z-50 flex items-start justify-center bg-black/30 pt-[12vh]"
      onMouseDown={close}
    >
      <div
        role="dialog"
        aria-label="Calendars"
        onMouseDown={(e) => e.stopPropagation()}
        className="border-hairline bg-surface flex max-h-[72vh] w-[420px] max-w-[92vw] flex-col rounded-2xl border shadow-2xl"
      >
        <div className="flex items-center gap-2 px-5 pt-4 pb-3">
          <Users size={15} className="text-accent" />
          <h2 className="flex-1 text-[13.5px] font-bold">Calendars</h2>
          <kbd className="bg-sunken text-ink-muted rounded-md px-1.5 py-0.5 font-mono text-[10.5px]">
            P
          </kbd>
          <button
            onClick={close}
            aria-label="Close calendars"
            className="text-ink-muted hover:text-ink -mr-2 flex h-7 w-7 items-center justify-center rounded-lg"
          >
            <X size={14} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          <CalendarList
            onAddAccount={() => {
              close();
              onAddAccount();
            }}
          />
        </div>
        <NotionCalendarRow className="border-hairline border-t px-3 py-3" />
      </div>
    </div>
  );
}
