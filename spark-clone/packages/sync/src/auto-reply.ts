import type { MailDb } from '@app/db';
import { EMPTY_AUTO_REPLY, type AutoReply } from '@app/shared';

/**
 * Out-of-office replies. Gmail OAuth accounts use Gmail's vacation responder
 * (users.settings.vacation), so replies go out while Uniox is closed. Every
 * other account gets a local responder: new inbox mail that arrives while the
 * app syncs is answered over SMTP, following Gmail's and RFC 3834's manners —
 * one reply per sender per few days, never to lists, bulk or automated mail.
 */

const GMAIL_VACATION = 'https://gmail.googleapis.com/gmail/v1/users/me/settings/vacation';
const NETWORK_TIMEOUT_MS = 20_000;

/** Same cadence as Gmail: a sender who writes again within this gets no second reply. */
export const AUTO_REPLY_RESEND_MS = 4 * 86_400_000;

// ---- Gmail vacation responder --------------------------------------------------

interface GmailVacation {
  enableAutoReply?: boolean;
  responseSubject?: string;
  responseBodyPlainText?: string;
  responseBodyHtml?: string;
  restrictToContacts?: boolean;
  restrictToDomain?: boolean;
  startTime?: string;
  endTime?: string;
}

export class GmailSettingsError extends Error {
  constructor(
    message: string,
    readonly needsReconnect: boolean,
  ) {
    super(message);
  }
}

/** Gmail stores HTML when set from its web UI; show it as text here. */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function textToHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

export function vacationToAutoReply(v: GmailVacation): AutoReply {
  const ms = (t: string | undefined) => (t && Number(t) > 0 ? Number(t) : null);
  return {
    enabled: !!v.enableAutoReply,
    subject: v.responseSubject ?? '',
    message: v.responseBodyPlainText || htmlToText(v.responseBodyHtml ?? ''),
    startMs: ms(v.startTime),
    endMs: ms(v.endTime),
    contactsOnly: !!v.restrictToContacts,
  };
}

/**
 * HTML is sent alongside the text because Gmail prefers HTML when both are
 * set: a stale HTML body from its web UI would otherwise win over our edit.
 */
export function autoReplyToVacation(r: AutoReply): GmailVacation {
  const v: GmailVacation = {
    enableAutoReply: r.enabled,
    responseSubject: r.subject,
    responseBodyPlainText: r.message,
    responseBodyHtml: textToHtml(r.message),
    restrictToContacts: r.contactsOnly,
    restrictToDomain: false,
  };
  if (r.startMs != null) v.startTime = String(r.startMs);
  if (r.endMs != null) v.endTime = String(r.endMs);
  return v;
}

async function gmailVacationRequest(
  token: string,
  init?: { method: 'PUT'; body: GmailVacation },
): Promise<GmailVacation> {
  const res = await fetch(GMAIL_VACATION, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init ? { 'Content-Type': 'application/json' } : {}),
    },
    body: init ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
  if (res.ok) return (await res.json()) as GmailVacation;
  const text = await res.text().catch(() => '');
  if (res.status === 403 && /insufficient|SCOPE/i.test(text)) {
    throw new GmailSettingsError('Reconnect Google to let Uniox manage Gmail’s auto reply.', true);
  }
  if (res.status === 403 && /SERVICE_DISABLED|accessNotConfigured|has not been used/i.test(text)) {
    throw new GmailSettingsError(
      'The Gmail API is not enabled for this OAuth client’s Google Cloud project.',
      false,
    );
  }
  let detail = '';
  try {
    detail = (JSON.parse(text) as { error?: { message?: string } }).error?.message ?? '';
  } catch {
    /* not JSON */
  }
  throw new GmailSettingsError(detail || `Gmail answered HTTP ${res.status}`, false);
}

export async function getGmailAutoReply(token: string): Promise<AutoReply> {
  return vacationToAutoReply(await gmailVacationRequest(token));
}

export async function putGmailAutoReply(token: string, reply: AutoReply): Promise<AutoReply> {
  return vacationToAutoReply(
    await gmailVacationRequest(token, { method: 'PUT', body: autoReplyToVacation(reply) }),
  );
}

// ---- local responder -----------------------------------------------------------

/** The local setting, stamped with when it was saved. */
export interface StoredAutoReply extends AutoReply {
  savedAt: number;
}

const settingKey = (accountId: string) => `autoReply:${accountId}`;
const sentKey = (accountId: string) => `autoReplySent:${accountId}`;

export function getLocalAutoReply(db: MailDb, accountId: string): StoredAutoReply | null {
  const v = db.getSetting(settingKey(accountId)) as StoredAutoReply | null;
  return v && typeof v === 'object' ? { ...EMPTY_AUTO_REPLY, ...v } : null;
}

/** Saving starts a fresh period, like Gmail: everyone may get one reply again. */
export function saveLocalAutoReply(
  db: MailDb,
  accountId: string,
  reply: AutoReply,
  now = Date.now(),
) {
  db.setSetting(settingKey(accountId), { ...reply, savedAt: now });
  db.setSetting(sentKey(accountId), {});
}

const AUTOMATED_SENDER =
  /^(no-?reply|do-?not-?reply|donotreply|mailer-daemon|postmaster|bounces?|notifications?|alerts?)([+._-]|$)/i;

export interface AutoReplyCandidate {
  reply: StoredAutoReply;
  now: number;
  /** The message's Date header (epoch ms). */
  messageDate: number;
  fromAddress: string;
  accountEmail: string;
  headers: Map<string, string>;
  knownCorrespondent: boolean;
  lastRepliedAt: number | undefined;
}

/** Whether one incoming message earns an auto reply. Pure, for testing. */
export function shouldAutoReply(c: AutoReplyCandidate): boolean {
  const { reply, now } = c;
  if (!reply.enabled || (!reply.subject.trim() && !reply.message.trim())) return false;
  if (reply.startMs != null && now < reply.startMs) return false;
  if (reply.endMs != null && now >= reply.endMs) return false;
  // Only mail that arrived during the period and after it was switched on —
  // not old mail turning up in a resync or moved back into the inbox.
  const since = Math.max(reply.savedAt, reply.startMs ?? 0, now - AUTO_REPLY_RESEND_MS);
  if (c.messageDate < since) return false;

  const from = c.fromAddress.toLowerCase();
  if (!from.includes('@') || from === c.accountEmail.toLowerCase()) return false;
  if (AUTOMATED_SENDER.test(from.split('@')[0]!)) return false;
  // RFC 3834: never answer automated, bulk or list mail.
  const auto = c.headers.get('auto-submitted');
  if (auto && auto.trim().toLowerCase() !== 'no') return false;
  if (/\b(bulk|list|junk)\b/i.test(c.headers.get('precedence') ?? '')) return false;
  if (c.headers.has('list-id') || c.headers.has('list-unsubscribe')) return false;

  if (reply.contactsOnly && !c.knownCorrespondent) return false;
  if (c.lastRepliedAt != null && now - c.lastRepliedAt < AUTO_REPLY_RESEND_MS) return false;
  return true;
}

/**
 * Ingest hook step: queue the local auto reply for one new inbox message.
 * Gmail OAuth accounts are skipped; Gmail answers those itself.
 */
export function queueLocalAutoReply(
  db: MailDb,
  opts: {
    accountId: string;
    messageId: string;
    fromAddress: string;
    subject: string;
    headers: Map<string, string>;
  },
  now = Date.now(),
): boolean {
  const reply = getLocalAutoReply(db, opts.accountId);
  if (!reply?.enabled) return false;
  const account = db.getAccount(opts.accountId);
  if (!account || account.authType === 'oauth-google') return false;
  const msg = db.getMessage(opts.messageId);
  if (!msg) return false;
  const from = opts.fromAddress.toLowerCase();
  const sent = (db.getSetting(sentKey(opts.accountId)) as Record<string, number> | null) ?? {};
  if (
    !shouldAutoReply({
      reply,
      now,
      messageDate: msg.date,
      fromAddress: from,
      accountEmail: account.email,
      headers: opts.headers,
      knownCorrespondent: db.isKnownRecipient(opts.accountId, from),
      lastRepliedAt: sent[from],
    })
  ) {
    return false;
  }

  // Keep the log small: entries older than the resend window no longer matter.
  const log: Record<string, number> = { [from]: now };
  for (const [k, t] of Object.entries(sent)) {
    if (k !== from && now - t < AUTO_REPLY_RESEND_MS) log[k] = t;
  }
  db.setSetting(sentKey(opts.accountId), log);

  const original = opts.subject.trim();
  const subject =
    reply.subject.trim() || (/^re:/i.test(original) ? original : `Re: ${original}`.trim());
  db.enqueueTask({
    type: 'send-draft',
    draft: {
      accountId: opts.accountId,
      to: [{ email: from }],
      cc: [],
      bcc: [],
      subject,
      text: reply.message,
      html: textToHtml(reply.message),
      inReplyToMessageId: opts.messageId,
      attachments: [],
      autoReply: true,
    },
  });
  return true;
}
