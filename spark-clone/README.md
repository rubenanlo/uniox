# spark-clone

A local-first desktop mail client replicating Spark Desktop's core experience.
Electron + TypeScript. **Zero backend**: OAuth/passwords stay on-device (OS
keychain), mail lives in a local SQLite database, every "superpower" is local
state plus a local scheduler.

Engineering plan: `../.research/20260715-spark-mail-replication-x7k2/polished_report.md`.

## Status

Phases 0–4 complete. On top of the Phase 0–2 core:

- **Snooze** (`S`): IMAP-encoded (SparkClone/Snoozed folder move + local
  timer), presets/custom/Someday, returns unread with optional alert, and a
  new incoming message auto-cancels it (Spark's rule)
- **Set Aside** (`G`), **Reminders** (`H`, cancelled by an incoming reply),
  **Send Later** (composer clock → Outbox with Send now / Cancel; overdue
  sends from a closed app wait for an explicit decision)
- **Smart Inbox**: rule-engine categorizer (List-Unsubscribe/List-Id →
  Newsletters, Auto-Submitted/no-reply → Notifications, participation →
  Personal, fallback Personal), sticky per-sender corrections that re-route
  existing mail, category cards with per-card bulk actions, Classic toggle
- **Gatekeeper**: first-contact Accept/Block (`⌘T`/`⌘B`) queue, block-domain,
  blocked senders auto-archive; senders you've written to are pre-accepted
- Notifications fire only for Personal, un-gated mail
- Templates ({name} placeholder semantics), per-account signatures,
  Settings → Scheduling presets

Phase 0–2 core:

- Unified inbox over multiple IMAP accounts (backfill, CONDSTORE/QRESYNC or
  UID-diff fallback, IMAP IDLE push while running)
- Threading via References/In-Reply-To, FTS5 search, unread counts
- Safe HTML rendering: DOMPurify + sandboxed iframe (`script-src 'none'`,
  never `allow-scripts`), remote images blocked by default, CID inline images
- Composer: TipTap rich text, reply/reply-all/forward with quoting,
  attachments, undo send; sends via SMTP + APPENDs to Sent
- Action registry driving the Spark keyboard map, `⌘K` Command Center, hover
  action bars, three list layouts (`⌘⌥1/2/3`), split view, light/dark
- Done (`E`) / Delete with undo toast, Pin (`D`), read/unread

Next (Phase 3–4): snooze, send later, reminders, Set Aside, Smart Inbox
categorization, Gatekeeper. OAuth providers (Gmail/M365) are stubbed pending
app registrations — see `TODO(user)` notes in the plan.

## Architecture

```
main process (thin, privileged)  ──spawns──▶  sync utilityProcess
  window · IPC broker · app://                 ImapFlow · nodemailer · mailparser
  safeStorage credentials                      better-sqlite3 (only DB writer)
        ▲ typed IPC (contextBridge)            task queue · scheduler
renderer (sandboxed React)  ──tasks/queries──▶ SQLite (WAL) + attachments dir
```

Packages: `@app/main`, `@app/sync`, `@app/db`, `@app/shared`, `@app/renderer`,
`@app/email-render`.

## Development

```bash
pnpm install && pnpm rebuild     # rebuild better-sqlite3 for Electron ABI
pnpm mail:up && pnpm seed        # Dovecot + Mailpit in Docker, fixture mail
pnpm dev                         # run the app (electron-vite)
```

Dev accounts: `alice@dev.local` / `bob@dev.local`, password `pass`, via the
"Use local dev server" button in onboarding. Mailpit UI: http://localhost:8025.

## Verification

```bash
pnpm typecheck && pnpm lint
pnpm test:electron               # unit + live IMAP integration (needs mail:up)
pnpm build && pnpm e2e           # drives the real app; screenshots in dev/e2e-artifacts/
```

`pnpm test` runs under plain Node and will fail to load better-sqlite3 after
`pnpm rebuild`; use `pnpm test:electron` (runs vitest under Electron's Node).

## Build & run (production)

Compile the app and run it locally without packaging:

```bash
pnpm install && pnpm rebuild
pnpm build
pnpm start                       # runs electron against out/
```

Package a distributable for your current OS:

```bash
pnpm dist:mac                    # macOS → release/Uniox-*-arm64.dmg + .zip
pnpm dist:win                    # Windows → release/Uniox Setup *.exe
pnpm dist:linux                  # Linux → release/Uniox-*.AppImage
pnpm dist                        # build for the host platform
```

Artifacts land in `release/`. On macOS, open the `.dmg`, drag **Uniox** to
Applications, and launch from there. The first launch may show a Gatekeeper
warning because the build is unsigned — right-click → Open to bypass, or sign
with a Developer ID certificate (`CSC_LINK` / `CSC_KEY_PASSWORD` env vars).

User data (SQLite DB, attachments, credentials) is stored under Electron's
`userData` path, separate from the app bundle — rebuilding or reinstalling
does not wipe mail. Dev (`pnpm dev`) uses `~/Library/Application Support/spark-clone`;
the installed `.app` uses `~/Library/Application Support/com.sparkclone.mail` so
mock/dev accounts never leak into production.
