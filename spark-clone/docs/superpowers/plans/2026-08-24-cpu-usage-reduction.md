# CPU Usage Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut Uniox's steady-state CPU/GPU usage by pausing the always-on orb shader, coalescing delta fan-out, skipping no-op sync passes, adopting Google Calendar incremental sync, gating on power events, and fixing renderer re-render hotspots.

**Architecture:** No new subsystems. Each task tightens an existing loop: renderer (orb, timers, store subscriptions), main process (delta coalescing, powerMonitor), sync utility process (IMAP poll fast-path, calendar syncToken), db (pragmas, index).

**Tech Stack:** Electron 43, React 19 + zustand + @react-three/fiber, imapflow, better-sqlite3, vitest.

**Spec:** The CPU audit findings in the conversation of 2026-08-24 (summarized per-task below; each task header restates its finding).

## Global Constraints

- Do not rename the app or its data directories (`spark-clone` name is pinned — saved credentials decrypt by app name).
- `pnpm typecheck` must pass after every task (`tsc -p tsconfig.node.json && tsc -p tsconfig.web.json`).
- DB-backed vitest suites need `pnpm test:electron` locally (better-sqlite3 is built for Electron's ABI); pure suites run with `pnpm test`.
- No behavior changes to mail correctness: every sync fast-path must fall back to the existing full pass when in doubt.
- Match existing code style: comment only constraints code can't show, 2-space indent, single quotes.

---

### Task 1: Pause the orb shader when idle

Finding: `SpecterOrb` renders a raymarch shader at 60fps forever (`frameloop='always'` whenever on-screen; even the reduced-motion path calls `invalidate()` per frame). Biggest steady-state CPU/GPU cost.

**Files:**
- Modify: `packages/renderer/src/components/orb/SpecterOrb.tsx`
- Modify: `packages/renderer/src/components/orb/OrbCorner.tsx:188`

**Interfaces:**
- Produces: `SpecterOrb` gains no new props; existing `paused` prop becomes the idle gate. `OrbCorner` passes `paused={!hovered && !pinned}`.

- [ ] **Step 1: Hoist reduced-motion detection out of OrbCore**

In `SpecterOrb.tsx`, OrbCore currently owns `calm` via a `matchMedia` effect (lines 385, 400–406). Move that state to the `SpecterOrb` component (same code, same hook shape) and pass it down as a prop `calm: boolean` (add to `OrbCoreProps`, remove the local state + effect from OrbCore). `SpecterOrb` needs it to choose the frameloop.

- [ ] **Step 2: Demand-drive the frameloop when still**

In `SpecterOrb`, compute `const still = paused || calm;` and change the Canvas prop (line 644):

```tsx
frameloop={awake && !still ? 'always' : 'demand'}
```

In OrbCore's `useFrame` (line 454–538), replace the unconditional trailing `invalidate()` (line 537) with:

```ts
if (!still) invalidate();
```

where `still = paused || calm` is already computed at line 459. Rationale: in `'always'` mode the call was a no-op; in `'demand'` mode it was the self-perpetuating loop. With it gated, a still orb renders once per external invalidation (r3f auto-invalidates on React tree updates, so the 700ms opacity tween — which re-renders OrbCore via the `opacity` prop — still animates, then the loop stops).

- [ ] **Step 3: Pass paused from OrbCorner**

In `OrbCorner.tsx:188`:

```tsx
<SpecterOrb width={120} height={120} opacity={opacity} backgroundColor="transparent" paused={!hovered && !pinned} />
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck` — expect clean. Then `pnpm dev` briefly: orb should be static at rest, animate on hover, and Activity Monitor GPU/CPU for the renderer should drop when idle.

- [ ] **Step 5: Commit**

```bash
git add packages/renderer/src/components/orb/
git commit -m "perf(orb): stop the shader frameloop while the orb is idle"
```

---

### Task 2: Coalesce delta fan-out in main + cache the notification sound

Finding: `broadcastDelta` (`packages/main/src/index.ts:232`) forwards every `threads-changed`/`sync-status` event; sync bursts trigger N full renderer re-queries. Each `notify` also does a settings DB round-trip.

**Files:**
- Create: `packages/main/src/delta-coalescer.ts`
- Test: `packages/main/test/delta-coalescer.test.ts`
- Modify: `packages/main/src/index.ts` (broadcastDelta, command handler)

**Interfaces:**
- Produces: `class DeltaCoalescer { constructor(emit: (e: DeltaEvent) => void, intervalMs?: number); push(e: DeltaEvent): void; }` — leading-edge emit, then one merged trailing emit per burst window (250ms default). Merges: `threads-changed` (union accountIds), `sync-status` (last-wins per accountId), `calendar-changed` (dedupe). All other kinds pass through immediately.

- [ ] **Step 1: Write the failing test** (`packages/main/test/delta-coalescer.test.ts`, pure — uses vitest fake timers)

```ts
import { describe, expect, it, vi } from 'vitest';
import type { DeltaEvent } from '@app/shared';
import { DeltaCoalescer } from '../src/delta-coalescer';

const tc = (ids: string[]): DeltaEvent => ({ kind: 'threads-changed', accountIds: ids });

describe('DeltaCoalescer', () => {
  it('emits the first threads-changed immediately, merges the burst into one trailing event', () => {
    vi.useFakeTimers();
    const out: DeltaEvent[] = [];
    const c = new DeltaCoalescer((e) => out.push(e), 250);
    c.push(tc(['a']));
    c.push(tc(['a']));
    c.push(tc(['b']));
    expect(out).toEqual([tc(['a'])]); // leading edge only
    vi.advanceTimersByTime(250);
    expect(out).toEqual([tc(['a']), tc(['a', 'b'])]); // merged trailing
    vi.advanceTimersByTime(1000);
    expect(out.length).toBe(2); // nothing more pending
    vi.useRealTimers();
  });

  it('keeps only the latest sync-status per account', () => {
    vi.useFakeTimers();
    const out: DeltaEvent[] = [];
    const c = new DeltaCoalescer((e) => out.push(e), 250);
    const st = (state: 'syncing' | 'idle'): DeltaEvent => ({
      kind: 'sync-status',
      status: { accountId: 'a', state },
    });
    c.push(st('syncing'));
    c.push(st('idle'));
    vi.advanceTimersByTime(250);
    expect(out).toEqual([st('syncing'), st('idle')]);
    vi.useRealTimers();
  });

  it('passes other kinds through untouched', () => {
    const out: DeltaEvent[] = [];
    const c = new DeltaCoalescer((e) => out.push(e), 250);
    const n: DeltaEvent = { kind: 'notify', title: 't', body: 'b' };
    c.push(n);
    expect(out).toEqual([n]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/main/test/delta-coalescer.test.ts` — expect FAIL (module not found).

- [ ] **Step 3: Implement `packages/main/src/delta-coalescer.ts`**

```ts
import type { DeltaEvent, SyncStatus } from '@app/shared';

/**
 * Sync bursts (backfill, multi-folder poll) emit dozens of coarse deltas in a
 * row; each one makes the renderer re-run its list queries. Emit the first of
 * a burst immediately (snappy single events), then fold the rest into one
 * merged event per window.
 */
export class DeltaCoalescer {
  private timer: NodeJS.Timeout | null = null;
  private accountIds = new Set<string>();
  private statuses = new Map<string, SyncStatus>();
  private calendarChanged = false;

  constructor(
    private readonly emit: (e: DeltaEvent) => void,
    private readonly intervalMs = 250,
  ) {}

  push(e: DeltaEvent): void {
    switch (e.kind) {
      case 'threads-changed':
        if (!this.timer) {
          this.emit(e);
          this.arm();
        } else {
          for (const id of e.accountIds) this.accountIds.add(id);
        }
        break;
      case 'sync-status':
        if (!this.timer) {
          this.emit(e);
          this.arm();
        } else {
          this.statuses.set(e.status.accountId, e.status);
        }
        break;
      case 'calendar-changed':
        if (!this.timer) {
          this.emit(e);
          this.arm();
        } else {
          this.calendarChanged = true;
        }
        break;
      default:
        this.emit(e);
    }
  }

  private arm(): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      const ids = [...this.accountIds];
      this.accountIds.clear();
      const statuses = [...this.statuses.values()];
      this.statuses.clear();
      const cal = this.calendarChanged;
      this.calendarChanged = false;
      if (ids.length) this.emit({ kind: 'threads-changed', accountIds: ids });
      for (const status of statuses) this.emit({ kind: 'sync-status', status });
      if (cal) this.emit({ kind: 'calendar-changed' });
      // A flush that carried anything re-arms once more so a still-running
      // burst keeps coalescing instead of emitting per-event again.
      if (ids.length || statuses.length || cal) this.arm();
    }, this.intervalMs);
  }
}
```

Note: the re-arm at the end means the trailing timer only fully stops after one empty window; adjust the first test's final assertion if you drop that (keep it — it prevents leading-edge spam during long bursts). With the re-arm, after the merged flush a further `vi.advanceTimersByTime(250)` fires an empty flush (no emit), so `out.length` stays 2 — the test as written passes.

- [ ] **Step 4: Run the test**

Run: `pnpm test packages/main/test/delta-coalescer.test.ts` — expect PASS.

- [ ] **Step 5: Wire into `broadcastDelta` and cache the notify sound**

In `packages/main/src/index.ts`:

```ts
import { DeltaCoalescer } from './delta-coalescer';
```

Add near `broadcastDelta`:

```ts
const deltaCoalescer = new DeltaCoalescer((e) => mainWindow?.webContents.send('delta', e));
let notifySoundCache: NotifySound | null = null;
```

Change `broadcastDelta`'s first line from `mainWindow?.webContents.send('delta', event)` to `deltaCoalescer.push(event)`.

In `notifySound()`, return the cache when set, and store the resolved value:

```ts
async function notifySound(): Promise<NotifySound> {
  if (notifySoundCache) return notifySoundCache;
  try {
    const v = (await bridge?.query('settings:get', { key: 'notificationSound' })) as string | null;
    if (v === 'None' || (NOTIFY_SOUNDS as readonly string[]).includes(v ?? '')) {
      notifySoundCache = v as NotifySound;
      return notifySoundCache;
    }
  } catch {
    /* fall through to default */
  }
  return DEFAULT_NOTIFY_SOUND;
}
```

In the `ipcMain.handle('command', …)` handler (line 295), before the default `bridge.query` fall-through, invalidate on settings writes:

```ts
if (channel === 'settings:set' && (args as { key?: string })?.key === 'notificationSound') {
  notifySoundCache = null;
}
```

(Place it at the top of the handler, before the `switch`, so it composes with the existing routing.)

- [ ] **Step 6: Verify + commit**

Run: `pnpm typecheck && pnpm test packages/main/test` — expect PASS.

```bash
git add packages/main/src/delta-coalescer.ts packages/main/test/delta-coalescer.test.ts packages/main/src/index.ts
git commit -m "perf(main): coalesce delta bursts and cache the notification sound"
```

---

### Task 3: Skip no-op IMAP sync passes and slow the poll

Finding: every folder of every account runs a full 3-month SEARCH + full UID diff every 60s (`account-sync.ts:492-502`), plus `reconcileServerState` + `hydrateRecentBodies` per tick, even when nothing changed. IMAP IDLE already covers INBOX push.

**Files:**
- Create: `packages/sync/src/poll-policy.ts`
- Test: `packages/sync/test/poll-policy.test.ts`
- Modify: `packages/sync/src/account-sync.ts`

**Interfaces:**
- Produces: `shouldSkipFolderSync(input: SkipInput): boolean` where

```ts
export interface FolderStatusSnapshot {
  uidValidity: number;
  uidNext: number;
  exists: number;
  modseq: string | null;
}
export interface SkipInput {
  cursorUidValidity: number | null;
  prev: FolderStatusSnapshot | null; // last snapshot this process saw for the folder
  now: FolderStatusSnapshot;
  hasCondstore: boolean;
  msSinceFullSync: number; // Infinity when never fully synced this session
}
```

- `AccountSync.syncFolder` returns `Promise<boolean>` (true = something changed / full pass ran).

- [ ] **Step 1: Write the failing test** (`packages/sync/test/poll-policy.test.ts`, pure)

```ts
import { describe, expect, it } from 'vitest';
import { shouldSkipFolderSync, type FolderStatusSnapshot } from '../src/poll-policy';

const snap = (over: Partial<FolderStatusSnapshot> = {}): FolderStatusSnapshot => ({
  uidValidity: 7,
  uidNext: 100,
  exists: 42,
  modseq: '555',
  ...over,
});

describe('shouldSkipFolderSync', () => {
  const base = {
    cursorUidValidity: 7,
    prev: snap(),
    now: snap(),
    hasCondstore: true,
    msSinceFullSync: 60_000,
  };

  it('skips when nothing moved on a CONDSTORE server', () => {
    expect(shouldSkipFolderSync(base)).toBe(true);
  });

  it('never skips the first pass of a session', () => {
    expect(shouldSkipFolderSync({ ...base, prev: null, msSinceFullSync: Infinity })).toBe(false);
  });

  it('runs on new mail (uidNext advanced)', () => {
    expect(shouldSkipFolderSync({ ...base, now: snap({ uidNext: 101 }) })).toBe(false);
  });

  it('runs on expunge (exists dropped)', () => {
    expect(shouldSkipFolderSync({ ...base, now: snap({ exists: 41 }) })).toBe(false);
  });

  it('runs on flag change (modseq moved)', () => {
    expect(shouldSkipFolderSync({ ...base, now: snap({ modseq: '556' }) })).toBe(false);
  });

  it('runs on uidvalidity change', () => {
    expect(shouldSkipFolderSync({ ...base, cursorUidValidity: 6 })).toBe(false);
  });

  it('without CONDSTORE, still refreshes flags every 15 minutes', () => {
    const noCond = { ...base, hasCondstore: false, now: snap({ modseq: null }), prev: snap({ modseq: null }) };
    expect(shouldSkipFolderSync({ ...noCond, msSinceFullSync: 5 * 60_000 })).toBe(true);
    expect(shouldSkipFolderSync({ ...noCond, msSinceFullSync: 16 * 60_000 })).toBe(false);
  });

  it('forces a periodic full pass so the 3-month window keeps advancing', () => {
    expect(shouldSkipFolderSync({ ...base, msSinceFullSync: 7 * 60 * 60_000 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test packages/sync/test/poll-policy.test.ts` — expect FAIL (module not found).

- [ ] **Step 3: Implement `packages/sync/src/poll-policy.ts`**

```ts
/** Without CONDSTORE, flag changes are invisible in STATUS — refresh this often. */
export const FLAGS_REFRESH_MS = 15 * 60_000;
/** The 3-month backfill window only advances during a full pass; run one this often. */
export const FULL_SYNC_INTERVAL_MS = 6 * 60 * 60_000;

export interface FolderStatusSnapshot {
  uidValidity: number;
  uidNext: number;
  exists: number;
  modseq: string | null;
}

export interface SkipInput {
  cursorUidValidity: number | null;
  prev: FolderStatusSnapshot | null;
  now: FolderStatusSnapshot;
  hasCondstore: boolean;
  msSinceFullSync: number;
}

/**
 * A poll tick may skip a folder's full SEARCH + UID diff only when the
 * mailbox provably didn't change: same UIDVALIDITY, no new mail (UIDNEXT),
 * no expunges (EXISTS), and — on CONDSTORE servers — no flag churn
 * (HIGHESTMODSEQ). Anything uncertain falls through to the full pass.
 */
export function shouldSkipFolderSync(input: SkipInput): boolean {
  const { cursorUidValidity, prev, now, hasCondstore, msSinceFullSync } = input;
  if (!prev) return false;
  if (msSinceFullSync >= FULL_SYNC_INTERVAL_MS) return false;
  if (cursorUidValidity === null || cursorUidValidity !== now.uidValidity) return false;
  if (prev.uidValidity !== now.uidValidity) return false;
  if (prev.uidNext !== now.uidNext || prev.exists !== now.exists) return false;
  if (hasCondstore) return prev.modseq === now.modseq && now.modseq !== null;
  return msSinceFullSync < FLAGS_REFRESH_MS;
}
```

- [ ] **Step 4: Run the test**

Run: `pnpm test packages/sync/test/poll-policy.test.ts` — expect PASS.

- [ ] **Step 5: Use it in `AccountSync.syncFolder` and slow the poll**

In `account-sync.ts`:

1. `const POLL_INTERVAL_MS = 60_000;` → `const POLL_INTERVAL_MS = 5 * 60_000;` (IDLE covers INBOX push; the poll is the safety net for other folders). Import `shouldSkipFolderSync, type FolderStatusSnapshot` from `./poll-policy`.
2. Add instance fields:

```ts
private readonly folderStatus = new Map<string, FolderStatusSnapshot>();
private readonly folderFullSyncAt = new Map<string, number>();
```

3. In `syncFolder`, change the signature to `async syncFolder(folder: Folder): Promise<boolean>` and, right after the `mailbox` guard + cursor read (after line 490), add the fast path:

```ts
const status: FolderStatusSnapshot = {
  uidValidity,
  uidNext: Number(mailbox.uidNext ?? 0),
  exists: mailbox.exists ?? 0,
  modseq: mailbox.highestModseq ? String(mailbox.highestModseq) : null,
};
const hasCondstore = !!client.capabilities?.has('CONDSTORE');
if (
  shouldSkipFolderSync({
    cursorUidValidity: cursor.uidvalidity,
    prev: this.folderStatus.get(folder.id) ?? null,
    now: status,
    hasCondstore,
    msSinceFullSync: Date.now() - (this.folderFullSyncAt.get(folder.id) ?? 0),
  })
) {
  return false;
}
```

(When `folderFullSyncAt` has no entry, `Date.now() - 0` is huge → never skips; combined with `prev: null` the first pass always runs.)

4. At the cursor-write point (after `setFolderCursor`, line 565–569), record:

```ts
this.folderStatus.set(folder.id, status);
this.folderFullSyncAt.set(folder.id, Date.now());
```

Also dedupe the existing local `hasCondstore`/`modseq` at lines 542–543 to reuse `status.modseq` and the `hasCondstore` computed above.

5. Return `touchedThreads.size > 0` at the end of `syncFolder` (after the notify loop). The two existing internal callers (`queueInboxSync`, `syncAllFolders`) need no change beyond using the value in step 6. Clear both maps for a folder in the `uidvalidity` reset branch (line 488–490) so a reset always runs full.

- [ ] **Step 6: Gate `reconcileServerState` and `hydrateRecentBodies` on change**

In `syncAllFolders` (line 354–374):

```ts
async syncAllFolders(): Promise<void> {
  if (this.syncingAll || !this.client) return;
  this.syncingAll = true;
  try {
    this.status(this.backfilled ? 'syncing' : 'backfilling');
    const folders = this.db.listFolders(this.account.id);
    folders.sort((a, b) => (a.role === 'inbox' ? -1 : b.role === 'inbox' ? 1 : 0));
    let anyChanged = !this.backfilled;
    for (const folder of folders) {
      if (this.stopped) return;
      if (await this.syncFolder(folder)) anyChanged = true;
    }
    this.backfilled = true;
    // Reads back label state / fills snippets — both no-ops unless a folder
    // actually changed, so skip the scans on quiet ticks (with a slow
    // heartbeat in case a change slipped past the fast-path).
    const overdue = Date.now() - this.lastReconcileAt > AccountSync.RECONCILE_HEARTBEAT_MS;
    if (anyChanged || overdue) {
      await this.hydrateRecentBodies();
      this.reconcileServerState();
      this.lastReconcileAt = Date.now();
    }
    this.status('idle');
  } finally {
    this.syncingAll = false;
  }
}
```

Add fields near `RECONCILE_GRACE_MS`:

```ts
private lastReconcileAt = 0;
private static readonly RECONCILE_HEARTBEAT_MS = 30 * 60_000;
```

- [ ] **Step 7: Verify + commit**

Run: `pnpm typecheck && pnpm test packages/sync/test/poll-policy.test.ts && pnpm test:electron` (the sync integration suite needs the Electron ABI). Expect PASS (integration tests exercise `syncFolder` — its return-value change is additive).

```bash
git add packages/sync/src/poll-policy.ts packages/sync/test/poll-policy.test.ts packages/sync/src/account-sync.ts
git commit -m "perf(sync): skip unchanged folders on poll ticks, poll every 5 minutes"
```

---

### Task 4: Google Calendar incremental sync (syncToken)

Finding: every 5 minutes each Google calendar re-fetches a 733-day window (`maxResults: 2500`) and rewrites every event row. `calendars.sync_token` exists in the schema, unused.

**Files:**
- Modify: `packages/sync/src/google-calendar.ts`
- Modify: `packages/sync/src/service.ts:178-216`
- Modify: `packages/db/src/index.ts` (three new methods near the calendar section, ~line 1245)
- Test: `packages/sync/test/google-calendar.test.ts` (extend)

**Interfaces:**
- Produces (google-calendar.ts):
  - `listGoogleEvents(...)` gains a return of `{ items: GEventItem[]; nextSyncToken: string | null }` (was `GEventItem[]`).
  - `listGoogleEventsChanged(token: string, remoteCalendarId: string, syncToken: string): Promise<{ items: GEventItem[]; nextSyncToken: string | null }>` — throws `SyncTokenExpiredError` on HTTP 410.
  - `export class SyncTokenExpiredError extends Error {}`
  - `mapGoogleEvent` unchanged, but incremental callers must handle `status === 'cancelled'` items **before** mapping (mapGoogleEvent returns null for them).
- Produces (db):
  - `getCalendarSyncToken(id: string): { token: string; at: number } | null`
  - `setCalendarSyncToken(id: string, token: string | null): void` (stores `JSON.stringify({ t, at: Date.now() })`; null clears)
  - `deleteGoogleEventByRemoteId(calendarId: string, remoteId: string): void`

- [ ] **Step 1: Write the failing tests** (append to `packages/sync/test/google-calendar.test.ts`; follow the file's existing fetch-stubbing pattern — read it first; if it has none, stub `globalThis.fetch` with `vi.stubGlobal`)

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  listGoogleEvents,
  listGoogleEventsChanged,
  SyncTokenExpiredError,
} from '../src/google-calendar';

const page = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('incremental calendar sync', () => {
  it('full fetch returns items and the nextSyncToken from the last page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page({ items: [{ id: 'e1' }], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(page({ items: [{ id: 'e2' }], nextSyncToken: 'tokA' }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await listGoogleEvents('tok', 'cal', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    expect(res.items.map((i) => i.id)).toEqual(['e1', 'e2']);
    expect(res.nextSyncToken).toBe('tokA');
  });

  it('changed fetch sends syncToken and returns cancelled items too', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page({ items: [{ id: 'gone', status: 'cancelled' }], nextSyncToken: 'tokB' }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await listGoogleEventsChanged('tok', 'cal', 'tokA');
    expect(String(fetchMock.mock.calls[0][0])).toContain('syncToken=tokA');
    expect(res.items[0]?.status).toBe('cancelled');
    expect(res.nextSyncToken).toBe('tokB');
  });

  it('throws SyncTokenExpiredError on HTTP 410', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(page({}, 410)));
    await expect(listGoogleEventsChanged('tok', 'cal', 'stale')).rejects.toBeInstanceOf(
      SyncTokenExpiredError,
    );
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test packages/sync/test/google-calendar.test.ts` — expect FAIL (missing exports / wrong return shape).

- [ ] **Step 3: Implement in `google-calendar.ts`**

Replace `listGoogleEvents` and add the incremental variant (shared pager):

```ts
export class SyncTokenExpiredError extends Error {}

async function pageEvents(
  token: string,
  remoteCalendarId: string,
  baseParams: Record<string, string>,
): Promise<{ items: GEventItem[]; nextSyncToken: string | null }> {
  const out: GEventItem[] = [];
  let nextSyncToken: string | null = null;
  let pageToken = '';
  do {
    const page = await gget<{ items?: GEventItem[]; nextPageToken?: string; nextSyncToken?: string }>(
      token,
      `/calendars/${encodeURIComponent(remoteCalendarId)}/events`,
      { ...baseParams, maxResults: '2500', ...(pageToken ? { pageToken } : {}) },
    );
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken ?? '';
    nextSyncToken = page.nextSyncToken ?? nextSyncToken;
  } while (pageToken);
  return { items: out, nextSyncToken };
}

export function listGoogleEvents(
  token: string,
  remoteCalendarId: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<{ items: GEventItem[]; nextSyncToken: string | null }> {
  return pageEvents(token, remoteCalendarId, {
    singleEvents: 'true', // recurring events arrive pre-expanded as instances
    timeMin: timeMinIso,
    timeMax: timeMaxIso,
  });
}

/** Changes since `syncToken` — includes cancelled instances so deletions propagate. */
export function listGoogleEventsChanged(
  token: string,
  remoteCalendarId: string,
  syncToken: string,
): Promise<{ items: GEventItem[]; nextSyncToken: string | null }> {
  return pageEvents(token, remoteCalendarId, { singleEvents: 'true', syncToken });
}
```

And make `gget` signal 410 distinctly:

```ts
  if (res.status === 410) throw new SyncTokenExpiredError(`Google Calendar ${path}: sync token expired`);
  if (!res.ok) throw new Error(`Google Calendar ${path}: HTTP ${res.status}`);
```

Update the module doc comment (lines 1–6) — syncToken is no longer "a later optimization".

- [ ] **Step 4: Add the db methods** (in `packages/db/src/index.ts`, after `pruneGoogleEvents`)

```ts
/** Google incremental-sync cursor, stored with its mint time so stale windows can be re-based. */
getCalendarSyncToken(id: string): { token: string; at: number } | null {
  const r = this.raw.prepare(`SELECT sync_token FROM calendars WHERE id = ?`).get(id) as
    | { sync_token: string | null }
    | undefined;
  if (!r?.sync_token) return null;
  try {
    const parsed = JSON.parse(r.sync_token) as { t?: string; at?: number };
    return parsed.t ? { token: parsed.t, at: parsed.at ?? 0 } : null;
  } catch {
    return null;
  }
}

setCalendarSyncToken(id: string, token: string | null) {
  this.raw
    .prepare(`UPDATE calendars SET sync_token = ? WHERE id = ?`)
    .run(token ? JSON.stringify({ t: token, at: Date.now() }) : null, id);
}

deleteGoogleEventByRemoteId(calendarId: string, remoteId: string) {
  this.raw
    .prepare(`DELETE FROM events WHERE calendar_id = ? AND source = 'google' AND remote_id = ?`)
    .run(calendarId, remoteId);
}
```

- [ ] **Step 5: Rewrite `syncAccountCalendars` in `service.ts`**

Replace the per-calendar body (lines 197–210) with a token-aware path. Import `listGoogleEventsChanged, SyncTokenExpiredError` alongside the existing imports.

```ts
/** Re-base the sync window monthly so it doesn't age out from under the token. */
private static readonly SYNC_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

private async syncCalendarEvents(token: string, rowId: string, remoteCalendarId: string): Promise<void> {
  const stored = this.db.getCalendarSyncToken(rowId);
  if (stored && Date.now() - stored.at < SyncService.SYNC_TOKEN_MAX_AGE_MS) {
    try {
      const { items, nextSyncToken } = await listGoogleEventsChanged(token, remoteCalendarId, stored.token);
      for (const item of items) {
        if (item.status === 'cancelled') {
          this.db.deleteGoogleEventByRemoteId(rowId, item.id);
          continue;
        }
        const mapped = mapGoogleEvent(item, rowId);
        if (mapped) this.db.upsertGoogleEvent(mapped);
      }
      if (nextSyncToken) this.db.setCalendarSyncToken(rowId, nextSyncToken);
      return;
    } catch (err) {
      if (!(err instanceof SyncTokenExpiredError)) throw err;
      this.db.setCalendarSyncToken(rowId, null); // fall through to a full window fetch
    }
  }
  const windowStart = Date.now() - SYNC_PAST_MS;
  const windowEnd = Date.now() + SYNC_FUTURE_MS;
  const { items, nextSyncToken } = await listGoogleEvents(
    token,
    remoteCalendarId,
    new Date(windowStart).toISOString(),
    new Date(windowEnd).toISOString(),
  );
  const seen: string[] = [];
  for (const item of items) {
    const mapped = mapGoogleEvent(item, rowId);
    if (!mapped) continue;
    seen.push(mapped.remoteId);
    this.db.upsertGoogleEvent(mapped);
  }
  this.db.pruneGoogleEvents(rowId, windowStart, windowEnd, seen);
  this.db.setCalendarSyncToken(rowId, nextSyncToken);
}
```

In `syncAccountCalendars`, the loop body keeps `upsertGoogleCalendar` then calls `await this.syncCalendarEvents(token, rowId, cal.id);` — delete the inlined window fetch/prune and the now-unused `windowStart`/`windowEnd` locals there.

- [ ] **Step 6: Verify + commit**

Run: `pnpm typecheck && pnpm test packages/sync/test/google-calendar.test.ts` — expect PASS. Also `pnpm test:electron` for the service suite.

```bash
git add packages/sync/src/google-calendar.ts packages/sync/src/service.ts packages/db/src/index.ts packages/sync/test/google-calendar.test.ts
git commit -m "perf(calendar): Google incremental sync via syncToken instead of full-window refetch"
```

---

### Task 5: Power-aware sync (suspend/resume gating)

Finding: no `powerMonitor` anywhere; the sync utility process polls at full rate while the machine sleeps/resumes (each resume then races reconnects) and when backgrounded.

**Files:**
- Modify: `packages/shared/src/ipc.ts:191-197` (MainToSync)
- Modify: `packages/main/src/sync-bridge.ts` (new `power()` method)
- Modify: `packages/main/src/index.ts` (powerMonitor wiring in app setup)
- Modify: `packages/sync/src/entry.ts` (route the message)
- Modify: `packages/sync/src/service.ts` (pause/resume)
- Modify: `packages/sync/src/account-sync.ts` (pause/resume)

**Interfaces:**
- Produces: `MainToSync |= { kind: 'power'; state: 'suspend' | 'resume' }`; `SyncBridge.power(state: 'suspend' | 'resume'): void`; `SyncService.setPower(state): void`; `AccountSync.pause(): void` / `AccountSync.resume(): void`.

- [ ] **Step 1: Extend the message type** (`packages/shared/src/ipc.ts`)

```ts
  | { kind: 'credentials'; accountId: string; password: string; authType?: 'password' | 'oauth' }
  /** System sleep/wake: sync pauses its timers while suspended. */
  | { kind: 'power'; state: 'suspend' | 'resume' };
```

- [ ] **Step 2: Bridge + main wiring**

`sync-bridge.ts`:

```ts
power(state: 'suspend' | 'resume'): void {
  this.send({ kind: 'power', state });
}
```

`packages/main/src/index.ts` — add `powerMonitor` to the existing `electron` import, and where the app finishes setup (after `bridge.start()` in the ready handler):

```ts
powerMonitor.on('suspend', () => bridge?.power('suspend'));
powerMonitor.on('resume', () => bridge?.power('resume'));
```

- [ ] **Step 3: Route in `entry.ts`**

```ts
    case 'power':
      service.setPower(msg.state);
      break;
```

- [ ] **Step 4: Service + AccountSync pause/resume**

`service.ts` — add a field `private powerPaused = false;`, guard the calendar interval callback (line 122):

```ts
setInterval(() => {
  if (!this.powerPaused) void this.syncAllCalendars();
}, 5 * 60_000),
```

and add:

```ts
/** System sleep: stop the timers; wake: catch up immediately. */
setPower(state: 'suspend' | 'resume') {
  this.powerPaused = state === 'suspend';
  for (const sync of this.accounts.values()) {
    if (state === 'suspend') sync.pause();
    else sync.resume();
  }
  if (state === 'resume') void this.syncAllCalendars();
}
```

`account-sync.ts` — add a field `private paused = false;` and:

```ts
/** Sleep: stop the poll timer (the IMAP socket dies on its own; the run loop reconnects). */
pause(): void {
  this.paused = true;
  if (this.pollTimer) clearTimeout(this.pollTimer);
  this.pollTimer = null;
}

resume(): void {
  if (!this.paused) return;
  this.paused = false;
  if (this.client?.usable) {
    void this.syncAllFolders().catch(() => this.status('error', 'resume sync failed'));
    this.schedulePoll();
  }
  // Not connected: the reconnect loop is already driving recovery.
}
```

Guard `schedulePoll` (line 301) and `queueInboxSync` (line 288) with `if (this.paused) return;` at the top.

- [ ] **Step 5: Verify + commit**

Run: `pnpm typecheck && pnpm test:electron` — expect PASS.

```bash
git add packages/shared/src/ipc.ts packages/main/src/sync-bridge.ts packages/main/src/index.ts packages/sync/src/entry.ts packages/sync/src/service.ts packages/sync/src/account-sync.ts
git commit -m "perf(sync): pause polling across system sleep via powerMonitor"
```

---

### Task 6: SQLite pragmas + folders role index

Finding: only WAL + foreign_keys are set — WAL defaults to `synchronous=FULL` (fsync per commit in a write-heavy process); `folders.role` is filtered in hot joins with no index.

**Files:**
- Modify: `packages/db/src/index.ts:175-180`
- Modify: `packages/db/src/schema.ts` (append one migration)
- Test: `packages/db/test/db.test.ts` (extend, runs under `pnpm test:electron`)

- [ ] **Step 1: Write the failing test** (append to `db.test.ts`, using the file's existing in-memory/temp-db pattern — read the top of the file for the helper it uses to open a MailDb)

```ts
it('applies perf pragmas and the folders role index', () => {
  const db = openTestDb(); // reuse the suite's existing constructor helper
  expect(db.raw.pragma('synchronous', { simple: true })).toBe(1); // NORMAL
  expect(db.raw.pragma('busy_timeout', { simple: true })).toBe(5000);
  const indexes = db.raw.prepare(`PRAGMA index_list('folders')`).all() as { name: string }[];
  expect(indexes.map((i) => i.name)).toContain('folders_account_role');
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm test:electron packages/db/test/db.test.ts` — expect FAIL on the new test.

- [ ] **Step 3: Implement**

`index.ts` constructor:

```ts
this.raw.pragma('journal_mode = WAL');
// WAL + NORMAL skips the per-commit fsync (durability moves to checkpoints);
// safe for a local cache DB that can always re-sync from the server.
this.raw.pragma('synchronous = NORMAL');
this.raw.pragma('busy_timeout = 5000');
this.raw.pragma('foreign_keys = ON');
```

`schema.ts` — append to `MIGRATIONS`:

```ts
  `
-- role-filtered joins (listThreads view EXISTS, reconcilePlacements) run on
-- every sync tick; give them an index.
CREATE INDEX folders_account_role ON folders(account_id, role);
`,
```

- [ ] **Step 4: Run tests, verify + commit**

Run: `pnpm test:electron packages/db/test/db.test.ts && pnpm typecheck` — expect PASS.

```bash
git add packages/db/src/index.ts packages/db/src/schema.ts packages/db/test/db.test.ts
git commit -m "perf(db): synchronous=NORMAL + busy_timeout, index folders(account_id, role)"
```

---

### Task 7: Renderer re-render hygiene

Finding: whole-store zustand subscriptions make every mounted row re-render on each hover write; HomeView ticks a 1s clock through the whole subtree; KanbanView runs `querySelector` on every global `mouseover`; MessageBody polls iframe height 20× and mounts one MutationObserver per message.

**Files:**
- Modify: `packages/renderer/src/components/list/ThreadList.tsx:289,459,639,884-896`
- Modify: `packages/renderer/src/components/HomeView.tsx:12-19`
- Modify: `packages/renderer/src/components/kanban/KanbanView.tsx:300-316`
- Modify: `packages/renderer/src/components/reading/MessageBody.tsx`
- Create: `packages/renderer/src/lib/useIsDark.ts`

- [ ] **Step 1: ThreadList selector subscriptions**

Replace the four non-selector `useUi()` destructures with per-field selectors. The key transformation — subscribe to *derived booleans* for hover/selection so a hover change only re-renders the two affected rows:

Line 289 (`BundleRow`):

```ts
const setCategoryFocus = useUi((s) => s.setCategoryFocus);
const split = useUi((s) => s.split);
const hoverThread = useUi((s) => s.hoverThread);
const rowId = bundleRowId(category);
const isSelected = useUi((s) => s.selectedThreadId === rowId);
const isHovered = useUi((s) => s.hoveredThreadId === rowId);
const anyHovered = useUi((s) => s.hoveredThreadId !== null);
```

(move the existing `const rowId = bundleRowId(category);` above the selectors; replace the two `const isSelected/isHovered` lines; in `rowClass`, `!hoveredThreadId` becomes `!anyHovered`).

Line 459 (`PriorityToggleRow`) — same shape with `PRIORITY_TOGGLE_ID`:

```ts
const selectThread = useUi((s) => s.selectThread);
const hoverThread = useUi((s) => s.hoverThread);
const isSelected = useUi((s) => s.selectedThreadId === PRIORITY_TOGGLE_ID);
const isHovered = useUi((s) => s.hoveredThreadId === PRIORITY_TOGGLE_ID);
const anyHovered = useUi((s) => s.hoveredThreadId !== null);
```

Line 639 (`RowShell`) — same shape with `thread.id`:

```ts
const selectThread = useUi((s) => s.selectThread);
const hoverThread = useUi((s) => s.hoverThread);
const isSelected = useUi((s) => s.selectedThreadId === thread.id);
const isHovered = useUi((s) => s.hoveredThreadId === thread.id);
const anyHovered = useUi((s) => s.hoveredThreadId !== null);
```

(the `(isHovered || (isSelected && !hoveredThreadId))` class conditions become `(isHovered || (isSelected && !anyHovered))`).

Line 884–896 (`ThreadList` container) — one selector per field, dropping the hover fields it never uses:

```ts
const listLayout = useUi((s) => s.listLayout);
const density = useUi((s) => s.density);
const setVisibleRows = useUi((s) => s.setVisibleRows);
const selectedThreadId = useUi((s) => s.selectedThreadId);
const view = useUi((s) => s.view);
const smartInbox = useUi((s) => s.smartInbox);
const searchQuery = useUi((s) => s.searchQuery);
const categoryFocus = useUi((s) => s.categoryFocus);
const setCategoryFocus = useUi((s) => s.setCategoryFocus);
const split = useUi((s) => s.split);
```

- [ ] **Step 2: HomeView clock cadence**

`HomeView.tsx:15` — the greeting/countdown/marker are minute-granular; tick every 30s:

```ts
const id = window.setInterval(() => setNow(new Date()), 30_000);
```

Update the `useNow` doc comment (line 11) to say "every 30s".

- [ ] **Step 3: KanbanView rAF-throttled sidebar probe**

`KanbanView.tsx:300-316` — coalesce the `update` work to one run per animation frame so continuous `mouseover` traffic stops doing per-event `querySelector` + `matches(':hover')`:

```ts
useEffect(() => {
  let raf = 0;
  const update = () => {
    raf = 0;
    const nav = document.querySelector('nav[aria-label="Mailboxes"]');
    setSidebarEngaged(
      nav instanceof HTMLElement &&
        (nav.matches(':hover') || nav.contains(document.activeElement)),
    );
  };
  const schedule = () => {
    if (!raf) raf = requestAnimationFrame(update);
  };
  window.addEventListener('focusin', schedule);
  window.addEventListener('focusout', schedule);
  window.addEventListener('mouseover', schedule);
  return () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('focusin', schedule);
    window.removeEventListener('focusout', schedule);
    window.removeEventListener('mouseover', schedule);
  };
}, []);
```

- [ ] **Step 4: Shared dark-mode hook + ResizeObserver in MessageBody**

Create `packages/renderer/src/lib/useIsDark.ts` — one MutationObserver for the whole app via `useSyncExternalStore`:

```ts
import { useSyncExternalStore } from 'react';

/** One shared observer on <html class>; N consumers, not N observers. */
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  observer ??= (() => {
    const o = new MutationObserver(() => listeners.forEach((l) => l()));
    o.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return o;
  })();
  return () => {
    listeners.delete(cb);
    if (!listeners.size) {
      observer?.disconnect();
      observer = null;
    }
  };
}

const isDark = () => document.documentElement.classList.contains('dark');

export function useIsDark(): boolean {
  return useSyncExternalStore(subscribe, isDark);
}
```

In `MessageBody.tsx`: delete the local `useIsDark` (lines 7–17) and `import { useIsDark } from '../../lib/useIsDark';`. Then replace the 20×150ms height poll (lines 80–104) with a ResizeObserver on the iframe body (the sandbox includes same-origin access — `contentDocument` is already used), keeping one immediate measure:

```ts
useEffect(() => {
  const iframe = iframeRef.current;
  if (!iframe || !rendered) return;
  let ro: ResizeObserver | null = null;
  const measure = () => {
    const doc = iframe.contentDocument;
    // body carries its own padding; +2 only covers subpixel rounding
    if (doc?.body) setHeight(Math.min(20_000, Math.max(40, doc.body.scrollHeight + 2)));
  };
  const onLoad = () => {
    measure();
    ro?.disconnect();
    const body = iframe.contentDocument?.body;
    if (body) {
      ro = new ResizeObserver(measure); // images/layout settle → resize fires
      ro.observe(body);
    }
  };
  iframe.addEventListener('load', onLoad);
  onLoad();
  return () => {
    iframe.removeEventListener('load', onLoad);
    ro?.disconnect();
  };
}, [rendered]);
```

- [ ] **Step 5: Verify + commit**

Run: `pnpm typecheck && pnpm test packages/renderer/test && pnpm lint` — expect PASS. Then `pnpm dev`: hover rows (only the hovered row should repaint — verify visually that hover highlight + HoverActions still work), open a long HTML email (height should settle without the poll), open Home + the sprint board (cursor hiding over the sidebar still works).

```bash
git add packages/renderer/src/components/list/ThreadList.tsx packages/renderer/src/components/HomeView.tsx packages/renderer/src/components/kanban/KanbanView.tsx packages/renderer/src/components/reading/MessageBody.tsx packages/renderer/src/lib/useIsDark.ts
git commit -m "perf(renderer): selector subscriptions, slower clock, throttled probes, ResizeObserver"
```

---

## Out of scope (deliberate)

- Denormalized `from_email` column to replace `from_json LIKE '%…%'` scans — worthwhile but touches every ingest/write path plus a backfill; do as its own plan.
- Battery-aware interval widening (`powerMonitor.isOnBatteryPower()`) — suspend/resume covers the big win; battery gating layers on cleanly later.
- Incremental UID search (`uid lastSeen+1:*`) inside a changed-folder pass — the skip fast-path removes the steady-state cost; the remaining full pass runs only when something actually changed or 6-hourly.
