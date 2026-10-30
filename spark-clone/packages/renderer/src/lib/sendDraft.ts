import { toast } from 'sonner';
import type { OutgoingDraft } from '@app/shared';
import { api } from './api';

const UNDO_SEND_MS = 5000;

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
