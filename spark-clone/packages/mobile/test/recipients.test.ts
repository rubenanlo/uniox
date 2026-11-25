import { describe, expect, it } from 'vitest';
import type { MobileMessage } from '../src/data/types';
import { myEmails, nameList, recipientChange, replyAllCc, threadCast } from '../src/lib/recipients';

const a = (name: string) => ({ name, email: `${name.toLowerCase()}@x.org` });
const msg = (p: Partial<MobileMessage>): MobileMessage => ({
  id: Math.random().toString(36),
  threadId: 't',
  accountId: 'acc',
  from: null,
  to: [],
  cc: [],
  date: 0,
  snippet: '',
  html: null,
  text: null,
  fromMe: false,
  unread: false,
  attachments: [],
  ...p,
});

const me = { name: 'Ruben', email: 'ruben@x.org' };
const m1 = msg({ from: a('Lorena'), to: [a('Isabela')], cc: [me, a('Marta')] });
const m2 = msg({ from: a('Isabela'), to: [a('Lorena')], cc: [me, a('Marta')] });
const m3 = msg({ from: a('Lorena'), to: [a('Isabela')], cc: [me, a('Tomas')] });

describe('recipients', () => {
  const mine = myEmails([m1, m2, m3], 'Ruben@x.org');

  it('lists the cast with roles on the newest message, the user last', () => {
    const cast = threadCast([m1, m2, m3], mine);
    expect(cast.map((c) => c.addr.name)).toEqual(['Lorena', 'Isabela', 'Marta', 'Tomas', 'Ruben']);
    expect(cast.map((c) => c.role)).toEqual(['from', 'to', null, 'cc', 'cc']);
    expect(cast[4]?.me).toBe(true);
  });

  it('notes who a reply added and removed', () => {
    expect(recipientChange(m1, m2, mine)).toBeNull();
    const c = recipientChange(m2, m3, mine);
    expect(c?.added).toEqual([{ addr: a('Tomas'), me: false, role: 'cc' }]);
    expect(c?.removed.map((r) => r.addr.name)).toEqual(['Marta']);
  });

  it('reply all takes everyone else on the last message as Cc', () => {
    expect(replyAllCc(m3, [a('Lorena')], mine).map((x) => x.name)).toEqual(['Isabela', 'Tomas']);
  });

  it('joins names', () => {
    expect(nameList(['A'])).toBe('A');
    expect(nameList(['A', 'B', 'C'])).toBe('A, B and C');
    expect(nameList(['A', 'B', 'C', 'D'])).toBe('A, B and 2 others');
  });
});
