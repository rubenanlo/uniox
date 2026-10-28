import { useEffect, useState } from 'react';

/**
 * Whether the window is focused and visible. Ambient motion keys off this so
 * it costs nothing while the app sits in the background.
 */
export function useWindowActive(): boolean {
  const read = () => !document.hidden && document.hasFocus();
  const [active, setActive] = useState(read);
  useEffect(() => {
    const update = () => setActive(read());
    window.addEventListener('focus', update);
    window.addEventListener('blur', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.removeEventListener('focus', update);
      window.removeEventListener('blur', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return active;
}
