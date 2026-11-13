import type { DarkPalette, LightPalette } from '@app/shared';

/** What the Settings picker shows for a palette: its name and a few swatches. */
export interface PaletteInfo<Id extends string> {
  id: Id;
  name: string;
  blurb: string;
  app: string;
  surface: string;
  ink: string;
  accent: string;
}

// Swatch values mirror the :root[data-palette] blocks in app.css ('classic' is
// the base @theme / .dark values).
export const DARK_PALETTE_INFO: PaletteInfo<DarkPalette>[] = [
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'Neutral graphite, blue accent',
    app: '#141416',
    surface: '#1e1e21',
    ink: '#e8e8ec',
    accent: '#7fa2ff',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    blurb: 'Deep navy, cyan accent',
    app: '#0b1020',
    surface: '#121a2e',
    ink: '#e3e9f5',
    accent: '#5cc8ff',
  },
  {
    id: 'ember',
    name: 'Ember',
    blurb: 'Warm charcoal, amber accent',
    app: '#17130f',
    surface: '#211b16',
    ink: '#f1e7db',
    accent: '#ff9d5c',
  },
  {
    id: 'aubergine',
    name: 'Aubergine',
    blurb: 'Dark plum, rose accent',
    app: '#16101b',
    surface: '#201727',
    ink: '#efe6f4',
    accent: '#f28bc0',
  },
];

export const LIGHT_PALETTE_INFO: PaletteInfo<LightPalette>[] = [
  {
    id: 'classic',
    name: 'Classic',
    blurb: 'Neutral white, blue accent',
    app: '#f6f6f4',
    surface: '#ffffff',
    ink: '#1c1c1f',
    accent: '#2f63e7',
  },
  {
    id: 'linen',
    name: 'Linen',
    blurb: 'Warm cream, terracotta accent',
    app: '#f3eee5',
    surface: '#fffcf7',
    ink: '#2a241d',
    accent: '#c0532b',
  },
  {
    id: 'glacier',
    name: 'Glacier',
    blurb: 'Cool white, indigo accent',
    app: '#edf1f7',
    surface: '#ffffff',
    ink: '#17202e',
    accent: '#4f46e5',
  },
  {
    id: 'sage',
    name: 'Sage',
    blurb: 'Green-grey, forest accent',
    app: '#edf0ea',
    surface: '#fbfcf9',
    ink: '#1c261e',
    accent: '#2d7a58',
  },
];

/** The palette that applies right now, or null for Classic (no override). */
export function activePalette(
  dark: boolean,
  darkPalette: DarkPalette,
  lightPalette: LightPalette,
): string | null {
  const list: PaletteInfo<string>[] = dark ? DARK_PALETTE_INFO : LIGHT_PALETTE_INFO;
  const id = dark ? darkPalette : lightPalette;
  // A stored id this build doesn't know falls back to Classic.
  return id !== 'classic' && list.some((p) => p.id === id) ? id : null;
}
