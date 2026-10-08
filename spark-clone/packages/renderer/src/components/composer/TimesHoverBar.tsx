import { CalendarDays, Globe2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { findDraftParagraph } from '../../lib/composerBridge';
import { reviewComposerZones, setComposerPicks, useComposerTimes } from '../../state/availability';
import { TimesCalendar } from '../reading/TimesCalendar';

/** How long the bar lingers after the pointer leaves, so it can be reached. */
const LINGER_MS = 600;

/**
 * Hovering the times ⌘⇧A wrote into the draft shows a small bar: 🌐 reviews
 * everyone's time zone, 📅 opens the calendar to change the times. It stays
 * while the pointer is on the block or the bar, and a moment after.
 */
export function TimesHoverBar({ card }: { card: React.RefObject<HTMLDivElement | null> }) {
  const times = useComposerTimes();
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [calendar, setCalendar] = useState<DOMRect | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = card.current;
    if (!el || !times) return;
    const keep = () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      hideTimer.current = null;
    };
    const hideSoon = () => {
      if (hideTimer.current) return;
      hideTimer.current = setTimeout(() => {
        hideTimer.current = null;
        setPos(null);
      }, LINGER_MS);
    };
    const onMove = (e: MouseEvent) => {
      const t = e.target as Node;
      if (barRef.current?.contains(t)) return keep();
      const block = findDraftParagraph(times.header)?.dom;
      if (block && block.contains(t)) {
        keep();
        const b = block.getBoundingClientRect();
        const c = el.getBoundingClientRect();
        setPos({ top: b.top - c.top - 14, right: c.right - b.right });
      } else hideSoon();
    };
    el.addEventListener('mousemove', onMove);
    el.addEventListener('mouseleave', hideSoon);
    return () => {
      el.removeEventListener('mousemove', onMove);
      el.removeEventListener('mouseleave', hideSoon);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [card, times]);

  if (!times || (!pos && !calendar)) return null;
  return (
    <>
      {pos && (
        <div
          ref={barRef}
          style={{ top: Math.max(4, pos.top), right: Math.max(8, pos.right) }}
          className="border-hairline bg-surface absolute z-30 flex items-center gap-0.5 rounded-lg border p-0.5 shadow-lg"
        >
          <button
            onClick={() => void reviewComposerZones()}
            title="Check everyone’s time zone"
            aria-label="Time zones"
            className="text-ink-muted hover:text-ink hover:bg-accent-soft rounded-md p-1.5"
          >
            <Globe2 size={14} />
          </button>
          <button
            data-times-calendar-toggle
            onClick={(e) => setCalendar(calendar ? null : e.currentTarget.getBoundingClientRect())}
            title="Change the times on a calendar"
            aria-label="Pick times on a calendar"
            className="text-ink-muted hover:text-ink hover:bg-accent-soft rounded-md p-1.5"
          >
            <CalendarDays size={14} />
          </button>
        </div>
      )}
      {calendar && (
        <TimesCalendar
          found={times.found}
          picks={times.picks}
          anchor={calendar}
          onChange={setComposerPicks}
          onClose={() => setCalendar(null)}
        />
      )}
    </>
  );
}
