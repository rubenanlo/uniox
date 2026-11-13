import { describe, expect, it } from 'vitest';
import { buildCard, EVENT_LEAD_MS, EVENT_START_TTL_MS, MAIL_TTL_MS } from '../src/notify/build-card';

const ctx = { dark: false, accounts: [{ id: 'a1', label: 'me@work.com', color: '#2f9e6b' }] };
const now = new Date('2026-11-12T13:20:00').getTime();
const mail = {
  title: 'Ana García',
  body: 'Q4 budget review',
  snippet: '  Hi Ruben  ',
  threadId: 't1',
  accountId: 'a1',
  messageId: 'm1',
  fromEmail: 'ana@x.com',
};

describe('notification cards', () => {
  it('builds a mail card with its account, category chip and actions', () => {
    const card = buildCard('n1', { ...mail, mailCategory: 'personal' }, ctx, now);
    expect(card).toMatchObject({
      kind: 'mail',
      key: 'mail:t1',
      title: 'Ana García',
      line: 'Q4 budget review',
      snippet: 'Hi Ruben',
      chip: 'People',
      tone: 'people',
      source: 'me@work.com',
      when: 'now',
      ttl: MAIL_TTL_MS,
    });
    expect(card.actions).toEqual(['open', 'reply', 'archive', 'later']);
  });

  it('marks priority senders amber, ahead of the category', () => {
    const card = buildCard('n2', { ...mail, mailCategory: 'newsletters', priority: true }, ctx, now);
    expect(card).toMatchObject({ chip: 'Priority', tone: 'priority' });
  });

  it('labels reminders and returning snoozes, and quiet categories', () => {
    expect(buildCard('n3', { ...mail, reason: 'reminder' }, ctx, now).chip).toBe('Reminder');
    expect(buildCard('n4', { ...mail, reason: 'snoozed' }, ctx, now).chip).toBe('Snoozed');
    expect(buildCard('n5', { ...mail, mailCategory: 'promotions' }, ctx, now)).toMatchObject({
      chip: 'Promotion',
      tone: 'quiet',
    });
    expect(buildCard('n6', mail, ctx, now).chip).toBe('Mail');
  });

  it('falls back when the account is unknown and offers nothing it cannot do', () => {
    const card = buildCard('n7', { title: 'Uniox', body: 'Preview' }, null, now);
    expect(card.source).toBe('');
    expect(card.snippet).toBeUndefined();
    expect(card.actions).toEqual([]);
  });

  it('keeps a meeting heads-up until it starts, then lets the start alert expire', () => {
    const base = {
      title: 'Design sync',
      body: '',
      category: 'event' as const,
      startMs: now + 10 * 60_000,
      endMs: now + 40 * 60_000,
      meetingUrl: 'https://meet.google.com/abc',
    };
    const lead = buildCard('e1', base, ctx, now);
    expect(lead).toMatchObject({
      kind: 'event',
      chip: 'Meeting',
      tone: 'meeting',
      startsAt: base.startMs,
      leadMs: EVENT_LEAD_MS,
      where: 'Video call',
      ttl: 0,
    });
    expect(lead.actions).toEqual(['snooze', 'join']);

    const start = buildCard('e2', base, ctx, base.startMs);
    expect(start.key).toBe(lead.key);
    expect(start.ttl).toBe(EVENT_START_TTL_MS);

    const room = buildCard('e3', { ...base, meetingUrl: undefined, location: 'Room 4' }, ctx, now);
    expect(room.actions).toEqual(['snooze']);
    expect(room.where).toBe('Room 4');
  });
});
