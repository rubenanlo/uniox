import { MessageSquare } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { runAssistantAction, type AssistantAction } from '../../lib/assistantContext';
import { cn } from '../../lib/utils';
import { useAssistant } from '../../state/assistant';
import { useUi } from '../../state/store';
import { LanguagePicker } from './LanguagePicker';
import { Keycaps } from '../ui/Keycap';
import { orbActionsFor, type OrbAction } from './orbActions';
import SpecterOrb from './SpecterOrb';

const IDLE_OPACITY = 0.45;

/**
 * Robot mark for the orb's resting state (Font Awesome Pro v7 "robot",
 * https://fontawesome.com/license). Both layers ride currentColor — the
 * duotone back layer at 40% — so the accent token colors it in both themes.
 */
export function RobotIcon({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 640 640" width={size} height={size} fill="currentColor" aria-hidden>
      <path
        opacity=".4"
        d="M128 256C128 269.3 138.7 280 152 280L176 280L176 232L152 232C138.7 232 128 242.7 128 256zM200 536L200 576L248 576L248 536C248 522.7 237.3 512 224 512C210.7 512 200 522.7 200 536zM296 88L296 128L344 128L344 88C344 74.7 333.3 64 320 64C306.7 64 296 74.7 296 88zM296 536L296 576L344 576L344 536C344 522.7 333.3 512 320 512C306.7 512 296 522.7 296 536zM392 536L392 576L440 576L440 536C440 522.7 429.3 512 416 512C402.7 512 392 522.7 392 536zM464 232L464 280L488 280C501.3 280 512 269.3 512 256C512 242.7 501.3 232 488 232L464 232z"
      />
      <path d="M176 192C176 156.7 204.7 128 240 128L400 128C435.3 128 464 156.7 464 192L464 304C464 339.3 435.3 368 400 368L240 368C204.7 368 176 339.3 176 304L176 192zM96 512C96 459 139 416 192 416L448 416C501 416 544 459 544 512L544 544C544 561.7 529.7 576 512 576L440 576L440 536C440 522.7 429.3 512 416 512C402.7 512 392 522.7 392 536L392 576L344 576L344 536C344 522.7 333.3 512 320 512C306.7 512 296 522.7 296 536L296 576L248 576L248 536C248 522.7 237.3 512 224 512C210.7 512 200 522.7 200 536L200 576L128 576C110.3 576 96 561.7 96 544L96 512zM288 224C288 206.3 273.7 192 256 192C238.3 192 224 206.3 224 224C224 241.7 238.3 256 256 256C273.7 256 288 241.7 288 224zM384 256C401.7 256 416 241.7 416 224C416 206.3 401.7 192 384 192C366.3 192 352 206.3 352 224C352 241.7 366.3 256 384 256z" />
    </svg>
  );
}

/**
 * Assistant orb pinned to the app's bottom-right corner. Hover eases the
 * orb's own `opacity` prop up to 1 (a small rAF tween — the prop drives a
 * shader uniform, so CSS transitions can't animate it) and reveals a menu
 * of context actions: Home, mail list/thread, or the open composer (the orb
 * steps left of the composer dialog so both stay visible). Clicking the orb
 * pins the menu open.
 *
 * Outside the calendar the corner stays empty: the top bar's robot button
 * (next to Compose) is the entry point, and the menu docks just below it.
 */
export function OrbCorner() {
  const view = useUi((s) => s.view);
  // The calendar has no top bar, so only there does the orb keep its corner.
  const docked = view !== 'calendar';
  const composerOpen = useUi((s) => !!s.composer);
  const selectedThreadId = useUi((s) => s.selectedThreadId);
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  /** The action waiting on a language pick, while the picker is showing. */
  const [languageFor, setLanguageFor] = useState<AssistantAction | null>(null);
  const [opacity, setOpacity] = useState(IDLE_OPACITY);

  const keyboardOpen = useAssistant((s) => s.orbMenuOpen);
  const setKeyboardOpen = useAssistant((s) => s.setOrbMenuOpen);
  const [active, setActive] = useState(0);
  const chat: OrbAction = {
    label: 'Open the assistant chat',
    icon: MessageSquare,
    run: () => useAssistant.getState().setOpen(true),
  };
  const suggested = orbActionsFor(view, composerOpen, selectedThreadId);
  // From the keyboard there's no orb to click for the chat, so it joins the list.
  const actions = keyboardOpen ? [...suggested, chat] : suggested;
  const menuOpen = docked ? keyboardOpen || pinned : hovered || pinned || keyboardOpen;
  // The picker belongs to the composer it was opened for: drop it (and the
  // pin holding it open) when the composer opens or closes.
  const [prevComposerOpen, setPrevComposerOpen] = useState(composerOpen);
  if (composerOpen !== prevComposerOpen) {
    setPrevComposerOpen(composerOpen);
    setLanguageFor(null);
    setPinned(false);
  }
  const closeMenu = () => {
    setKeyboardOpen(false);
    setActive(0);
    setPinned(false);
    setHovered(false);
    setLanguageFor(null);
  };
  const pick = ({ action, run, pickLanguage }: OrbAction) => {
    if (action && pickLanguage) {
      // Typing in the picker moves focus off the orb, so pin
      // the menu open until a language is picked.
      setPinned(true);
      setLanguageFor(action);
      return;
    }
    closeMenu();
    if (action) void runAssistantAction(action);
    else run?.();
  };

  // ⌘. opened the menu: ↑/↓ walk it, ↩ runs, 1–9 jump straight to a row,
  // Esc closes. Captured ahead of the composer so its caret stays put.
  useEffect(() => {
    if (!keyboardOpen || languageFor) return;
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const step = e.key === 'ArrowDown' ? 1 : -1;
        setActive((i) => (i + step + actions.length) % actions.length);
      } else if (e.key === 'Enter') {
        pick(actions[Math.min(active, actions.length - 1)]!);
      } else if (!e.metaKey && !e.ctrlKey && n >= 1 && n <= actions.length) {
        pick(actions[n - 1]!);
      } else if (e.key === 'Escape') {
        closeMenu();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // A click anywhere else dismisses the (pinned) language picker.
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!languageFor && !keyboardOpen) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element;
      // The top-bar button toggles the menu itself; closing here first would
      // make its click reopen it.
      if (target.closest?.('[data-assistant-toggle]')) return;
      if (!rootRef.current?.contains(target)) closeMenu();
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [languageFor, keyboardOpen]);

  // Hover brightens the shader opacity over a fixed 700ms (ease-out cubic),
  // resuming from wherever a half-finished fade left off.
  const opacityRef = useRef(IDLE_OPACITY);
  useEffect(() => {
    if (docked) return; // no orb on screen to brighten
    const target = menuOpen ? 1 : IDLE_OPACITY;
    const from = opacityRef.current;
    if (from === target) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / 700, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = from + (target - from) * eased;
      opacityRef.current = value;
      setOpacity(value);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [menuOpen, docked]);

  // Opening/closing/expanding the composer teleports the orb rather than
  // sliding it: fade out in place, jump while invisible, fade back in.
  const composerExpanded = useUi((s) => s.composerExpanded);
  const [slot, setSlot] = useState<'corner' | 'beside-composer' | 'beside-expanded'>('corner');
  const [veiled, setVeiled] = useState(false);
  useEffect(() => {
    const target =
      docked || !composerOpen ? 'corner' : composerExpanded ? 'beside-expanded' : 'beside-composer';
    if (target === slot) return;
    const raf = requestAnimationFrame(() => setVeiled(true));
    const timer = window.setTimeout(() => {
      setSlot(target);
      setVeiled(false);
    }, 200);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
  }, [composerOpen, composerExpanded, slot, docked]);

  // Docked: hang the menu from the top-bar button, right edges aligned.
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null);
  useLayoutEffect(() => {
    if (!docked || !menuOpen) return;
    const place = () => {
      const r = document.querySelector('[data-assistant-toggle]')?.getBoundingClientRect();
      setAnchor(r ? { top: r.bottom + 6, right: window.innerWidth - r.right } : null);
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [docked, menuOpen]);

  // The visual gap below the card is padding, not margin, so the hover area
  // is continuous — crossing from orb to menu never closes it.
  const menu = (placement: string) => (
    <div role="menu" aria-label="Assistant actions" className={cn('orb-menu-in', placement)}>
      <div className="border-hairline bg-surface rounded-2xl border p-1.5 shadow-2xl">
        {languageFor ? (
          <LanguagePicker
            onBack={() => {
              setPinned(false);
              setLanguageFor(null);
            }}
            onPick={(language) => {
              const action = languageFor;
              closeMenu();
              void runAssistantAction(action, { language });
            }}
          />
        ) : (
          <>
            {actions.map((item, i) => {
              const Icon = item.icon;
              const current = keyboardOpen && i === Math.min(active, actions.length - 1);
              return [
                item === chat && (
                  <div key="divider" className="border-hairline mx-2 my-1 border-t" />
                ),
                <button
                  key={item.label}
                  role="menuitem"
                  onMouseEnter={() => keyboardOpen && setActive(i)}
                  onClick={() => pick(item)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[12.5px]',
                    current
                      ? 'bg-accent-soft/40 text-ink'
                      : 'text-ink-muted hover:bg-accent-soft/40 hover:text-ink',
                  )}
                >
                  <Icon size={14} className="text-accent shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {keyboardOpen && i < 9 && <Keycaps keys={[String(i + 1)]} />}
                </button>,
              ];
            })}
            {keyboardOpen ? (
              <div className="text-ink-faint border-hairline mt-1 flex items-center gap-3 border-t px-3 pt-2 pb-1 text-[11px]">
                <span className="flex items-center gap-1">
                  <Keycaps keys={['↑', '↓']} /> move
                </span>
                <span className="flex items-center gap-1">
                  <Keycaps keys={['↩']} /> run
                </span>
                <span className="ml-auto flex items-center gap-1">
                  <Keycaps keys={['esc']} /> close
                </span>
              </div>
            ) : (
              <div className="text-ink-faint border-hairline mt-1 flex items-center justify-between border-t px-3 pt-2 pb-1 text-[11px]">
                <span>Open from the keyboard</span>
                <Keycaps keys={['⌘', '.']} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  if (docked) {
    if (!menuOpen || !anchor) return null;
    return (
      <div ref={rootRef} className="fixed z-50" style={{ top: anchor.top, right: anchor.right }}>
        {menu('absolute right-0 top-0 w-72')}
      </div>
    );
  }

  return (
    <div
      className={cn(
        // Below the composer (z-40): on narrow windows the dialog may cover it.
        // Asymmetric fade: vanish fast, rematerialize slowly (0 → idle
        // opacity — full brightness stays reserved for hover).
        'absolute bottom-4 z-30 transition-opacity',
        veiled ? 'duration-200' : 'duration-700 ease-out',
        // The composer dialog owns the corner while it's open: 620px compact,
        // 1100px expanded, plus the shell padding.
        slot === 'beside-expanded'
          ? 'right-[1136px]'
          : slot === 'beside-composer'
            ? 'right-[656px]'
            : 'right-4',
        veiled && 'pointer-events-none opacity-0',
      )}
      ref={rootRef}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {menuOpen && menu('absolute right-0 bottom-full w-72 pb-2')}
      <button
        onClick={() => {
          closeMenu();
          useAssistant.getState().setOpen(true);
        }}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        aria-label="Assistant"
        aria-expanded={menuOpen}
        className="block cursor-pointer rounded-full focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:outline-none"
      >
        {/* At rest the assistant is a quiet robot chip; hovering (or focus)
            dissolves it and wakes the orb — the raymarch frameloop only runs
            while engaged. */}
        <span className="relative block h-[120px] w-[120px]">
          <span
            className={cn(
              'absolute inset-0 transition-opacity',
              menuOpen ? 'opacity-100 duration-300' : 'opacity-0 duration-700 ease-out',
            )}
            aria-hidden={!menuOpen}
          >
            <SpecterOrb
              width={120}
              height={120}
              opacity={opacity}
              backgroundColor="transparent"
              paused={!menuOpen}
            />
          </span>
          <span
            className={cn(
              'border-hairline bg-surface text-accent absolute top-1/2 left-1/2 flex h-14 w-14 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border shadow-sm transition-opacity',
              menuOpen ? 'opacity-0 duration-300' : 'opacity-100 duration-700 ease-out',
            )}
          >
            <RobotIcon />
          </span>
        </span>
      </button>
    </div>
  );
}
