import { useEffect, useState } from 'react';
import type { ComposerState } from '@app/shared';
import { api } from '../../lib/api';
import { useAccentColor, useTheme } from '../../lib/theme';
import { handleTriageUndo } from '../../lib/undo';
import { useUi } from '../../state/store';
import { AppToaster } from '../AppToaster';
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
      useUi.setState({ theme: popped.theme, accentColor: popped.accentColor });
      setState(popped.state);
    });
  }, []);

  // ⌘Z comes through the app menu; in the editor it is text undo.
  useEffect(() => api.onTriageUndo(() => void handleTriageUndo()), []);

  return (
    <div className="bg-surface relative h-full">
      {state && <Composer state={state} windowed />}
      <AppToaster />
    </div>
  );
}
