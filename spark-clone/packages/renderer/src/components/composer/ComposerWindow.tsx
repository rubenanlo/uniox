import { useEffect, useState } from 'react';
import type { ComposerState } from '@app/shared';
import { api } from '../../lib/api';
import { useAccentColor, useTheme } from '../../lib/theme';
import { handleTriageUndo } from '../../lib/undo';
import { useAssistant, wireAssistant } from '../../state/assistant';
import { useUi } from '../../state/store';
import { AppToaster } from '../AppToaster';
import { AssistantModal } from '../orb/AssistantModal';
import { AssistantPalette } from '../orb/AssistantPalette';
import { Composer } from './Composer';

/**
 * A composer popped out into its own window: the whole window is the draft,
 * so the inbox behind it stays free to browse. It asks main for the draft it
 * was opened with, wears the main window's theme and accent, and closes the
 * window once the email is sent, saved or discarded.
 */
export function ComposerWindow() {
  const [state, setState] = useState<ComposerState | null>(null);
  useTheme();
  useAccentColor();

  useEffect(() => {
    void api.query('composer:window-state', undefined).then((popped) => {
      if (!popped) {
        window.close();
        return;
      }
      // `composer` set so the assistant offers the composer actions here.
      useUi.setState({
        theme: popped.theme,
        accentColor: popped.accentColor,
        composer: popped.state,
      });
      setState(popped.state);
    });
  }, []);

  useEffect(() => wireAssistant(), []);
  // ⌘I opens the assistant palette, as in the main window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'i')
        return;
      e.preventDefault();
      e.stopPropagation();
      const a = useAssistant.getState();
      a.setPaletteOpen(!a.paletteOpen);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // ⌘Z comes through the app menu; in the editor it is text undo.
  useEffect(() => api.onTriageUndo(() => void handleTriageUndo()), []);

  return (
    <div className="bg-surface relative h-full">
      {state && <Composer state={state} windowed />}
      <AssistantPalette />
      <AssistantModal />
      <AppToaster />
    </div>
  );
}
