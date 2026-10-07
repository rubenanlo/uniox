import MailComposer from 'nodemailer/lib/mail-composer';
import nodemailer from 'nodemailer';
import type { MailDb } from '@app/db';
import type { Account, Address, OutgoingDraft } from '@app/shared';

const fmt = (a: Address) => (a.name ? `"${a.name.replace(/"/g, '')}" <${a.email}>` : a.email);

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
  }

  const composer = new MailComposer({
    from: fmt({ name: account.displayName || undefined, email: account.email }),
    to: draft.to.map(fmt).join(', '),
    cc: draft.cc.length ? draft.cc.map(fmt).join(', ') : undefined,
    bcc: draft.bcc.length ? draft.bcc.map(fmt).join(', ') : undefined,
    subject: draft.subject,
    text: draft.text,
    html: draft.html,
    inReplyTo,
    references,
    attachments: draft.attachments.map((a) => ({
      filename: a.filename,
      contentType: a.contentType,
      content: Buffer.from(a.dataBase64, 'base64'),
    })),
  });
  return new Promise((resolve, reject) => {
    composer.compile().build((err, message) => (err ? reject(err) : resolve(message)));
  });
}

export async function smtpSend(
  account: Account,
  password: string,
  draft: OutgoingDraft,
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
