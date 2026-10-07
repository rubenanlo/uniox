import { ChevronDown, ChevronUp, Eye, EyeOff, Link2, Loader2, Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Address } from '@app/shared';
import {
  addMonths,
  isSameMonth,
  isToday,
  monthGrid,
  monthLabel,
  startOfDay,
  startOfMonth,
} from '../../lib/calendarMonth';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import { cn } from '../../lib/utils';
import { useCalendar } from '../../state/calendar';
import { useKanban } from '../../state/kanban';
import { useAccounts } from '../../state/queries';
import { useNotionVisible } from './useNotionEvents';

const MINI_DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function MiniMonth() {
  const cursor = useCalendar((s) => s.cursor);
  const setCursor = useCalendar((s) => s.setCursor);
  const [month, setMonth] = useState(() => startOfMonth(cursor));
  // Follow the cursor when it moves externally (t/today, arrow paging, header
  // chevrons), via the render-time "adjusting state" pattern rather than an
  // effect — avoids an extra render pass and satisfies the no-setState-in-effect
  // lint rule. Manual chevron paging inside the mini month still works between
  // cursor moves since this only fires when `cursor` itself changes.
  const [trackedCursor, setTrackedCursor] = useState(cursor);
  if (cursor !== trackedCursor) {
    setTrackedCursor(cursor);
    setMonth(startOfMonth(cursor));
  }
  const { days } = monthGrid(month);
  return (
    <div className="px-4 pt-4">
      <div className="mb-2 flex items-center justify-between gap-4">
        <p className="text-ink text-[12px] ml-2.5 font-semibold">{monthLabel(month)}</p>
        <div className="flex items-center mr-1">
          <button
            onClick={() => setMonth((m) => addMonths(m, -1))}
            aria-label="Previous month"
            className="text-ink-muted hover:text-ink flex h-6 w-6 items-center justify-center rounded"
          >
            <ChevronUp size={13} />
          </button>
          <button
            onClick={() => setMonth((m) => addMonths(m, 1))}
            aria-label="Next month"
            className="text-ink-muted hover:text-ink flex h-6 w-6 items-center justify-center rounded"
          >
            <ChevronDown size={13} />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {MINI_DAYS.map((d) => (
          <span key={d} className="text-ink-faint text-[10px] font-semibold">
            {d}
          </span>
        ))}
        {days.map((dayMs) => (
          <button
            key={dayMs}
            onClick={() => setCursor(dayMs)}
            className={cn(
              'mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[11px] tabular-nums',
              isToday(dayMs)
                ? 'bg-danger font-bold text-white'
                : startOfDay(dayMs) === cursor
                  ? 'bg-sunken text-ink font-semibold'
                  : isSameMonth(dayMs, month)
                    ? 'text-ink-muted hover:bg-sunken'
                    : 'text-ink-faint/50 hover:bg-sunken',
            )}
          >
            {new Date(dayMs).getDate()}
          </button>
        ))}
      </div>
    </div>
  );
}

function EyeToggle({ on, onClick, label }: { on: boolean; onClick(): void; label: string }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      className="text-ink-faint hover:text-ink ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded"
    >
      {on ? <Eye size={12} /> : <EyeOff size={12} />}
    </button>
  );
}

/** Unsubscribe control for a subscribed Google calendar (two-click confirm). */
function UnsubButton({ calendarId, name }: { calendarId: string; name: string }) {
  const unsubscribe = useCalendar((s) => s.unsubscribeCalendar);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const click = () => {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    void unsubscribe(calendarId).then((err) => {
      setBusy(false);
      setConfirm(false);
      if (err) toast(err);
      else toast(`Unsubscribed from ${name}`);
    });
  };

  return (
    <button
      onClick={click}
      onBlur={() => setConfirm(false)}
      disabled={busy}
      aria-label={`Unsubscribe from ${name}`}
      title="Unsubscribe (removes from your Google account)"
      className={cn(
        'shrink-0 rounded text-[10.5px]',
        confirm ? 'text-danger px-1 font-semibold' : 'text-ink-faint hover:text-danger flex h-6 w-6 items-center justify-center',
      )}
    >
      {busy ? <Loader2 size={11} className="animate-spin" /> : confirm ? 'Remove?' : <X size={11} />}
    </button>
  );
}

/** Type-ahead to subscribe an account to a colleague's calendar by email. */
function CalendarSearch({ accountId }: { accountId: string }) {
  const subscribe = useCalendar((s) => s.subscribeCalendar);
  const [q, setQ] = useState('');
  const [suggestions, setSuggestions] = useState<Address[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return; // stale results are hidden by the render gate below
    let cancelled = false;
    void api.query('contacts:suggest', { query, limit: 6 }).then((rows) => {
      if (!cancelled) setSuggestions(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [q]);

  const add = (email: string) => {
    const addr = email.trim().toLowerCase();
    if (!addr.includes('@')) return;
    setBusy(true);
    setError(null);
    void subscribe(accountId, addr).then((err) => {
      setBusy(false);
      if (err) setError(err);
      else {
        setQ('');
        setSuggestions([]);
      }
    });
  };

  return (
    <div className="relative mt-1 px-2">
      <div className="flex items-center gap-1.5">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') add(q);
          }}
          placeholder="Add a person's calendar…"
          aria-label="Search people to add their calendar"
          className="bg-surface border-hairline focus:ring-accent w-full rounded-md border px-2 py-1 text-[12px] placeholder:text-ink-faint focus:ring-1 focus:outline-none"
        />
        {busy && <Loader2 size={13} className="text-ink-faint shrink-0 animate-spin" />}
      </div>
      {q.trim().length >= 2 && suggestions.length > 0 && (
        <div className="border-hairline bg-surface absolute z-10 mt-1 flex w-[calc(100%-1rem)] flex-col overflow-hidden rounded-lg border shadow-lg">
          {suggestions.map((s) => (
            <button
              key={s.email}
              onClick={() => add(s.email)}
              className="hover:bg-sunken flex flex-col items-start px-2.5 py-1.5 text-left"
            >
              {s.name && <span className="text-ink text-[12px]">{s.name}</span>}
              <span className="text-ink-muted truncate text-[11.5px]">{s.email}</span>
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-danger mt-1 text-[11px]">{error}</p>}
    </div>
  );
}

export function CalendarSidebar({ onAddAccount }: { onAddAccount(): void }) {
  const open = useCalendar((s) => s.sidebarOpen);
  const calendars = useCalendar((s) => s.calendars);
  const setVisible = useCalendar((s) => s.setCalendarVisible);
  const { accounts } = useAccounts();
  const kanban = useKanban();
  const notionVisible = useNotionVisible((s) => s.visible);
  const toggleNotion = useNotionVisible((s) => s.toggle);
  if (!open) return null;

  const row = 'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12.5px]';

  return (
    <aside
      aria-label="Calendar sidebar"
      className="border-hairline flex h-full w-[280px] shrink-0 flex-col overflow-y-auto border-r pb-4"
    >
      <MiniMonth />
      <div className="text-ink-muted mt-5 flex items-center gap-2 px-6 text-[12.5px]">
        <Link2 size={13} /> Scheduling
        <Eye size={12} className="text-ink-faint ml-auto" />
      </div>
      <div className="mt-4 flex flex-col gap-4 px-4">
        {accounts.map((a) => {
          const cals = calendars.filter((c) => c.accountId === a.id);
          return (
            <section key={a.id}>
              <h3 className="text-ink px-2 text-[12.5px] font-semibold">{a.email}</h3>
              <div className="mt-1 flex flex-col">
                {cals.map((c) => (
                  <div key={c.id} className={cn(row, 'group text-ink-muted hover:bg-sunken/60')}>
                    <span
                      className="h-3 w-3 shrink-0 rounded"
                      style={{ backgroundColor: c.color, opacity: c.visible ? 1 : 0.35 }}
                    />
                    <span className={cn('flex-1 truncate', !c.visible && 'opacity-50')}>{c.name}</span>
                    <EyeToggle
                      on={c.visible}
                      label={`Toggle ${c.name}`}
                      onClick={() => setVisible(c.id, !c.visible)}
                    />
                    {c.source === 'google' && c.id.startsWith('gcal:') && (
                      <UnsubButton calendarId={c.id} name={c.name} />
                    )}
                  </div>
                ))}
                {cals.length <= 1 && a.authType !== 'oauth-google' && (
                  <p className="text-ink-faint px-2 py-1 text-[11px]">
                    Connect Google in Settings to see this account's calendars
                  </p>
                )}
                {a.authType === 'oauth-google' && <CalendarSearch accountId={a.id} />}
              </div>
            </section>
          );
        })}
        {(() => {
          const local = calendars.find((c) => c.id === 'local-default');
          return local ? (
            <div className={cn(row, 'text-ink-muted hover:bg-sunken/60')}>
              <span
                className="h-3 w-3 shrink-0 rounded"
                style={{ backgroundColor: local.color, opacity: local.visible ? 1 : 0.35 }}
              />
              <span className={cn('truncate', !local.visible && 'opacity-50')}>{local.name}</span>
              <EyeToggle
                on={local.visible}
                label="Toggle My Calendar"
                onClick={() => setVisible(local.id, !local.visible)}
              />
            </div>
          ) : null;
        })()}
        <button onClick={onAddAccount} className={cn(row, 'text-ink-muted hover:bg-sunken/60')}>
          <Plus size={13} /> Add calendar account
        </button>
      </div>
      <div className="border-hairline mt-auto border-t px-4 pt-3">
        {kanban.configured ? (
          <div className={cn(row, 'text-ink-muted')}>
            <span className="h-3 w-3 shrink-0 rounded" style={{ backgroundColor: '#8b5cf6' }} />
            <span className="truncate">Sprint board</span>
            <EyeToggle on={notionVisible} label="Toggle Notion events" onClick={toggleNotion} />
          </div>
        ) : (
          <p className="text-ink-faint px-2 text-[11.5px]">
            Connect a Notion board in Settings to see due dates here.
          </p>
        )}
      </div>
    </aside>
  );
}
