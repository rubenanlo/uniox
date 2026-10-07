/**
 * Arrow-key navigation over the search box's recent-search list.
 *
 * The cursor cycles through the recents and back out to the input, the way a
 * combobox does: -1 means nothing is highlighted and the caret owns the field.
 */
export const NO_RECENT = -1;

export function nextRecentIndex(
  key: 'ArrowDown' | 'ArrowUp',
  current: number,
  count: number,
): number {
  if (count <= 0) return NO_RECENT;
  // The list can shrink under a stale index (a recent was just used).
  const from = current >= count ? NO_RECENT : current;
  if (key === 'ArrowDown') {
    const next = from + 1;
    return next >= count ? NO_RECENT : next;
  }
  const next = from - 1;
  return next < NO_RECENT ? count - 1 : next;
}
