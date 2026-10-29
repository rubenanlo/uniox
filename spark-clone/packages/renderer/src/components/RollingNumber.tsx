import { useEffect, useState } from 'react';

/** Matches the .home-glide transition in app.css. */
const ROLL_MS = 900;

type Wheel = { digit: number; pos: number; still: boolean };

/**
 * One digit of a rolling number: a strip of 0–9 twice over, slid on transform
 * so a change costs one composited transition. Rolling forward past 9 (say
 * 59 → 60) runs on into the second copy and then snaps back unseen, so the
 * wheel always turns the way the number moved.
 */
function DigitWheel({ digit, up, glide }: { digit: number; up: boolean; glide: boolean }) {
  const [wheel, setWheel] = useState<Wheel>({ digit, pos: digit, still: true });
  if (wheel.digit !== digit) {
    const wrap = glide && up && digit < wheel.digit;
    setWheel({ digit, pos: wrap ? digit + 10 : digit, still: !glide });
  }

  // Once a wrap has rolled into the second copy, swap back to the first.
  useEffect(() => {
    if (wheel.pos < 10) return;
    const id = window.setTimeout(
      () => setWheel((w) => ({ ...w, pos: w.pos - 10, still: true })),
      ROLL_MS + 50,
    );
    return () => window.clearTimeout(id);
  }, [wheel.pos]);

  return (
    <span className="inline-block h-[1em] overflow-hidden">
      <span
        className={`flex flex-col ${wheel.still ? '' : 'home-glide'}`}
        style={{ transform: `translateY(${-wheel.pos}em)` }}
      >
        {Array.from({ length: 20 }, (_, i) => (
          <span key={i} className="h-[1em]">
            {i % 10}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * A whole number whose digits roll to their new value when it changes —
 * nothing runs between changes. Digits are keyed from the right so the ones
 * wheel stays put when the number grows a digit. Needs `leading-none` and
 * `tabular-nums` on the parent.
 */
export function RollingNumber({ value, glide }: { value: number; glide: boolean }) {
  const [last, setLast] = useState({ value, up: true });
  if (last.value !== value) setLast({ value, up: value > last.value });
  const digits = String(value).split('').map(Number);
  return (
    <span aria-label={String(value)} className="inline-flex">
      <span aria-hidden className="inline-flex">
        {digits.map((d, i) => (
          <DigitWheel key={digits.length - i} digit={d} up={last.up} glide={glide} />
        ))}
      </span>
    </span>
  );
}
