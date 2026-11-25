import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Minimal stand-ins for the two stores the idle return reads.
const ui = vi.hoisted(() => {
  const state: Record<string, unknown> = {};
  const reset = () =>
    Object.assign(state, {
      view: 'inbox',
      composer: null,
      kanbanOpen: false,
      selectedThreadId: 't1',
      commandOpen: false,
      shortcutsOpen: false,
      settingsOpen: true,
      picker: null,
      setView: (view: string) => Object.assign(state, { view, selectedThreadId: null }),
      setCommandOpen: (v: boolean) => Object.assign(state, { commandOpen: v }),
      setShortcutsOpen: (v: boolean) => Object.assign(state, { shortcutsOpen: v }),
      setSettingsOpen: (v: boolean) => Object.assign(state, { settingsOpen: v }),
      closePicker: () => Object.assign(state, { picker: null }),
    });
  return { state, reset };
});
const cal = vi.hoisted(() => ({ rightPane: { kind: 'shortcuts' } as { kind: string } }));
vi.mock('../src/state/store', () => ({
  useUi: { getState: () => ui.state },
  DEFAULT_IDLE_HOME_MINUTES: 10,
}));
vi.mock('../src/state/calendar', () => ({ useCalendar: { getState: () => cal } }));

const { startIdleHome, registerIdleBlocker } = await import('../src/lib/idleHome');

const MIN = 60_000;
let win: EventTarget;
let stop: () => void;

beforeEach(() => {
  vi.useFakeTimers();
  ui.reset();
  cal.rightPane = { kind: 'shortcuts' };
  win = new EventTarget();
  vi.stubGlobal('window', Object.assign(win, { setTimeout, clearTimeout }));
  stop = startIdleHome(10 * MIN);
});
afterEach(() => {
  stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('back to Home when idle', () => {
  it('goes Home and closes Settings after 10 quiet minutes', () => {
    vi.advanceTimersByTime(10 * MIN - 1);
    expect(ui.state.view).toBe('inbox');
    vi.advanceTimersByTime(1);
    expect(ui.state.view).toBe('home');
    expect(ui.state.settingsOpen).toBe(false);
  });

  it('any key press restarts the countdown', () => {
    vi.advanceTimersByTime(9 * MIN);
    win.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(9 * MIN);
    expect(ui.state.view).toBe('inbox');
    vi.advanceTimersByTime(1 * MIN);
    expect(ui.state.view).toBe('home');
  });

  it('scrolling in a pane counts as activity', () => {
    vi.advanceTimersByTime(9 * MIN);
    win.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(5 * MIN);
    expect(ui.state.view).toBe('inbox');
  });

  it('stays put while a composer is open', () => {
    ui.state.composer = { mode: 'new' };
    vi.advanceTimersByTime(30 * MIN);
    expect(ui.state.view).toBe('inbox');
  });

  it('stays put while a chat reply box holds text, then goes once it is cleared', () => {
    let typed = true;
    const release = registerIdleBlocker(() => typed);
    vi.advanceTimersByTime(10 * MIN);
    expect(ui.state.view).toBe('inbox');
    typed = false;
    vi.advanceTimersByTime(10 * MIN);
    expect(ui.state.view).toBe('home');
    release();
  });

  it('keeps an open calendar event form', () => {
    ui.state.view = 'calendar';
    cal.rightPane = { kind: 'form' };
    vi.advanceTimersByTime(20 * MIN);
    expect(ui.state.view).toBe('calendar');
  });
});
