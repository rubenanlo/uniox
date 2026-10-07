/** Live check: Priority senders group + unread-first ordering in the inbox. */
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { ImapFlow } from 'imapflow';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const document: any;

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function appendMail(from: string, subject: string) {
  const client = new ImapFlow({
    host: '127.0.0.1', port: 1143, secure: false,
    auth: { user: 'alice@dev.local', pass: 'pass' },
    tls: { rejectUnauthorized: false }, logger: false,
  });
  await client.connect();
  await client.append(
    'INBOX',
    `From: Test <${from}>\r\nTo: alice@dev.local\r\nSubject: ${subject}\r\n` +
      `Date: ${new Date().toUTCString()}\r\nMessage-ID: <prio-${Math.random().toString(36).slice(2)}@x>\r\n` +
      `Content-Type: text/plain\r\n\r\nhello\r\n`,
    [],
  );
  await client.logout();
}

async function main() {
  const userData = mkdtempSync(join(tmpdir(), 'sparkclone-e2e-prio-'));
  const app: ElectronApplication = await electron.launch({
    cwd: '/Users/rubenandino/Developer/Projects/spark-clone',
    args: ['out/main/index.js'],
    env: { ...process.env, SPARKCLONE_USER_DATA: userData },
  });
  const page = await app.firstWindow();

  await page.getByText('Use local dev server').click();
  await page.getByLabel('Email address').fill('alice@dev.local');
  await page.getByLabel('Password').fill('pass');
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.waitForSelector('[data-thread-list]', { timeout: 30_000 });

  const marker = Date.now();
  await appendMail('vip@ext.example', `VIP hello ${marker}`);
  await appendMail('someone@ext.example', `Plain hello ${marker}`);
  await page.waitForSelector(`text=VIP hello ${marker}`, { timeout: 45_000 });
  await page.waitForSelector(`text=Plain hello ${marker}`, { timeout: 45_000 });
  console.log('▶ mail landed');

  // Add vip@ext.example as a priority sender via Settings
  await page.getByTitle('Settings').click();
  await page.getByRole('button', { name: 'Priority', exact: true }).click();
  await page.getByLabel('Priority email address').fill('vip@ext.example');
  await page.getByRole('button', { name: 'Add sender' }).click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // Read the rendered list order: headers and where the two test mails sit
  const order = await page.evaluate(() => {
    const rows = [
      ...document.querySelectorAll('[data-thread-list] > div > div'),
    ] as { textContent: string }[];
    return rows.map((r) => r.textContent ?? '');
  });
  const idxOf = (needle: string) => order.findIndex((t: string) => t.includes(needle));
  const iPrioHeader = idxOf('Priority · ');
  const iVip = idxOf(`VIP hello ${marker}`);
  const iUnreadHeader = idxOf('Unread · ');
  const iPlain = idxOf(`Plain hello ${marker}`);

  check('Priority header rendered first', iPrioHeader === 0, `index ${iPrioHeader}`);
  check('VIP mail sits under Priority', iPrioHeader >= 0 && iVip > iPrioHeader && (iUnreadHeader === -1 || iVip < iUnreadHeader), `vip@${iVip}`);
  check('Unread section exists after priority/bundles', iUnreadHeader > iVip, `unread@${iUnreadHeader}`);
  check('Plain unread mail sits under Unread', iPlain > iUnreadHeader, `plain@${iPlain}`);

  // Removing the address restores the normal flow
  await page.getByTitle('Settings').click();
  await page.getByRole('button', { name: 'Priority', exact: true }).click();
  await page.getByTitle('Remove vip@ext.example from priority senders').click();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => {
    const rows = [
      ...document.querySelectorAll('[data-thread-list] > div > div'),
    ] as { textContent: string }[];
    return rows.map((r) => r.textContent ?? '');
  });
  check('Priority group disappears when list emptied', !after.some((t: string) => t.includes('Priority · ')));

  await app.close();
  console.log(failures === 0 ? '✅ priority + unread ordering passed' : `❌ ${failures} failures`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
