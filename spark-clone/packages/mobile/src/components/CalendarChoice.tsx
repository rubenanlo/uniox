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

type Group = ReturnType<typeof useCalendarGroups>[number];

/** The words for a pick: "Personal", or "Family · Personal" for another calendar of the account. */
export function pickLabel(groups: ReturnType<typeof useCalendarGroups>, pick: CalendarPick) {
  const g = groups.find((x) => x.account.id === pick.accountId);
  if (!g) return '';
  const c = pick.calendarId && g.others.find((x) => x.id === pick.calendarId);
  return c ? `${c.name} · ${g.name}` : g.name;
}

/** Accounts as small headings, each with its calendars as chips. One tap picks both. */
export function CalendarChoice({
  groups,
  value,
  onChange,
}: {
  groups: ReturnType<typeof useCalendarGroups>;
  value: CalendarPick;
  onChange: (p: CalendarPick) => void;
}) {
  const chip = (g: Group, id: string | undefined, label: string, color: string) => {
    const on = value.accountId === g.account.id && (value.calendarId ?? '') === (id ?? '');
    return (
      <button
        key={`${g.account.id}/${id ?? 'main'}`}
        className={on ? 'on' : ''}
        aria-pressed={on}
        aria-label={id ? `${label}, in ${g.name}` : label}
        onClick={() => onChange({ accountId: g.account.id, calendarId: id })}
      >
        <i style={{ background: color }} />
        {label}
      </button>
    );
  };
  // Accounts with one calendar share a row; an account with more gets its own heading.
  const single = groups.filter((g) => !g.others.length);
  const multi = groups.filter((g) => g.others.length);
  return (
    <div className="cal-cals" role="group" aria-label="Calendar">
      {single.length > 0 && (
        <div className="cal-cals-row">
          {single.map((g) => chip(g, undefined, g.name, g.account.color))}
        </div>
      )}
      {multi.map((g) => (
        <div key={g.account.id}>
          <div className="cal-cals-h">{g.name}</div>
          <div className="cal-cals-row">
            {chip(g, undefined, 'Main', g.account.color)}
            {g.others.map((c) => chip(g, c.id, c.name, c.color))}
          </div>
        </div>
      ))}
    </div>
  );
}
