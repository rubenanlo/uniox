import type { DarkPalette, LightPalette, QuickReplyItem, QuickReplyState } from '@app/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { itemPayload, queuePosition, stepItem, unreadItem } from '../../lib/quickReply';
import { useAccentColor, useTheme } from '../../lib/theme';
import { wireAssistant } from '../../state/assistant';
import { useAccounts, useDelta } from '../../state/queries';
import { useUi, type ThemePref } from '../../state/store';
import { AppToaster } from '../AppToaster';
import { NotificationList } from './NotificationList';
import { ReplyWidget } from './ReplyWidget';

/**
 * How many inbox threads the list loads (all accounts, read and unread; the
 * account switch and the view filter them in the page, so flipping is instant).
 */
const INBOX_LIMIT = 400;
/** Fade in anyway if a first load hangs, rather than never showing. */
const READY_TIMEOUT_MS = 800;

/** Inbox threads (read and unread), refreshed as mail changes while the window lives. */
function useInboxItems(): { rows: QuickReplyItem[]; loaded: boolean } {
  const [rows, setRows] = useState<QuickReplyItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const refresh = useCallback(() => {
    void api
      .query('threads:unread', { limit: INBOX_LIMIT, includeRead: true })
      .then((threads) => setRows(threads.map(unreadItem)))
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);
  useEffect(refresh, [refresh]);
  useDelta((e) => {
    if (e.kind === 'threads-changed' || e.kind === 'accounts-changed') refresh();
  });
  return { rows, loaded };
}

/**
 * The quick-reply overlay window (#quick-reply). It covers the screen: the
 * dim scrim, then the notification list (⌥⌘N) or the reply widget for one
 * email. A click on the dimmed area closes it; so does Esc, except in a reply
 * opened from the list, where Esc steps back to the list.
 */
export function QuickReplyWindow() {
  const [state, setState] = useState<QuickReplyState | null>(null);
  const [prefsReady, setPrefsReady] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const unread = useInboxItems();
  const { accounts, loaded: accountsLoaded } = useAccounts();
  // The window is created on the first open and shown straight away, while
  // this page is still loading. Hold the page back until the user's theme,
  // accounts and unread mail are in: otherwise the first open fades in with
  // the default palette and an empty list, then snaps to the real colours
  // while rows spring in and the account pill pops up. Later opens reuse the
  // warm window, which is why only the first one looked glitchy.
  const ready = !!state && (timedOut || (prefsReady && accountsLoaded && unread.loaded));
  useEffect(() => {
    const t = setTimeout(() => setTimedOut(true), READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, []);
  // Flipped one frame after the page learns it is shown (and is ready), so the
  // dim and the card ease in from transparent rather than appearing at full
  // strength.
  const [entered, setEntered] = useState(false);
  const shown = !!state?.shown && ready;
  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(shown));
    return () => cancelAnimationFrame(raf);
  }, [shown]);
  const stageRef = useRef<HTMLDivElement>(null);
  useTheme();
  useAccentColor();

  useEffect(() => {
    document.documentElement.classList.add('quick-reply');
    // Wear the main window's look (read only: the main window owns these prefs).
    void api
      .query('settings:get', { key: 'ui-prefs' })
      .then((stored) => {
        if (!stored || typeof stored !== 'object') return;
        const p = stored as Partial<{
          theme: ThemePref;
          darkPalette: DarkPalette;
          lightPalette: LightPalette;
          accentColor: string | null;
          accountColors: Record<string, string>;
          accountLabels: Record<string, string>;
        }>;
        useUi.setState({
          ...(p.theme ? { theme: p.theme } : {}),
          ...(p.darkPalette ? { darkPalette: p.darkPalette } : {}),
          ...(p.lightPalette ? { lightPalette: p.lightPalette } : {}),
          ...(p.accentColor !== undefined ? { accentColor: p.accentColor } : {}),
          ...(p.accountColors ? { accountColors: p.accountColors } : {}),
          ...(p.accountLabels ? { accountLabels: p.accountLabels } : {}),
        });
      })
      .catch(() => {})
      .finally(() => setPrefsReady(true));
    void api.query('quick-reply:state', undefined).then(setState);
    return wireAssistant();
  }, []);

  useDelta((e) => {
    if (e.kind === 'quick-reply') setState(e.state);
  });

  const close = useCallback(() => void api.command('quick-reply:close', undefined), []);
  /** Close without handing focus back: something the page opened (a meeting link) should keep it. */
  const closeQuiet = useCallback(() => void api.command('quick-reply:close', { returnFocus: false }), []);
  const show = useCallback(
    (mode: QuickReplyState['mode'], currentId: string | null) =>
      void api.command('quick-reply:show', { mode, currentId }),
    [],
  );

  const open = (item: QuickReplyItem) => {
    if (item.category === 'event') {
      // A meeting alert: join the call if there is one, else show it in the calendar.
      if (item.meetingUrl) {
        window.open(item.meetingUrl);
        closeQuiet();
      } else close();
      return;
    }
    if (item.id.startsWith('u:')) {
      // An inbox thread that didn't notify: main lists it so the widget (and ←/→) can find it.
      void api.command('quick-reply:show', { mode: 'reply', item: itemPayload(item) });
      return;
    }
    show('reply', item.id);
  };

  if (!state || !ready) return null;
  const current = state.items.find((i) => i.id === state.currentId) ?? null;
  const replying = state.mode === 'reply' && current?.threadId;

  return (
    <div
      className="qr-scrim fixed inset-0 select-none"
      data-open={entered}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget || e.target === stageRef.current) close();
      }}
    >
      <div ref={stageRef} className="qr-stage absolute inset-0">
        {replying ? (
          <ReplyWidget
            key={current.id}
            item={current}
            position={queuePosition(state.items, current.id)}
            send={state.send?.id === current.id ? state.send : null}
            onStep={(dir) => {
              const next = stepItem(state.items, current.id, dir);
              if (next) show('reply', next);
            }}
            onClose={close}
            onEscape={state.canGoBack ? () => show('list', current.id) : close}
            onDone={() => {
              const next = stepItem(state.items, current.id, 1) ?? stepItem(state.items, current.id, -1);
              if (next) show('reply', next);
              else close();
              void api.command('quick-reply:dismiss', { id: current.id });
            }}
          />
        ) : (
          <NotificationList
            items={state.items}
            inboxItems={unread.rows}
            view={state.view ?? 'inbox'}
            accounts={accounts}
            startId={state.currentId}
            onOpen={open}
            onClose={close}
          />
        )}
      </div>
      <AppToaster />
    </div>
  );
}
