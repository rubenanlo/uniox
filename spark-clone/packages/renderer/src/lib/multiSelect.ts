import type { ThreadSummary } from '@app/shared';
import { navRowId, PRIORITY_TOGGLE_ID, useUi, type NavRow } from '../state/store';

/** Row ids from index a to b (either order), skipping the Show-all toggle row. */
function rangeIds(rows: NavRow[], a: number, b: number): string[] {
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return rows
    .slice(lo, hi + 1)
    .map(navRowId)
    .filter((id) => id !== PRIORITY_TOGGLE_ID);
}

/** Select every row from the anchor (or current selection) to `rowId`: ⇧-click. */
export function selectRangeTo(rowId: string) {
  const ui = useUi.getState();
  const rows = ui.visibleRows;
  const anchor = ui.selectionAnchor ?? ui.selectedThreadId ?? rowId;
  const from = rows.findIndex((r) => navRowId(r) === anchor);
  const to = rows.findIndex((r) => navRowId(r) === rowId);
  if (from === -1 || to === -1) return ui.selectThread(rowId);
  ui.setMultiSelected(rangeIds(rows, from, to), rowId, anchor);
}

/** ⇧↑ / ⇧↓: grow or shrink the picked range by one row from the anchor. */
export function extendSelection(delta: 1 | -1) {
  const ui = useUi.getState();
  const rows = ui.visibleRows;
  const current = ui.selectedThreadId ?? ui.hoveredThreadId;
  const idx = rows.findIndex((r) => navRowId(r) === current);
  if (idx === -1) {
    const first = rows[delta === 1 ? 0 : rows.length - 1];
    if (first) ui.selectThread(navRowId(first), true);
    return;
  }
  const next = rows[Math.min(rows.length - 1, Math.max(0, idx + delta))];
  if (next) selectRangeTo(navRowId(next));
}

/** ⌘-click: add or remove one row without touching the rest. */
export function toggleInSelection(rowId: string) {
  const ui = useUi.getState();
  const picked = ui.multiSelected.length
    ? ui.multiSelected
    : ui.selectedThreadId && ui.selectedThreadId !== PRIORITY_TOGGLE_ID
      ? [ui.selectedThreadId]
      : [];
  const has = picked.includes(rowId);
  const set = new Set(has ? picked.filter((id) => id !== rowId) : [...picked, rowId]);
  // keep list order so ranges and "next row" logic stay predictable
  const ids = ui.visibleRows.map(navRowId).filter((id) => set.has(id));
  if (ids.length <= 1) return ui.selectThread(ids[0] ?? null);
  ui.setMultiSelected(ids, has ? ids[ids.length - 1]! : rowId, rowId);
}

/**
 * The threads a triage key should act on when several rows are picked (bundle
 * rows expand to their whole group), or null for a normal single selection.
 */
export function multiSelectedThreads(): ThreadSummary[] | null {
  const ui = useUi.getState();
  if (ui.multiSelected.length < 2) return null;
  const picked = new Set(ui.multiSelected);
  const out: ThreadSummary[] = [];
  for (const row of ui.visibleRows) {
    if (!picked.has(navRowId(row))) continue;
    if (row.kind === 'thread') out.push(row.thread);
    else if (row.kind === 'bundle') out.push(...row.threads);
  }
  return out;
}

/** After a bulk move: land on the first row below the picked ones (or above). */
export function advancePastMultiSelection() {
  const ui = useUi.getState();
  const picked = new Set(ui.multiSelected);
  const rows = ui.visibleRows;
  const lastIdx = rows.reduce((m, r, i) => (picked.has(navRowId(r)) ? i : m), -1);
  const after = rows.slice(lastIdx + 1).find((r) => !picked.has(navRowId(r)));
  const before = [...rows.slice(0, lastIdx)].reverse().find((r) => !picked.has(navRowId(r)));
  const next = after ?? before;
  ui.selectThread(next ? navRowId(next) : null, true);
}
