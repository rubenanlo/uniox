/**
 * "Sync with phone": the view preferences the desktop and the phone app share,
 * and the translation between the desktop's `ui-prefs` names and the phone's
 * `settings.data` names (packages/mobile/src/data/types.ts SharedSettings).
 */

/** Desktop side (subset of the renderer's UiPrefs). */
export interface DesktopSharedPrefs {
  theme: 'system' | 'light' | 'dark';
  lightPalette: string;
  darkPalette: string;
  readingLayout: 'classic' | 'chat';
}

/** Phone side (subset of SharedSettings). */
export interface CloudSharedPrefs {
  theme: 'auto' | 'light' | 'dark';
  palette: string;
  paletteDark: string;
  threadLayout: 'cards' | 'chat';
}

export const CLOUD_PREF_KEYS = ['theme', 'palette', 'paletteDark', 'threadLayout'] as const;
export type CloudPrefKey = (typeof CLOUD_PREF_KEYS)[number];

const paletteOut = (p: string): string => (p === 'classic' ? 'default' : p);
const paletteIn = (p: string): string => (p === 'default' ? 'classic' : p);

export function toCloudPrefs(d: Partial<DesktopSharedPrefs>): Partial<CloudSharedPrefs> {
  const out: Partial<CloudSharedPrefs> = {};
  if (d.theme) out.theme = d.theme === 'system' ? 'auto' : d.theme;
  if (d.lightPalette) out.palette = paletteOut(d.lightPalette);
  if (d.darkPalette) out.paletteDark = paletteOut(d.darkPalette);
  if (d.readingLayout) out.threadLayout = d.readingLayout === 'classic' ? 'cards' : 'chat';
  return out;
}

export function toDesktopPrefs(
  c: Partial<CloudSharedPrefs>,
  known: { light: readonly string[]; dark: readonly string[] },
): Partial<DesktopSharedPrefs> {
  const out: Partial<DesktopSharedPrefs> = {};
  if (c.theme === 'auto') out.theme = 'system';
  else if (c.theme === 'light' || c.theme === 'dark') out.theme = c.theme;
  // A palette this build does not know is left alone rather than applied.
  if (typeof c.palette === 'string' && known.light.includes(paletteIn(c.palette))) {
    out.lightPalette = paletteIn(c.palette);
  }
  if (typeof c.paletteDark === 'string' && known.dark.includes(paletteIn(c.paletteDark))) {
    out.darkPalette = paletteIn(c.paletteDark);
  }
  if (c.threadLayout === 'cards') out.readingLayout = 'classic';
  else if (c.threadLayout === 'chat') out.readingLayout = 'chat';
  return out;
}

/**
 * Three-way merge per key against `base`, the values both sides agreed on at
 * the last sync. A side that moved away from the base wins; if both moved,
 * the phone's value wins (it was saved to the cloud first). With no base yet
 * (first sync) the desktop's values win.
 */
export function mergeCloudPrefs(
  local: Partial<CloudSharedPrefs>,
  remote: Partial<CloudSharedPrefs>,
  base: Partial<CloudSharedPrefs> | null,
): { merged: Partial<CloudSharedPrefs>; push: Partial<CloudSharedPrefs>; apply: Partial<CloudSharedPrefs> } {
  const merged: Record<string, unknown> = {};
  const push: Record<string, unknown> = {};
  const apply: Record<string, unknown> = {};
  for (const k of CLOUD_PREF_KEYS) {
    const l = local[k];
    const r = remote[k];
    const b = base?.[k];
    if (base && r !== undefined && r !== b) {
      merged[k] = r;
      if (r !== l) apply[k] = r;
    } else if (l !== undefined) {
      merged[k] = l;
      if (l !== r) push[k] = l;
    } else if (r !== undefined) {
      merged[k] = r;
    }
  }
  return {
    merged: merged as Partial<CloudSharedPrefs>,
    push: push as Partial<CloudSharedPrefs>,
    apply: apply as Partial<CloudSharedPrefs>,
  };
}

/** What Settings shows for "Sync with phone". */
export interface CloudSyncStatus {
  enabled: boolean;
  /** The Uniox cloud user the desktop is linked as. */
  email?: string;
  /** Result of the last hand-over, per Google account. */
  accounts?: { email?: string; ok: boolean; error?: string }[];
  lastSyncAt?: number;
  error?: string;
}
