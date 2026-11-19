import type { GlassRect } from '@app/shared';

/** A screen rectangle (Electron's Rectangle, without importing electron). */
export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * macOS draws frameless windows with this corner radius (and clips their
 * vibrancy to it). Our panels are rounder, so each backdrop sits a little
 * inside its panel to keep its corners hidden under the panel's curve.
 */
const WINDOW_RADIUS = 10;

/** How far a backdrop sits inside a panel of radius `r` so its corners stay inside the panel's curve. */
export function backdropInset(radius: number): number {
  return Math.max(0, Math.ceil((radius - WINDOW_RADIUS) * (1 - Math.SQRT1_2)));
}

/** A panel's rect (in its window) moved to the screen and shrunk to where its blur goes. */
export function backdropBounds(rect: GlassRect, origin: { x: number; y: number }): Bounds | null {
  const d = backdropInset(rect.radius);
  const width = Math.round(rect.width - d * 2);
  const height = Math.round(rect.height - d * 2);
  if (width < 4 || height < 4) return null;
  return { x: Math.round(origin.x + rect.x + d), y: Math.round(origin.y + rect.y + d), width, height };
}


/** The clear, refracting band Liquid Glass keeps around a lens panel (E2), in CSS px; thinner on small panels. */
export function lensRim(rect: GlassRect): number {
  return Math.max(0, Math.min(18, Math.floor(Math.min(rect.width, rect.height) / 6)));
}

/** Smallest core worth blurring: below this a panel is all rim. */
const MIN_CORE = 48;

/**
 * Where a lens panel's softly blurred middle goes: inside its clear rim, and
 * far enough in that the blur window's own 10px corners stay under the
 * panel's curve. Null when the panel is too small to have a middle.
 */
export function lensCoreBounds(rect: GlassRect, origin: { x: number; y: number }): Bounds | null {
  const rim = lensRim(rect);
  const d = Math.max(rim, backdropInset(rect.radius));
  const width = Math.round(rect.width - d * 2);
  const height = Math.round(rect.height - d * 2);
  if (width < MIN_CORE || height < MIN_CORE) return null;
  return { x: Math.round(origin.x + rect.x + d), y: Math.round(origin.y + rect.y + d), width, height };
}
