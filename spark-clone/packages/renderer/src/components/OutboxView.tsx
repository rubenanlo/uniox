import { AlertTriangle, CalendarClock, Send, Trash2 } from 'lucide-react';
import { api } from '../lib/api';
import { cn } from '../lib/utils';
import { fmtWake } from '../lib/schedule';
import { useOutbox } from '../state/queries';

/**
 * Scheduled sends (report §2.2). Local-first honesty: sends fire while the
 * app runs; anything missed while closed lands here as overdue and waits
 * for an explicit decision.
 */
export function OutboxView() {
  const { sends } = useOutbox();
  const overdue = sends.filter((s) => s.status === 'overdue');

  if (!sends.length) {
    return (
      <div className="text-ink-muted flex h-full flex-col items-center justify-center gap-2 text-[12.5px]">
        <CalendarClock size={20} className="text-ink-faint" />
        <p>No scheduled emails.</p>
        <p className="text-ink-faint text-[11.5px]">Schedule one from the composer’s clock button.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-3">
      {overdue.length > 0 && (
        <div className="border-hairline bg-sunken mb-3 flex items-center gap-2 rounded-xl border px-3 py-2 text-[12px]">
          <AlertTriangle size={13} className="text-danger" />
          <span>
            {overdue.length} {overdue.length === 1 ? 'email' : 'emails'} came due while the app was closed.
            Send or cancel each one.
          </span>
        </div>
      )}
      {sends.map((s) => (
        <article
          key={s.id}
          className={cn(
            'border-hairline bg-surface mb-2 flex items-center gap-3 rounded-xl border px-3.5 py-2.5',
            s.status === 'overdue' && 'border-danger/40',
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12.5px] font-semibold">{s.subject || '(no subject)'}</p>
            <p className="text-ink-muted truncate text-[11.5px]">to {s.toLabel || '—'}</p>
          </div>
          <span
            className={cn(
              'shrink-0 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold',
              s.status === 'overdue' ? 'bg-danger/10 text-danger' : 'bg-accent-soft text-accent',
            )}
          >
            {s.status === 'overdue' ? 'overdue' : s.status === 'sending' ? 'sending…' : fmtWake(s.sendAt)}
          </span>
          <button
            onClick={() => void api.command('task:enqueue', { type: 'send-scheduled-now', scheduledId: s.id })}
            className="bg-accent flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11.5px] font-semibold text-white hover:opacity-90"
          >
            <Send size={11.5} /> Send now
          </button>
          <button
            onClick={() => void api.command('task:enqueue', { type: 'cancel-scheduled', scheduledId: s.id })}
            className="text-ink-muted hover:text-danger rounded-md p-1.5"
            title="Cancel scheduled send"
          >
            <Trash2 size={13} />
          </button>
        </article>
      ))}
    </div>
  );
}
