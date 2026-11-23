import { useEffect, useState } from 'react';
import type { UnioxApi } from '../data/api';
import type { MobileThread } from '../data/types';

/**
 * One-sentence AI gists for priority threads only (Ruben's rule: no AI on
 * other mail). The server already caches each first read per newest message,
 * so a gist costs tokens once per new message; this keeps a local copy too so
 * the Inbox paints instantly on the next open.
 */
const KEY = 'uniox.gists.v1';
type Cache = Record<string, { at: number; text: string }>;

function load(): Cache {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Cache;
  } catch {
    return {};
  }
}
function save(c: Cache) {
  try {
    // Keep the newest 200 entries.
    const keep = Object.entries(c)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 200);
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(keep)));
  } catch {
    /* storage full or blocked: gists just reload next time */
  }
}

/** First sentence of a summary, trimmed for a list row. */
export function firstSentence(s: string): string {
  const t = s.trim().replace(/\s+/g, ' ');
  const m = t.match(/^.+?[.!?](?=\s|$)/);
  return (m ? m[0] : t).slice(0, 220);
}

export function useGists(
  api: UnioxApi,
  threads: MobileThread[],
  enabled: boolean,
): Record<string, string> {
  const [gists, setGists] = useState<Record<string, string>>(() => {
    const c = load();
    const out: Record<string, string> = {};
    for (const t of threads) {
      const hit = c[t.id];
      if (hit && hit.at === t.lastMessageAt) out[t.id] = hit.text;
    }
    return out;
  });
  const want = threads.map((t) => `${t.id}@${t.lastMessageAt}`).join(',');

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void (async () => {
      const cache = load();
      for (const t of threads) {
        if (!live) return;
        const hit = cache[t.id];
        if (hit && hit.at === t.lastMessageAt) {
          setGists((g) => (g[t.id] === hit.text ? g : { ...g, [t.id]: hit.text }));
          continue;
        }
        try {
          const r = await api.firstRead(t.id);
          const text = r.summary ? firstSentence(r.summary) : '';
          if (!text) continue;
          cache[t.id] = { at: t.lastMessageAt, text };
          save(cache);
          if (live) setGists((g) => ({ ...g, [t.id]: text }));
        } catch {
          // No key, offline or AI off: the row falls back to subject + snippet.
          return;
        }
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, enabled, want]);

  return gists;
}
