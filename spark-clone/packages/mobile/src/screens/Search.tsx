import { Calendar, Search as SearchIcon, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SearchResults } from '../data/types';
import { ThreadRow } from '../components/ThreadRow';
import { AiMark, Empty, Highlight, Spinner, TabBar } from '../components/ui';
import { shortDate, timeRange } from '../lib/format';
import { go, useRoute } from '../lib/router';
import { useStore } from '../lib/store';

type Filter = 'all' | 'mail' | 'events';

export function Search() {
  const api = useStore((s) => s.api);
  const route = useRoute();
  const [q, setQ] = useState(route.query.get('q') ?? '');
  const [res, setRes] = useState<SearchResults | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const input = useRef<HTMLInputElement>(null);
  const shown = q.trim().length < 2 ? null : res;

  useEffect(() => {
    input.current?.focus();
  }, []);
  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) return;
    let live = true;
    const t = setTimeout(() => {
      setBusy(true);
      void api
        .search(query)
        .then((r) => live && setRes(r))
        .finally(() => live && setBusy(false));
      history.replaceState(null, '', `#/search?q=${encodeURIComponent(query)}`);
    }, 350);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [api, q]);

  return (
    <>
      <div className="screen">
        <div className="row-flex" style={{ gap: 10, padding: '8px 16px 0' }}>
          <div
            className="row-flex grow"
            style={{ height: 42, borderRadius: 21, padding: '0 14px', background: 'var(--sunken)' }}
          >
            <SearchIcon size={18} color="var(--muted)" />
            <input
              ref={input}
              className="grow"
              type="search"
              enterKeyHint="search"
              placeholder="Mail, people, events"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              style={{ fontSize: 16 }}
            />
            {busy ? (
              <Spinner />
            ) : (
              q && (
                <button
                  aria-label="Clear"
                  onClick={() => setQ('')}
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    background: 'var(--faint)',
                    color: 'var(--app)',
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  <X size={11} strokeWidth={3} />
                </button>
              )
            )}
          </div>
          {q && (
            <button
              style={{ color: 'var(--accent)', fontSize: 16 }}
              onClick={() => (setQ(''), go('home'))}
            >
              Cancel
            </button>
          )}
        </div>
        {shown && (
          <div className="chips">
            {(
              [
                ['all', 'All'],
                ['mail', `Mail · ${shown.threads.length}`],
                ['events', `Events · ${shown.events.length}`],
              ] as [Filter, string][]
            ).map(([k, l]) => (
              <button
                key={k}
                className={`chip ${filter === k ? 'on' : ''}`}
                onClick={() => setFilter(k)}
              >
                {l}
              </button>
            ))}
          </div>
        )}
        {shown?.answer && (
          <div
            className="glass row-flex pop"
            style={{
              margin: '10px 14px 0',
              borderRadius: 20,
              padding: '12px 14px',
              gap: 10,
              alignItems: 'flex-start',
            }}
          >
            <AiMark />
            <div style={{ fontSize: 14.5, lineHeight: 1.45 }}>{shown.answer}</div>
          </div>
        )}
        {shown && filter !== 'mail' && shown.events.length > 0 && (
          <>
            <div className="sect">
              <span className="eyebrow">Events</span>
            </div>
            {shown.events.map((e) => (
              <button
                key={e.id}
                className="row"
                style={{ width: '100%', textAlign: 'left', alignItems: 'center' }}
                onClick={() => go(`calendar?view=list&event=${encodeURIComponent(e.id)}`)}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    background: `color-mix(in srgb, ${e.color} 15%, transparent)`,
                    color: e.color,
                    display: 'grid',
                    placeItems: 'center',
                    flex: 'none',
                  }}
                >
                  <Calendar size={19} />
                </div>
                <div className="meta">
                  <div className="from">
                    <Highlight text={e.title} query={q} />
                  </div>
                  <div className="snip">
                    {shortDate(e.startMs)} · {e.allDay ? 'all day' : timeRange(e.startMs, e.endMs)}
                  </div>
                </div>
              </button>
            ))}
          </>
        )}
        {shown && filter !== 'events' && shown.threads.length > 0 && (
          <>
            <div className="sect">
              <span className="eyebrow">Mail</span>
            </div>
            {shown.threads.map((t) => (
              <ThreadRow key={t.id} thread={t} query={q} />
            ))}
          </>
        )}
        {shown && !shown.threads.length && !shown.events.length && (
          <Empty title="No results" sub={`Nothing matches “${q}”.`} />
        )}
        {!shown && !busy && (
          <Empty title="Search everything" sub="Mail from every account, and your calendar." />
        )}
      </div>
      <TabBar on="search" />
    </>
  );
}
