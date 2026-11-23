/**
 * Double-tap the top of the window to scroll back up, like tapping the
 * status bar in a native iPhone app. Taps on buttons, links and fields
 * keep their normal meaning.
 */
const ZONE = 64; // px below the safe area that count as "the top"
const GAP_MS = 320;

let lastTap = { at: 0, x: 0 };

function safeTop(): number {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--safe-top');
  const probe = document.createElement('div');
  probe.style.cssText = `position:fixed;top:0;height:${v || '0px'};visibility:hidden`;
  document.body.appendChild(probe);
  const h = probe.offsetHeight;
  probe.remove();
  return h;
}

function scrollAllUp() {
  // Whatever is scrolled on screen goes back to the top (the page, a sheet, a list).
  const els = [
    document.scrollingElement,
    ...Array.from(document.querySelectorAll<HTMLElement>('*')),
  ];
  for (const el of els) {
    if (!el || el.scrollTop <= 0) continue;
    if (el instanceof HTMLElement && el.offsetParent === null && el !== document.body) continue;
    el.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function onTap(x: number, y: number, target: EventTarget | null) {
  if (y > safeTop() + ZONE) return;
  if (
    target instanceof Element &&
    target.closest('button, a, input, textarea, select, [role="button"]')
  )
    return;
  const now = performance.now();
  if (now - lastTap.at < GAP_MS && Math.abs(x - lastTap.x) < 60) {
    lastTap = { at: 0, x: 0 };
    scrollAllUp();
  } else lastTap = { at: now, x };
}

export function installScrollToTop() {
  document.addEventListener(
    'touchend',
    (e) => {
      const t = e.changedTouches[0];
      if (t && e.touches.length === 0) onTap(t.clientX, t.clientY, e.target);
    },
    { passive: true },
  );
  // Mouse double-click for desktop browsers.
  document.addEventListener('dblclick', (e) => {
    if (e.clientY <= safeTop() + ZONE) {
      const target = e.target;
      if (!(target instanceof Element && target.closest('button, a, input, textarea, select')))
        scrollAllUp();
    }
  });
}
