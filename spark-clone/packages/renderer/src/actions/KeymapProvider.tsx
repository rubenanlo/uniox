import { useEffect } from 'react';
import { api } from '../lib/api';
import { focusPanelLeft, focusPanelRight } from '../lib/panels';
import { handleTriageUndo } from '../lib/undo';
import { keyboardTargetId, useUi } from '../state/store';
import { ACTIONS, fieldOwnsKey, matchCombo, refreshNow } from './registry';

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

  // ⌘R arrives from the app menu (it replaces Electron's reload there); the
  // registry binding below covers the key when it reaches the page instead.
  useEffect(() => api.onAppRefresh(refreshNow), []);

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
        // Don't hijack ⌘-combos a field needs (clipboard, ⌘B/⌘I/⌘U formatting —
        // ⌘I only in rich text, so it opens the assistant from plain inputs),
        // and never act on the email list from inside the composer.
        const el = e.target as HTMLElement | null;
        const inComposer = !!el?.closest?.('[data-composer]');
        const richText = !!el?.isContentEditable;
        if (fieldOwnsKey(e, action, { editable, inComposer, richText })) return;
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
