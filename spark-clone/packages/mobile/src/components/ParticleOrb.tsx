import { useEffect, useRef } from 'react';

/**
 * The Assistant icon: a small sphere of particles with the Uniox mark (two
 * overlapping rounded cards) floating inside. It opens side-on, turns to face
 * you, then sways, while a band of colour drifts across the particles around
 * the theme's accent colour.
 *
 * Drawn on a 2D canvas. The loop only runs while the app is visible and
 * focused, drops to ~30 fps after the entrance, and draws a single still
 * frame when the system asks for reduced motion.
 */

type Particle = [x: number, y: number, z: number, logo: 0 | 1, rand: number];

const TILT = 0.17;
const REVEAL_S = 2.5;
const SWAY = 0.3;
const SWAY_S = 16;

const built = new Map<string, Particle[]>();

function build(shellN: number, logoN: number): Particle[] {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const pts: Particle[] = [];
  const ct = Math.cos(TILT);
  const st = Math.sin(TILT);
  // Shell: a Fibonacci sphere, tipped slightly toward the viewer.
  for (let i = 0; i < shellN; i++) {
    const y = 1 - (2 * (i + 0.5)) / shellN;
    const r = Math.sqrt(1 - y * y);
    const a = i * 2.39996323;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    pts.push([x, ct * y - st * z, st * y + ct * z, 0, rnd()]);
  }
  // The mark, in the app icon's own coordinates (build/icon.svg): the front
  // card hides part of the back one. Each point gets a random depth, so the
  // mark is a cloud from the side and only lines up when it faces you.
  const sd = (
    px: number,
    py: number,
    cx: number,
    cy: number,
    hw: number,
    hh: number,
    rad: number,
  ) => {
    const qx = Math.abs(px - cx) - (hw - rad);
    const qy = Math.abs(py - cy) - (hh - rad);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
  };
  for (let n = 0, guard = 0; n < logoN && guard < logoN * 300; guard++) {
    const px = 200 + rnd() * 620;
    const py = 190 + rnd() * 640;
    const f = sd(px, py, 452.5, 440.5, 205.5, 208.5, 96);
    const b = sd(px, py, 558.5, 580.5, 196.5, 202.5, 96);
    if (!(Math.abs(f) < 26 || (Math.abs(b) < 26 && f > 46))) continue;
    const x = ((px - 501) / 300) * 0.56;
    const y = (-(py - 507.5) / 300) * 0.56;
    const room = Math.sqrt(Math.max(0, 0.9 - x * x - y * y));
    pts.push([x, y, (rnd() * 2 - 1) * room * 0.5, 1, rnd()]);
    n++;
  }
  return pts;
}

/** The accent colour as [hue, saturation %, lightness %]. */
function accentHsl(el: Element): [number, number, number] {
  let hex = getComputedStyle(el).getPropertyValue('--accent').trim().replace('#', '');
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  if (hex.length !== 6 || Number.isNaN(r + g + b)) return [199, 100, 68];
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (mx === r) h = ((g - b) / d) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s * 100, l * 100];
}

const smooth = (a: number, b: number, v: number) => {
  const q = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return q * q * (3 - 2 * q);
};

function draw(c: HTMLCanvasElement, size: number, t: number, still: boolean) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const W = Math.round(size * dpr);
  if (c.width !== W) c.width = c.height = W;
  const ctx = c.getContext('2d');
  if (!ctx) return;
  const small = size < 90;
  const key = small ? 's' : 'l';
  let pts = built.get(key);
  if (!pts) built.set(key, (pts = small ? build(620, 420) : build(3600, 2400)));

  ctx.clearRect(0, 0, W, W);
  const ease = still ? 1 : 1 - Math.pow(1 - Math.min(1, t / REVEAL_S), 3);
  const yaw = still ? 0 : (-Math.PI / 2) * (1 - ease) + Math.sin((t * 2 * Math.PI) / SWAY_S) * SWAY;
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const R = W * 0.36 * (0.78 + 0.22 * ease);
  const mid = W / 2;

  const [h, s, l] = accentHsl(c);
  const sat = Math.max(55, s).toFixed(0);
  // On a light background the particles need to be darker to show.
  const dark = l > 60;
  const shellL = (dark ? Math.min(82, l + 6) : Math.max(38, l - 4)).toFixed(0);
  const logoL = (dark ? Math.min(90, l + 16) : Math.max(30, l - 12)).toFixed(0);
  const shellPal: string[] = [];
  const logoPal: string[] = [];
  for (let k = 0; k < 8; k++) {
    const hue = (h + (k / 7 - 0.5) * 80).toFixed(0);
    shellPal.push(`hsl(${hue},${sat}%,${shellL}%)`);
    logoPal.push(`hsl(${hue},${sat}%,${logoL}%)`);
  }

  const unit = dpr * (small ? 0.62 : 1);
  for (const [x, y, z, logo, rand] of pts) {
    const rx = cy * x - sy * z;
    const rz = sy * x + cy * z;
    const light = Math.max(0.08, Math.min(1, 0.52 - rx * 0.48 + y * 0.32));
    const band = Math.floor((Math.sin(t * 0.7 + x * 2.2 + y * 1.4 + z * 0.8) * 0.5 + 0.5) * 7.999);
    let alpha: number;
    let sz: number;
    if (!logo) {
      const edge = Math.pow(Math.max(0, 1 - Math.abs(rz)), 3);
      const front = smooth(-0.1, 0.65, rz);
      alpha =
        (0.04 + edge * (0.9 + light * light * 0.5) + front * 0.2) *
        (0.5 + 0.5 * light) *
        (0.45 + 0.55 * rand) *
        1.5;
      alpha *= 1 - smooth(-0.25, 0.65, rx) * smooth(-0.25, 0.65, -y) * 0.85;
      sz = (0.9 + edge * 1.5 + front * 0.3) * unit;
      ctx.fillStyle = shellPal[band]!;
      if (rand > 0.8) {
        // A sparse outer shell of dust.
        ctx.globalAlpha = Math.min(1, (0.14 + Math.max(rz, 0) * 0.45) * light * 0.7 * ease);
        ctx.fillRect(mid + rx * R * 1.3, mid - y * R * 1.3, unit, unit);
      }
    } else {
      alpha = 0.72 + 0.28 * light;
      sz = (small ? 1.5 : 1.35) * unit;
      ctx.fillStyle = logoPal[band]!;
    }
    ctx.globalAlpha = Math.min(1, alpha * ease);
    ctx.fillRect(mid + rx * R - sz / 2, mid - y * R - sz / 2, sz, sz);
  }
  ctx.globalAlpha = 1;
}

export function ParticleOrb({ size = 44 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0;
    let t = 0;
    let last = 0;
    let drawnAt = -1;
    const awake = () => !document.hidden && document.hasFocus();
    const loop = (now: number) => {
      raf = 0;
      if (reduced.matches) return draw(c, size, 40, true);
      if (!awake()) return; // start() resumes it on focus / visibility
      t += Math.min(now - (last || now), 50) / 1000;
      last = now;
      // Full rate for the opening turn, ~30 fps for the slow sway after it.
      if (t < REVEAL_S + 0.2 || t - drawnAt >= 1 / 31) {
        draw(c, size, t, false);
        drawnAt = t;
      }
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      last = 0;
      if (!raf) raf = requestAnimationFrame(loop);
    };
    draw(c, size, 0, reduced.matches);
    start();
    window.addEventListener('focus', start);
    document.addEventListener('visibilitychange', start);
    reduced.addEventListener('change', start);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('focus', start);
      document.removeEventListener('visibilitychange', start);
      reduced.removeEventListener('change', start);
    };
  }, [size]);
  return <canvas ref={ref} aria-hidden style={{ width: size, height: size, display: 'block' }} />;
}
