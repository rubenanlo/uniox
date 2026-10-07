import { toast } from 'sonner';

const UNDO_TTL_MS = 5000;

interface UndoEntry {
  run(): void;
  expiresAt: number;
  toastId: string | number;
}

/** The most recent undoable action; ⌘Z reverts it while its toast is up. */
let last: UndoEntry | null = null;

function invoke(entry: UndoEntry) {
  if (last === entry) last = null;
  toast.dismiss(entry.toastId);
  entry.run();
}

/** Show an action toast with an Undo button and arm ⌘Z to revert it. */
export function toastWithUndo(message: string, run: () => void) {
  const entry: UndoEntry = { run, expiresAt: 0, toastId: '' };
  entry.toastId = toast(message, {
    duration: UNDO_TTL_MS,
    action: { label: 'Undo ⌘Z', onClick: () => invoke(entry) },
  });
  entry.expiresAt = Date.now() + UNDO_TTL_MS;
  last = entry;
}

/** Revert the most recent triage action. Returns false when nothing is undoable. */
export function performUndo(): boolean {
  if (!last || Date.now() > last.expiresAt) return false;
  invoke(last);
  return true;
}

function activeElement(): HTMLElement | null {
  const el = document.activeElement;
  return el instanceof HTMLElement ? el : null;
}

/** Composer body: ⌘Z is text undo, not triage undo. */
function inComposerEditor(): boolean {
  return !!activeElement()?.closest('.ProseMirror') && !!document.querySelector('[data-composer]');
}

/** Route ⌘Z from the menu accelerator or the page keymap. */
export function handleTriageUndo(): boolean {
  if (inComposerEditor()) {
    document.execCommand('undo');
    return true;
  }
  if (performUndo()) return true;
  const el = activeElement();
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
    document.execCommand('undo');
    return true;
  }
  toast('Nothing to undo');
  return false;
}
