import { useEffect, useState } from 'react';

/**
 * `value`, settled for `delayMs`. A delay of 0 passes the value straight
 * through (e.g. clearing a search should apply at once).
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), Math.max(0, delayMs));
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return delayMs <= 0 ? value : settled;
}
