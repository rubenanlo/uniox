import { useEffect, useState } from 'react';
import type { MobileAccount, MobileCalendar } from '../data/types';
import { useStore } from '../lib/store';

/** Where a new event goes: an account, and one of its calendars (the main one when left out). */
export type CalendarPick = { accountId: string; calendarId?: string };

/** An account by the name it has across the app (its label), never by its address. */
export const accountName = (a: MobileAccount) => a.displayName || a.email.split('@')[0] || a.email;

// One list for the whole session: it changes rarely and each card should open at once.
let cache: Promise<MobileCalendar[]> | null = null;

/**
 * The calendars you can add to, grouped by account. Until the list arrives, or when the
 * server cannot give it, each account offers just its main calendar.
 */
export function useCalendarGroups() {
  const { api, accounts } = useStore();
  const [cals, setCals] = useState<MobileCalendar[] | null>(null);
  useEffect(() => {
    let live = true;
    cache ??= api.calendars().catch((e) => {
      cache = null;
      throw e;
    });
    cache.then((c) => live && setCals(c)).catch(() => live && setCals([]));
    return () => {
      live = false;
    };
  }, [api]);
  return accounts.map((a) => {
    const mine = (cals ?? []).filter((c) => c.accountId === a.id);
    // The main calendar is named after the account; the others keep their own names.
    const others = mine.filter((c) => !c.primary).sort((x, y) => x.name.localeCompare(y.name));
    return { account: a, name: accountName(a), others };
  });
}

/** The words for a pick: "Personal", or "Family · Personal" for another calendar of the account. */
export function pickLabel(groups: ReturnType<typeof useCalendarGroups>, pick: CalendarPick) {
  const g = groups.find((x) => x.account.id === pick.accountId);
  if (!g) return '';
  const c = pick.calendarId && g.others.find((x) => x.id === pick.calendarId);
  return c ? `${c.name} · ${g.name}` : g.name;
}

/**
 * Accounts as chips. An account's other calendars (e.g. Family) appear only once that
 * account is picked, as a second row under it. `done` is false while that row is offered.
 */
export function CalendarChoice({
  groups,
  value,
  onChange,
}: {
  groups: ReturnType<typeof useCalendarGroups>;
  value: CalendarPick;
  onChange: (p: CalendarPick, done: boolean) => void;
}) {
  const chip = (key: string, on: boolean, label: string, color: string, pick: () => void) => (
    <button key={key} className={on ? 'on' : ''} aria-pressed={on} onClick={pick}>
      <i style={{ background: color }} />
      {label}
    </button>
  );
  const sel = groups.find((g) => g.account.id === value.accountId);
  return (
    <div className="cal-cals" role="group" aria-label="Calendar">
      <div className="cal-cals-row">
        {groups.map((g) =>
          chip(g.account.id, g === sel, g.name, g.account.color, () =>
            onChange({ accountId: g.account.id }, !g.others.length),
          ),
        )}
      </div>
      <div className={`cal-fold${sel && sel.others.length ? ' open' : ''}`}>
        <div>
          {sel && sel.others.length > 0 && (
            <div className="cal-cals-sub" role="group" aria-label={`Calendars in ${sel.name}`}>
              {chip('main', !value.calendarId, 'Main', sel.account.color, () =>
                onChange({ accountId: sel.account.id }, true),
              )}
              {sel.others.map((c) =>
                chip(c.id, value.calendarId === c.id, c.name, c.color, () =>
                  onChange({ accountId: sel.account.id, calendarId: c.id }, true),
                ),
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
