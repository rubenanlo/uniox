import { useEffect } from 'react';
import { useCalendar } from '../state/calendar';
import { useUi } from '../state/store';

export { DEFAULT_IDLE_HOME_MINUTES } from '../state/store';

/**
 * Back to Home after a stretch of no activity (Settings → General). Any key,
 * click, pointer move, scroll or touch counts as activity, so typing keeps the
 * timer at bay. Time with Uniox in the background counts too, and the switch
 * happens quietly: nothing is focused or brought forward.
 *
 * Unsent work is never lost: while a composer, a chat reply box with text, a
 * forward or a calendar event form is open the return is skipped, and the
 * timer simply starts over.
 *
 * Cheap by design: activity only writes a timestamp. One timeout runs per idle
 * period; when it fires it re-arms for whatever time is left.
 */

/** A surface holding unsent work answers true while it should keep the app put. */
type Busy = () => boolean;
const blockers = new Set<Busy>();

/** Hold the idle return while `busy()` is true; returns the release. */
export function registerIdleBlocker(busy: Busy): () => void {
  blockers.add(busy);
  return () => {
    blockers.delete(busy);
  };
}

/** True when something on screen holds unsent work. */
export function hasUnsentWork(): boolean {
  if (useUi.getState().composer) return true;
  if (useUi.getState().view === 'calendar' && useCalendar.getState().rightPane.kind === 'form')
    return true;
  for (const busy of blockers) if (busy()) return true;
  return false;
}

/** Choices in Settings; 0 turns it off. */
export const IDLE_HOME_OPTIONS = [0, 5, 10, 30] as const;

/** Milliseconds until the timer should fire again, given the last activity. */
export function idleRemaining(lastActivity: number, now: number, idleMs: number): number {
  return Math.max(0, lastActivity + idleMs - now);
}

/** Leave whatever is open and rest on Home. */
function goHome(): void {
  const s = useUi.getState();
  // Overlays sit above the view, so close them too or Home would hide behind them.
  if (s.commandOpen) s.setCommandOpen(false);
  if (s.shortcutsOpen) s.setShortcutsOpen(false);
  if (s.settingsOpen) s.setSettingsOpen(false);
  if (s.picker) s.closePicker();
  if (s.view !== 'home' || s.kanbanOpen || s.selectedThreadId) s.setView('home');
}

const ACTIVITY = ['pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart'] as const;

/** Start watching for idleness; returns the stop. Exported for tests. */
export function startIdleHome(idleMs: number): () => void {
  let last = Date.now();
  let timer: number | undefined;
  const mark = () => {
    last = Date.now();
  };
  const arm = (ms: number) => {
    timer = window.setTimeout(check, ms);
  };
  const check = () => {
    const left = idleRemaining(last, Date.now(), idleMs);
    if (left > 0) return arm(left);
    if (!hasUnsentWork()) goHome();
    // Start a fresh period either way: an open draft is checked again later.
    last = Date.now();
    arm(idleMs);
  };
  const opts = { passive: true, capture: true } as const;
  ACTIVITY.forEach((e) => window.addEventListener(e, mark, opts));
  // Scrolling inside panes (or over an email frame) doesn't bubble; capture it.
  window.addEventListener('scroll', mark, opts);
  arm(idleMs);
  return () => {
    window.clearTimeout(timer);
    ACTIVITY.forEach((e) => window.removeEventListener(e, mark, opts));
    window.removeEventListener('scroll', mark, opts);
  };
}

export function useIdleHome(): void {
  const minutes = useUi((s) => s.idleHomeMinutes);
  useEffect(() => (minutes ? startIdleHome(minutes * 60_000) : undefined), [minutes]);
}
