/**
 * Seed the local dev IMAP server (dev/docker-compose.yml) with a fixture corpus.
 *
 *   pnpm mail:up && pnpm seed
 *
 * Accounts: alice@dev.local / bob@dev.local, password "pass" (Dovecot passdb static).
 * Idempotent-ish: wipes and re-creates the seeded folders each run.
 */
import { ImapFlow } from 'imapflow';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HOST = '127.0.0.1';
const PORT = 1143;
const PASSWORD = 'pass';

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, '../packages/email-render/fixtures');

// 1x1 red PNG
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let midCounter = 0;
function mid(domain = 'dev.local'): string {
  midCounter += 1;
  return `<seed-${Date.now()}-${midCounter}@${domain}>`;
}

function daysAgo(n: number, hour = 9, min = 0): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, min, 0, 0);
  return d;
}

interface Msg {
  from: string;
  to: string;
  cc?: string;
  subject: string;
  date: Date;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  headers?: Record<string, string>;
  text?: string;
  html?: string;
  attachments?: { filename: string; contentType: string; base64: string; cid?: string }[];
  flags?: string[];
  folder?: string; // default INBOX
}

function buildMime(m: Msg): { raw: string; messageId: string } {
  const messageId = m.messageId ?? mid();
  const h: string[] = [];
  h.push(`From: ${m.from}`);
  h.push(`To: ${m.to}`);
  if (m.cc) h.push(`Cc: ${m.cc}`);
  h.push(`Subject: ${m.subject}`);
  h.push(`Date: ${m.date.toUTCString()}`);
  h.push(`Message-ID: ${messageId}`);
  if (m.inReplyTo) h.push(`In-Reply-To: ${m.inReplyTo}`);
  if (m.references?.length) h.push(`References: ${m.references.join(' ')}`);
  for (const [k, v] of Object.entries(m.headers ?? {})) h.push(`${k}: ${v}`);
  h.push('MIME-Version: 1.0');

  const text = m.text ?? 'Plain-text part.';
  const textPart = `Content-Type: text/plain; charset=utf-8\r\n\r\n${text}`;
  const htmlPart = m.html
    ? `Content-Type: text/html; charset=utf-8\r\n\r\n${m.html}`
    : undefined;

  let body: string;
  if (!htmlPart && !m.attachments?.length) {
    h.push('Content-Type: text/plain; charset=utf-8');
    body = text;
  } else {
    const altBoundary = `alt-${messageId.replace(/[<>@]/g, '')}`;
    let inner: string;
    if (htmlPart) {
      inner =
        `Content-Type: multipart/alternative; boundary="${altBoundary}"\r\n\r\n` +
        `--${altBoundary}\r\n${textPart}\r\n--${altBoundary}\r\n${htmlPart}\r\n--${altBoundary}--`;
    } else {
      inner = textPart;
    }
    if (m.attachments?.length) {
      const mixBoundary = `mix-${messageId.replace(/[<>@]/g, '')}`;
      h.push(`Content-Type: multipart/mixed; boundary="${mixBoundary}"`);
      const parts = m.attachments
        .map((a) => {
          const disp = a.cid ? 'inline' : 'attachment';
          const cidHeader = a.cid ? `Content-ID: <${a.cid}>\r\n` : '';
          return (
            `--${mixBoundary}\r\nContent-Type: ${a.contentType}; name="${a.filename}"\r\n` +
            `Content-Transfer-Encoding: base64\r\n${cidHeader}` +
            `Content-Disposition: ${disp}; filename="${a.filename}"\r\n\r\n${a.base64}`
          );
        })
        .join('\r\n');
      body = `--${mixBoundary}\r\n${inner}\r\n${parts}\r\n--${mixBoundary}--`;
    } else {
      const altBoundary2 = `alt-${messageId.replace(/[<>@]/g, '')}`;
      h.push(`Content-Type: multipart/alternative; boundary="${altBoundary2}"`);
      body = `--${altBoundary2}\r\n${textPart}\r\n--${altBoundary2}\r\n${htmlPart}\r\n--${altBoundary2}--`;
    }
  }
  return { raw: h.join('\r\n') + '\r\n\r\n' + body + '\r\n', messageId };
}

function corpusFor(user: string): Msg[] {
  const me = `${user}@dev.local`;
  const msgs: Msg[] = [];

  // --- A real conversation thread (3 messages, threaded via References)
  const t1 = mid();
  const t2 = mid();
  msgs.push(
    {
      from: 'Carol Rivera <carol@partner.example>',
      to: me,
      subject: 'Q3 planning session',
      date: daysAgo(6, 10, 12),
      messageId: t1,
      text: 'Hi — can we lock the Q3 planning session for Thursday? Agenda attached in the next mail.',
      html: '<p>Hi — can we lock the <b>Q3 planning session</b> for Thursday? Agenda to follow.</p>',
    },
    {
      from: `Me <${me}>`,
      to: 'Carol Rivera <carol@partner.example>',
      subject: 'Re: Q3 planning session',
      date: daysAgo(6, 14, 3),
      messageId: t2,
      inReplyTo: t1,
      references: [t1],
      text: 'Thursday works. Morning if possible.',
      folder: 'Sent',
      flags: ['\\Seen'],
    },
    {
      from: 'Carol Rivera <carol@partner.example>',
      to: me,
      subject: 'Re: Q3 planning session',
      date: daysAgo(5, 8, 41),
      inReplyTo: t2,
      references: [t1, t2],
      text: 'Great — 9:30 Thursday it is. Calendar invite coming.',
      html: '<p>Great — <b>9:30 Thursday</b> it is. Calendar invite coming.</p>',
    },
  );

  // --- Newsletters (List-Unsubscribe / List-Id)
  for (let i = 0; i < 3; i++) {
    msgs.push({
      from: 'Frontend Weekly <digest@frontendweekly.example>',
      to: me,
      subject: `Frontend Weekly #${118 + i}: Signals, again`,
      date: daysAgo(21 - i * 7, 6, 30),
      headers: {
        'List-Id': 'Frontend Weekly <digest.frontendweekly.example>',
        'List-Unsubscribe': '<https://frontendweekly.example/unsub>, <mailto:unsub@frontendweekly.example>',
        Precedence: 'bulk',
      },
      text: `Issue ${118 + i}. This week: signals, again.`,
      html: readFileSync(join(fixturesDir, 'tracking-and-css.html'), 'utf8'),
    });
  }

  // --- Promotions (bulk + marketing language / marketing sender)
  msgs.push(
    {
      from: 'Gear Store <promo@deals.example>',
      to: me,
      subject: 'Flash sale: 30% off everything this weekend',
      date: daysAgo(2, 7, 45),
      headers: {
        'List-Unsubscribe': '<https://deals.example/unsub>',
        Precedence: 'bulk',
      },
      text: 'This weekend only: 30% off storewide. Don’t miss it.',
      html: '<p><b>30% OFF</b> everything. This weekend only.</p>',
    },
    {
      from: 'Wanderlust Travel <offers@wanderlust.example>',
      to: me,
      subject: 'Last chance: $199 flights to Lisbon',
      date: daysAgo(4, 10, 15),
      headers: { 'List-Unsubscribe': '<https://wanderlust.example/unsub>' },
      text: 'Limited time offer — $199 return flights.',
    },
  );

  // --- Invite (text/calendar part)
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'UID:seed-invite-1@dev.local',
    'DTSTART:20260720T140000Z',
    'DTEND:20260720T150000Z',
    `SUMMARY:Q3 planning session`,
    `ORGANIZER:mailto:carol@partner.example`,
    `ATTENDEE:mailto:${me}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  msgs.push({
    from: 'Carol Rivera <carol@partner.example>',
    to: me,
    subject: 'Invitation: Q3 planning session @ Thu Jul 20, 2pm',
    date: daysAgo(1, 9, 5),
    text: 'Carol Rivera has invited you to Q3 planning session.',
    attachments: [
      {
        filename: 'invite.ics',
        contentType: 'text/calendar; method=REQUEST',
        base64: Buffer.from(ics).toString('base64'),
      },
    ],
  });

  // --- Notifications (no-reply, Auto-Submitted)
  msgs.push(
    {
      from: 'GitHub <noreply@github.example>',
      to: me,
      subject: '[repo] CI failed on main (run #4821)',
      date: daysAgo(1, 17, 55),
      headers: { 'Auto-Submitted': 'auto-generated', Precedence: 'bulk' },
      text: 'Build #4821 failed: sync-engine tests. View: https://ci.example/run/4821',
    },
    {
      from: 'Cloud Billing <no-reply@cloud.example>',
      to: me,
      subject: 'Your July invoice is available',
      date: daysAgo(2, 4, 2),
      headers: { 'Auto-Submitted': 'auto-generated' },
      text: 'Invoice INV-2026-07 for $12.40 is ready.',
    },
  );

  // --- Attachment + CID inline image
  msgs.push({
    from: 'Design Shop <orders@shop.example>',
    to: me,
    subject: 'Order shipped 🎉 (#84721)',
    date: daysAgo(3, 12, 20),
    html: readFileSync(join(fixturesDir, 'messy-real-world.html'), 'utf8'),
    text: 'Your order #84721 shipped.',
    attachments: [
      { filename: 'logo.png', contentType: 'image/png', base64: PNG_B64, cid: 'logo@shop.example' },
      {
        filename: 'invoice-84721.txt',
        contentType: 'text/plain',
        base64: Buffer.from('Invoice #84721\nTotal: $49.00\n').toString('base64'),
      },
    ],
  });

  // --- Hostile HTML corpus (renderer must neutralize these)
  for (const f of readdirSync(fixturesDir).filter((f) => f.endsWith('.html'))) {
    msgs.push({
      from: 'Suspicious Sender <attacker@evil.example>',
      to: me,
      subject: `[fixture] hostile: ${basename(f, '.html')}`,
      date: daysAgo(4, 23, 5),
      text: 'fallback text part',
      html: readFileSync(join(fixturesDir, f), 'utf8'),
    });
  }

  // --- Bulk filler for list virtualization / backfill windows
  const senders = [
    'Ana Torres <ana@corp.example>',
    'Dev Standup <standup@corp.example>',
    'Marketing <promo@deals.example>',
    'Pat Lee <pat@corp.example>',
  ];
  const count = user === 'alice' ? 140 : 25;
  for (let i = 0; i < count; i++) {
    const s = senders[i % senders.length]!;
    msgs.push({
      from: s,
      to: me,
      subject: `Update ${i + 1}: ${['status', 'notes', 'follow-up', 'FYI'][i % 4]}`,
      date: daysAgo(7 + Math.floor(i / 3), 8 + (i % 9), (i * 7) % 60),
      text: `Filler message ${i + 1} for ${user}. Lorem ipsum dolor sit amet, consectetur adipiscing elit.`,
      flags: i % 3 === 0 ? ['\\Seen'] : [],
    });
  }

  return msgs;
}

async function seedUser(user: string) {
  const client = new ImapFlow({
    host: HOST,
    port: PORT,
    secure: false,
    auth: { user: `${user}@dev.local`, pass: PASSWORD },
    tls: { rejectUnauthorized: false }, // dev server has a self-signed cert
    logger: false,
  });
  await client.connect();

  for (const folder of ['Sent', 'Drafts', 'Trash', 'Archive', 'Junk']) {
    try {
      await client.mailboxCreate(folder);
    } catch {
      /* exists */
    }
  }

  // Wipe INBOX + Sent so reseeding doesn't duplicate
  for (const folder of ['INBOX', 'Sent']) {
    const lock = await client.getMailboxLock(folder);
    try {
      await client.messageDelete({ all: true }, { uid: true });
    } catch {
      /* empty */
    } finally {
      lock.release();
    }
  }

  const msgs = corpusFor(user);
  for (const m of msgs) {
    const { raw } = buildMime(m);
    await client.append(m.folder ?? 'INBOX', raw, m.flags ?? [], m.date);
  }
  await client.logout();
  console.log(`seeded ${user}@dev.local with ${msgs.length} messages`);
}

async function main() {
  await seedUser('alice');
  await seedUser('bob');
  console.log('done. IMAP 127.0.0.1:1143 (pass: "pass"), SMTP 127.0.0.1:1025, Mailpit UI http://localhost:8025');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
