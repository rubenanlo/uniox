import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calendarRowId,
  listGoogleEvents,
  listGoogleEventsChanged,
  mapGoogleEvent,
  parseGTime,
  gEventTimes,
  patchGoogleEvent,
  SyncTokenExpiredError,
  type GEventItem,
} from '../src/google-calendar';

const d = (y: number, m: number, day: number) => new Date(y, m - 1, day).getTime();

describe('parseGTime', () => {
  it('parses all-day dates to local midnight', () => {
    expect(parseGTime({ date: '2026-08-20' })).toEqual({ ms: d(2026, 8, 20), allDay: true });
  });
  it('parses RFC 3339 dateTimes with offsets', () => {
    const r = parseGTime({ dateTime: '2026-08-20T15:00:00+02:00' });
    expect(r?.allDay).toBe(false);
    expect(r?.ms).toBe(Date.parse('2026-08-20T13:00:00Z'));
  });
  it('rejects garbage and empties', () => {
    expect(parseGTime(undefined)).toBeNull();
    expect(parseGTime({ dateTime: 'not-a-date' })).toBeNull();
    expect(parseGTime({})).toBeNull();
  });
});

describe('calendarRowId', () => {
  it('primary rides the acct row; others key by remote id', () => {
    expect(calendarRowId('a1', { id: 'x@gmail.com', primary: true })).toBe('acct:a1');
    expect(calendarRowId('a1', { id: 'team@group.calendar.google.com' })).toBe(
      'gcal:a1:team@group.calendar.google.com',
    );
  });
});

describe('mapGoogleEvent', () => {
  const base: GEventItem = {
    id: 'ev1',
    summary: 'Standup',
    start: { dateTime: '2026-08-20T09:00:00+02:00' },
    end: { dateTime: '2026-08-20T09:30:00+02:00' },
  };

  it('maps a timed event with the composite id', () => {
    const m = mapGoogleEvent(base, 'acct:a1')!;
    expect(m.id).toBe('gev:acct:a1:ev1');
    expect(m.remoteId).toBe('ev1');
    expect(m.allDay).toBe(false);
    expect(m.endMs - m.startMs).toBe(30 * 60_000);
    expect(m.eventType).toBe('default');
  });
  it('maps all-day events keeping the exclusive end date', () => {
    const m = mapGoogleEvent(
      { ...base, start: { date: '2026-08-24' }, end: { date: '2026-08-28' } },
      'acct:a1',
    )!;
    expect(m.allDay).toBe(true);
    expect(m.startMs).toBe(d(2026, 8, 24));
    expect(m.endMs).toBe(d(2026, 8, 28));
  });
  it('skips cancelled and working-location items', () => {
    expect(mapGoogleEvent({ ...base, status: 'cancelled' }, 'c')).toBeNull();
    expect(mapGoogleEvent({ ...base, eventType: 'workingLocation' }, 'c')).toBeNull();
  });
  it('carries out-of-office, meet links, and palette colors', () => {
    const m = mapGoogleEvent(
      { ...base, eventType: 'outOfOffice', hangoutLink: 'https://meet.google.com/x', colorId: '11' },
      'c',
    )!;
    expect(m.eventType).toBe('outOfOffice');
    expect(m.meetingUrl).toBe('https://meet.google.com/x');
    expect(m.color).toBe('#d50000');
  });
  it('skips events missing parseable times', () => {
    expect(mapGoogleEvent({ id: 'x', start: {}, end: {} }, 'c')).toBeNull();
  });
});

describe('incremental calendar sync', () => {
  const page = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });

  afterEach(() => vi.unstubAllGlobals());

  it('full fetch returns items and the nextSyncToken from the last page', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page({ items: [{ id: 'e1' }], nextPageToken: 'p2' }))
      .mockResolvedValueOnce(page({ items: [{ id: 'e2' }], nextSyncToken: 'tokA' }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await listGoogleEvents('tok', 'cal', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z');
    expect(res.items.map((i) => i.id)).toEqual(['e1', 'e2']);
    expect(res.nextSyncToken).toBe('tokA');
  });

  it('changed fetch sends syncToken and returns cancelled items too', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        page({ items: [{ id: 'gone', status: 'cancelled' }], nextSyncToken: 'tokB' }),
      );
    vi.stubGlobal('fetch', fetchMock);
    const res = await listGoogleEventsChanged('tok', 'cal', 'tokA');
    expect(String(fetchMock.mock.calls[0]![0])).toContain('syncToken=tokA');
    expect(res.items[0]?.status).toBe('cancelled');
    expect(res.nextSyncToken).toBe('tokB');
  });

  it('throws SyncTokenExpiredError on HTTP 410', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(page({}, 410)));
    await expect(listGoogleEventsChanged('tok', 'cal', 'stale')).rejects.toBeInstanceOf(
      SyncTokenExpiredError,
    );
  });
});

describe('gEventTimes', () => {
  it('formats timed events as RFC 3339 dateTimes', () => {
    const start = Date.parse('2026-08-20T13:00:00Z');
    const t = gEventTimes(start, start + 3_600_000, false);
    expect(Date.parse(t.start.dateTime!)).toBe(start);
    expect(Date.parse(t.end.dateTime!)).toBe(start + 3_600_000);
    expect(t.start.date).toBeUndefined();
  });
  it('formats all-day events as local dates keeping the exclusive end', () => {
    const t = gEventTimes(d(2026, 8, 24), d(2026, 8, 28), true);
    expect(t.start).toEqual({ date: '2026-08-24' });
    expect(t.end).toEqual({ date: '2026-08-28' });
  });
});

describe('mapGoogleEvent transparency', () => {
  it('carries free (transparent) and defaults to busy', () => {
    const base: GEventItem = {
      id: 'ev1',
      start: { dateTime: '2026-08-20T09:00:00Z' },
      end: { dateTime: '2026-08-20T10:00:00Z' },
    };
    expect(mapGoogleEvent({ ...base, transparency: 'transparent' }, 'c')?.transparency).toBe(
      'transparent',
    );
    expect(mapGoogleEvent(base, 'c')?.transparency).toBeUndefined();
  });
});

describe('patchGoogleEvent', () => {
  const page = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  afterEach(() => vi.unstubAllGlobals());

  it('PATCHes times plus only the provided fields', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page({ id: 'ev1' }));
    vi.stubGlobal('fetch', fetchMock);
    const start = Date.parse('2026-08-20T13:00:00Z');
    await patchGoogleEvent('tok', 'cal id', 'ev1', {
      startMs: start,
      endMs: start + 3_600_000,
      allDay: false,
      title: 'New title',
      transparency: 'transparent',
    });
    const [url, init] = fetchMock.mock.calls[0]! as [URL | string, RequestInit];
    expect(String(url)).toBe(
      'https://www.googleapis.com/calendar/v3/calendars/cal%20id/events/ev1',
    );
    expect(init.method).toBe('PATCH');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.summary).toBe('New title');
    expect(body.transparency).toBe('transparent');
    expect((body.start as { dateTime?: string }).dateTime).toBeDefined();
    expect(body).not.toHaveProperty('location');
    expect(body).not.toHaveProperty('description');
  });

  it('throws a readable error on failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(page({}, 403)));
    await expect(
      patchGoogleEvent('tok', 'cal', 'ev1', { startMs: 0, endMs: 1, allDay: false }),
    ).rejects.toThrow(/403/);
  });
});
