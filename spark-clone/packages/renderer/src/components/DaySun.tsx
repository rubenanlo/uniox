import { hourOf, useNow, useScheduling } from '../lib/workday';
import { useWindowActive } from '../lib/useWindowActive';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** One coloured light inside the sun; each drifts on its own slow loop. */
const LIGHTS = [
  { color: 'var(--color-aqua)', drift: 'day-sun-drift-a', seconds: 23 },
  { color: 'var(--color-azure)', drift: 'day-sun-drift-b', seconds: 29 },
  { color: 'var(--color-violet)', drift: 'day-sun-drift-c', seconds: 26 },
] as const;

/**
 * Home's backdrop: a soft sun that climbs an arc from the bottom-left toward
 * the upper right as the workday passes (`progress` 0 → 1), with a faint
 * horizon haze along the floor. Its light leans aqua in the morning, azure at
 * midday and violet by evening.
 *
 * The colour play inside the sun is three pre-tinted discs that drift and
 * crossfade. Only transform and opacity animate, so the compositor runs it
 * without repainting the gradients; and it pauses outright while the window
 * is blurred or hidden. The sun's position moves only when Home's 30s clock
 * ticks.
 */
export function DaySun({ progress }: { progress: number }) {
  const active = useWindowActive();
  const p = clamp01(progress);
  const x = 12 + p * 76; // % across the window
  const y = 108 - Math.sin((p * 0.9 + 0.1) * (Math.PI / 2)) * 92; // % down
  // Morning, midday, evening weights; every light keeps a floor so the
  // colours always have something to move between.
  const weights = [clamp01(1 - p * 2), 1 - Math.abs(p * 2 - 1), clamp01(p * 2 - 1)].map(
    (w) => 0.3 + w * 0.7,
  );

  return (
    <div
      className={`day-sun pointer-events-none absolute inset-0 overflow-hidden ${active ? '' : 'day-sun-paused'}`}
      aria-hidden
    >
      <div className="day-sun-haze absolute inset-x-0 bottom-0 h-[38%]" />
      <div
        className="absolute top-0 left-0 h-[64rem] w-[64rem] transition-transform duration-[1200ms] ease-out"
        style={{ transform: `translate(calc(${x}vw - 50%), calc(${y}vh - 50%))` }}
      >
        {LIGHTS.map((l, i) => (
          <div key={l.drift} className="absolute inset-0" style={{ opacity: weights[i] }}>
            <div
              className="day-sun-light absolute inset-0"
              style={{
                animationName: l.drift,
                animationDuration: `${l.seconds}s`,
                background: `radial-gradient(closest-side, color-mix(in oklab, ${l.color} var(--sun-core), transparent), color-mix(in oklab, ${l.color} var(--sun-halo), transparent) 32%, transparent)`,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The sun for the current moment of the configured workday. */
export function HomeSun() {
  const now = useNow();
  const { morningHour: start, eveningHour } = useScheduling();
  const end = Math.max(eveningHour, start + 1);
  return <DaySun progress={(hourOf(now) - start) / (end - start)} />;
}
