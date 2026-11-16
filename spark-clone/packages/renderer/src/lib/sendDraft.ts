import { toast } from 'sonner';
import type { OutgoingDraft } from '@app/shared';
import { api } from './api';

export const UNDO_SEND_MS = 5000;

/** Undo Send: the task is enqueued only after the window elapses. */
export function sendWithUndo(draft: OutgoingDraft): void {
  let cancelled = false;
  const timer = setTimeout(() => {
    if (!cancelled) void api.command('task:enqueue', { type: 'send-draft', draft });
  }, UNDO_SEND_MS);
  toast('Sending…', {
    duration: UNDO_SEND_MS,
    action: {
      label: 'Undo',
      onClick: () => {
        cancelled = true;
        clearTimeout(timer);
        toast('Send cancelled');
      },
    },
  });
}

/**
 * Undo Send without a toast, for surfaces that show their own countdown (the
 * quick-reply widget's "Sending… Undo" bubble). The timer lives at module
 * level, so it still fires if that surface unmounts or its window hides.
 */
export function deferSend(draft: OutgoingDraft, onSent?: () => void): { cancel: () => boolean } {
  let state: 'waiting' | 'sent' | 'cancelled' = 'waiting';
  const timer = setTimeout(() => {
    state = 'sent';
    void api.command('task:enqueue', { type: 'send-draft', draft }).then(() => onSent?.());
  }, UNDO_SEND_MS);
  return {
    cancel: () => {
      if (state !== 'waiting') return false;
      state = 'cancelled';
      clearTimeout(timer);
      return true;
    },
  };
}
