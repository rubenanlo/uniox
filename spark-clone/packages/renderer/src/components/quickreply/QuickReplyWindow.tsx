import type { DarkPalette, LightPalette, QuickReplyItem, QuickReplyState } from '@app/shared';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { queuePosition, stepItem } from '../../lib/quickReply';
import { useAccentColor, useTheme } from '../../lib/theme';
import { wireAssistant } from '../../state/assistant';
import { useDelta } from '../../state/queries';
import { useUi, type ThemePref } from '../../state/store';
import { AppToaster } from '../AppToaster';
import { NotificationList } from './NotificationList';
import { ReplyWidget } from './ReplyWidget';

/**
 * The quick-reply overlay window (#quick-reply). It covers the screen: the
 * dim scrim, then the notification list (⌥⌘N) or the reply widget for one
 * email. Esc or a click on the dimmed area closes it.
 */
export function QuickReplyWindow() {
  const [state, setState] = useState<QuickReplyState | null>(null);
  useTheme();
  useAccentColor();

  useEffect(() => {
    document.documentElement.classList.add('quick-reply');
    // Wear the main window's look (read only: the main window owns these prefs).
    void api.query('settings:get', { key: 'ui-prefs' }).then((stored) => {
      if (!stored || typeof stored !== 'object') return;
      const p = stored as Partial<{
        theme: ThemePref;
        darkPalette: DarkPalette;
        lightPalette: LightPalette;
        accentColor: string | null;
      }>;
      useUi.setState({
        ...(p.theme ? { theme: p.theme } : {}),
        ...(p.darkPalette ? { darkPalette: p.darkPalette } : {}),
        ...(p.lightPalette ? { lightPalette: p.lightPalette } : {}),
        ...(p.accentColor !== undefined ? { accentColor: p.accentColor } : {}),
      });
    });
    void api.query('quick-reply:state', undefined).then(setState);
    return wireAssistant();
  }, []);

  useDelta((e) => {
    if (e.kind === 'quick-reply') setState(e.state);
  });

  const close = useCallback(() => void api.command('quick-reply:close', undefined), []);
  const show = useCallback(
    (mode: QuickReplyState['mode'], currentId: string | null) => void api.command('quick-reply:show', { mode, currentId }),
    [],
  );

  const open = (item: QuickReplyItem) => {
    if (item.category === 'event') {
      // A meeting alert: join the call if there is one, else show it in the calendar.
      if (item.meetingUrl) window.open(item.meetingUrl);
      close();
      return;
    }
    show('reply', item.id);
  };

  if (!state) return null;
  const current = state.items.find((i) => i.id === state.currentId) ?? null;
  const replying = state.mode === 'reply' && current?.threadId;

  return (
    <div
      className="qr-scrim fixed inset-0 select-none"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      {replying ? (
        <ReplyWidget
          key={current.id}
          item={current}
          position={queuePosition(state.items, current.id)}
          onStep={(dir) => {
            const next = stepItem(state.items, current.id, dir);
            if (next) show('reply', next);
          }}
          onClose={close}
          onDone={() => {
            const next = stepItem(state.items, current.id, 1) ?? stepItem(state.items, current.id, -1);
            if (next) show('reply', next);
            else close();
            void api.command('quick-reply:dismiss', { id: current.id });
          }}
        />
      ) : (
        <NotificationList items={state.items} startId={state.currentId} onOpen={open} onClose={close} />
      )}
      <AppToaster />
    </div>
  );
}
