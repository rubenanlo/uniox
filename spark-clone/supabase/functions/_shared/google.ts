import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2';
import { env } from './db.ts';

/**
 * Google OAuth + Gmail/Calendar REST helpers. Same scopes as the desktop app
 * (packages/main/src/google-auth.ts) so one consent covers mail, calendar and
 * Gmail's vacation responder.
 */
export const GOOGLE_SCOPES =
  'https://mail.google.com/ https://www.googleapis.com/auth/gmail.settings.basic https://www.googleapis.com/auth/calendar openid email profile';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function redirectUri(): string {
  return `${env('SUPABASE_URL')}/functions/v1/google-connect`;
}

export function authUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'),
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: GOOGLE_SCOPES,
    state,
    access_type: 'offline',
    prompt: 'select_account consent',
    include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export interface TokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  id_token?: string;
}

export async function exchangeCode(code: string): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      redirect_uri: redirectUri(),
      grant_type: 'authorization_code',
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

export function idTokenClaims(idToken: string): { email?: string; name?: string } {
  const part = idToken.split('.')[1] ?? '';
  // UTF-8 aware, so names such as "Rubén" survive.
  return JSON.parse(decodeB64Url(part));
}

/** A fresh access token for an account, refreshing and persisting as needed. */
export async function accessToken(db: SupabaseClient, accountId: string): Promise<string> {
  const { data, error } = await db
    .from('account_tokens')
    .select('refresh_token, access_token, expires_at')
    .eq('account_id', accountId)
    .single();
  if (error || !data) throw new Error('No Google token for this account');
  if (data.access_token && data.expires_at && new Date(data.expires_at).getTime() > Date.now() + 60_000) {
    return data.access_token;
  }
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: data.refresh_token,
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      grant_type: 'refresh_token',
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed: ${res.status}`);
  const t: TokenSet = await res.json();
  await db
    .from('account_tokens')
    .update({ access_token: t.access_token, expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString() })
    .eq('account_id', accountId);
  return t.access_token;
}

export class GoogleError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function gfetch<T>(token: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) throw new GoogleError(res.status, `${init.method ?? 'GET'} ${url.split('?')[0]}: ${res.status} ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return await res.json();
}

export const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const CAL = 'https://www.googleapis.com/calendar/v3';

/* ---------- Gmail message parsing ---------- */

export interface Addr {
  name?: string;
  email: string;
}

interface GmailPart {
  partId?: string;
  mimeType: string;
  filename?: string;
  headers?: { name: string; value: string }[];
  body?: { size: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet: string;
  internalDate: string;
  payload: GmailPart;
}

export function decodeB64Url(data: string): string {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function utf8ToB64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function encodeB64Url(text: string): string {
  return utf8ToB64(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Parses an RFC 5322 address list ("A <a@x>, b@y") into addresses. */
export function parseAddrs(value: string | undefined): Addr[] {
  if (!value) return [];
  const out: Addr[] = [];
  // Split on commas outside quotes and angle brackets.
  let depth = 0;
  let quoted = false;
  let cur = '';
  for (const ch of value) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === '<') depth++;
    else if (!quoted && ch === '>') depth--;
    if (ch === ',' && !quoted && depth === 0) {
      out.push(...one(cur));
      cur = '';
    } else cur += ch;
  }
  out.push(...one(cur));
  return out;

  function one(raw: string): Addr[] {
    const s = raw.trim();
    if (!s) return [];
    const m = s.match(/^(.*)<([^>]+)>\s*$/);
    if (m) {
      const name = (m[1] ?? '').trim().replace(/^"|"$/g, '').trim();
      return [{ email: (m[2] ?? '').trim().toLowerCase(), ...(name ? { name } : {}) }];
    }
    return s.includes('@') ? [{ email: s.toLowerCase() }] : [];
  }
}

export interface ParsedMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  date: number;
  snippet: string;
  subject: string;
  from: Addr | null;
  to: Addr[];
  cc: Addr[];
  rfcMessageId: string | null;
  references: string | null;
  headers: Map<string, string>;
  html: string | null;
  text: string | null;
  calendar: string | null;
  attachments: { id: string; filename: string; contentType: string; size: number }[];
}

export function parseMessage(m: GmailMessage): ParsedMessage {
  const headers = new Map<string, string>();
  for (const h of m.payload.headers ?? []) headers.set(h.name.toLowerCase(), h.value);
  let html: string | null = null;
  let text: string | null = null;
  let calendar: string | null = null;
  const attachments: ParsedMessage['attachments'] = [];

  const walk = (p: GmailPart) => {
    if (p.filename && p.body?.attachmentId) {
      attachments.push({ id: p.body.attachmentId, filename: p.filename, contentType: p.mimeType, size: p.body.size });
    } else if (p.body?.data) {
      if (p.mimeType === 'text/html' && html === null) html = decodeB64Url(p.body.data);
      else if (p.mimeType === 'text/plain' && text === null) text = decodeB64Url(p.body.data);
      else if (p.mimeType === 'text/calendar' && calendar === null) calendar = decodeB64Url(p.body.data);
    }
    p.parts?.forEach(walk);
  };
  walk(m.payload);

  return {
    id: m.id,
    threadId: m.threadId,
    labelIds: m.labelIds ?? [],
    date: Number(m.internalDate),
    snippet: decodeEntities(m.snippet ?? ''),
    subject: headers.get('subject') ?? '',
    from: parseAddrs(headers.get('from'))[0] ?? null,
    to: parseAddrs(headers.get('to')),
    cc: parseAddrs(headers.get('cc')),
    rfcMessageId: headers.get('message-id') ?? null,
    references: headers.get('references') ?? null,
    headers,
    html: html ? stripActiveContent(html) : null,
    text,
    calendar,
    attachments,
  };
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** First-pass sanitizing; the phone runs DOMPurify again before rendering. */
export function stripActiveContent(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
}

/* ---------- Minimal iCalendar (VEVENT) extraction for invites ---------- */

export interface IcsInvite {
  uid: string | null;
  title: string;
  startMs: number;
  endMs: number;
  organizer: Addr | null;
  attendees: Addr[];
  method: string | null;
}

export function parseIcs(ics: string): IcsInvite | null {
  // Unfold continuation lines (RFC 5545 §3.1).
  const lines = ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  let inEvent = false;
  const out: IcsInvite = { uid: null, title: '', startMs: 0, endMs: 0, organizer: null, attendees: [], method: null };
  for (const line of lines) {
    if (line.startsWith('METHOD:')) out.method = line.slice(7).trim();
    if (line === 'BEGIN:VEVENT') inEvent = true;
    else if (line === 'END:VEVENT') break;
    if (!inEvent) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const [nameAndParams, value] = [line.slice(0, idx), line.slice(idx + 1)];
    const [name, ...params] = nameAndParams.split(';');
    const param = (k: string) => params.find((p) => p.toUpperCase().startsWith(`${k}=`))?.split('=')[1]?.replace(/^"|"$/g, '');
    switch (name) {
      case 'UID':
        out.uid = value;
        break;
      case 'SUMMARY':
        out.title = value.replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\n/gi, ' ');
        break;
      case 'DTSTART':
        out.startMs = icsDate(value, param('TZID'));
        break;
      case 'DTEND':
        out.endMs = icsDate(value, param('TZID'));
        break;
      case 'ORGANIZER':
        out.organizer = { email: value.replace(/^mailto:/i, '').toLowerCase(), ...(param('CN') ? { name: param('CN') } : {}) };
        break;
      case 'ATTENDEE':
        out.attendees.push({ email: value.replace(/^mailto:/i, '').toLowerCase(), ...(param('CN') ? { name: param('CN') } : {}) });
        break;
    }
  }
  return out.startMs ? out : null;
}

/** Converts an iCalendar date; TZID times are resolved with Intl. */
export function icsDate(v: string, tzid?: string): number {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return 0;
  const [, y, mo, d, h = '0', mi = '0', s = '0', z] = m;
  const utc = Date.UTC(+y!, +mo! - 1, +d!, +h, +mi, +s);
  if (z || !tzid) return utc;
  // Offset of tzid at that wall time.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tzid,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  try {
    const parts = Object.fromEntries(fmt.formatToParts(new Date(utc)).map((p) => [p.type, p.value]));
    const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return utc - (asUtc - utc);
  } catch {
    return utc;
  }
}

/* ---------- Outgoing mail (RFC 5322) ---------- */

function encodeWord(s: string): string {
  // deno-lint-ignore no-control-regex
  return /^[\x00-\x7f]*$/.test(s) ? s : `=?UTF-8?B?${utf8ToB64(s)}?=`;
}

export function formatAddr(a: Addr): string {
  return a.name ? `${encodeWord(a.name.includes(',') ? `"${a.name}"` : a.name)} <${a.email}>` : a.email;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function buildMime(opts: {
  from: Addr;
  to: Addr[];
  cc: Addr[];
  subject: string;
  body: string;
  inReplyTo?: string | null;
  references?: string | null;
}): string {
  const boundary = `uniox-${crypto.randomUUID()}`;
  const head = [
    `From: ${formatAddr(opts.from)}`,
    `To: ${opts.to.map(formatAddr).join(', ')}`,
    ...(opts.cc.length ? [`Cc: ${opts.cc.map(formatAddr).join(', ')}`] : []),
    `Subject: ${encodeWord(opts.subject)}`,
    'MIME-Version: 1.0',
    ...(opts.inReplyTo ? [`In-Reply-To: ${opts.inReplyTo}`, `References: ${[opts.references, opts.inReplyTo].filter(Boolean).join(' ')}`] : []),
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
  ];
  const html = `<div dir="auto">${escapeHtml(opts.body).replace(/\n/g, '<br>')}</div>`;
  const b64 = (s: string) => utf8ToB64(s).replace(/.{76}/g, '$&\r\n');
  return [
    ...head,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(opts.body),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    b64(html),
    `--${boundary}--`,
    '',
  ].join('\r\n');
}
