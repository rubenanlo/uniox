# Account avatars & account-switch shortcuts — design

**Date:** 2026-07-17
**Status:** approved

## Goal

Let the user give each mail account a custom picture (e.g., their Gmail profile
photo) in place of the colored-initials circle shown in the sidebar. Pictures
are chosen manually from a local file — identical flow for OAuth and
app-password accounts, since app-password accounts have no Google API access to
fetch photos automatically.

## Storage

Avatars live in the existing UI-prefs persistence path (`settings` key-value
store via `persist.ts`), not in the sync database:

- New `accountAvatars: Record<accountId, string>` field on the zustand `useUi`
  store, where the value is a small data-URL.
- Persisted as part of `UiPrefs` (same debounced `settings:set` flow as
  `priorityEmails`), restored on launch.
- On upload the renderer center-crops the chosen image to a square and
  downscales to 96×96 via canvas (`toDataURL('image/jpeg', 0.85)`, white
  background fill so transparent PNGs don't go black) — a few KB per account.

No main-process, sync-engine, or schema changes. The renderer CSP already
allows `img-src data:`.

## Components

- `lib/avatar.ts` — `AVATAR_SIZE`, pure `cropBox(width, height)` (largest
  centered square), and `fileToAvatarDataUrl(file)` which decodes via
  `createImageBitmap` (rejects on non-images) and draws to canvas.
- `components/ui/AccountIcon.tsx` — renders the avatar `<img>` when present,
  else today's colored initials. Used by the sidebar and the Accounts tab so
  icons look identical everywhere. `ACCOUNT_HUES` moves from `Sidebar.tsx` to
  `lib/utils.ts` so both call sites share it.
- **Settings → Accounts tab** (new entry in `SECTIONS` in `SettingsSheet.tsx`):
  lists each account with its icon, display name, email, a "Choose image…"
  control (hidden `<input type="file" accept="image/*">`) and a "Remove" button
  that reverts to initials.
- `Sidebar.tsx` — account buttons render the image when an avatar exists;
  selection ring and sync-status dots unchanged.

## Account-switch shortcuts (added mid-implementation at user request)

⌘1 selects the All-accounts filter; ⌘2–⌘9 select accounts in sidebar order
(⌘2 is the first account, mirroring the sidebar where "All" is the first
button). Implemented as entries in the action registry (`actions/registry.ts`,
section "Navigate"), so keyboard dispatch, the Command Center, and the
shortcuts sheet all pick them up automatically. Plain ⌘digit is free — the
layout shortcuts use ⌘⌥digit — and the app menu defines no conflicting
accelerators. Combos for accounts that don't exist are no-ops.

## Error handling

- Unreadable / non-image files: inline error in the Accounts tab, previous
  icon kept.
- Removing an account may orphan a map entry; it is ignored at render time and
  costs a few KB — no cleanup needed.

## Testing

- Unit tests for `cropBox` (landscape, portrait, square, odd dimensions) in
  `packages/renderer/test/avatar.test.ts` (vitest runs in node, so only the
  pure math is unit-tested; the canvas path is verified by running the app).
