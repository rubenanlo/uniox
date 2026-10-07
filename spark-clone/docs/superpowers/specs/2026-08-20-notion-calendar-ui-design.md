# Notion-style Calendar — Phase 1: UI Shell

**Date:** 2026-08-20
**Status:** Approved (design review in chat, 2026-08-20)
**Scope:** Sub-project 1 of 3. Phase 2 = Google Calendar sync. Phase 3 = full
recurrence engine. This phase builds the complete Notion-Calendar UI backed by
local + Notion-derived events only. No fake data anywhere: controls that need
Google sync render their final layout with an "available after Google sync"
empty state.

## Goal

Rebuild the calendar to mimic Notion Calendar: month/week/day views, a
calendar-owned left sidebar, a right pane (shortcuts → event details → event
form), an all-day lane, out-of-office and repeating events, location, an
account picker for new events, and keyboard-first navigation consistent with
the rest of spark-clone (Home sidebar reveal, kanban-style cursor).

## 1. Layout & navigation

`CalendarView` is a **full-window takeover**: opening Calendar replaces the
mail shell with `[calendar sidebar 280px] [grid, flexible] [right pane 300px]`.

- **Top bar** over the grid: month title ("August 2026") on the left; view
  switcher dropdown (Month/Week/Day), **Today** button, and prev/next chevrons
  on the right.
- **Mail sidebar (app rail):** auto-hidden off-canvas while the calendar is
  open, exactly like Home. `←` when the day cursor is already at the grid's
  left edge reveals and focuses it (`focusSidebar()`); `→` from the sidebar
  blurs it, tucking it away and returning to the grid. `Esc` with no pane
  state open returns to mail.
- **Day cursor (kanban/email-style):** the grid always has a focused day with
  a subtle ring. `←`/`→` move by day; `↑`/`↓` move by week in Month view and
  scroll by hour-step in Week/Day. Walking past the visible range **pages the
  period** (e.g. `→` on the last visible day flips to the next month/week).
  `Enter` on the cursor opens the create form for that day in the right pane.
- **Pane toggles:** `⌘\` hides/shows the calendar sidebar; `⌘/` hides/shows
  the right pane. Collapsed panes yield their width to the grid; state
  persists for the session.

### Keyboard shortcuts (active while calendar is open, not while typing)

| Key | Action |
| --- | --- |
| `t` | Go to today |
| `c` | Create event (right pane form) |
| `m` / `w` / `d` | Month / Week / Day view |
| `←` `→` | Move day cursor; past the edge pages the period; at left edge reveals mail sidebar |
| `↑` `↓` | Move cursor by week (Month) / scroll time (Week/Day) |
| `Enter` | Create event on the cursor day |
| `⌘\` | Toggle calendar sidebar |
| `⌘/` | Toggle right pane |
| `Esc` | Close right-pane state; else back to mail |

The right pane's default "Useful shortcuts" list documents exactly these.

## 2. Left sidebar (calendar-owned)

Top to bottom, mirroring the screenshots:

1. **Mini month** — Su-first week, red pill on today, up/down month arrows;
   clicking a day moves the main grid (and cursor) there.
2. **Scheduling row** — visual placeholder (link icon + "Scheduling" + eye);
   functional in a later phase.
3. **Per-account sections** — each mail account (`accounts:list`) is a header
   (its email address); under it, its calendars with color dot, name, and an
   eye visibility toggle. Phase 1: each account has exactly one local
   calendar (see §4). An org-teammates area under each account shows the
   "available after Google sync" empty state.
4. **"+ Add calendar account"** row.
5. **Notion section** — workspace name, "+ Add Notion database", Notion badge;
   reflects the existing Sprint-board connection from `useKanban`. The Notion
   derived calendar has a visibility toggle here.

## 3. Right pane (three states)

- **(a) Shortcuts (default):** "Useful shortcuts" list as in the screenshots.
- **(b) Event details** (event clicked): title, calendar + account, time
  range (or "All day" / repeat description), location, meeting link,
  description, "Open in Notion" for notion-source events. Edit and Delete for
  editable (local) events; read-only sources show no mutation buttons.
- **(c) Create/edit form** (replaces the modal `EventEditor`): title; account
  picker (which account's calendar owns the event); date + start/end time;
  **All day** toggle; **Out of office** event type toggle; **Repeat** picker
  (None / Daily / Weekly on <weekday> / Monthly / Yearly / Custom…); location
  (free text); **Rooms** picker rendered with the sync empty state;
  description; meeting URL. Save / Cancel; `Esc` returns to previous state.

The pane header has a collapse button mirroring `⌘/`.

## 4. Data model (additive)

- `events` gains `event_type TEXT NOT NULL DEFAULT 'default'`
  (`'default' | 'outOfOffice'`). The existing `rrule` column starts being
  used. Schema migration follows the repo's existing migration pattern.
- `CalendarEvent` / `CalendarEventInput` gain `eventType`, `rrule`; events
  expose `accountId` derived from their calendar.
- **Per-account local calendars:** each mail account lazily gets one
  `calendars` row (`account_id` set, `source 'local'`, named after the
  account) created on first calendar open. This makes the account picker real
  in phase 1 and maps 1:1 onto the account's Google default calendar in
  phase 2. The `local-default` calendar remains for events not tied to an
  account.
- **IPC:** `calendar:list` query (calendars with visibility),
  `calendar:setVisible` command; `calendar:events` unchanged;
  `calendar:event:save` accepts the new fields.

## 5. Repeating events (presets only)

Repeat choices are stored as real RRULE strings (`FREQ=DAILY`,
`FREQ=WEEKLY;BYDAY=TH`, `FREQ=MONTHLY;BYMONTHDAY=20`, `FREQ=YEARLY`). A pure
renderer function `expandRrule(event, rangeStart, rangeEnd)` materialises
occurrences for the four presets within the queried range only. Custom rules
(intervals, counts, until-dates) are accepted by the picker UI but persist
without expansion — first occurrence renders — until phase 3. Occurrence ids
are `<eventId>:<occurrenceStartMs>`; editing/deleting from an occurrence acts
on the whole series in phase 1 (this-event-only edits are phase 3).

## 6. The three views

- **Month:** 5–6 week grid. Multi-day/all-day events render as spanning
  chips packed into lanes per week row; timed events as left-color-bar chips
  with a time label; per-day overflow shows "N more" opening a day popover.
  Out-of-office renders as a filled chip with the ⊗ glyph.
- **Week/Day — one shared `TimeGrid`** (Day = one column): hour rules
  12 AM–11 PM with the GMT offset label; **all-day lane pinned at the top**
  (collapsible chevron, like Notion); timed events absolutely positioned with
  column-splitting for overlaps; red current-time line with a clock label;
  click-drag on empty grid creates a draft event and opens the right-pane
  form pre-filled with the dragged range. Out-of-office blocks render muted
  with the ⊗ label.
- Event colors: per-event override, else calendar color (existing rule).

## 7. Out of scope for phase 1

Google Calendar sync (org/teammate calendars, real rooms, cross-account
Google events, OAuth calendar scope + re-consent), full RRULE engine and
this-event-only edits, scheduling/availability sharing, drag-to-move/resize
existing events, search-events box, teammate overlay (`P`), command menu.

## 8. Testing & verification

- **Vitest (pure, DB-free — runs locally):** `expandRrule` presets and range
  clipping; month/week/day range math; all-day lane packing; overlap column
  assignment; day-cursor paging logic.
- **Live verification:** seeded local events through the UI itself (timed,
  all-day, multi-day, OOO, repeating, overlapping) in the dev app; keyboard
  walkthrough of every shortcut in the table above.
