import { create } from 'zustand';
import { api } from '../lib/api';
import { isValidZone } from '../lib/availability';

/**
 * Time zones the user told the app for people whose Google calendar doesn't
 * show one. Stored under the `contactTimeZones` setting, keyed by lowercased
 * email, and reused for every later group suggestion.
 */
export type ContactZones = Record<string, string>;

const KEY = 'contactTimeZones';

export async function loadContactZones(): Promise<ContactZones> {
  const raw = (await api.query('settings:get', { key: KEY })) as unknown;
  const out: ContactZones = {};
  if (raw && typeof raw === 'object') {
    for (const [email, tz] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof tz === 'string' && isValidZone(tz)) out[email.toLowerCase()] = tz;
    }
  }
  return out;
}

/** Merge `zones` into the stored map; a null value forgets that person. */
export async function saveContactZones(zones: Record<string, string | null>): Promise<void> {
  const next = await loadContactZones();
  for (const [email, tz] of Object.entries(zones)) {
    if (tz) next[email.toLowerCase()] = tz;
    else delete next[email.toLowerCase()];
  }
  await api.command('settings:set', { key: KEY, value: next });
  useZonePrompt.setState((s) => ({ version: s.version + 1 }));
}

export interface ZoneQuestion {
  email: string;
  name?: string;
  /** Pre-selected answer. */
  guess: string;
  /** Where the pre-selected answer came from, shown next to it. */
  source: 'saved' | 'google' | 'thread' | 'assistant' | 'yours';
}

/**
 * The "where are these people?" dialog. `ask` resolves with the chosen zones
 * once saved, or null when skipped. `version` bumps on every save so views
 * holding suggestions can recompute.
 */
export const useZonePrompt = create<{
  questions: ZoneQuestion[] | null;
  resolve: ((zones: ContactZones | null) => void) | null;
  version: number;
}>(() => ({ questions: null, resolve: null, version: 0 }));

export function askForZones(questions: ZoneQuestion[]): Promise<ContactZones | null> {
  if (!questions.length) return Promise.resolve({});
  // A second ask while one is open replaces it; the first resolves as skipped.
  useZonePrompt.getState().resolve?.(null);
  return new Promise((resolve) => useZonePrompt.setState({ questions, resolve }));
}

export function answerZones(zones: ContactZones | null): void {
  const { resolve } = useZonePrompt.getState();
  useZonePrompt.setState({ questions: null, resolve: null });
  if (zones && Object.keys(zones).length) {
    void saveContactZones(zones).then(() => resolve?.(zones));
  } else resolve?.(zones);
}

/** The user's own zone, the fallback answer. */
export function myZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Every IANA zone the runtime knows, for the picker. */
export function allZones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf(
      'timeZone',
    );
  } catch {
    return [myZone()];
  }
}
