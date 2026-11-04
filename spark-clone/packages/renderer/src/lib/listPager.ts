/**
 * Page Up / Page Down / Home / End for the mail list. The list registers the
 * pager while it is mounted (it owns the virtualizer that knows where rows
 * sit); the keymap only dispatches these keys while the list is the active
 * panel, so the reading pane keeps native scrolling.
 */
export type PageMove = 'page-down' | 'page-up' | 'first' | 'last';

let pager: ((move: PageMove) => void) | null = null;

export function registerListPager(fn: (move: PageMove) => void): () => void {
  pager = fn;
  return () => {
    if (pager === fn) pager = null;
  };
}

export function listPagerReady(): boolean {
  return pager !== null;
}

export function pageList(move: PageMove): void {
  pager?.(move);
}

interface Span {
  start: number;
  end: number;
}

/**
 * Where a page move lands. `spans` are every list item's offsets (headers
 * included) and `nav[i]` says whether item i is selectable. Returns the
 * scroll offset to apply (null = leave the scroll alone) and the selectable
 * item index to select.
 *
 * Page Down brings the row cut off at the bottom edge to the top and selects
 * the first email from there; on the last page it stops on the last email.
 * Page Up is the mirror image, stopping on the first email.
 */
export function planPage(
  move: PageMove,
  spans: Span[],
  nav: boolean[],
  scrollTop: number,
  viewport: number,
): { scrollTo: number | null; select: number } | null {
  const navIdx = nav.flatMap((ok, i) => (ok ? [i] : []));
  if (!navIdx.length) return null;
  const first = navIdx[0]!;
  const last = navIdx[navIdx.length - 1]!;
  const total = spans.length ? spans[spans.length - 1]!.end : 0;
  const maxTop = Math.max(0, total - viewport);
  const firstNavFrom = (top: number) => navIdx.find((i) => spans[i]!.start >= top - 1) ?? last;
  // The item that contains offset y (the one cut by that edge).
  const itemAt = (y: number) => spans.find((s) => s.start <= y && y < s.end);

  if (move === 'first') return { scrollTo: 0, select: first };
  if (move === 'last') return { scrollTo: maxTop, select: last };

  if (move === 'page-down') {
    if (scrollTop >= maxTop - 1) return { scrollTo: null, select: last };
    const cut = itemAt(scrollTop + viewport);
    const top = cut && cut.start > scrollTop ? cut.start : scrollTop + viewport;
    // Near the end the scroll clamps, but the selection still lands on the
    // first email that wasn't fully visible before.
    return { scrollTo: Math.min(top, maxTop), select: firstNavFrom(top) };
  }

  // page-up
  if (scrollTop <= 1) return { scrollTo: 0, select: first };
  const target = Math.max(0, scrollTop - viewport);
  const cut = itemAt(target);
  const top = target === 0 ? 0 : cut && cut.end <= scrollTop ? cut.start : target;
  return { scrollTo: top, select: top === 0 ? first : firstNavFrom(top) };
}
