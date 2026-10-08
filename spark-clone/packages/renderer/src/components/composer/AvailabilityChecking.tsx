import { useEffect, useState } from 'react';
import { useAvailabilityCheck } from '../../state/availability';
import { Keycaps } from '../ui/Keycap';

const LABEL = 'Checking availability';

/**
 * Shown over the composer while ⌘⇧A looks up everyone's calendars: the label
 * fills in left to right as a stand-in for progress (the lookups don't report
 * any), finishing when the times arrive. Esc cancels.
 */
export function AvailabilityChecking() {
  const checking = useAvailabilityCheck((s) => s.checking);
  if (!checking) return null;
  return <Overlay />;
}

function Overlay() {
  const [progress, setProgress] = useState(0.04);
  useEffect(() => {
    // Creep forward in random steps but never finish on our own: the overlay
    // unmounts when the check does.
    const id = setInterval(
      () => setProgress((p) => Math.min(0.92, p + Math.random() * 0.2 * (1 - p))),
      500,
    );
    return () => clearInterval(id);
  }, []);
  const text = 'text-[26px] font-black tracking-[-0.06em] uppercase leading-none whitespace-nowrap';
  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-surface/85 absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-2xl backdrop-blur-[2px]"
    >
      <div className="relative">
        <div aria-hidden className={`${text} text-accent absolute inset-0 opacity-20`}>
          {LABEL}
        </div>
        <div
          className={`${text} text-accent relative`}
          style={{
            clipPath: `inset(0 ${(1 - progress) * 100}% 0 0)`,
            // A soft overshoot-free ease, close to a spring settling.
            transition: 'clip-path 600ms cubic-bezier(0.22, 1, 0.36, 1)',
            willChange: 'clip-path',
          }}
        >
          {LABEL}
        </div>
      </div>
      <p className="text-ink-faint flex items-center gap-1 text-[11.5px]">
        <Keycaps keys={['Esc']} /> to cancel
      </p>
    </div>
  );
}
