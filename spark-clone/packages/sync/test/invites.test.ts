import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildItip, itipSubject, parseIcs, wallTimeToUtc, type Account } from '@app/shared';
import { composeItip, describeInvite, findGoogleEvent, respondOnGoogle } from '../src/invites';
import type { GEventItem } from '../src/google-calendar';

const GOOGLE_INVITE = [
  'BEGIN:VCALENDAR',
  'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
  'VERSION:2.0',
  'CALSCALE:GREGORIAN',
  'METHOD:REQUEST',
  'BEGIN:VTIMEZONE',
  'TZID:Europe/Paris',
  'BEGIN:STANDARD',
  'TZOFFSETFROM:+0200',
  'TZOFFSETTO:+0100',
  'END:STANDARD',
  'END:VTIMEZONE',
  'BEGIN:VEVENT',
  'DTSTART;TZID=Europe/Paris:20261124T100000',
  'DTEND;TZID=Europe/Paris:20261124T110000',
  'DTSTAMP:20261120T154500Z',
  'ORGANIZER;CN=Gillian Mortimer:mailto:gillian@example.org',
  'UID:abc123@google.com',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=',
  ' TRUE;CN=ruben@example.org;X-NUM-GUESTS=0:mailto:ruben@example.org',
  'ATTENDEE;CUTYPE=INDIVIDUAL;ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;CN="Mortimer, ',
  ' Gillian";X-NUM-GUESTS=0:mailto:gillian@example.org',
  'ATTENDEE;CUTYPE=INDIVIDUAL;PARTSTAT=TENTATIVE;CN=Abi:mailto:abi@example.org',
  'ATTENDEE;CUTYPE=RESOURCE;PARTSTAT=ACCEPTED;CN=Room 2:mailto:room2@resource.calendar.google.com',
  'SEQUENCE:2',
  'STATUS:CONFIRMED',
  'SUMMARY:JIC domain\\, next steps',
  'LOCATION:Paris office',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'DESCRIPTION:This is an event reminder',
  'TRIGGER:-P0DT0H30M0S',
  'END:VALARM',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const account: Account = {
  id: 'acct1',
  email: 'ruben@example.org',
  displayName: 'Ruben Andino',
  imap: { host: 'imap', port: 993, secure: true },
  smtp: { host: 'smtp', port: 465, secure: true },
  authType: 'oauth-google',
} as Account;

describe('parseIcs', () => {
  it('reads the event, people and zone from a Google invite', () => {
    const inv = parseIcs(GOOGLE_INVITE)!;
    expect(inv.method).toBe('REQUEST');
    expect(inv.uid).toBe('abc123@google.com');
    expect(inv.sequence).toBe(2);
    expect(inv.summary).toBe('JIC domain, next steps');
    expect(inv.location).toBe('Paris office');
    expect(inv.startMs).toBe(Date.parse('2026-11-24T09:00:00Z'));
    expect(inv.endMs).toBe(Date.parse('2026-11-24T10:00:00Z'));
    expect(inv.organizer).toEqual({ email: 'gillian@example.org', name: 'Gillian Mortimer' });
    expect(inv.attendees.map((a) => [a.email, a.partstat, a.resource])).toEqual([
      ['ruben@example.org', 'NEEDS-ACTION', false],
      ['gillian@example.org', 'ACCEPTED', false],
      ['abi@example.org', 'TENTATIVE', false],
      ['room2@resource.calendar.google.com', 'ACCEPTED', true],
    ]);
    // Quoted CN with a comma survives.
    expect(inv.attendees[1]!.name).toBe('Mortimer, Gillian');
    // VALARM's DESCRIPTION is not the event's.
    expect(inv.description).toBeUndefined();
  });

  it('maps Outlook zone names and handles UTC and all-day values', () => {
    const outlook = parseIcs(
      [
        'BEGIN:VCALENDAR',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        'UID:o1',
        'DTSTART;TZID=Eastern Standard Time:20260715T090000',
        'DTEND;TZID=Eastern Standard Time:20260715T093000',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\n'),
    )!;
    expect(outlook.startMs).toBe(Date.parse('2026-07-15T13:00:00Z')); // EDT
    const utc = parseIcs('BEGIN:VEVENT\nUID:u\nDTSTART:20261201T080000Z\nDURATION:PT45M\nEND:VEVENT')!;
    expect(utc.endMs - utc.startMs).toBe(45 * 60_000);
    const day = parseIcs('BEGIN:VEVENT\nUID:d\nDTSTART;VALUE=DATE:20261201\nEND:VEVENT')!;
    expect(day.allDay).toBe(true);
    expect(day.endMs - day.startMs).toBe(86_400_000);
  });

  it('returns null without a usable VEVENT', () => {
    expect(parseIcs('BEGIN:VCALENDAR\nEND:VCALENDAR')).toBeNull();
    expect(parseIcs('BEGIN:VEVENT\nSUMMARY:x\nEND:VEVENT')).toBeNull();
  });

  it('converts wall time across DST', () => {
    expect(wallTimeToUtc(2026, 3, 29, 3, 30, 0, 'Europe/Paris')).toBe(Date.parse('2026-03-29T01:30:00Z'));
  });
});

describe('buildItip', () => {
  const inv = parseIcs(GOOGLE_INVITE)!;
  it('writes a REPLY that echoes the event and carries only your answer', () => {
    const ics = buildItip({
      invite: inv,
      attendee: { email: 'ruben@example.org', name: 'Ruben Andino' },
      partstat: 'ACCEPTED',
      nowMs: Date.parse('2026-11-20T16:00:00Z'),
    });
    expect(ics).toContain('METHOD:REPLY');
    expect(ics).toContain('UID:abc123@google.com');
    expect(ics).toContain('SEQUENCE:2');
    expect(ics).toContain('DTSTART:20261124T090000Z');
    expect(ics).toContain('ATTENDEE;PARTSTAT=ACCEPTED;CN="Ruben Andino":mailto:ruben@example.org');
    expect(ics).toContain('SUMMARY:JIC domain\\, next steps');
    expect(ics.match(/ATTENDEE/g)).toHaveLength(1);
    // Round-trips through the parser.
    expect(parseIcs(ics)!.attendees[0]!.partstat).toBe('ACCEPTED');
  });

  it('writes a COUNTER with the proposed time', () => {
    const start = Date.parse('2026-11-25T14:00:00Z');
    const ics = buildItip({
      invite: inv,
      attendee: { email: 'ruben@example.org' },
      partstat: 'TENTATIVE',
      counter: { startMs: start, endMs: start + 3_600_000 },
      comment: 'Could we do Wednesday?',
    });
    expect(ics).toContain('METHOD:COUNTER');
    expect(ics).toContain('DTSTART:20261125T140000Z');
    expect(ics).toContain('COMMENT:Could we do Wednesday?');
    expect(itipSubject({ partstat: 'TENTATIVE', counter: { startMs: 0, endMs: 1 } }, 'X')).toBe(
      'New time proposed: X',
    );
  });
});

describe('describeInvite', () => {
  const inv = parseIcs(GOOGLE_INVITE)!;
  it('uses the Google event for status and times when it is on the calendar', () => {
    const google: GEventItem = {
      id: 'ev1',
      summary: 'JIC domain, next steps',
      start: { dateTime: '2026-11-24T11:00:00+01:00' },
      end: { dateTime: '2026-11-24T12:00:00+01:00' },
      attendees: [{ email: 'ruben@example.org', self: true, responseStatus: 'tentative' }],
    };
    const info = describeInvite('m1', account, inv, google, Date.parse('2026-11-20T00:00:00Z'))!;
    expect(info.via).toBe('google');
    expect(info.myStatus).toBe('tentative');
    expect(info.startMs).toBe(Date.parse('2026-11-24T10:00:00Z')); // rescheduled upstream
    expect(info.attendees.map((a) => a.email)).toEqual(['abi@example.org']); // not me, organizer, room
    expect(info.past).toBe(false);
  });

  it('falls back to the emailed invite and skips replies', () => {
    const info = describeInvite('m1', account, inv, null)!;
    expect(info.via).toBe('email');
    expect(info.myStatus).toBe('needs-action');
    expect(describeInvite('m1', account, { ...inv, method: 'REPLY' }, null)).toBeNull();
    expect(describeInvite('m1', account, { ...inv, method: 'CANCEL' }, null)!.kind).toBe('cancel');
  });
});

describe('Google RSVP', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('finds the event by iCalUID and patches only your status, notifying guests', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: URL | string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (!init?.method) {
          return new Response(
            JSON.stringify({
              items: [
                {
                  id: 'ev1',
                  attendees: [
                    { email: 'gillian@example.org', responseStatus: 'accepted', organizer: true },
                    { email: 'ruben@example.org', self: true, responseStatus: 'needsAction' },
                  ],
                },
              ],
            }),
          );
        }
        return new Response('{}');
      }),
    );
    const inv = parseIcs(GOOGLE_INVITE)!;
    const ev = await findGoogleEvent('tok', inv);
    expect(calls[0]!.url).toContain('iCalUID=abc123%40google.com');
    await respondOnGoogle('tok', ev!, account, 'declined', 'Traveling that day');
    const patch = calls[1]!;
    expect(patch.url).toContain('/calendars/primary/events/ev1?sendUpdates=all');
    expect(patch.init?.method).toBe('PATCH');
    const body = JSON.parse(String(patch.init?.body));
    expect(body).toEqual({
      attendees: [
        { email: 'gillian@example.org', responseStatus: 'accepted', organizer: true },
        { email: 'ruben@example.org', self: true, responseStatus: 'declined', comment: 'Traveling that day' },
      ],
    });
  });
});

describe('composeItip', () => {
  it('builds a calendar message to the organizer, not a written reply', async () => {
    const { raw, to } = await composeItip(account, parseIcs(GOOGLE_INVITE)!, 'accepted');
    const text = raw.toString('utf8');
    expect(to).toBe('gillian@example.org');
    expect(text).toMatch(/Subject: Accepted: JIC domain, next steps/);
    expect(text).toMatch(/Content-Type: text\/calendar; charset=utf-8; method=REPLY/);
  });
});
