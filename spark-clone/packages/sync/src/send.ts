import { createHash } from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer';
import nodemailer from 'nodemailer';
import type { MailDb } from '@app/db';
import type { Account, Address, OutgoingDraft } from '@app/shared';

const DATA_IMG =
  /(<img\b[^>]*?\bsrc\s*=\s*)(["'])data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)\2/gi;

export interface InlineImage {
  cid: string;
  contentType: string;
  filename: string;
  content: Buffer;
}

/**
 * Pasted signature images are stored as data: URLs, which Gmail and Outlook
 * refuse to display. Send them the way mail clients do instead: as inline
 * attachments referenced by cid:, identical images sharing one part.
 */
export function inlineDataImages(html: string): { html: string; images: InlineImage[] } {
  const byHash = new Map<string, InlineImage>();
  const out = html.replace(
    DATA_IMG,
    (_m, head: string, quote: string, type: string, b64: string) => {
      const content = Buffer.from(b64.replace(/\s+/g, ''), 'base64');
      const hash = createHash('sha1').update(content).digest('hex').slice(0, 16);
      let img = byHash.get(hash);
      if (!img) {
        const ext = type.split('/')[1]!.replace('svg+xml', 'svg').replace('jpeg', 'jpg');
        img = {
          cid: `sig-${hash}@uniox`,
          contentType: type,
          filename: `image-${byHash.size + 1}.${ext}`,
          content,
        };
        byHash.set(hash, img);
      }
      return `${head}${quote}cid:${img.cid}${quote}`;
    },
  );
  return { html: out, images: [...byHash.values()] };
}

const fmt = (a: Address) => (a.name ? `"${a.name.replace(/"/g, '')}" <${a.email}>` : a.email);

const REPLY_PREFIX = /^\s*((re|aw|sv|antw)\s*:\s*)+/i;

/**
 * In-Reply-To / References for an edited draft: the stored draft's own
 * headers, or (for drafts saved before those were kept) the newest real
 * message of the account whose subject the "Re:" draft answers.
 */
export function draftThreading(
  db: MailDb,
  draftMessageId: string,
  accountId: string,
  subject: string,
): { inReplyTo: string; references: string } | null {
  const row = db.raw
    .prepare(`SELECT in_reply_to, refs_json FROM messages WHERE id = ?`)
    .get(draftMessageId) as { in_reply_to: string | null; refs_json: string } | undefined;
  if (row?.in_reply_to) {
    const refs: string[] = JSON.parse(row.refs_json || '[]');
    return {
      inReplyTo: row.in_reply_to,
      references: (refs.length ? refs : [row.in_reply_to]).join(' '),
    };
  }
  if (!REPLY_PREFIX.test(subject)) return null;
  const base = subject.replace(REPLY_PREFIX, '').trim();
  if (!base) return null;
  const candidates = db.raw
    .prepare(
      `SELECT m.message_id_hdr, m.refs_json, m.subject FROM messages m
         JOIN folders f ON f.id = m.folder_id
        WHERE m.account_id = ? AND m.draft = 0 AND coalesce(m.message_id_hdr, '') != ''
          AND f.role NOT IN ('trash', 'spam') AND instr(m.subject, ?) > 0
        ORDER BY m.date DESC LIMIT 20`,
    )
    .all(accountId, base) as { message_id_hdr: string; refs_json: string; subject: string }[];
  const hit = candidates.find((c) => c.subject.replace(REPLY_PREFIX, '').trim() === base);
  if (!hit) return null;
  const prior: string[] = JSON.parse(hit.refs_json || '[]');
  return { inReplyTo: hit.message_id_hdr, references: [...prior, hit.message_id_hdr].join(' ') };
}

export async function composeRaw(
  db: MailDb,
  account: Account,
  draft: OutgoingDraft,
): Promise<Buffer> {
  let inReplyTo: string | undefined;
  let references: string | undefined;
  if (draft.inReplyToMessageId) {
    const orig = db.getMessage(draft.inReplyToMessageId);
    const hdr = orig
      ? (db.raw
          .prepare(`SELECT message_id_hdr, refs_json FROM messages WHERE id = ?`)
          .get(orig.id) as { message_id_hdr: string | null; refs_json: string } | undefined)
      : undefined;
    if (hdr?.message_id_hdr) {
      inReplyTo = hdr.message_id_hdr;
      const prior: string[] = JSON.parse(hdr.refs_json || '[]');
      references = [...prior, hdr.message_id_hdr].join(' ');
    }
  } else if (draft.deleteDraftMessageId) {
    // An edited draft has no reply target of its own: carry over the stored
    // draft's threading headers, or every re-save (and the final send) would
    // split off into a conversation of its own.
    const kept = draftThreading(db, draft.deleteDraftMessageId, draft.accountId, draft.subject);
    inReplyTo = kept?.inReplyTo;
    references = kept?.references;
  }

  const inline = inlineDataImages(draft.html);
  const composer = new MailComposer({
    from: fmt({ name: account.displayName || undefined, email: account.email }),
    to: draft.to.map(fmt).join(', '),
    cc: draft.cc.length ? draft.cc.map(fmt).join(', ') : undefined,
    bcc: draft.bcc.length ? draft.bcc.map(fmt).join(', ') : undefined,
    subject: draft.subject,
    text: draft.text,
    html: inline.html,
    inReplyTo,
    references,
    headers: draft.autoReply ? { 'Auto-Submitted': 'auto-replied' } : undefined,
    attachments: [
      ...draft.attachments.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        content: Buffer.from(a.dataBase64, 'base64'),
      })),
      ...inline.images.map((i) => ({
        filename: i.filename,
        contentType: i.contentType,
        content: i.content,
        cid: i.cid,
        contentDisposition: 'inline' as const,
      })),
    ],
  });
  return new Promise((resolve, reject) => {
    composer.compile().build((err, message) => (err ? reject(err) : resolve(message)));
  });
}

export async function smtpSend(
  account: Account,
  password: string,
  draft: Pick<OutgoingDraft, 'to' | 'cc' | 'bcc'>,
  raw: Buffer,
): Promise<void> {
  const { smtp } = account;
  const envelope = {
    from: account.email,
    to: [...draft.to, ...draft.cc, ...draft.bcc].map((a) => a.email),
  };
  const base = {
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    tls: smtp.allowInsecureTls ? { rejectUnauthorized: false } : undefined,
  };
  const auth =
    account.authType === 'oauth-google'
      ? ({ type: 'OAuth2', user: account.email, accessToken: password } as const)
      : { user: account.email, pass: password };
  try {
    const transport = nodemailer.createTransport({ ...base, auth });
    await transport.sendMail({ envelope, raw });
  } catch (err) {
    // Dev servers (Mailpit) may not advertise AUTH; retry unauthenticated.
    const msg = err instanceof Error ? err.message : String(err);
    if (/auth/i.test(msg)) {
      const transport = nodemailer.createTransport(base);
      await transport.sendMail({ envelope, raw });
      return;
    }
    throw err;
  }
}
