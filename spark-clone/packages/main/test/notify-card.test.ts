import { describe, expect, it } from 'vitest';
import { buildCard, EVENT_START_TTL_MS, hueFor, initials, MAIL_TTL_MS } from '../src/notify/build-card';

const ctx = { dark: false, accounts: [{ id: 'a1', label: 'me@work.com', color: '#2f9e6b' }] };
const now = new Date('2026-11-12T13:20:00').getTime();

describe('notification cards', () => {
  it('derives initials from names and addresses', () => {
    expect(initials('Ana García')).toBe('AG');
    expect(initials('José María de la Peña')).toBe('JP');
    expect(initials('billing@stripe.com')).toBe('BC');
    expect(initials('Ünal')).toBe('Ü');
    expect(initials('  ')).toBe('?');
  });

  it('keeps a sender on one hue', () => {
    expect(hueFor('ana@x.com')).toBe(hueFor('ANA@x.com'));
    expect(hueFor('ana@x.com')).toBeGreaterThanOrEqual(0);
    expect(hueFor('ana@x.com')).toBeLessThan(360);
  });

  it('builds a mail card with the account colour and every action it can perform', () => {
    const card = buildCard(
      'n1',
      {
        title: 'Ana García',
        body: 'Q4 budget review',
        snippet: '  Hi Ruben  ',
        threadId: 't1',
        accountId: 'a1',
        messageId: 'm1',
        fromEmail: 'ana@x.com',
      },
      ctx,
      now,
    );
    expect(card).toMatchObject({
      kind: 'mail',
      key: 'mail:t1',
      line: 'Q4 budget review',
      snippet: 'Hi Ruben',
      source: 'me@work.com',
      sourceColor: '#2f9e6b',
      initials: 'AG',
      ttl: MAIL_TTL_MS,
    });
    expect(card.actions).toEqual(['reply', 'archive', 'read', 'later']);
  });

  it('offers only what a reminder can do (no message to mark read)', () => {
    const card = buildCard('n2', { title: 'Reminder', body: 'Invoice', threadId: 't2', accountId: 'a1' }, ctx, now);
    expect(card.actions).toEqual(['reply', 'archive', 'later']);
    expect(card.snippet).toBeUndefined();
  });

  it('falls back when the account is unknown', () => {
    const card = buildCard('n3', { title: 'Uniox', body: 'Preview' }, null, now);
    expect(card.source).toBe('Mail');
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
    expect(lead).toMatchObject({ kind: 'event', when: 'in 10 min', ttl: 0, day: '12', month: 'NOV' });
    expect(lead.actions).toEqual(['join', 'snooze']);
    expect(lead.line).toMatch(/Video call$/);

    const start = buildCard('e2', base, ctx, base.startMs);
    expect(start.key).toBe(lead.key);
    expect(start).toMatchObject({ when: 'now', ttl: EVENT_START_TTL_MS });

    const room = buildCard('e3', { ...base, meetingUrl: undefined, location: 'Room 4' }, ctx, now);
    expect(room.actions).toEqual(['snooze']);
    expect(room.line).toMatch(/Room 4$/);
  });
});
