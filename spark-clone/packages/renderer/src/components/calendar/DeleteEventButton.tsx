import { Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import type { CalendarEvent } from '@app/shared';
import { deleteTargetId } from '../../lib/eventEdit';
import { cn } from '../../lib/utils';
import { useCalendar } from '../../state/calendar';

/**
 * Delete for the details panes. Local events go at once; Google events also
 * disappear from Google (and guests' calendars), so the first click only arms
 * the button and a second one within a few seconds deletes. Key it by event id
 * so switching events never carries an armed state over.
 */
export function DeleteEventButton({
  event,
  className,
  children,
  armedLabel = 'Delete from Google?',
}: {
  event: CalendarEvent;
  className: string;
  children: ReactNode;
  armedLabel?: string;
}) {
  const remove = useCalendar((s) => s.remove);
  const calendars = useCalendar((s) => s.calendars);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const target = deleteTargetId(event, calendars);
  const confirm = event.source === 'google';

  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  if (!target) return null;

  const onClick = async () => {
    if (busy) return;
    if (confirm && !armed) {
      setArmed(true);
      return;
    }
    setBusy(true);
    const err = await remove(target);
    setBusy(false);
    setArmed(false);
    if (err) toast(err);
  };

  return (
    <button
      onClick={() => void onClick()}
      disabled={busy}
      aria-label={armed ? armedLabel : 'Delete event'}
      className={cn(
        className,
        armed && 'bg-danger border-danger text-white hover:bg-danger',
        armed && 'w-auto px-3',
      )}
    >
      {armed ? (
        <span className="flex items-center gap-1.5 text-[12px] font-semibold whitespace-nowrap">
          <Trash2 size={12} /> {armedLabel}
        </span>
      ) : (
        children
      )}
    </button>
  );
}
