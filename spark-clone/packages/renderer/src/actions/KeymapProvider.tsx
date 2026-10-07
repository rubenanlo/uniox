import { useEffect } from 'react';
import { api } from '../lib/api';
import { focusPanelLeft, focusPanelRight } from '../lib/panels';
import { handleTriageUndo } from '../lib/undo';
import { keyboardTargetId, useUi } from '../state/store';
import { ACTIONS, matchCombo } from './registry';

function inEditableTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
}

/** Global keyboard dispatch over the action registry. */
export function KeymapProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    return api.onTriageUndo(() => {
      handleTriageUndo();
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const ui = useUi.getState();
      // While composing or in dialogs, only chorded (meta) shortcuts pass through.
      const editable = inEditableTarget(e);
      if (editable && !(e.metaKey || e.ctrlKey)) return;
      if (ui.composer && !(e.metaKey || e.ctrlKey)) return;
      if (ui.commandOpen) return; // cmdk owns the keyboard
      // Enter must keep activating focused buttons/links natively.
      if (e.key === 'Enter' && (e.target as HTMLElement | null)?.closest?.('button, a')) return;

      // Fallback when the key event reaches the page (non-macOS, dev browser, etc.).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleTriageUndo();
        return;
      }

      // ← / → move between panels (sidebar ⇄ list ⇄ reading pane) from
      // anywhere. Panes that need horizontal arrows for themselves (sidebar
      // rows, message headers) stopPropagation before this runs.
      if (
        (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey &&
        (e.target as HTMLElement | null)?.tagName !== 'SELECT' &&
        !ui.picker && !ui.settingsOpen && !ui.shortcutsOpen
      ) {
        e.preventDefault();
        if (e.key === 'ArrowLeft') focusPanelLeft();
        else focusPanelRight();
        return;
      }

      for (const action of ACTIONS) {
        if (!matchCombo(e, action.combo) && !matchCombo(e, action.altCombo ?? null)) continue;
        // In an editable field, don't hijack native ⌘-combos the field needs
        // (selection/clipboard plus the editor's ⌘B/⌘I/⌘U formatting).
        if (
          editable &&
          action.id !== 'undo' &&
          ['a', 'c', 'v', 'x', 'z', 'b', 'i', 'u'].includes(action.combo!.key) &&
          action.combo!.meta &&
          !action.combo!.shift
        )
          return;
        e.preventDefault();
        action.perform(keyboardTargetId());
        return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
  return children;
}
