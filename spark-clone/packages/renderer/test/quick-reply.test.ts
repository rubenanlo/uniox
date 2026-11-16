import { describe, expect, it } from 'vitest';
import type { MessageMeta, QuickReplyItem } from '@app/shared';
import {
  htmlNeedsRender,
  looksLikeMarkup,
  listTab,
  startTab,
  cardAttachments,
  parseAddressList,
  parseReplyIdeas,
  prefixedSubject,
  queuePosition,
  replyRecipients,
  shortAgo,
  stepItem,
  textToHtml,
  visibleText,
} from '../src/lib/quickReply';

const msg = (over: Partial<MessageMeta> = {}): MessageMeta => ({
  id: 'm1',
  threadId: 't1',
  accountId: 'a1',
  folderId: 'f',
  uid: 1,
  subject: 'Q1 roadmap review',
  from: { name: 'Maya Okafor', email: 'maya@northwind.com' },
  to: [{ email: 'me@uniox.app' }, { name: 'Laura', email: 'laura@northwind.com' }],
  cc: [{ email: 'antonio@northwind.com' }],
  date: 0,
  snippet: '',
  seen: false,
  flagged: false,
  answered: false,
  draft: false,
  hasAttachments: false,
  ...over,
});

describe('visibleText', () => {
  it('drops the quoted history and signature', () => {
    const text = 'Sounds good, Tuesday works.\n\n-- \nMaya\nNorthwind\n\nOn Mon, 3 Nov 2026, Ruben <r@x.com> wrote:\n> Can we meet?';
    expect(visibleText(text)).toBe('Sounds good, Tuesday works.');
  });

  it('stops at an "On … wrote:" line and skips > lines', () => {
    expect(visibleText('Yes!\n> old\nOn Tue, Ruben wrote:\n> older')).toBe('Yes!');
  });

  it('cuts an Outlook header block only after a blank line', () => {
    expect(visibleText('From: the team\nHello\n\nFrom: Ruben\nSent: Monday')).toBe('From: the team\nHello');
  });

  it('falls back to the whole text when only a quote is left', () => {
    expect(visibleText('> just a quote')).toBe('> just a quote');
  });
});

describe('textToHtml', () => {
  it('makes paragraphs and line breaks, escaping HTML', () => {
    expect(textToHtml('Hi <Maya>,\nTuesday works.\n\nBest')).toBe('<p>Hi &lt;Maya&gt;,<br>Tuesday works.</p><p>Best</p>');
  });
});

describe('prefixedSubject', () => {
  it('replaces existing prefixes', () => {
    expect(prefixedSubject('Re', 'RE: Fwd: Plan')).toBe('Re: Plan');
    expect(prefixedSubject('Fwd', 'Plan')).toBe('Fwd: Plan');
    expect(prefixedSubject('Re', '')).toBe('Re: (no subject)');
  });
});

describe('replyRecipients', () => {
  const own = new Set(['me@uniox.app']);
  it('replies to the sender only', () => {
    expect(replyRecipients(msg(), own, false)).toEqual({ to: [{ name: 'Maya Okafor', email: 'maya@northwind.com' }], cc: [] });
  });
  it('reply-all keeps everyone but me, Cc stays Cc', () => {
    const r = replyRecipients(msg(), own, true);
    expect(r.to.map((a) => a.email)).toEqual(['maya@northwind.com', 'laura@northwind.com']);
    expect(r.cc.map((a) => a.email)).toEqual(['antonio@northwind.com']);
  });
  it('answering my own last message goes to its recipients', () => {
    const mine = msg({ from: { email: 'me@uniox.app' }, to: [{ email: 'maya@northwind.com' }], cc: [] });
    expect(replyRecipients(mine, own, false).to.map((a) => a.email)).toEqual(['maya@northwind.com']);
  });
});

describe('parseAddressList', () => {
  it('reads names, bare addresses and drops junk', () => {
    expect(parseAddressList('Antonio Ruiz <antonio@x.com>; laura@x.com, nope')).toEqual([
      { name: 'Antonio Ruiz', email: 'antonio@x.com' },
      { email: 'laura@x.com' },
    ]);
  });
});

describe('parseReplyIdeas', () => {
  it('reads fenced JSON', () => {
    const raw = '```json\n{"summary":"Maya wants 45 min.","suggestions":["Accept Tuesday","Propose times","Ask for agenda","Extra"],"forwardTo":{"name":"Antonio","email":"antonio@x.com"}}\n```';
    expect(parseReplyIdeas(raw)).toEqual({
      summary: 'Maya wants 45 min.',
      suggestions: ['Accept Tuesday', 'Propose times', 'Ask for agenda'],
      forwardTo: { name: 'Antonio', email: 'antonio@x.com' },
      meetingMinutes: null,
    });
  });
  it('rounds the meeting length to 15 minutes', () => {
    expect(parseReplyIdeas('{"summary":"x","meetingMinutes":40}').meetingMinutes).toBe(45);
    expect(parseReplyIdeas('{"summary":"x","meetingMinutes":null}').meetingMinutes).toBeNull();
  });
  it('ignores a bad forward address and uses prose as the summary without JSON', () => {
    expect(parseReplyIdeas('{"summary":"x","suggestions":[],"forwardTo":{"email":"nope"}}').forwardTo).toBeNull();
    expect(parseReplyIdeas('Just prose.').summary).toBe('Just prose.');
  });
});

describe('cardAttachments', () => {
  it('hides images embedded in the body', () => {
    const base = { messageId: 'm', contentType: 'image/png', size: 1, localPath: null };
    const atts = [
      { ...base, id: '1', filename: 'logo.png', cid: '<logo@x>' },
      { ...base, id: '2', filename: 'deck.pdf', cid: null },
    ];
    expect(cardAttachments(atts, '<img src="cid:logo@x">').map((a) => a.id)).toEqual(['2']);
  });
});

describe('queue stepping', () => {
  const item = (id: string, over: Partial<QuickReplyItem> = {}): QuickReplyItem => ({ id, at: 0, title: id, body: '', threadId: id, ...over });
  const items = [item('a'), item('ev', { category: 'event', threadId: undefined }), item('b'), item('c')];
  it('skips meeting alerts and stops at the ends', () => {
    expect(stepItem(items, 'a', 1)).toBe('b');
    expect(stepItem(items, 'b', -1)).toBe('a');
    expect(stepItem(items, 'a', -1)).toBeNull();
    expect(stepItem(items, 'c', 1)).toBeNull();
    expect(queuePosition(items, 'b')).toEqual({ index: 1, total: 3 });
  });
});

describe('shortAgo', () => {
  it('formats minutes and hours', () => {
    expect(shortAgo(0, 30_000)).toBe('now');
    expect(shortAgo(0, 5 * 60_000)).toBe('5m');
    expect(shortAgo(0, 3 * 3_600_000)).toBe('3h');
  });
});

describe('list tabs', () => {
  const base = { title: 'A', body: 'S', at: 0 };
  it('files each notification in one tab', () => {
    expect(listTab({ ...base, id: '1', category: 'event' })).toBe('calendar');
    expect(listTab({ ...base, id: '2', priority: true, hasAttachments: true })).toBe('important');
    expect(listTab({ ...base, id: '3', hasAttachments: true, mailCategory: 'personal' })).toBe('docs');
    expect(listTab({ ...base, id: '4', mailCategory: 'personal' })).toBe('important');
    expect(listTab({ ...base, id: '5', mailCategory: 'newsletters' })).toBe('other');
  });
  it('opens on the tab of the start item, else the first non-empty one', () => {
    const items = [
      { ...base, id: 'n', mailCategory: 'newsletters' as const },
      { ...base, id: 'e', category: 'event' as const },
    ];
    expect(startTab(items, 'n')).toBe('other');
    expect(startTab(items, null)).toBe('calendar');
  });
});

describe('rendering hard emails', () => {
  it('spots HTML or CSS source posing as text', () => {
    expect(looksLikeMarkup('<html><body><div>Hi</div></body></html>')).toBe(true);
    expect(looksLikeMarkup('.a { color: red; } .b { margin: 0; } Hello')).toBe(true);
    expect(looksLikeMarkup('Hi Ruben, 3 < 5 and that is fine.\n\nBest')).toBe(false);
  });
  it('renders layout and image-led mail, keeps plain mail as text', () => {
    expect(htmlNeedsRender('<table><tr><td><table><tr><td><table></table></td></tr></table></td></tr></table>')).toBe(true);
    expect(htmlNeedsRender('<img src="a"><img src="b"><p>Sale!</p>')).toBe(true);
    expect(htmlNeedsRender(`<div>${'Thanks for the deck, looks great. '.repeat(5)}</div><img src="sig.png">`)).toBe(false);
    expect(htmlNeedsRender('<p>Hi Ruben,</p><p>See you Tuesday.</p>')).toBe(false);
  });
});
