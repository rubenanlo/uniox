# Notion-Style Calendar Phase 1 (UI Shell) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild spark-clone's calendar into a Notion-Calendar-style three-column full-window takeover with month/week/day views, a calendar sidebar, a stateful right pane, all-day lane, out-of-office + repeating events, and keyboard-first navigation.

**Architecture:** Pure date/layout/recurrence math lives in `packages/renderer/src/lib/` (vitest-covered, DB-free). A rewritten zustand store (`state/calendar.ts`) holds view/anchor/cursor/pane state. New components under `components/calendar/` compose the three columns. Small additive changes to shared types, DB (one migration + calendar list/visibility), and the sync-service IPC switch.

**Tech Stack:** React 19 + zustand + Tailwind (existing patterns), better-sqlite3 via `packages/db`, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-20-notion-calendar-ui-design.md`

## Global Constraints

- No fake data: rooms picker and org-calendar areas render an "Available after Google sync" empty state.
- Repeat presets stored as real RRULE strings; only `FREQ=DAILY`, `FREQ=WEEKLY;BYDAY=XX`, `FREQ=MONTHLY;BYMONTHDAY=N`, `FREQ=YEARLY` expand in phase 1. Occurrence ids are `<eventId>:<occurrenceStartMs>`. Edits/deletes act on the whole series.
- Week starts Sunday. All date math is local-time epoch-ms (existing `calendarMonth.ts` convention).
- Shortcuts (calendar open, not typing): `t` today, `c` create, `m`/`w`/`d` views, arrows = day cursor (past edge pages; `←` at left edge reveals mail sidebar), `Enter` create-at-cursor, `⌘\` toggle calendar sidebar, `⌘/` toggle right pane, `Esc` close pane state / back to mail.
- Only the renderer hot-reloads under `pnpm dev`. `packages/db`, `packages/shared`, and `packages/sync` changes need the user to restart `pnpm dev`. DB-backed vitest suites fail locally (Electron ABI better-sqlite3) — do NOT run `packages/db` tests; renderer pure suites are the test surface.
- Typecheck: `cd /Users/rubenandino/Developer/Projects/spark-clone && npx tsc --noEmit -p tsconfig.web.json` (renderer/shared) and `npx tsc --noEmit -p tsconfig.node.json` (db/sync/main).
- Tests: `npx vitest run packages/renderer/test/<file>.test.ts`.
- Commit after every task. Never `git add -A` — the repo carries unrelated staged WIP; add only the files you touched.

---

### Task 1: Shared types, DB migration, calendar list/visibility IPC

**Files:**
- Modify: `packages/shared/src/calendar.ts`
- Modify: `packages/shared/src/ipc.ts` (queries at ~line 46, commands at ~line 119)
- Modify: `packages/db/src/schema.ts` (append migration to `MIGRATIONS`)
- Modify: `packages/db/src/index.ts` (`rowToEvent` ~line 60-70, `listEvents`/`upsertEvent` ~line 1045-1085)
- Modify: `packages/sync/src/service.ts` (calendar cases ~line 301-315)
- Modify: `packages/renderer/src/components/calendar/CalendarView.tsx` (the `useNotionEvents` event literal gains the now-required `eventType: 'default'` field, next to `allDay: true` — without this the web typecheck fails)

**Interfaces:**
- Produces (used by every later task):
  - `Calendar` gains `accountId?: string` and `rooms: 'pending'` never exists — no rooms type in phase 1.
  - `CalendarEvent` gains `eventType: 'default' | 'outOfOffice'`, `rrule?: string`, `accountId?: string`.
  - `CalendarEventInput` gains `calendarId?: string` (already there), `eventType?: 'default' | 'outOfOffice'`, `rrule?: string`.
  - IPC query `calendar:list` → `Calendar[]`; IPC command `calendar:setVisible` `{ id: string; visible: boolean }` → `{ ok: boolean }`.
  - DB: `listCalendars(): Calendar[]`, `setCalendarVisible(id: string, visible: boolean): void`, `ensureAccountCalendar(accountId: string, name: string): void` (id = `acct:` + accountId, INSERT OR IGNORE).

- [ ] **Step 1: Extend shared types**

In `packages/shared/src/calendar.ts` replace the `Calendar` interface and extend the event interfaces:

```ts
/** A calendar the user can see events from (local, or a synced Google calendar). */
export interface Calendar {
  id: string;
  name: string;
  color: string;
  source: 'local' | 'google';
  visible: boolean;
  /** Owning mail account; undefined for the free-floating local calendar. */
  accountId?: string;
}
```

Add to `CalendarEvent` (after `allDay`):

```ts
  /** 'outOfOffice' renders the Notion ⊗ style; default is a normal event. */
  eventType: 'default' | 'outOfOffice';
  /** RFC-5545 recurrence rule; presets expand client-side in phase 1. */
  rrule?: string;
  /** Owning mail account, derived from the calendar (undefined = local). */
  accountId?: string;
```

Add to `CalendarEventInput` (after `allDay`):

```ts
  eventType?: 'default' | 'outOfOffice';
  rrule?: string;
```

- [ ] **Step 2: Append the migration**

In `packages/db/src/schema.ts`, append a new string element at the END of the `MIGRATIONS` array (never edit existing entries):

```sql
-- Calendar phase 1: event types (out-of-office) ride on stored events.
ALTER TABLE events ADD COLUMN event_type TEXT NOT NULL DEFAULT 'default';
```

- [ ] **Step 3: DB functions**

In `packages/db/src/index.ts`:

(a) Update `rowToEvent` (the mapper near line 60) to add the new fields:

```ts
  eventType: (r.event_type as 'default' | 'outOfOffice') ?? 'default',
  rrule: (r.rrule as string) || undefined,
```

(b) Replace `listEvents` so it (1) hides events of invisible calendars, (2) includes recurring series that started before the range (their occurrences may land inside), and (3) reports the owning account:

```ts
  /** Stored events (local + synced) overlapping [startMs, endMs), plus any
   *  recurring series that began before endMs — the renderer expands those.
   *  Events on hidden calendars are excluded. */
  listEvents(startMs: number, endMs: number): CalendarEvent[] {
    const rows = this.raw
      .prepare(
        `SELECT e.*, c.account_id AS cal_account_id FROM events e
           JOIN calendars c ON c.id = e.calendar_id
         WHERE c.visible = 1
           AND ((e.start_ms < ? AND e.end_ms > ?) OR (e.rrule IS NOT NULL AND e.start_ms < ?))
         ORDER BY e.start_ms`,
      )
      .all(endMs, startMs, endMs) as Row[];
    return rows.map((r) => ({
      ...rowToEvent(r),
      accountId: (r.cal_account_id as string) || undefined,
    }));
  },
```

(c) Extend `upsertEvent`'s INSERT column list with `event_type, rrule` (values `input.eventType ?? 'default'`, `input.rrule ?? null`) and the `ON CONFLICT ... DO UPDATE SET` list with `event_type = excluded.event_type, rrule = excluded.rrule`.

(d) Add three new methods next to `listEvents`:

```ts
  listCalendars(): Calendar[] {
    return (this.raw.prepare(`SELECT * FROM calendars ORDER BY name`).all() as Row[]).map((r) => ({
      id: r.id as string,
      name: r.name as string,
      color: r.color as string,
      source: r.source as 'local' | 'google',
      visible: !!r.visible,
      accountId: (r.account_id as string) || undefined,
    }));
  }

  setCalendarVisible(id: string, visible: boolean) {
    this.raw
      .prepare(`UPDATE calendars SET visible = ?, updated_at = ? WHERE id = ?`)
      .run(visible ? 1 : 0, Date.now(), id);
  }

  /** Lazily give a mail account its own local calendar (id 'acct:<accountId>'). */
  ensureAccountCalendar(accountId: string, name: string) {
    this.raw
      .prepare(
        `INSERT OR IGNORE INTO calendars (id, account_id, name, color, source, visible, updated_at)
         VALUES (?, ?, ?, '#2f63e7', 'local', 1, ?)`,
      )
      .run(`acct:${accountId}`, accountId, name, Date.now());
  }
```

Import `Calendar` into the db package's imports from `@app/shared` alongside `CalendarEvent`.

- [ ] **Step 4: IPC types**

`packages/shared/src/ipc.ts` — add to the queries map (next to `calendar:events`):

```ts
  /** All calendars (per-account local calendars are ensured on first call). */
  'calendar:list': { args: undefined; result: Calendar[] };
```

and to the commands map (next to `calendar:event:save`):

```ts
  /** Show/hide a calendar's events everywhere. */
  'calendar:setVisible': { args: { id: string; visible: boolean }; result: { ok: boolean } };
```

Add `Calendar` to the type import from `./calendar`.

- [ ] **Step 5: Sync-service handlers**

`packages/sync/src/service.ts` — in the query switch, next to `case 'calendar:events'`:

```ts
      case 'calendar:list': {
        for (const a of this.db.listAccounts()) {
          this.db.ensureAccountCalendar(a.id, a.displayName || a.email);
        }
        return this.db.listCalendars();
      }
```

(Confirm the accounts accessor name with `grep -n "listAccounts" packages/db/src/index.ts` — if it differs, use the existing one.) In the command switch, next to `calendar:event:delete`:

```ts
      case 'calendar:setVisible': {
        const { id, visible } = args as { id: string; visible: boolean };
        this.db.setCalendarVisible(id, visible);
        this.delta({ kind: 'calendar-changed' });
        return { ok: true };
      }
```

- [ ] **Step 6: Typecheck both configs**

Run: `npx tsc --noEmit -p tsconfig.web.json && npx tsc --noEmit -p tsconfig.node.json`
Expected: clean. (No DB vitest — ABI constraint above.)

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/calendar.ts packages/shared/src/ipc.ts packages/db/src/schema.ts packages/db/src/index.ts packages/sync/src/service.ts packages/renderer/src/components/calendar/CalendarView.tsx
git commit -m "feat(calendar): event types, rrule storage, calendar list/visibility IPC"
```

---

### Task 2: Date-range math for the three views

**Files:**
- Modify: `packages/renderer/src/lib/calendarMonth.ts` (extend; keep existing exports untouched)
- Test: `packages/renderer/test/calendar-dates.test.ts`

**Interfaces:**
- Consumes: existing `DAY_MS`, `startOfDay`, `startOfMonth`, `addMonths`, `monthGrid`.
- Produces:
  - `addDays(ms: number, n: number): number` (DST-safe day step)
  - `startOfWeek(ms: number): number` (Sunday)
  - `type CalView = 'month' | 'week' | 'day'`
  - `rangeForView(view: CalView, anchorMs: number): { start: number; end: number; days: number[] }`
  - `pageAnchor(view: CalView, anchorMs: number, dir: 1 | -1): number`
  - `moveCursor(view: CalView, anchorMs: number, cursorMs: number, deltaDays: number): { anchor: number; cursor: number }` — steps the cursor; when the cursor leaves the visible range, re-anchors (pages).
  - `viewTitle(anchorMs: number): string` — "August 2026" (reuse `monthLabel`).

- [ ] **Step 1: Write the failing tests**

Create `packages/renderer/test/calendar-dates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addDays,
  DAY_MS,
  moveCursor,
  pageAnchor,
  rangeForView,
  startOfDay,
  startOfWeek,
} from '../src/lib/calendarMonth';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day).getTime();

describe('week/day ranges', () => {
  it('startOfWeek lands on Sunday', () => {
    expect(new Date(startOfWeek(d(2026, 8, 20))).getDay()).toBe(0); // Thu → Sun 16
    expect(startOfWeek(d(2026, 8, 16))).toBe(d(2026, 8, 16)); // Sunday is itself
  });
  it('week view = 7 days from Sunday', () => {
    const r = rangeForView('week', d(2026, 8, 20));
    expect(r.days).toHaveLength(7);
    expect(r.days[0]).toBe(d(2026, 8, 16));
    expect(r.end - r.start).toBe(7 * DAY_MS);
  });
  it('day view = single day', () => {
    const r = rangeForView('day', d(2026, 8, 20));
    expect(r.days).toEqual([d(2026, 8, 20)]);
  });
  it('month view matches monthGrid (42 days)', () => {
    expect(rangeForView('month', d(2026, 8, 1)).days).toHaveLength(42);
  });
});

describe('paging', () => {
  it('pages week by 7 days, day by 1, month by calendar month', () => {
    expect(pageAnchor('week', d(2026, 8, 16), 1)).toBe(d(2026, 8, 23));
    expect(pageAnchor('day', d(2026, 8, 20), -1)).toBe(d(2026, 8, 19));
    expect(new Date(pageAnchor('month', d(2026, 8, 1), 1)).getMonth()).toBe(8); // September
  });
});

describe('moveCursor', () => {
  it('moves within the visible month without re-anchoring', () => {
    const r = moveCursor('month', d(2026, 8, 1), d(2026, 8, 20), 1);
    expect(r.cursor).toBe(d(2026, 8, 21));
    expect(r.anchor).toBe(d(2026, 8, 1));
  });
  it('pages the month when walking past the grid edge', () => {
    // Sept 5 is the last cell of August 2026's 42-day grid.
    const r = moveCursor('month', d(2026, 8, 1), d(2026, 9, 5), 1);
    expect(r.cursor).toBe(d(2026, 9, 6));
    expect(new Date(r.anchor).getMonth()).toBe(8); // anchored to September
  });
  it('pages the week backwards from its first day', () => {
    const r = moveCursor('week', d(2026, 8, 16), d(2026, 8, 16), -1);
    expect(r.cursor).toBe(d(2026, 8, 15));
    expect(r.anchor).toBe(d(2026, 8, 9));
  });
  it('handles DST-length days via addDays', () => {
    expect(startOfDay(addDays(d(2026, 3, 28), 2))).toBe(d(2026, 3, 30)); // EU DST window
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/renderer/test/calendar-dates.test.ts`
Expected: FAIL — `addDays`/`rangeForView`/etc. are not exported.

- [ ] **Step 3: Implement in `calendarMonth.ts`**

Append:

```ts
export type CalView = 'month' | 'week' | 'day';

/** Day stepping that survives DST (noon-anchored, then floored). */
export function addDays(ms: number, n: number): number {
  return startOfDay(startOfDay(ms) + n * DAY_MS + DAY_MS / 2);
}

export function startOfWeek(ms: number): number {
  return addDays(startOfDay(ms), -new Date(startOfDay(ms)).getDay());
}

export function rangeForView(
  view: CalView,
  anchorMs: number,
): { start: number; end: number; days: number[] } {
  if (view === 'month') {
    const { days, gridStart, gridEnd } = monthGrid(anchorMs);
    return { start: gridStart, end: gridEnd, days };
  }
  const first = view === 'week' ? startOfWeek(anchorMs) : startOfDay(anchorMs);
  const count = view === 'week' ? 7 : 1;
  const days = Array.from({ length: count }, (_, i) => addDays(first, i));
  return { start: days[0]!, end: addDays(days[count - 1]!, 1), days };
}

export function pageAnchor(view: CalView, anchorMs: number, dir: 1 | -1): number {
  if (view === 'month') return addMonths(anchorMs, dir);
  return addDays(anchorMs, dir * (view === 'week' ? 7 : 1));
}

/** Step the day cursor; walking out of the visible range pages the anchor. */
export function moveCursor(
  view: CalView,
  anchorMs: number,
  cursorMs: number,
  deltaDays: number,
): { anchor: number; cursor: number } {
  const cursor = addDays(cursorMs, deltaDays);
  const { start, end } = rangeForView(view, anchorMs);
  if (cursor >= start && cursor < end) return { anchor: anchorMs, cursor };
  const anchor = view === 'month' ? startOfMonth(cursor) : view === 'week' ? startOfWeek(cursor) : cursor;
  return { anchor, cursor };
}

export const viewTitle = monthLabel;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/renderer/test/calendar-dates.test.ts`
Expected: PASS. Also run `npx vitest run packages/renderer/test` to confirm no existing suite broke.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/lib/calendarMonth.ts packages/renderer/test/calendar-dates.test.ts
git commit -m "feat(calendar): week/day range math, paging, day-cursor movement"
```

---

### Task 3: RRULE preset expansion

**Files:**
- Create: `packages/renderer/src/lib/rrule.ts`
- Test: `packages/renderer/test/rrule.test.ts`

**Interfaces:**
- Consumes: `addDays`, `startOfDay`, `DAY_MS` from `./calendarMonth`; `CalendarEvent` from `@app/shared`.
- Produces:
  - `presetRrule(preset: RepeatPreset, startMs: number): string | undefined` where `type RepeatPreset = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly'`
  - `ruleLabel(rrule: string | undefined): string` — "Doesn't repeat" / "Daily" / "Weekly on Thursday" / "Monthly on day 20" / "Yearly" / "Custom".
  - `expandEvent(event: CalendarEvent, rangeStart: number, rangeEnd: number): CalendarEvent[]` — the base event (if in range) plus preset occurrences with ids `` `${event.id}:${occStart}` ``, each carrying `seriesId: event.id` is NOT added (keep the type unchanged; the series id is `event.id.split(':')[0]`).

- [ ] **Step 1: Write the failing tests**

Create `packages/renderer/test/rrule.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@app/shared';
import { expandEvent, presetRrule, ruleLabel } from '../src/lib/rrule';

const d = (y: number, m: number, day: number, h = 0) => new Date(y, m - 1, day, h).getTime();
const HOUR = 3_600_000;

function ev(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'e1',
    calendarId: 'local-default',
    source: 'local',
    title: 'Standup',
    startMs: d(2026, 8, 3, 9),
    endMs: d(2026, 8, 3, 9) + HOUR,
    allDay: false,
    eventType: 'default',
    ...over,
  };
}

describe('presetRrule / ruleLabel', () => {
  it('builds preset rules from the start date', () => {
    expect(presetRrule('none', d(2026, 8, 20))).toBeUndefined();
    expect(presetRrule('daily', d(2026, 8, 20))).toBe('FREQ=DAILY');
    expect(presetRrule('weekly', d(2026, 8, 20))).toBe('FREQ=WEEKLY;BYDAY=TH');
    expect(presetRrule('monthly', d(2026, 8, 20))).toBe('FREQ=MONTHLY;BYMONTHDAY=20');
    expect(presetRrule('yearly', d(2026, 8, 20))).toBe('FREQ=YEARLY');
  });
  it('labels rules for the details pane', () => {
    expect(ruleLabel(undefined)).toBe("Doesn't repeat");
    expect(ruleLabel('FREQ=WEEKLY;BYDAY=TH')).toBe('Weekly on Thursday');
    expect(ruleLabel('FREQ=DAILY;INTERVAL=2')).toBe('Custom');
  });
});

describe('expandEvent', () => {
  const range = { start: d(2026, 8, 16), end: d(2026, 8, 23) }; // week of Aug 16

  it('returns the plain event unchanged when it has no rrule', () => {
    const e = ev({ startMs: d(2026, 8, 18, 9), endMs: d(2026, 8, 18, 10) });
    expect(expandEvent(e, range.start, range.end)).toEqual([e]);
  });
  it('daily: one occurrence per day, duration preserved, ids suffixed', () => {
    const out = expandEvent(ev({ rrule: 'FREQ=DAILY' }), range.start, range.end);
    expect(out).toHaveLength(7);
    expect(out[0]!.id).toBe(`e1:${d(2026, 8, 16, 9)}`);
    expect(out[0]!.endMs - out[0]!.startMs).toBe(HOUR);
  });
  it('weekly: only the BYDAY weekday inside the range', () => {
    const out = expandEvent(ev({ rrule: 'FREQ=WEEKLY;BYDAY=TH' }), range.start, range.end);
    expect(out).toHaveLength(1);
    expect(new Date(out[0]!.startMs).getDay()).toBe(4);
  });
  it('never emits occurrences before the series start', () => {
    const out = expandEvent(
      ev({ startMs: d(2026, 8, 19, 9), endMs: d(2026, 8, 19, 10), rrule: 'FREQ=DAILY' }),
      range.start,
      range.end,
    );
    expect(out[0]!.startMs).toBe(d(2026, 8, 19, 9));
    expect(out).toHaveLength(4); // 19, 20, 21, 22
  });
  it('monthly lands on BYMONTHDAY; yearly on the anniversary', () => {
    const m = expandEvent(
      ev({ startMs: d(2026, 6, 20, 9), endMs: d(2026, 6, 20, 10), rrule: 'FREQ=MONTHLY;BYMONTHDAY=20' }),
      range.start, range.end,
    );
    expect(m).toHaveLength(1);
    expect(new Date(m[0]!.startMs).getDate()).toBe(20);
    const y = expandEvent(
      ev({ startMs: d(2025, 8, 18, 9), endMs: d(2025, 8, 18, 10), rrule: 'FREQ=YEARLY' }),
      range.start, range.end,
    );
    expect(y).toHaveLength(1);
    expect(new Date(y[0]!.startMs).getFullYear()).toBe(2026);
  });
  it('custom rules fall back to the base occurrence only', () => {
    const out = expandEvent(ev({ rrule: 'FREQ=DAILY;INTERVAL=2' }), d(2026, 8, 1), d(2026, 9, 1));
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('e1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/renderer/test/rrule.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/renderer/src/lib/rrule.ts`**

```ts
import type { CalendarEvent } from '@app/shared';
import { addDays, startOfDay } from './calendarMonth';

/**
 * Phase-1 recurrence: the four Notion-style presets expand client-side; any
 * other RRULE renders its base occurrence only until the phase-3 engine.
 */
export type RepeatPreset = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function presetRrule(preset: RepeatPreset, startMs: number): string | undefined {
  const d = new Date(startMs);
  switch (preset) {
    case 'daily': return 'FREQ=DAILY';
    case 'weekly': return `FREQ=WEEKLY;BYDAY=${BYDAY[d.getDay()]}`;
    case 'monthly': return `FREQ=MONTHLY;BYMONTHDAY=${d.getDate()}`;
    case 'yearly': return 'FREQ=YEARLY';
    default: return undefined;
  }
}

/** Parse `A=B;C=D` into a map; returns null for anything we can't expand. */
function parsePreset(rrule: string): { freq: string; byday?: number; bymonthday?: number } | null {
  const parts = Object.fromEntries(rrule.split(';').map((p) => p.split('=') as [string, string]));
  const keys = Object.keys(parts);
  const freq = parts.FREQ;
  if (!freq) return null;
  if (freq === 'DAILY' && keys.length === 1) return { freq };
  if (freq === 'WEEKLY' && keys.length === 2 && parts.BYDAY) {
    const day = BYDAY.indexOf(parts.BYDAY as (typeof BYDAY)[number]);
    return day >= 0 ? { freq, byday: day } : null;
  }
  if (freq === 'MONTHLY' && keys.length === 2 && parts.BYMONTHDAY)
    return { freq, bymonthday: Number(parts.BYMONTHDAY) };
  if (freq === 'YEARLY' && keys.length === 1) return { freq };
  return null;
}

export function ruleLabel(rrule: string | undefined): string {
  if (!rrule) return "Doesn't repeat";
  const p = parsePreset(rrule);
  if (!p) return 'Custom';
  if (p.freq === 'DAILY') return 'Daily';
  if (p.freq === 'WEEKLY') return `Weekly on ${DAY_NAMES[p.byday!]}`;
  if (p.freq === 'MONTHLY') return `Monthly on day ${p.bymonthday}`;
  return 'Yearly';
}

/** All occurrences of `event` overlapping [rangeStart, rangeEnd). */
export function expandEvent(
  event: CalendarEvent,
  rangeStart: number,
  rangeEnd: number,
): CalendarEvent[] {
  const overlaps = (s: number, e: number) => s < rangeEnd && e > rangeStart;
  if (!event.rrule) return overlaps(event.startMs, event.endMs) ? [event] : [];
  const rule = parsePreset(event.rrule);
  if (!rule) return overlaps(event.startMs, event.endMs) ? [event] : [];

  const duration = event.endMs - event.startMs;
  const base = new Date(event.startMs);
  const out: CalendarEvent[] = [];
  const push = (startMs: number) => {
    if (startMs < event.startMs || !overlaps(startMs, startMs + duration)) return;
    out.push(
      startMs === event.startMs
        ? event
        : { ...event, id: `${event.id}:${startMs}`, startMs, endMs: startMs + duration },
    );
  };

  // Walk the range day by day (bounded: ranges are ≤ 42 days).
  for (let day = startOfDay(rangeStart); day < rangeEnd; day = addDays(day, 1)) {
    const d = new Date(day);
    const at = new Date(
      d.getFullYear(), d.getMonth(), d.getDate(), base.getHours(), base.getMinutes(),
    ).getTime();
    if (rule.freq === 'DAILY') push(at);
    else if (rule.freq === 'WEEKLY' && d.getDay() === rule.byday) push(at);
    else if (rule.freq === 'MONTHLY' && d.getDate() === rule.bymonthday) push(at);
    else if (
      rule.freq === 'YEARLY' &&
      d.getDate() === base.getDate() &&
      d.getMonth() === base.getMonth()
    )
      push(at);
  }
  return out;
}

/** The stored series id behind any (possibly expanded-occurrence) event id. */
export function seriesId(eventId: string): string {
  return eventId.split(':')[0]!;
}
```

Note: `seriesId` must NOT break `notion:` ids — Notion event ids look like `notion:<cardId>`. Guard in the caller: only call `seriesId` for `source === 'local'` events (details-pane edit/delete path). Add this exact comment to the function.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/renderer/test/rrule.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/lib/rrule.ts packages/renderer/test/rrule.test.ts
git commit -m "feat(calendar): RRULE preset expansion and labels"
```

---

### Task 4: Event layout math (all-day lanes + timed overlap columns)

**Files:**
- Create: `packages/renderer/src/lib/eventLayout.ts`
- Test: `packages/renderer/test/event-layout.test.ts`

**Interfaces:**
- Consumes: `CalendarEvent` from `@app/shared`; `DAY_MS`, `startOfDay` from `./calendarMonth`.
- Produces:
  - `isAllDayLike(e: CalendarEvent): boolean` — allDay OR spans ≥ 1 full day boundary (multi-day timed events ride the all-day lane, like Notion).
  - `packLanes(events: CalendarEvent[], rowStart: number, rowEnd: number): { event: CalendarEvent; lane: number; startCol: number; span: number }[]` — greedy first-fit lanes for a week row of `(rowEnd - rowStart) / DAY_MS` columns.
  - `layoutColumns(events: CalendarEvent[]): { event: CalendarEvent; col: number; cols: number }[]` — column assignment for concurrent timed events in one day.

- [ ] **Step 1: Write the failing tests**

Create `packages/renderer/test/event-layout.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '@app/shared';
import { isAllDayLike, layoutColumns, packLanes } from '../src/lib/eventLayout';

const d = (day: number, h = 0) => new Date(2026, 7, day, h).getTime(); // August 2026
const ev = (id: string, startMs: number, endMs: number, allDay = false): CalendarEvent => ({
  id, calendarId: 'c', source: 'local', title: id, startMs, endMs, allDay, eventType: 'default',
});

describe('isAllDayLike', () => {
  it('true for allDay and for multi-day timed events', () => {
    expect(isAllDayLike(ev('a', d(3), d(4), true))).toBe(true);
    expect(isAllDayLike(ev('b', d(3, 22), d(4, 2)))).toBe(true); // crosses midnight
    expect(isAllDayLike(ev('c', d(3, 9), d(3, 10)))).toBe(false);
  });
});

describe('packLanes (week row Sun 16 – Sat 22)', () => {
  const rowStart = d(16);
  const rowEnd = d(23);
  it('non-overlapping chips share lane 0', () => {
    const out = packLanes([ev('a', d(16), d(17), true), ev('b', d(18), d(19), true)], rowStart, rowEnd);
    expect(out.map((p) => p.lane)).toEqual([0, 0]);
  });
  it('overlapping chips stack lanes; spans clip to the row', () => {
    const out = packLanes(
      [ev('a', d(14), d(25), true), ev('b', d(17), d(19), true)],
      rowStart, rowEnd,
    );
    const a = out.find((p) => p.event.id === 'a')!;
    const b = out.find((p) => p.event.id === 'b')!;
    expect(a.lane).toBe(0);
    expect(a.startCol).toBe(0);
    expect(a.span).toBe(7); // clipped to the full row
    expect(b.lane).toBe(1);
    expect(b.startCol).toBe(1); // Mon 17
    expect(b.span).toBe(2);
  });
});

describe('layoutColumns', () => {
  it('sequential events keep a single column', () => {
    const out = layoutColumns([ev('a', d(3, 9), d(3, 10)), ev('b', d(3, 10), d(3, 11))]);
    expect(out.every((p) => p.cols === 1)).toBe(true);
  });
  it('overlapping events split the width', () => {
    const out = layoutColumns([ev('a', d(3, 9), d(3, 11)), ev('b', d(3, 10), d(3, 12))]);
    expect(out.find((p) => p.event.id === 'a')!.col).toBe(0);
    expect(out.find((p) => p.event.id === 'b')!.col).toBe(1);
    expect(out.every((p) => p.cols === 2)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run packages/renderer/test/event-layout.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/renderer/src/lib/eventLayout.ts`**

```ts
import type { CalendarEvent } from '@app/shared';
import { DAY_MS, startOfDay } from './calendarMonth';

/** All-day proper, or a timed event that crosses a midnight — both ride the
 *  all-day lane like Notion Calendar. */
export function isAllDayLike(e: CalendarEvent): boolean {
  return e.allDay || startOfDay(e.startMs) !== startOfDay(Math.max(e.startMs, e.endMs - 1));
}

export interface LanePlacement {
  event: CalendarEvent;
  lane: number;
  /** 0-based day column within the row. */
  startCol: number;
  /** Number of day columns covered (≥ 1, clipped to the row). */
  span: number;
}

/** Greedy first-fit lane packing for spanning chips across one week row. */
export function packLanes(
  events: CalendarEvent[],
  rowStart: number,
  rowEnd: number,
): LanePlacement[] {
  const cols = Math.round((rowEnd - rowStart) / DAY_MS);
  const sorted = [...events].sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs);
  const laneEnds: number[] = []; // per lane: last occupied end column (exclusive)
  const out: LanePlacement[] = [];
  for (const event of sorted) {
    const startCol = Math.max(0, Math.floor((startOfDay(event.startMs) - rowStart) / DAY_MS));
    const endCol = Math.min(cols, Math.ceil((event.endMs - rowStart) / DAY_MS));
    const span = Math.max(1, endCol - startCol);
    let lane = laneEnds.findIndex((end) => end <= startCol);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = startCol + span;
    out.push({ event, lane, startCol, span });
  }
  return out;
}

export interface ColumnPlacement {
  event: CalendarEvent;
  col: number;
  cols: number;
}

/** Column split for concurrent timed events within one day (Notion style:
 *  every member of an overlap cluster shares the cluster's column count). */
export function layoutColumns(events: CalendarEvent[]): ColumnPlacement[] {
  const sorted = [...events].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const placements: ColumnPlacement[] = [];
  let cluster: { event: CalendarEvent; col: number }[] = [];
  let clusterEnd = -Infinity;
  const flush = () => {
    const cols = Math.max(1, ...cluster.map((c) => c.col + 1));
    for (const c of cluster) placements.push({ event: c.event, col: c.col, cols });
    cluster = [];
  };
  for (const event of sorted) {
    if (event.startMs >= clusterEnd && cluster.length) flush();
    const taken = cluster.filter((c) => c.event.endMs > event.startMs).map((c) => c.col);
    let col = 0;
    while (taken.includes(col)) col++;
    cluster.push({ event, col });
    clusterEnd = Math.max(clusterEnd, event.endMs);
  }
  if (cluster.length) flush();
  return placements;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run packages/renderer/test/event-layout.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/lib/eventLayout.ts packages/renderer/test/event-layout.test.ts
git commit -m "feat(calendar): all-day lane packing and timed overlap columns"
```

---

### Task 5: Calendar store rewrite (view, cursor, panes, calendars)

**Files:**
- Modify: `packages/renderer/src/state/calendar.ts` (full rewrite; keep `wireCalendar` export name — `App.tsx` imports it)

**Interfaces:**
- Consumes: `rangeForView`, `pageAnchor`, `moveCursor`, `startOfDay`, `startOfMonth`, `CalView` from `../lib/calendarMonth`; IPC from Task 1.
- Produces (`useCalendar` zustand store — every later component consumes this exact shape):

```ts
export type RightPaneState =
  | { kind: 'shortcuts' }
  | { kind: 'details'; event: CalendarEvent }
  | { kind: 'form'; draft: EventDraft };

export interface EventDraft {
  /** Stored event id when editing; undefined when creating. */
  id?: string;
  calendarId: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  eventType: 'default' | 'outOfOffice';
  rrule?: string;
  location: string;
  description: string;
  meetingUrl: string;
  color?: string;
}

interface CalendarState {
  view: CalView;                 // 'month' | 'week' | 'day'
  anchor: number;                // month-start / week-Sunday / day
  cursor: number;                // focused day (startOfDay ms)
  events: CalendarEvent[];       // stored, visible-calendar, range (+rrule seeds)
  calendars: Calendar[];
  sidebarOpen: boolean;          // ⌘\
  rightPaneOpen: boolean;        // ⌘/
  rightPane: RightPaneState;
  setView(view: CalView): void;              // re-anchors around cursor
  setCursor(dayMs: number): void;            // clicking a day / mini-month
  moveCursorBy(deltaDays: number): void;     // arrows; pages past edges
  page(dir: 1 | -1): void;                   // chevrons; keeps cursor in range
  goToday(): void;
  toggleSidebar(): void;
  toggleRightPane(): void;
  openDetails(event: CalendarEvent): void;   // also opens the pane
  openForm(draft: Partial<EventDraft> & { startMs: number; endMs: number }): void;
  closePane(): void;                         // → shortcuts
  refresh(): void;
  loadCalendars(): Promise<void>;
  setCalendarVisible(id: string, visible: boolean): void;  // optimistic + IPC
  save(draft: EventDraft): Promise<void>;
  remove(id: string): Promise<void>;         // callers pass the SERIES id
}
export function wireCalendar(): () => void;  // initial load + delta subscription
export function draftFromEvent(e: CalendarEvent): EventDraft;
export function newDraft(dayMs: number, calendars: Calendar[]): EventDraft; // 9–10 AM
```

- [ ] **Step 1: Rewrite `state/calendar.ts`**

```ts
import { create } from 'zustand';
import type { Calendar, CalendarEvent } from '@app/shared';
import { api } from '../lib/api';
import {
  type CalView,
  moveCursor,
  pageAnchor,
  rangeForView,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from '../lib/calendarMonth';

export type RightPaneState =
  | { kind: 'shortcuts' }
  | { kind: 'details'; event: CalendarEvent }
  | { kind: 'form'; draft: EventDraft };

export interface EventDraft {
  id?: string;
  calendarId: string;
  title: string;
  startMs: number;
  endMs: number;
  allDay: boolean;
  eventType: 'default' | 'outOfOffice';
  rrule?: string;
  location: string;
  description: string;
  meetingUrl: string;
  color?: string;
}

const HOUR = 3_600_000;

/** Anchor appropriate for a view, centred on a day. */
function anchorFor(view: CalView, dayMs: number): number {
  return view === 'month' ? startOfMonth(dayMs) : view === 'week' ? startOfWeek(dayMs) : startOfDay(dayMs);
}

interface CalendarState {
  view: CalView;
  anchor: number;
  cursor: number;
  events: CalendarEvent[];
  calendars: Calendar[];
  sidebarOpen: boolean;
  rightPaneOpen: boolean;
  rightPane: RightPaneState;
  setView(view: CalView): void;
  setCursor(dayMs: number): void;
  moveCursorBy(deltaDays: number): void;
  page(dir: 1 | -1): void;
  goToday(): void;
  toggleSidebar(): void;
  toggleRightPane(): void;
  openDetails(event: CalendarEvent): void;
  openForm(draft: Partial<EventDraft> & { startMs: number; endMs: number }): void;
  closePane(): void;
  refresh(): void;
  loadCalendars(): Promise<void>;
  setCalendarVisible(id: string, visible: boolean): void;
  save(draft: EventDraft): Promise<void>;
  remove(id: string): Promise<void>;
}

export const useCalendar = create<CalendarState>((set, get) => ({
  view: 'month',
  anchor: startOfMonth(Date.now()),
  cursor: startOfDay(Date.now()),
  events: [],
  calendars: [],
  sidebarOpen: true,
  rightPaneOpen: true,
  rightPane: { kind: 'shortcuts' },

  setView: (view) => {
    set((s) => ({ view, anchor: anchorFor(view, s.cursor) }));
    get().refresh();
  },
  setCursor: (dayMs) => {
    const day = startOfDay(dayMs);
    set((s) => ({ cursor: day, anchor: anchorFor(s.view, day) }));
    get().refresh();
  },
  moveCursorBy: (deltaDays) => {
    const s = get();
    const next = moveCursor(s.view, s.anchor, s.cursor, deltaDays);
    set({ cursor: next.cursor, anchor: next.anchor });
    if (next.anchor !== s.anchor) s.refresh();
  },
  page: (dir) => {
    const s = get();
    const anchor = pageAnchor(s.view, s.anchor, dir);
    const { start, end } = rangeForView(s.view, anchor);
    const cursor = s.cursor >= start && s.cursor < end ? s.cursor : start;
    set({ anchor, cursor });
    s.refresh();
  },
  goToday: () => get().setCursor(Date.now()),

  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleRightPane: () => set((s) => ({ rightPaneOpen: !s.rightPaneOpen })),
  openDetails: (event) => set({ rightPane: { kind: 'details', event }, rightPaneOpen: true }),
  openForm: (partial) =>
    set((s) => ({
      rightPaneOpen: true,
      rightPane: {
        kind: 'form',
        draft: {
          calendarId: s.calendars.find((c) => c.accountId)?.id ?? 'local-default',
          title: '',
          allDay: false,
          eventType: 'default',
          location: '',
          description: '',
          meetingUrl: '',
          ...partial,
        },
      },
    })),
  closePane: () => set({ rightPane: { kind: 'shortcuts' } }),

  refresh: () => {
    const { view, anchor } = get();
    const { start, end } = rangeForView(view, anchor);
    void api
      .query('calendar:events', { startMs: start, endMs: end })
      .then((events) => set({ events }))
      .catch(() => {});
  },
  loadCalendars: async () => {
    const calendars = await api.query('calendar:list', undefined);
    set({ calendars });
  },
  setCalendarVisible: (id, visible) => {
    set((s) => ({
      calendars: s.calendars.map((c) => (c.id === id ? { ...c, visible } : c)),
    }));
    void api.command('calendar:setVisible', { id, visible }).then(() => get().refresh());
  },

  save: async (draft) => {
    await api.command('calendar:event:save', {
      event: {
        id: draft.id,
        calendarId: draft.calendarId,
        title: draft.title,
        startMs: draft.startMs,
        endMs: draft.endMs,
        allDay: draft.allDay,
        eventType: draft.eventType,
        rrule: draft.rrule,
        location: draft.location.trim() || undefined,
        description: draft.description.trim() || undefined,
        meetingUrl: draft.meetingUrl.trim() || undefined,
        color: draft.color,
      },
    });
    set({ rightPane: { kind: 'shortcuts' } });
    get().refresh();
  },
  remove: async (id) => {
    await api.command('calendar:event:delete', { id });
    set({ rightPane: { kind: 'shortcuts' } });
    get().refresh();
  },
}));

/** Wire the change delta + initial load, app-level (call from App effect). */
export function wireCalendar(): () => void {
  useCalendar.getState().refresh();
  void useCalendar.getState().loadCalendars();
  return api.onDelta((e) => {
    if (e.kind === 'calendar-changed') {
      useCalendar.getState().refresh();
      void useCalendar.getState().loadCalendars();
    }
    if (e.kind === 'accounts-changed') void useCalendar.getState().loadCalendars();
  });
}

export function draftFromEvent(e: CalendarEvent): EventDraft {
  return {
    id: e.id,
    calendarId: e.calendarId,
    title: e.title,
    startMs: e.startMs,
    endMs: e.endMs,
    allDay: e.allDay,
    eventType: e.eventType,
    rrule: e.rrule,
    location: e.location ?? '',
    description: e.description ?? '',
    meetingUrl: e.meetingUrl ?? '',
    color: e.color,
  };
}

export function newDraft(dayMs: number, calendars: Calendar[]): EventDraft {
  const day = startOfDay(dayMs);
  return {
    calendarId: calendars.find((c) => c.accountId)?.id ?? 'local-default',
    title: '',
    startMs: day + 9 * HOUR,
    endMs: day + 10 * HOUR,
    allDay: false,
    eventType: 'default',
    location: '',
    description: '',
    meetingUrl: '',
  };
}
```

Note: `EditorTarget` and `openEditor`/`closeEditor`/`editor` are gone. `EventEditor.tsx` still imports them — it is deleted in Task 7; until then the typecheck runs at the end of THIS task will fail on `EventEditor.tsx`. To keep every task green, delete `packages/renderer/src/components/calendar/EventEditor.tsx` in this task and stub `CalendarView.tsx` minimally: remove the `editor`/`openEditor` usages (replace `openEditor({ event: null, dayMs })` calls with `openForm(newDraft(dayMs, useCalendar.getState().calendars))` equivalents or simply `setCursor(dayMs)`, and drop the `{editor && <EventEditor …/>}` line). CalendarView is fully rewritten in Task 8/10 anyway.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: clean after the EventEditor deletion + CalendarView stub adjustments.

- [ ] **Step 3: Run the full renderer suite**

Run: `npx vitest run packages/renderer/test`
Expected: PASS (no suite imports the calendar store today).

- [ ] **Step 4: Commit**

```bash
git add packages/renderer/src/state/calendar.ts packages/renderer/src/components/calendar/CalendarView.tsx
git rm packages/renderer/src/components/calendar/EventEditor.tsx
git commit -m "feat(calendar): store rewrite — view/cursor/pane state, calendar visibility"
```

---

### Task 6: Notion-events hook extraction

**Files:**
- Create: `packages/renderer/src/components/calendar/useNotionEvents.ts`
- Modify: `packages/renderer/src/components/calendar/CalendarView.tsx` (import from the new file)

**Interfaces:**
- Produces: `useNotionEvents(): CalendarEvent[]` and `useVisibleEvents(rangeStart: number, rangeEnd: number): CalendarEvent[]` — stored events expanded via `expandEvent` merged with Notion events (respecting a `notionVisible` flag), sorted by start.

The month/week/day views all need "stored + expanded + notion" — one hook keeps them identical.

- [ ] **Step 1: Create `useNotionEvents.ts`**

Move the existing `useNotionEvents` function body verbatim out of `CalendarView.tsx` (lines 20-51: `NOTION_COLOR`, the hook) into the new file, exporting both. Then add below it:

```ts
import { create } from 'zustand';

/** Session-only visibility for the derived Notion calendar (sidebar eye). */
export const useNotionVisible = create<{ visible: boolean; toggle(): void }>((set) => ({
  visible: true,
  toggle: () => set((s) => ({ visible: !s.visible })),
}));

/** Everything the grids render: stored events expanded for the range, plus
 *  Notion due-dates, sorted all-day-first then by start. */
export function useVisibleEvents(rangeStart: number, rangeEnd: number): CalendarEvent[] {
  const stored = useCalendar((s) => s.events);
  const notion = useNotionEvents();
  const notionVisible = useNotionVisible((s) => s.visible);
  return useMemo(() => {
    const expanded = stored.flatMap((e) => expandEvent(e, rangeStart, rangeEnd));
    const merged = notionVisible
      ? [...expanded, ...notion.filter((e) => e.startMs < rangeEnd && e.endMs > rangeStart)]
      : expanded;
    return merged.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startMs - b.startMs);
  }, [stored, notion, notionVisible, rangeStart, rangeEnd]);
}
```

Imports needed: `useMemo` from react, `CalendarEvent` from `@app/shared`, `expandEvent` from `../../lib/rrule`, `useCalendar` from `../../state/calendar`, plus what the moved hook already used (`useKanban`, `DAY_MS`, `startOfDay`).

- [ ] **Step 2: Update `CalendarView.tsx`** to import `useNotionEvents` from `./useNotionEvents` and delete the moved code.

- [ ] **Step 3: Typecheck + suite**

Run: `npx tsc --noEmit -p tsconfig.web.json && npx vitest run packages/renderer/test`
Expected: clean / PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/renderer/src/components/calendar/useNotionEvents.ts packages/renderer/src/components/calendar/CalendarView.tsx
git commit -m "refactor(calendar): shared visible-events hook with rrule expansion"
```

---

### Task 7: Right pane (shortcuts / details / form)

**Files:**
- Create: `packages/renderer/src/components/calendar/RightPane.tsx`
- Create: `packages/renderer/src/components/calendar/EventForm.tsx`

**Interfaces:**
- Consumes: `useCalendar` (rightPane, openDetails, openForm, closePane, save, remove, calendars), `draftFromEvent`, `ruleLabel`, `presetRrule`, `seriesId`; `useAccounts` from `../../state/queries` (returns `{ accounts }` each with `{ id, email, displayName }`).
- Produces: `<RightPane />` — self-contained; reads everything from the store. Rendered by CalendarView (Task 10).

- [ ] **Step 1: Create `RightPane.tsx`**

```tsx
import { ExternalLink, Pencil, Trash2, X } from 'lucide-react';
import type { CalendarEvent } from '@app/shared';
import { timeLabel } from '../../lib/calendarMonth';
import { ruleLabel, seriesId } from '../../lib/rrule';
import { cn } from '../../lib/utils';
import { useAccounts } from '../../state/queries';
import { draftFromEvent, useCalendar } from '../../state/calendar';
import { EventForm } from './EventForm';

const SHORTCUTS: [string, string][] = [
  ['Go to today', 'T'],
  ['New event', 'C'],
  ['Month / Week / Day', 'M W D'],
  ['Move around', '← → ↑ ↓'],
  ['Create on focused day', '↩'],
  ['Toggle sidebar', '⌘ \\'],
  ['Toggle this panel', '⌘ /'],
  ['Back to mail', 'Esc'],
];

function ShortcutsPanel() {
  return (
    <div className="px-4 py-4">
      <h2 className="text-ink mb-3 text-[13.5px] font-bold">Useful shortcuts</h2>
      <ul className="flex flex-col gap-2.5">
        {SHORTCUTS.map(([label, keys]) => (
          <li key={label} className="flex items-center justify-between gap-2">
            <span className="text-ink-muted text-[12.5px]">{label}</span>
            <span className="flex gap-1">
              {keys.split(' ').map((k, i) => (
                <kbd
                  key={i}
                  className="border-hairline bg-sunken text-ink-muted rounded border px-1.5 py-0.5 text-[10.5px]"
                >
                  {k}
                </kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function whenLabel(e: CalendarEvent): string {
  const day = new Date(e.startMs).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  if (e.allDay) return `${day} · All day`;
  return `${day} · ${timeLabel(e.startMs)} – ${timeLabel(e.endMs)}`;
}

function DetailsPanel({ event }: { event: CalendarEvent }) {
  const openForm = useCalendar((s) => s.openForm);
  const remove = useCalendar((s) => s.remove);
  const closePane = useCalendar((s) => s.closePane);
  const calendars = useCalendar((s) => s.calendars);
  const { accounts } = useAccounts();
  const cal = calendars.find((c) => c.id === event.calendarId);
  const account = accounts.find((a) => a.id === (event.accountId ?? cal?.accountId));
  const editable = event.source === 'local' && !event.readOnly;

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-start gap-2">
        <span
          className="mt-1 h-3 w-3 shrink-0 rounded"
          style={{ backgroundColor: event.color ?? cal?.color ?? 'var(--color-accent)' }}
        />
        <h2 className="text-ink flex-1 text-[14.5px] leading-snug font-bold">
          {event.eventType === 'outOfOffice' && '⊗ '}
          {event.title || '(untitled)'}
        </h2>
        <button
          onClick={closePane}
          aria-label="Close details"
          className="text-ink-muted hover:text-ink -mr-1 flex h-7 w-7 items-center justify-center rounded-lg"
        >
          <X size={14} />
        </button>
      </div>
      <p className="text-ink-muted text-[12.5px]">{whenLabel(event)}</p>
      <p className="text-ink-faint text-[12px]">{ruleLabel(event.rrule)}</p>
      <p className="text-ink-faint text-[12px]">
        {cal ? cal.name : event.source === 'notion' ? 'Notion' : 'Calendar'}
        {account && ` · ${account.email}`}
      </p>
      {event.location && <p className="text-ink-muted text-[12.5px]">📍 {event.location}</p>}
      {event.meetingUrl && (
        <a href={event.meetingUrl} target="_blank" rel="noreferrer"
           className="text-accent truncate text-[12.5px] font-medium">
          {event.meetingUrl}
        </a>
      )}
      {event.description && (
        <p className="text-ink-muted text-[12.5px] whitespace-pre-wrap">{event.description}</p>
      )}
      {event.url && (
        <a href={event.url} target="_blank" rel="noreferrer"
           className="text-accent inline-flex items-center gap-1.5 text-[12.5px] font-medium">
          <ExternalLink size={13} /> Open in Notion
        </a>
      )}
      {editable && (
        <div className="border-hairline mt-1 flex gap-2 border-t pt-3">
          <button
            onClick={() => openForm(draftFromEvent({ ...event, id: seriesId(event.id) }))}
            className="border-hairline text-ink hover:bg-sunken flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-1.5 text-[12px] font-semibold"
          >
            <Pencil size={12} /> Edit
          </button>
          <button
            onClick={() => void remove(seriesId(event.id))}
            className="border-hairline text-danger hover:bg-sunken flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-1.5 text-[12px] font-semibold"
          >
            <Trash2 size={12} /> Delete
          </button>
        </div>
      )}
      {event.rrule && editable && (
        <p className="text-ink-faint text-[11px]">Edits apply to the whole series.</p>
      )}
    </div>
  );
}

export function RightPane() {
  const rightPane = useCalendar((s) => s.rightPane);
  const open = useCalendar((s) => s.rightPaneOpen);
  if (!open) return null;
  return (
    <aside
      aria-label="Calendar side panel"
      className="border-hairline h-full w-[300px] shrink-0 overflow-y-auto border-l"
    >
      {rightPane.kind === 'shortcuts' && <ShortcutsPanel />}
      {rightPane.kind === 'details' && <DetailsPanel event={rightPane.event} />}
      {rightPane.kind === 'form' && <EventForm draft={rightPane.draft} />}
    </aside>
  );
}
```

- [ ] **Step 2: Create `EventForm.tsx`**

```tsx
import { DoorClosed, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DAY_MS, startOfDay } from '../../lib/calendarMonth';
import { presetRrule, type RepeatPreset } from '../../lib/rrule';
import { cn } from '../../lib/utils';
import { useAccounts } from '../../state/queries';
import { type EventDraft, useCalendar } from '../../state/calendar';

const COLORS = ['#2f63e7', '#e0567c', '#e0913a', '#2ba676', '#8b5cf6', '#6d6d75'];
const inputCls =
  'border-hairline bg-sunken text-ink w-full rounded-lg border px-2.5 py-1.5 text-[12.5px] outline-none focus:ring-2 focus:ring-accent';

const pad = (n: number) => String(n).padStart(2, '0');
const dateValue = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const timeValue = (ms: number) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
function combine(date: string, time: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, hh ?? 0, mm ?? 0).getTime();
}

/** Which preset (if any) a stored rrule corresponds to, for the select. */
function presetOf(rrule: string | undefined): RepeatPreset | 'custom' {
  if (!rrule) return 'none';
  if (rrule === 'FREQ=DAILY') return 'daily';
  if (/^FREQ=WEEKLY;BYDAY=[A-Z]{2}$/.test(rrule)) return 'weekly';
  if (/^FREQ=MONTHLY;BYMONTHDAY=\d+$/.test(rrule)) return 'monthly';
  if (rrule === 'FREQ=YEARLY') return 'yearly';
  return 'custom';
}

export function EventForm({ draft }: { draft: EventDraft }) {
  const save = useCalendar((s) => s.save);
  const closePane = useCalendar((s) => s.closePane);
  const calendars = useCalendar((s) => s.calendars);
  const { accounts } = useAccounts();

  const [title, setTitle] = useState(draft.title);
  const [calendarId, setCalendarId] = useState(draft.calendarId);
  const [date, setDate] = useState(dateValue(draft.startMs));
  const [start, setStart] = useState(timeValue(draft.startMs));
  const [end, setEnd] = useState(timeValue(draft.endMs));
  const [allDay, setAllDay] = useState(draft.allDay);
  const [ooo, setOoo] = useState(draft.eventType === 'outOfOffice');
  const [repeat, setRepeat] = useState<RepeatPreset | 'custom'>(presetOf(draft.rrule));
  const [customRule, setCustomRule] = useState(presetOf(draft.rrule) === 'custom' ? draft.rrule! : '');
  const [location, setLocation] = useState(draft.location);
  const [description, setDescription] = useState(draft.description);
  const [meetingUrl, setMeetingUrl] = useState(draft.meetingUrl);
  const [color, setColor] = useState(draft.color ?? COLORS[0]!);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  // Account choices map onto per-account calendars (id 'acct:<accountId>').
  const accountCalendars = calendars.filter((c) => c.accountId);

  const submit = () => {
    if (!title.trim()) return;
    const startMs = allDay ? startOfDay(combine(date, '00:00')) : combine(date, start);
    const endMs = allDay ? startOfDay(combine(date, '00:00')) + DAY_MS : combine(date, end);
    void save({
      id: draft.id,
      calendarId,
      title: title.trim(),
      startMs,
      endMs: Math.max(endMs, startMs + (allDay ? 0 : 60_000)),
      allDay,
      eventType: ooo ? 'outOfOffice' : 'default',
      rrule: repeat === 'custom' ? customRule || undefined : presetRrule(repeat, startMs),
      location,
      description,
      meetingUrl,
      color,
    });
  };

  const weekday = new Date(combine(date, '00:00')).toLocaleDateString(undefined, { weekday: 'long' });

  return (
    <div className="flex flex-col gap-3 px-4 py-4">
      <div className="flex items-center gap-2">
        <h2 className="text-ink flex-1 text-[13.5px] font-bold">
          {draft.id ? 'Edit event' : 'New event'}
        </h2>
        <button onClick={closePane} aria-label="Close form"
                className="text-ink-muted hover:text-ink flex h-7 w-7 items-center justify-center rounded-lg">
          <X size={14} />
        </button>
      </div>
      <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)}
             onKeyDown={(e) => e.key === 'Enter' && submit()}
             placeholder="Event title" className={cn(inputCls, 'text-[13.5px] font-medium')} />
      <label className="text-ink-faint text-[11px] font-semibold tracking-wide uppercase">Account</label>
      <select value={calendarId} onChange={(e) => setCalendarId(e.target.value)} className={inputCls}>
        {accountCalendars.map((c) => {
          const a = accounts.find((x) => x.id === c.accountId);
          return <option key={c.id} value={c.id}>{a?.email ?? c.name}</option>;
        })}
        <option value="local-default">My Calendar (local)</option>
      </select>
      <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
      {!allDay && (
        <div className="flex items-center gap-2">
          <input type="time" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
          <span className="text-ink-faint">–</span>
          <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label className="text-ink-muted flex items-center gap-2 text-[12.5px]">
          <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)}
                 className="accent-[var(--color-accent)]" /> All day
        </label>
        <label className="text-ink-muted flex items-center gap-2 text-[12.5px]">
          <input type="checkbox" checked={ooo} onChange={(e) => setOoo(e.target.checked)}
                 className="accent-[var(--color-accent)]" /> Out of office
        </label>
      </div>
      <label className="text-ink-faint text-[11px] font-semibold tracking-wide uppercase">Repeat</label>
      <select value={repeat} onChange={(e) => setRepeat(e.target.value as RepeatPreset | 'custom')}
              className={inputCls}>
        <option value="none">Doesn't repeat</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly on {weekday}</option>
        <option value="monthly">Monthly</option>
        <option value="yearly">Yearly</option>
        <option value="custom">Custom…</option>
      </select>
      {repeat === 'custom' && (
        <>
          <input value={customRule} onChange={(e) => setCustomRule(e.target.value)}
                 placeholder="RRULE, e.g. FREQ=DAILY;INTERVAL=2" className={inputCls} />
          <p className="text-ink-faint text-[11px]">
            Custom rules show their first occurrence only for now.
          </p>
        </>
      )}
      <input value={location} onChange={(e) => setLocation(e.target.value)}
             placeholder="Location" className={inputCls} />
      <div className="border-hairline bg-sunken/40 flex items-center gap-2 rounded-lg border border-dashed px-2.5 py-2">
        <DoorClosed size={13} className="text-ink-faint shrink-0" />
        <span className="text-ink-faint text-[11.5px]">Rooms — available after Google sync</span>
      </div>
      <input value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)}
             placeholder="Meeting link" className={inputCls} />
      <textarea value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder="Description" rows={3} className={cn(inputCls, 'resize-none')} />
      <div className="flex items-center gap-1.5">
        {COLORS.map((c) => (
          <button key={c} onClick={() => setColor(c)} aria-label={`Color ${c}`}
                  className={cn('h-5 w-5 rounded-full transition-transform',
                                color === c && 'ring-ink/40 scale-110 ring-2 ring-offset-1')}
                  style={{ backgroundColor: c }} />
        ))}
      </div>
      <button onClick={submit} disabled={!title.trim()}
              className="bg-accent mt-1 rounded-xl py-2 text-[12.5px] font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40">
        {draft.id ? 'Save changes' : 'Add event'}
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: clean (components are created but not yet rendered — that's fine).

- [ ] **Step 4: Commit**

```bash
git add packages/renderer/src/components/calendar/RightPane.tsx packages/renderer/src/components/calendar/EventForm.tsx
git commit -m "feat(calendar): right pane — shortcuts, event details, event form"
```

---

### Task 8: Calendar sidebar (mini month, accounts, Notion)

**Files:**
- Create: `packages/renderer/src/components/calendar/CalendarSidebar.tsx`

**Interfaces:**
- Consumes: `useCalendar` (cursor, setCursor, calendars, setCalendarVisible, sidebarOpen), `useNotionVisible`, `useAccounts`, `useKanban` (`configured`, `board`), `monthGrid`/`addMonths`/`startOfMonth`/`isToday`/`isSameMonth` from `calendarMonth`.
- Produces: `<CalendarSidebar onAddAccount(): void />`.

- [ ] **Step 1: Create `CalendarSidebar.tsx`**

```tsx
import { ChevronDown, ChevronUp, Eye, EyeOff, Link2, Plus } from 'lucide-react';
import { useState } from 'react';
import {
  addMonths, isSameMonth, isToday, monthGrid, startOfDay, startOfMonth,
} from '../../lib/calendarMonth';
import { cn } from '../../lib/utils';
import { useKanban } from '../../state/kanban';
import { useAccounts } from '../../state/queries';
import { useCalendar } from '../../state/calendar';
import { useNotionVisible } from './useNotionEvents';

const MINI_DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function MiniMonth() {
  const cursor = useCalendar((s) => s.cursor);
  const setCursor = useCalendar((s) => s.setCursor);
  const [month, setMonth] = useState(() => startOfMonth(cursor));
  const { days } = monthGrid(month);
  return (
    <div className="px-4 pt-4">
      <div className="mb-1 flex items-center justify-end gap-1">
        <button onClick={() => setMonth((m) => addMonths(m, -1))} aria-label="Previous month"
                className="text-ink-muted hover:text-ink flex h-6 w-6 items-center justify-center rounded">
          <ChevronUp size={13} />
        </button>
        <button onClick={() => setMonth((m) => addMonths(m, 1))} aria-label="Next month"
                className="text-ink-muted hover:text-ink flex h-6 w-6 items-center justify-center rounded">
          <ChevronDown size={13} />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-0.5 text-center">
        {MINI_DAYS.map((d) => (
          <span key={d} className="text-ink-faint text-[10px] font-semibold">{d}</span>
        ))}
        {days.map((dayMs) => (
          <button key={dayMs} onClick={() => setCursor(dayMs)}
                  className={cn(
                    'mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[11px] tabular-nums',
                    isToday(dayMs) ? 'bg-danger font-bold text-white'
                      : startOfDay(dayMs) === cursor ? 'bg-sunken text-ink font-semibold'
                      : isSameMonth(dayMs, month) ? 'text-ink-muted hover:bg-sunken' : 'text-ink-faint/50 hover:bg-sunken',
                  )}>
            {new Date(dayMs).getDate()}
          </button>
        ))}
      </div>
    </div>
  );
}

function EyeToggle({ on, onClick, label }: { on: boolean; onClick(): void; label: string }) {
  return (
    <button onClick={onClick} aria-label={label}
            className="text-ink-faint hover:text-ink ml-auto flex h-6 w-6 shrink-0 items-center justify-center rounded">
      {on ? <Eye size={12} /> : <EyeOff size={12} />}
    </button>
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
    <aside aria-label="Calendar sidebar"
           className="border-hairline flex h-full w-[280px] shrink-0 flex-col overflow-y-auto border-r pb-4">
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
                  <div key={c.id} className={cn(row, 'text-ink-muted hover:bg-sunken/60')}>
                    <span className="h-3 w-3 shrink-0 rounded"
                          style={{ backgroundColor: c.color, opacity: c.visible ? 1 : 0.35 }} />
                    <span className={cn('truncate', !c.visible && 'opacity-50')}>{c.name}</span>
                    <EyeToggle on={c.visible} label={`Toggle ${c.name}`}
                               onClick={() => setVisible(c.id, !c.visible)} />
                  </div>
                ))}
                <p className="text-ink-faint px-2 py-1 text-[11px]">
                  Organization calendars — available after Google sync
                </p>
              </div>
            </section>
          );
        })}
        {(() => {
          const local = calendars.find((c) => c.id === 'local-default');
          return local ? (
            <div className={cn(row, 'text-ink-muted hover:bg-sunken/60')}>
              <span className="h-3 w-3 shrink-0 rounded"
                    style={{ backgroundColor: local.color, opacity: local.visible ? 1 : 0.35 }} />
              <span className={cn('truncate', !local.visible && 'opacity-50')}>{local.name}</span>
              <EyeToggle on={local.visible} label="Toggle My Calendar"
                         onClick={() => setVisible(local.id, !local.visible)} />
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
            <span className="truncate">{kanban.board?.title ?? 'Notion board'}</span>
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
```

Check `useKanban`'s board shape with `grep -n "title\|configured" packages/renderer/src/state/kanban.ts | head` — if the board title property differs (e.g. `board.name`), use the actual one.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/renderer/src/components/calendar/CalendarSidebar.tsx
git commit -m "feat(calendar): calendar sidebar — mini month, account calendars, Notion"
```

---

### Task 9: Month view + TimeGrid (week/day)

**Files:**
- Create: `packages/renderer/src/components/calendar/MonthView.tsx`
- Create: `packages/renderer/src/components/calendar/TimeGrid.tsx`

**Interfaces:**
- Consumes: `useVisibleEvents`, `useCalendar` (cursor, setCursor, openDetails, openForm, calendars, view, anchor), `packLanes`/`layoutColumns`/`isAllDayLike`, range helpers.
- Produces: `<MonthView />` and `<TimeGrid days={number[]} />` (Task 10 renders them).
- Both views color chips with `event.color ?? calendars.find(c => c.id === event.calendarId)?.color ?? 'var(--color-accent)'` — extract that once per file as `chipColor(event, calendars)`.

- [ ] **Step 1: Create `MonthView.tsx`**

Structure (all real code, follow existing CalendarView JSX conventions):

- `const { days, gridStart } = useMemo(() => monthGrid(anchor), [anchor])`; `const events = useVisibleEvents(gridStart, gridStart + 42 * DAY_MS)`.
- Split `events` with `isAllDayLike` into `spanning` and `timed`.
- Render 6 week rows (`days.slice(w * 7, w * 7 + 7)`). Each row is `relative`: a 7-col grid of day cells underneath, and an absolutely positioned lane layer on top for spanning chips from `packLanes(spanningInRow, rowStart, rowStart + 7 * DAY_MS)` (top offset `24 + lane * 20`px; hide lanes ≥ 3 behind the day's "+N more" count).
- Day cell: date number (red `bg-danger` pill when `isToday`, dim when `!isSameMonth`), cursor ring when `startOfDay(dayMs) === cursor` (`ring-2 ring-accent/60 ring-inset rounded-lg`), up to 3 timed chips (left color bar: `borderLeft: 3px solid chipColor`, time label + title, ⊗ prefix when `eventType === 'outOfOffice'`), then a "+N more" button when overflowing.
- "+N more" opens a small absolute popover (local `useState<number | null>` holding the open dayMs; a `fixed inset-0` transparent click-catcher closes it) listing every event that day; clicking one calls `openDetails(event)`.
- Cell `onClick` → `setCursor(dayMs)`; chip `onClick` → `stopPropagation()` + `openDetails(event)`; cell `onDoubleClick` → `openForm(newDraft(dayMs, calendars))`.

- [ ] **Step 2: Create `TimeGrid.tsx`**

```tsx
// Shared by Week (days.length === 7) and Day (length 1) views.
```

Structure:

- Props: `{ days: number[] }`. `const rangeStart = days[0]!; const rangeEnd = addDays(days[days.length - 1]!, 1);` `const events = useVisibleEvents(rangeStart, rangeEnd)`; split via `isAllDayLike`.
- Constants: `const HOUR_PX = 48; const GUTTER = 56;` grid body height `24 * HOUR_PX`.
- **Header row:** GMT label in the gutter (`'GMT' + (-new Date().getTimezoneOffset() / 60 >= 0 ? '+' : '') + -new Date().getTimezoneOffset() / 60`), then per-day column headers "Thu 20" with a red pill on today.
- **All-day lane** (pinned, collapsible): `packLanes(allDayLike, rangeStart, rangeEnd)` positioned on a `grid-cols-[56px_repeat(N,1fr)]` overlay; each chip `gridColumn: startCol + 2 / span span`, row = lane. A chevron button collapses to one lane with "+N" (local `useState`). Chip click → `openDetails`.
- **Scrollable body** (`overflow-y-auto`, attribute `data-timegrid` — the CalendarView keyboard handler scrolls it with ↑/↓ — and a `ref` that scrolls to `8 * HOUR_PX` on mount): hour gridlines + labels ("5 AM"…) in the gutter; one relative column per day; for each day, `layoutColumns(timedThatDay)` places chips at `top: (start - day) / 3_600_000 * HOUR_PX`, `height: max(20, duration / 3_600_000 * HOUR_PX)`, `left: col / cols * 100%`, `width: 100 / cols %`, with `chipColor` left bar + soft background (`backgroundColor: color + '26'` hex-alpha). OOO chips render with the ⊗ prefix and muted background.
- **Now line:** if today is within `days`, red line across that column at `(Date.now() - startOfDay(Date.now())) / 3_600_000 * HOUR_PX` with the current `timeLabel(Date.now())` chip in the gutter; re-render via a 60 s `setInterval` in a `useEffect`.
- **Drag-create:** `onMouseDown` on a day column records `{ day, startY }`; `mousemove` updates a translucent draft block (30-min snapping: `Math.round(y / (HOUR_PX / 2)) * (HOUR_PX / 2)`); `mouseup` calls `openForm({ ...newDraft(day, calendars), startMs: day + snap(startY), endMs: day + snap(endY) })` (minimum 30 min). Attach move/up listeners on `window` inside the mousedown handler and remove them on mouseup. Plain click (no drag > 4px) just sets the cursor.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/renderer/src/components/calendar/MonthView.tsx packages/renderer/src/components/calendar/TimeGrid.tsx
git commit -m "feat(calendar): month view with spanning lanes; week/day time grid"
```

---

### Task 10: CalendarView shell, keyboard, App integration

**Files:**
- Modify: `packages/renderer/src/components/calendar/CalendarView.tsx` (full rewrite)
- Modify: `packages/renderer/src/App.tsx` (calendar branch, ~line 310-317; pass `onAddAccount`)
- Modify: `packages/renderer/src/components/Sidebar.tsx:67` (`autoHide`)
- Modify: `packages/renderer/src/lib/panels.ts` (`toggleSidebarReveal` ~line 37, `focusPanelRight` ~line 112)

**Interfaces:**
- Consumes: everything above.
- Produces: `CalendarView({ onAddAccount }: { onAddAccount(): void })`.

- [ ] **Step 1: Rewrite `CalendarView.tsx`**

```tsx
import { ChevronDown, ChevronLeft, ChevronRight, PanelRight } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { rangeForView, viewTitle, type CalView } from '../../lib/calendarMonth';
import { cn } from '../../lib/utils';
import { focusSidebar } from '../../lib/panels';
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
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

export function CalendarView({ onAddAccount }: { onAddAccount(): void }) {
  const s = useCalendar();
  const { view, anchor, cursor } = s;

  // Capture-phase so calendar keys win over KeymapProvider's bubble listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (useUi.getState().view !== 'calendar') return;
      const st = useCalendar.getState();
      const meta = e.metaKey || e.ctrlKey;
      const stop = () => { e.preventDefault(); e.stopPropagation(); };

      if (meta && e.key === '\\') { stop(); st.toggleSidebar(); return; }
      if (meta && e.key === '/') { stop(); st.toggleRightPane(); return; }
      if (meta || e.altKey || inEditable(e)) return;

      switch (e.key) {
        case 't': stop(); st.goToday(); return;
        case 'c': stop(); st.openForm(newDraft(st.cursor, st.calendars)); return;
        case 'm': stop(); st.setView('month'); return;
        case 'w': stop(); st.setView('week'); return;
        case 'd': stop(); st.setView('day'); return;
        case 'Enter':
          if ((e.target as HTMLElement | null)?.closest?.('button, a, input')) return;
          stop(); st.openForm(newDraft(st.cursor, st.calendars)); return;
        case 'ArrowRight': stop(); st.moveCursorBy(1); return;
        case 'ArrowLeft': {
          stop();
          const { start } = rangeForView(st.view, st.anchor);
          if (st.cursor === start) focusSidebar();   // left edge → reveal mail rail
          else st.moveCursorBy(-1);
          return;
        }
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
          if (st.rightPane.kind !== 'shortcuts') { stop(); st.closePane(); return; }
          stop(); useUi.getState().setView('home'); return;
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  useEffect(() => { s.refresh(); void s.loadCalendars(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const days = useMemo(() => rangeForView(view, anchor).days, [view, anchor]);

  return (
    <div className="flex h-full min-w-0 flex-1">
      <CalendarSidebar onAddAccount={onAddAccount} />
      <div className="flex h-full min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 px-5 pt-4 pb-3">
          <h1 className="text-ink text-[19px] font-bold tracking-tight">{viewTitle(anchor)}</h1>
          <div className="ml-auto flex items-center gap-1.5">
            <div className="border-hairline relative flex h-8 items-center rounded-lg border">
              <select
                value={view}
                onChange={(e) => s.setView(e.target.value as CalView)}
                aria-label="Calendar view"
                className="text-ink h-full appearance-none bg-transparent pr-7 pl-3 text-[12.5px] font-medium outline-none"
              >
                {VIEWS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
              <ChevronDown size={13} className="text-ink-faint pointer-events-none absolute right-2" />
            </div>
            <button onClick={s.goToday}
                    className="border-hairline text-ink-muted hover:bg-sunken hover:text-ink h-8 rounded-lg border px-3 text-[12.5px] font-medium">
              Today
            </button>
            <button onClick={() => s.page(-1)} aria-label="Previous"
                    className="text-ink-muted hover:bg-sunken hover:text-ink flex h-8 w-8 items-center justify-center rounded-lg">
              <ChevronLeft size={16} />
            </button>
            <button onClick={() => s.page(1)} aria-label="Next"
                    className="text-ink-muted hover:bg-sunken hover:text-ink flex h-8 w-8 items-center justify-center rounded-lg">
              <ChevronRight size={16} />
            </button>
            <button onClick={s.toggleRightPane} aria-label="Toggle side panel"
                    className={cn('flex h-8 w-8 items-center justify-center rounded-lg',
                                  s.rightPaneOpen ? 'text-ink' : 'text-ink-muted hover:text-ink')}>
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
```

- [ ] **Step 2: App integration (full takeover)**

In `App.tsx`: the calendar branch escapes the `<main>`-beside-`<Sidebar>` frame. Replace the shell block (lines ~305-318) so calendar swaps the whole middle region but keeps `<Sidebar>` mounted for the reveal:

```tsx
        {view !== 'calendar' && <TopBar />}
        <div className="relative flex min-h-0 flex-1">
          <Sidebar onAddAccount={() => setAddingAccount(true)} />
          <main className="flex h-full min-w-0 flex-1 flex-col">
            {view === 'home' ? (
              <HomeView />
            ) : view === 'calendar' ? (
              <CalendarView onAddAccount={() => setAddingAccount(true)} />
            ) : (
              <MailView />
            )}
          </main>
        </div>
```

- [ ] **Step 3: Mail-rail auto-hide on calendar**

- `Sidebar.tsx:67`: `const autoHide = view === 'home' || view === 'calendar';`
- `panels.ts` `toggleSidebarReveal` (line ~37): `if (ui.view !== 'home' && ui.view !== 'calendar') { ... }`
- `panels.ts` `focusPanelRight` (line ~112): `if (useUi.getState().view === 'home' || useUi.getState().view === 'calendar') { blur; return; }`
- Check line 234's `autoHide || v === 'home'` blur condition in Sidebar.tsx still reads correctly (it uses `autoHide`, so no change needed — verify only).

- [ ] **Step 4: Typecheck + full suite**

Run: `npx tsc --noEmit -p tsconfig.web.json && npx vitest run packages/renderer/test`
Expected: clean / PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/components/calendar/CalendarView.tsx packages/renderer/src/App.tsx packages/renderer/src/components/Sidebar.tsx packages/renderer/src/lib/panels.ts
git commit -m "feat(calendar): three-column takeover shell, keyboard map, mail-rail reveal"
```

---

### Task 11: Live verification and polish

**Files:** none new — fixes land where the walkthrough finds them.

- [ ] **Step 1:** Ask the user to restart `pnpm dev` (db/shared/sync changed — Global Constraints). Verify the migration ran: `sqlite3 "$HOME/Library/Application Support/spark-clone/mail.db" "PRAGMA table_info(events);"` shows `event_type`.
- [ ] **Step 2:** Walk every shortcut from the spec table in the running app: `t`, `c`, `m`/`w`/`d`, all four arrows (including paging past month/week edges and `←`-at-edge revealing the mail rail), `Enter`, `⌘\`, `⌘/`, `Esc` (form → shortcuts → home).
- [ ] **Step 3:** Through the UI create and verify: a timed event, an all-day event, a multi-day event (spans in month + all-day lane in week), an out-of-office event (⊗ styling), a weekly repeating event (occurrences repeat across weeks; edit shows "whole series" note; delete removes all), two overlapping timed events (columns split), 5 events on one day (month "+N more" popover), a second-account event via the Account picker, and a calendar visibility toggle (events vanish/return).
- [ ] **Step 4:** Verify drag-create on the week grid opens the pre-filled form; verify the now-line sits at the current time; verify Notion due-dates appear and their eye toggle works.
- [ ] **Step 5:** Run the `verify` skill's project flow if present; then `npx vitest run packages/renderer/test` and both typechecks one final time.
- [ ] **Step 6: Commit** any fixes:

```bash
git add <files you touched>
git commit -m "fix(calendar): polish from live verification walkthrough"
```
