import type { Address, AttachmentMeta, MessageMeta, NotifyPayload, QuickReplyItem, QuickReplyView, ThreadSummary } from '@app/shared';

/**
 * Pure helpers for the quick-reply widget: turning email bodies into chat
 * bubbles, the typed reply back into an email, and reading the assistant's
 * JSON. Kept DOM-free so they're unit-tested.
 */

/** Lines that start the quoted history a reply carries below the new text. */
const QUOTE_HEADER = [
  /^On .{4,200}wrote:\s*$/i, // Gmail / Apple Mail: "On Tue, 4 Nov 2026, Maya <…> wrote:"
  /^El .{4,200}escribió:\s*$/i,
  /^Le .{4,200}a écrit\s*:\s*$/i,
  /^Am .{4,200}schrieb .{0,80}:\s*$/i,
  /^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}\s*$/i,
  /^_{8,}\s*$/, // Outlook's rule above "From: …"
  /^From:\s.+$/i, // Outlook header block, when it follows a blank line
];

/**
 * The new part of an email for a chat bubble: drops the quoted thread below
 * it (">" lines and the "On … wrote:" header onwards) and the signature after
 * the standard "-- " delimiter. Falls back to the whole text when nothing new
 * is left (a message that is only a quote).
 */
export function visibleText(text: string): string {
  text = cleanPlainText(text);
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const t = line.trim();
    if (t === '--' || line === '-- ') break;
    if (QUOTE_HEADER.some((re) => re.test(t))) {
      // "From:" alone only counts when it opens a header block after a gap.
      if (/^From:/i.test(t) && (i === 0 || lines[i - 1]!.trim() !== '')) {
        out.push(line);
        continue;
      }
      break;
    }
    if (t.startsWith('>')) continue;
    out.push(line);
  }
  const trimmed = out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return trimmed || text.trim();
}

/**
 * Undo what mail apps do when they flatten HTML into the text/plain part:
 * Gmail writes bold as *bold* and every link as "text <url>" (wrapped over
 * lines when long), and an image link becomes "* <url>*". Drop the link
 * targets and emphasis stars so the chat shows the words people see.
 */
export function cleanPlainText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, '\n')
      // A line that is only a link target (a logo or address link): drop the line.
      .replace(/^[ \t]*<(?:https?:\/\/|mailto:)[^<>\s]*(?:\n[^<>\s]+)*>[ \t]*(?:\n|$)/gim, '')
      // "label <https://…>" / "<mailto:…>", possibly wrapped across lines.
      .replace(/[ \t]*<(?:https?:\/\/|mailto:)[^<>\s]*(?:\n[^<>\s]+)*>/gi, '')
      // "name@x.org <other@x.org>": a link target after visible text.
      .replace(/(\S)[ \t]*<[^<>\s@]+@[^<>\s]+>/g, '$1')
      // *emphasis* (Gmail's bold), including nested **…*.
      .replace(/(^|[\s([|,;:])\*+(?=[^\s*])/gm, '$1')
      .replace(/([^\s*])\*+(?=$|[\s)\].,;:!?|])/gm, '$1')
      // Lines left with nothing but stars or bullets (an image link).
      .split('\n')
      .filter((line) => !/^[ \t]*[*•][ \t*]*$/.test(line))
      .join('\n')
  );
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Typed plain text as email HTML: one paragraph per blank-line block, <br> inside. */
export function textToHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** The quoted original under a reply, as the composer writes it. */
export function quoteBlock(message: MessageMeta, body: { html: string | null; text: string | null }): string {
  const who = message.from?.name || message.from?.email || 'someone';
  const meta = `On ${new Date(message.date).toLocaleString()}, ${escapeHtml(who)} wrote:`;
  const inner = body.html ?? `<pre>${escapeHtml(body.text ?? '')}</pre>`;
  return `<p></p><p style="color:#777">${meta}</p><blockquote>${inner}</blockquote>`;
}

/** The forwarded-message header and body, Gmail style. */
export function forwardBlock(message: MessageMeta, body: { html: string | null; text: string | null }): string {
  const addr = (a: Address) => (a.name ? `${escapeHtml(a.name)} &lt;${escapeHtml(a.email)}&gt;` : escapeHtml(a.email));
  const rows = [
    message.from ? `From: ${addr(message.from)}` : '',
    `Date: ${escapeHtml(new Date(message.date).toLocaleString())}`,
    `Subject: ${escapeHtml(message.subject)}`,
    message.to.length ? `To: ${message.to.map(addr).join(', ')}` : '',
    message.cc.length ? `Cc: ${message.cc.map(addr).join(', ')}` : '',
  ].filter(Boolean);
  const inner = body.html ?? `<pre>${escapeHtml(body.text ?? '')}</pre>`;
  return `<p></p><p>---------- Forwarded message ---------<br>${rows.join('<br>')}</p>${inner}`;
}

export function prefixedSubject(kind: 'Re' | 'Fwd', subject: string): string {
  const bare = subject.replace(/^((re|fwd?|aw|wg):\s*)+/i, '');
  return `${kind}: ${bare || '(no subject)'}`;
}

/** Who a reply goes to: the sender, plus everyone else on it for reply-all (never yourself). */
export function replyRecipients(
  message: MessageMeta,
  ownEmails: Set<string>,
  all: boolean,
): { to: Address[]; cc: Address[] } {
  const seen = new Set<string>();
  const pick = (list: (Address | null)[]) =>
    list.filter((a): a is Address => {
      const key = a?.email.toLowerCase();
      if (!key || ownEmails.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  // Replying to your own message (the last one is yours): keep its recipients.
  const fromSelf = !!message.from && ownEmails.has(message.from.email.toLowerCase());
  const first = fromSelf ? message.to : [message.from];
  if (!all) return { to: pick(first), cc: [] };
  return { to: pick([...first, ...message.to]), cc: pick(message.cc) };
}

/** Comma/semicolon-separated addresses as typed ("Ana <a@b.com>, c@d.com"). */
export function parseAddressList(raw: string): Address[] {
  return raw
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): Address | null => {
      const m = part.match(/^(.*)<([^>]+)>$/);
      const email = (m ? m[2]! : part).trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
      const name = m?.[1]?.trim().replace(/^"|"$/g, '');
      return name ? { name, email } : { email };
    })
    .filter((a): a is Address => !!a);
}

/** The assistant's opening read of the email. */
export interface ReplyIdeas {
  summary: string;
  /** Short reply intents shown as chips ("Accept Tuesday", "Ask for the agenda"). */
  suggestions: string[];
  /** The email asks to pass something to this person: offer a forward. */
  forwardTo: Address | null;
  /** The email asks to find a time to meet: its length in minutes, else null. */
  meetingMinutes: number | null;
}

/** Read the assistant's JSON leniently (it may add prose or a code fence). */
export function parseReplyIdeas(raw: string): ReplyIdeas {
  const none: ReplyIdeas = { summary: '', suggestions: [], forwardTo: null, meetingMinutes: null };
  const json = raw.match(/\{[\s\S]*\}/)?.[0];
  if (!json) return { ...none, summary: raw.trim().slice(0, 600) };
  try {
    const v = JSON.parse(json) as Record<string, unknown>;
    const summary = typeof v.summary === 'string' ? v.summary.trim() : '';
    const suggestions = Array.isArray(v.suggestions)
      ? v.suggestions
          .filter((s): s is string => typeof s === 'string' && !!s.trim())
          .map((s) => s.trim().slice(0, 60))
          .slice(0, 3)
      : [];
    const fwd = v.forwardTo as Record<string, unknown> | null | undefined;
    const fwdEmail = typeof fwd?.email === 'string' ? fwd.email.trim() : '';
    const forwardTo = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fwdEmail)
      ? { email: fwdEmail, ...(typeof fwd?.name === 'string' && fwd.name.trim() ? { name: fwd.name.trim() } : {}) }
      : null;
    const minutes = Number(v.meetingMinutes);
    const meetingMinutes =
      v.meetingMinutes == null || !Number.isFinite(minutes)
        ? null
        : Math.min(240, Math.max(15, Math.round(minutes / 15) * 15));
    return { summary, suggestions, forwardTo, meetingMinutes };
  } catch {
    return none;
  }
}

/** Files shown as cards: real attachments, not images embedded in the body. */
export function cardAttachments(attachments: AttachmentMeta[], html: string | null): AttachmentMeta[] {
  return attachments.filter((a) => !(a.cid && html?.includes(`cid:${a.cid.replace(/^<|>$/g, '')}`)));
}

/**
 * Step through the queue: `dir` 1 = older, -1 = newer. Wraps neither way, so
 * the header arrows grey out at the ends.
 */
export function stepItem(items: QuickReplyItem[], currentId: string | null, dir: 1 | -1): string | null {
  const mail = items.filter((i) => i.category !== 'event' && i.threadId);
  const at = mail.findIndex((i) => i.id === currentId);
  const next = mail[at + dir];
  return at >= 0 && next ? next.id : null;
}

/** "3 of 5" over the emails in the queue (meeting alerts don't count). */
export function queuePosition(items: QuickReplyItem[], currentId: string | null): { index: number; total: number } {
  const mail = items.filter((i) => i.category !== 'event' && i.threadId);
  return { index: mail.findIndex((i) => i.id === currentId), total: mail.length };
}

/** Clamp a list cursor after the list changes. */
export function clampIndex(index: number, length: number): number {
  return length ? Math.min(Math.max(index, 0), length - 1) : 0;
}

/** "2m", "1h", "Tue" for list rows. */
export function shortAgo(at: number, now: number): string {
  const min = Math.max(0, Math.floor((now - at) / 60_000));
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  return new Date(at).toLocaleDateString(undefined, { weekday: 'short' });
}

/** The ⌥⌘N list's tabs, in the order they show. */
export type ListTab = 'important' | 'calendar' | 'docs' | 'other';
export const LIST_TABS: { id: ListTab; label: string }[] = [
  { id: 'important', label: 'Important' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'docs', label: 'Docs' },
  { id: 'other', label: 'Other' },
];

/**
 * Which tab a notification lives in (each in exactly one): meetings, then
 * priority senders, then mail with files, then other people's mail, and
 * everything automated last.
 */
export function listTab(item: QuickReplyItem): ListTab {
  if (item.category === 'event') return 'calendar';
  if (item.priority) return 'important';
  if (item.hasAttachments) return 'docs';
  if (item.mailCategory === 'personal' || item.mailCategory === 'invites' || item.reason) return 'important';
  return 'other';
}

/** The tab to open on: the one holding `startId`, else the first with anything in it. */
export function startTab(items: QuickReplyItem[], startId: string | null): ListTab {
  const start = items.find((i) => i.id === startId);
  if (start) return listTab(start);
  return LIST_TABS.find((t) => items.some((i) => listTab(i) === t.id))?.id ?? 'important';
}

/** An inbox thread as a ⌥⌘N row (it isn't a notification, so its id is the thread's). */
export function unreadItem(t: ThreadSummary & { prioritySender?: boolean }): QuickReplyItem {
  const from = t.lastInboundFrom ?? t.senders?.[0] ?? t.participants[0] ?? null;
  return {
    id: `u:${t.id}`,
    origin: 'unread',
    title: from?.name || from?.email || 'Unknown',
    body: t.subject,
    snippet: t.snippet,
    threadId: t.id,
    accountId: t.accountId,
    ...(from?.email ? { fromEmail: from.email } : {}),
    mailCategory: t.category,
    priority: !!t.prioritySender,
    hasAttachments: t.hasAttachments,
    unread: t.unreadCount > 0,
    at: t.lastInboundDate || t.lastMessageDate,
  };
}

/** A row as the payload main lists it by (an unread thread that isn't listed yet). */
export function itemPayload(item: QuickReplyItem): NotifyPayload {
  const payload: Partial<QuickReplyItem> = { ...item };
  delete payload.id;
  delete payload.at;
  delete payload.kept;
  delete payload.unread;
  return payload as NotifyPayload;
}

/** The ⌥⌘N list's sections, in the order they show. */
export type ListSection = 'kept' | 'new' | 'unread' | 'read';
export const LIST_SECTIONS: { id: ListSection; label: string }[] = [
  { id: 'kept', label: 'Kept' },
  { id: 'new', label: 'New notifications' },
  { id: 'unread', label: 'Still unread' },
  { id: 'read', label: 'Read, still in inbox' },
];

/** The ⌥⌘N header's names for the two views. */
export const VIEW_LABEL: Record<QuickReplyView, string> = { inbox: 'Inbox', unread: 'Unread' };

export interface ListRow {
  item: QuickReplyItem;
  section: ListSection;
}

/**
 * The rows of one tab for one account (undefined = all), section by section:
 * kept emails, then notifications, then unread mail that didn't notify (or
 * whose notification aged out), then (whole-inbox view only) read mail still
 * in the inbox. A thread shows once, in the first section that has it.
 * Meeting alerts have no account and show under every account.
 */
export function listRows(
  items: QuickReplyItem[],
  inbox: QuickReplyItem[],
  tab: ListTab,
  accountId?: string,
  view: QuickReplyView = 'inbox',
): ListRow[] {
  const inView = (i: QuickReplyItem) =>
    listTab(i) === tab && (!accountId || !i.accountId || i.accountId === accountId);
  const kept = items.filter((i) => i.kept && inView(i));
  const fresh = items.filter((i) => !i.kept && i.origin !== 'unread' && inView(i));
  const listed = new Set([...kept, ...fresh].map((i) => i.threadId).filter(Boolean));
  const rest = inbox.filter((i) => inView(i) && !listed.has(i.threadId));
  const read = view === 'inbox' ? rest.filter((i) => i.unread === false) : [];
  return [
    ...kept.map((item) => ({ item, section: 'kept' as const })),
    ...fresh.map((item) => ({ item, section: 'new' as const })),
    ...rest.filter((i) => i.unread !== false).map((item) => ({ item, section: 'unread' as const })),
    ...read.map((item) => ({ item, section: 'read' as const })),
  ];
}

/**
 * ⌘1 is All accounts and ⌘2… the accounts in order, as in the main window.
 * Returns the account id ('' = All) for the digit, or null when there's none.
 */
export function accountForDigit(digit: number, accountIds: string[]): string | null {
  if (digit === 1) return '';
  const id = accountIds[digit - 2];
  return id ?? null;
}

const TAG = /<\/?[a-z][a-z0-9-]*(\s[^<>]*)?\/?>/gi;
const CSS_RULE = /[.#@a-z][\w\s.#:,>*-]*\{[^{}]*:[^{}]*\}/gi;

/** Text that is really HTML or CSS source (a mislabelled text part, or a style block leaking through). */
export function looksLikeMarkup(text: string): boolean {
  return (text.match(TAG)?.length ?? 0) >= 3 || (text.match(CSS_RULE)?.length ?? 0) >= 2;
}

/**
 * An HTML email that won't read as a chat bubble: a designed layout
 * (newsletter tables, image-led mail) whose words alone lose the point.
 * Those are shown rendered, in a sandboxed frame, instead.
 */
export function htmlNeedsRender(html: string): boolean {
  const images = html.match(/<img\b/gi)?.length ?? 0;
  const tables = html.match(/<table\b/gi)?.length ?? 0;
  const words = html
    .replace(/<(style|script|head|title)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(TAG, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
  if (tables >= 3) return true;
  if (images >= 2 && words < 600) return true;
  return images >= 1 && words < 80;
}
