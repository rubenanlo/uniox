import { useEffect } from 'react';
import { api } from '../lib/api';
import { loadPrioritySenders, seedLegacyPriorityEmails, wirePriorityDeltaRefresh } from './priority';
import { useUi, type ListDensity, type ListLayout, type ThemePref } from './store';

const KEY = 'ui-prefs';

interface UiPrefs {
  theme: ThemePref;
  listLayout: ListLayout;
  density: ListDensity;
  split: boolean;
  smartInbox: boolean;
  sidebarExpanded: boolean;
  /** Legacy only — priority senders now live in the sync DB (priority.ts).
   *  Still read once on load to migrate old blobs; never written back. */
  priorityEmails?: string[];
  accountAvatars: Record<string, string>;
  accountColors: Record<string, string>;
  accentColor: string | null;
}

const pick = (s: ReturnType<typeof useUi.getState>): UiPrefs => ({
  theme: s.theme,
  listLayout: s.listLayout,
  density: s.density,
  split: s.split,
  smartInbox: s.smartInbox,
  sidebarExpanded: s.sidebarExpanded,
  accountAvatars: s.accountAvatars,
  accountColors: s.accountColors,
  accentColor: s.accentColor,
});

/** Restore view preferences on launch and save them when they change. */
export function usePersistedUiPrefs() {
  useEffect(() => {
    let loaded = false;
    let timer: number | undefined;
    void api.query('settings:get', { key: KEY }).then(async (stored) => {
      let legacyPriority: string[] | undefined;
      if (stored && typeof stored === 'object') {
        const { priorityEmails, ...p } = stored as Partial<UiPrefs>;
        legacyPriority = priorityEmails;
        useUi.setState({ ...pick(useUi.getState()), ...p });
      }
      loaded = true;
      // Priority senders come from the sync DB; migrate any legacy blob first.
      await seedLegacyPriorityEmails(legacyPriority);
      await loadPrioritySenders();
      wirePriorityDeltaRefresh();
    });
    const unsub = useUi.subscribe((s, prev) => {
      if (!loaded) return;
      const a = pick(s);
      const b = pick(prev);
      if ((Object.keys(a) as (keyof UiPrefs)[]).every((k) => a[k] === b[k])) return;
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        void api.command('settings:set', { key: KEY, value: pick(useUi.getState()) });
      }, 300);
    });
    return () => {
      unsub();
      clearTimeout(timer);
    };
  }, []);
}
