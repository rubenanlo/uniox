import type { ThreadAction, UnioxApi } from './api';
import {
  type Address,
  DEFAULT_SETTINGS,
  type MobileAccount,
  type MobileEvent,
  type MobileMessage,
  type MobileThread,
  type SharedSettings,
} from './types';

/** Sample data for demos, tests and running without a backend. */

const H = 3_600_000;
const D = 24 * H;

function todayAt(h: number, m = 0, dayOffset = 0): number {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime() + dayOffset * D;
}

const ACCOUNTS: MobileAccount[] = [
  {
    id: 'a1',
    email: 'ruben@unsdsn.org',
    displayName: 'SDSN',
    color: '#2f63e7',
    status: 'ok',
    lastSyncAt: Date.now(),
  },
  {
    id: 'a2',
    email: 'ruben.personal@gmail.com',
    displayName: 'Personal',
    color: '#2db682',
    status: 'ok',
    lastSyncAt: Date.now(),
  },
];

const p = (name: string, email: string) => ({ name, email });
const ME = p('Ruben Andino', 'ruben@unsdsn.org');
const HELEN = p('Helen Mariani', 'helen@unsdsn.org');
const ISABELA = p('Isabela Carrozza', 'isabela@jic.org');
const GILL = p('Gillian Mortimer', 'gillian@jic.org');
const GUILLAUME = p('Guillaume Lafortune', 'guillaume@unsdsn.org');
const JEFFREY = p('Jeffrey Sachs', 'jeffrey@unsdsn.org');
const ALYSON = p('Alyson Marks', 'alyson@unsdsn.org');
const SHANNON = p('Shannon Leigh', 'shannon@unsdsn.org');
const ANA = p('Ana Torres', 'ana@unsdsn.org');

function t(
  partial: Partial<MobileThread> & Pick<MobileThread, 'id' | 'subject' | 'lastFrom'>,
): MobileThread {
  return {
    accountId: 'a1',
    snippet: '',
    participants: partial.lastFrom ? [partial.lastFrom] : [],
    lastMessageAt: Date.now(),
    messageCount: 1,
    unreadCount: 0,
    hasAttachments: false,
    pinned: false,
    priority: false,
    category: 'personal',
    inInbox: true,
    snoozeUntil: null,
    ...partial,
  };
}

let threads: MobileThread[] = [
  t({
    id: 't1',
    subject: 'JIC | Domain',
    lastFrom: ISABELA,
    snippet: 'Hi Gill and Abigail, just to let you know that PR04782 is now approved…',
    lastMessageAt: Date.now() - 20 * 60_000,
    messageCount: 3,
    unreadCount: 1,
    priority: true,
    hasAttachments: true,
  }),
  t({
    id: 't2',
    subject: 'SDG Index 2027 · data freeze timeline',
    lastFrom: HELEN,
    snippet: 'Hi Ruben, sharing the revised freeze dates for the SDG Index 2027…',
    lastMessageAt: todayAt(9, 14, -9),
    messageCount: 4,
    unreadCount: 1,
    priority: true,
    pinned: true,
    hasAttachments: true,
  }),
  t({
    id: 't3',
    subject: 'Donation page copy, final round',
    lastFrom: SHANNON,
    snippet: 'Attached the last tweaks from comms. The hero line now reads…',
    lastMessageAt: todayAt(11, 2, -9),
    unreadCount: 1,
    priority: true,
  }),
  t({
    id: 't4',
    subject: 'SDG Index 2026: final country profiles',
    lastFrom: JEFFREY,
    snippet: 'Attached are the final profiles for sign-off before Monday.',
    lastMessageAt: todayAt(9, 41),
    unreadCount: 1,
    priority: true,
  }),
  t({
    id: 't5',
    subject: "Fwd: We're halfway there! Will you help us meet our Giving Tuesday goal?",
    lastFrom: ALYSON,
    snippet: 'Forwarding in case you want to share it with the network.',
    lastMessageAt: todayAt(8, 12),
    accountId: 'a2',
    priority: true,
  }),
  t({
    id: 't6',
    subject: 'Invitation: SDG Transformation Center review',
    lastFrom: GUILLAUME,
    snippet: 'Thursday 26 Nov, 14:00 to 15:00 (CET). Join with Google Meet…',
    lastMessageAt: todayAt(16, 0, -1),
    category: 'invites',
  }),
  t({
    id: 't7',
    subject: 'Q4 web analytics summary',
    lastFrom: ANA,
    snippet: 'Sessions are up 18% since the redesign. The SDG dashboard…',
    lastMessageAt: todayAt(10, 30, -10),
    messageCount: 2,
  }),
  t({
    id: 't8',
    subject: 'TLDR AI: the week in agents',
    lastFrom: p('TLDR AI', 'dan@tldr.tech'),
    snippet: 'Agents that book your travel, a new open model…',
    lastMessageAt: todayAt(7, 0),
    category: 'newsletters',
    unreadCount: 1,
  }),
  t({
    id: 't9',
    subject: 'Frontend Weekly #412',
    lastFrom: p('Frontend Weekly', 'news@frontend.dev'),
    snippet: 'CSS anchor positioning lands everywhere…',
    lastMessageAt: todayAt(6, 30),
    category: 'newsletters',
    unreadCount: 1,
  }),
  t({
    id: 't10',
    subject: 'Your order has shipped',
    lastFrom: p('Saeco Store', 'noreply@saeco.com'),
    snippet: 'Your descaler is on its way.',
    lastMessageAt: todayAt(12, 0, -1),
    category: 'notifications',
    unreadCount: 1,
  }),
];

const messages: Record<string, MobileMessage[]> = {
  t1: [
    msg(
      'm1',
      't1',
      GILL,
      'I checked and your PR is not yet approved. Maybe you could reach out to Stephanie and see if there is anything else that she needs.',
      todayAt(10, 20),
    ),
    msg('m2', 't1', ME, "Thanks, Gill! I'll reach out to Stephanie.", todayAt(10, 29), true),
    msg(
      'm3',
      't1',
      ISABELA,
      'Hi Gill and Abigail,\n\nJust to let you know that PR04782 is now approved. Kindly let us know the next steps, and Ruben, could you share two times on Monday or Tuesday for a quick call to hand over the DNS details?\n\nAll the best,\nIsabela',
      Date.now() - 20 * 60_000,
      false,
      true,
    ),
  ],
  t2: [
    msg(
      'm4',
      't2',
      HELEN,
      'Hi Ruben,\n\nSharing the revised freeze dates for the SDG Index 2027. We are pushing the data freeze to Thursday, December 4 so the regional teams have one more week on the new indicators.\n\nCould you confirm the country list by Tuesday? Kenya and Ghana are still pending their statistical office sign-off.\n\nBest,\nHelen',
      todayAt(9, 14, -9),
      false,
      true,
    ),
  ],
  t6: [
    {
      ...msg(
        'm5',
        't6',
        GUILLAUME,
        'SDG Transformation Center review\nThursday 26 Nov 2026 · 14:00 – 15:00 (Central European Time)\nJoin with Google Meet: meet.google.com/stc-rvw-019',
        todayAt(16, 0, -1),
      ),
      invite: {
        eventId: 'e7',
        title: 'SDG Transformation Center review',
        startMs: todayAt(14, 0, 5),
        endMs: todayAt(15, 0, 5),
        meetingUrl: 'https://meet.google.com/stc-rvw-019',
        organizer: GUILLAUME,
        guests: [GUILLAUME, HELEN, ANA, p('Maria Lopez', 'maria@unsdsn.org')],
        myAnswer: null,
      },
    },
  ],
};

function msg(
  id: string,
  threadId: string,
  from: Address,
  text: string,
  date: number,
  fromMe = false,
  unread = false,
): MobileMessage {
  return {
    id,
    threadId,
    accountId: 'a1',
    from,
    to: [fromMe ? ISABELA : ME],
    cc: [],
    date,
    snippet: text.slice(0, 120),
    html: null,
    text,
    fromMe,
    unread,
    attachments: [],
  };
}

function ev(
  id: string,
  title: string,
  start: number,
  end: number,
  color: string,
  extra: Partial<MobileEvent> = {},
): MobileEvent {
  return {
    id,
    accountId: 'a1',
    calendarName: 'ruben@unsdsn.org',
    title,
    startMs: start,
    endMs: end,
    allDay: false,
    color,
    attendees: [],
    myAnswer: 'accepted',
    free: false,
    ...extra,
  };
}

const created: MobileEvent[] = [];

function eventsAround(): MobileEvent[] {
  const out: MobileEvent[] = [...created];
  for (let d = -3; d <= 10; d++) {
    const day = new Date(Date.now() + d * D).getDay();
    if (day === 0 || day === 6) continue;
    out.push(
      ev(`sync${d}`, 'SDSN leadership sync', todayAt(9, 0, d), todayAt(10, 0, d), '#2f63e7', {
        meetingUrl: 'https://meet.google.com/abc-defg-hij',
        attendees: [JEFFREY, HELEN, GUILLAUME, ALYSON],
        organizer: JEFFREY,
        description: 'Weekly sync. Agenda: SDG Index freeze, retreat logistics, Q1 hiring.',
      }),
    );
    if (d % 2 === 0)
      out.push(
        ev(`lunch${d}`, 'Lunch with Guillaume', todayAt(12, 0, d), todayAt(13, 30, d), '#8a5cd6', {
          location: 'Café Bern',
        }),
      );
    if (d % 3 === 0)
      out.push(
        ev(`focus${d}`, 'Focus time', todayAt(16, 0, d), todayAt(17, 0, d), '#a3a3ab', {
          free: true,
        }),
      );
  }
  out.push(
    ev('e7', 'SDG Transformation Center review', todayAt(14, 0, 5), todayAt(15, 0, 5), '#2f63e7', {
      meetingUrl: 'https://meet.google.com/stc-rvw-019',
      myAnswer: null,
      organizer: GUILLAUME,
    }),
  );
  out.push(ev('freeze', 'Data freeze', todayAt(14, 30, 2), todayAt(15, 30, 2), '#c7402d'));
  return out;
}

let settings: SharedSettings = { ...DEFAULT_SETTINGS };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const delay = <T>(v: T, ms = 120) => new Promise<T>((r) => setTimeout(() => r(v), ms));

export const mockApi: UnioxApi = {
  kind: 'mock',
  session: () => delay({ email: ME.email }),
  signIn: () => delay(undefined),
  signOut: () => delay(undefined),
  connectAccount: () => delay(undefined),
  accounts: () => delay(ACCOUNTS),
  syncNow: () => delay(undefined, 500),
  threads: ({ accountId, limit = 100 }) =>
    delay(
      threads
        .filter((x) => x.inInbox && (!accountId || x.accountId === accountId))
        .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
        .slice(0, limit),
    ),
  async thread(id) {
    const thread = threads.find((x) => x.id === id);
    if (!thread) throw new Error('Thread not found');
    const list = messages[id] ?? [
      msg(`${id}-m`, id, thread.lastFrom ?? ME, thread.snippet, thread.lastMessageAt),
    ];
    return delay({ thread, messages: list });
  },
  async act(threadId: string, action: ThreadAction) {
    threads = threads.map((x) => {
      if (x.id !== threadId) return x;
      switch (action.kind) {
        case 'archive':
        case 'trash':
          return { ...x, inInbox: false };
        case 'inbox':
          return { ...x, inInbox: true, snoozeUntil: null };
        case 'read':
          return { ...x, unreadCount: action.read ? 0 : 1 };
        case 'pin':
          return { ...x, pinned: action.pinned };
        case 'snooze':
          return { ...x, inInbox: false, snoozeUntil: action.until };
      }
    });
    emit();
  },
  send: () => delay(undefined, 300),
  events: (from, to) => delay(eventsAround().filter((e) => e.endMs > from && e.startMs < to)),
  rsvp: () => delay(undefined),
  async createEvent(input) {
    created.push(
      ev(
        `new${created.length}`,
        input.title,
        input.startMs,
        input.endMs,
        '#2f63e7',
        input.addMeet ? { meetingUrl: 'https://meet.google.com/new-meet-now' } : {},
      ),
    );
    emit();
  },
  async search(q) {
    const needle = q.toLowerCase();
    const hit = (s: string) => s.toLowerCase().includes(needle);
    return delay({
      answer: needle.includes('freeze')
        ? 'The SDG Index 2027 data freeze is now Thursday, Dec 4 (moved by Helen on Nov 12).'
        : null,
      threads: threads.filter(
        (x) => hit(x.subject) || hit(x.snippet) || hit(x.lastFrom?.name ?? ''),
      ),
      events: eventsAround()
        .filter((e) => hit(e.title))
        .filter((e, i, all) => all.findIndex((o) => o.title === e.title) === i),
    });
  },
  firstRead: (threadId) =>
    delay(
      threadId === 't1'
        ? {
            summary:
              'Isabela says the domain PR is approved and asks for two times early next week for a quick DNS handover call.',
            replyIdeas: ['Share Monday times', 'Confirm next steps', 'Loop in Abigail'],
            freeSlots: [
              { startMs: todayAt(10, 0, 2), endMs: todayAt(10, 30, 2) },
              { startMs: todayAt(11, 30, 2), endMs: todayAt(12, 0, 2) },
              { startMs: todayAt(15, 0, 3), endMs: todayAt(15, 30, 3) },
            ],
          }
        : {
            summary:
              'Helen moved the freeze to Dec 4 and needs your OK on the revised country list by Tuesday.',
            replyIdeas: ['Confirm Dec 4', 'Ask about Kenya'],
          },
      400,
    ),
  rewrite: (body, instruction) => delay(`${body}\n\n(${instruction})`, 400),
  assistant: () =>
    delay(
      'Three things are waiting on you: confirm the country list for Helen (due Tuesday), send Isabela two times for the DNS call, and give Jeffrey a final call on the retreat agenda before Monday 9:00.',
      600,
    ),
  settings: () => delay(settings),
  async saveSettings(patch) {
    settings = { ...settings, ...patch };
    emit();
  },
  registerPush: () => delay(undefined),
  onChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
