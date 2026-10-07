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
