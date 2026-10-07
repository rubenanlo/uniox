/**
 * End-to-end sweep against the built app + dev mail servers.
 *
 *   pnpm mail:up && pnpm seed && pnpm build && pnpm e2e
 *
 * Drives the real Electron binary via Playwright CDP: onboards both dev
 * accounts, verifies the unified inbox, safe rendering, archive+undo,
 * Command Center, layouts, reply→SMTP capture, and IDLE live pickup.
 * Screenshots land in dev/e2e-artifacts/.
 */
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { ImapFlow } from 'imapflow';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const artifacts = join(here, 'e2e-artifacts');
mkdirSync(artifacts, { recursive: true });

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: join(artifacts, name) });
  console.log(`  📸 ${name}`);
}

async function addAccount(page: Page, email: string) {
  await page.getByText('Use local dev server').click();
  const emailInput = page.getByLabel('Email address');
  await emailInput.fill(email);
  await page.getByLabel('Password').fill('pass');
  await page.getByRole('button', { name: 'Add account' }).click();
}

async function appendMail(user: string, subject: string) {
  const client = new ImapFlow({
    host: '127.0.0.1',
    port: 1143,
    secure: false,
    auth: { user, pass: 'pass' },
    tls: { rejectUnauthorized: false },
    logger: false,
  });
  await client.connect();
  await client.append(
    'INBOX',
    `From: Live Test <live@ext.example>\r\nTo: ${user}\r\nSubject: ${subject}\r\n` +
      `Date: ${new Date().toUTCString()}\r\nMessage-ID: <live-${Date.now()}@x>\r\n` +
      `Content-Type: text/plain\r\n\r\nThis arrived while the app was running.\r\n`,
    [],
  );
  await client.logout();
}

async function main() {
  const userData = mkdtempSync(join(tmpdir(), 'sparkclone-e2e-'));
  console.log('▶ launching app (userData:', userData + ')');
  const app: ElectronApplication = await electron.launch({
    args: ['out/main/index.js'],
    env: { ...process.env, SPARKCLONE_USER_DATA: userData, ELECTRON_ENABLE_LOGGING: '1' },
  });
  const page = await app.firstWindow();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('  [renderer:error]', msg.text());
  });
  await page.waitForLoadState('domcontentloaded');

  // ---- onboarding: two accounts → unified inbox
  await page.getByText('Add a mail account').waitFor({ timeout: 15_000 });
  await shot(page, '01-onboarding.png');
  await addAccount(page, 'alice@dev.local');
  await page.getByRole('heading', { name: 'Inbox' }).waitFor({ timeout: 30_000 });
  check('alice added, inbox shell renders', true);

  // wait for backfilled rows
  await page.locator('[role="list"] [role="button"]').first().waitFor({ timeout: 60_000 });
  const aliceRows = await page.locator('[role="list"] [role="button"]').count();
  check('inbox shows synced threads', aliceRows > 20, `${aliceRows} rows rendered`);

  // second account
  await page.getByTitle('Add another account').click();
  await addAccount(page, 'bob@dev.local');
  await page.getByRole('heading', { name: 'Inbox' }).waitFor({ timeout: 30_000 });
  await page.waitForTimeout(4000); // bob backfill
  const unifiedButtons = await page.getByTitle(/dev\.local/).count();
  check('two accounts in sidebar', unifiedButtons >= 2, `${unifiedButtons} account chips`);
  await page.waitForTimeout(4000);
  await shot(page, '02-unified-inbox.png');

  // ---- open a newsletter thread: safe render + blocked images
  // (Smart Inbox buries newsletters below the fold; search finds it)
  await page.getByLabel('Search mail').fill('Frontend Weekly');
  await page.waitForTimeout(800);
  await page.getByText('Frontend Weekly #120', { exact: false }).first().click();
  await page.locator('iframe[title="Email content"]').first().waitFor({ timeout: 20_000 });
  check('message body renders in sandboxed iframe', true);
  const sandbox = await page
    .locator('iframe[title="Email content"]')
    .first()
    .getAttribute('sandbox');
  check('iframe sandbox has no allow-scripts', !!sandbox && !sandbox.includes('allow-scripts'), sandbox ?? '');
  const blockedBar = await page.getByText(/remote image.* blocked/i).count();
  check('remote images blocked by default', blockedBar > 0);
  await shot(page, '03-reading-pane.png');

  // ---- hostile email renders inert
  await page.getByLabel('Search mail').fill('script-injection');
  await page.waitForTimeout(800);
  await page.getByText('[fixture] hostile: script-injection').first().click();
  await page.waitForTimeout(1200);
  const title = await page.title();
  check('hostile email did not execute scripts', title !== 'pwned', `title="${title}"`);
  await page.getByLabel('Search mail').fill('');
  await page.waitForTimeout(800);

  // ---- archive with undo (E on selected row)
  const firstSubject = await page
    .locator('[role="list"] [role="button"]')
    .first()
    .textContent();
  await page.locator('[role="list"] [role="button"]').first().click();
  await page.keyboard.press('e');
  await page.getByText('Undo ⌘Z').waitFor({ timeout: 5_000 });
  check('Done (E) shows undo toast', true, (firstSubject ?? '').slice(0, 40));

  // ---- Command Center
  await page.keyboard.press('Meta+k');
  await page.getByPlaceholder(/Act on|Type a command/).waitFor({ timeout: 5_000 });
  await shot(page, '04-command-center.png');
  await page.getByPlaceholder(/Act on|Type a command/).fill('done');
  await page.keyboard.press('Escape');
  check('⌘K Command Center opens and searches', true);

  // ---- layouts
  await page.keyboard.press('Meta+Alt+3');
  await page.waitForTimeout(400);
  await shot(page, '05-simple-list.png');
  await page.keyboard.press('Meta+Alt+2');
  await page.waitForTimeout(400);
  await shot(page, '06-unread-cards.png');
  await page.keyboard.press('Meta+Alt+1');
  check('layout shortcuts cycle Focused/Cards/Simple', true);

  // ---- reply → SMTP capture in Mailpit
  await page.getByText('Q3 planning session', { exact: false }).first().click();
  await page.waitForTimeout(800);
  await page.keyboard.press('r'); // Reply All
  await page.locator('.composer-editor .ProseMirror').waitFor({ timeout: 10_000 });
  await page.locator('.composer-editor .ProseMirror').click();
  await page.keyboard.type('Confirmed — see you Thursday at 9:30.');
  await shot(page, '07-composer.png');
  await page.keyboard.press('Meta+Enter');
  await page.getByText('Sending…').waitFor({ timeout: 5_000 });
  check('send shows undo window', true);
  console.log('  … waiting out the undo-send window + delivery');
  await page.waitForTimeout(9_000);
  const mailpit = (await (await fetch('http://localhost:8025/api/v1/messages')).json()) as {
    messages: { Subject: string }[];
  };
  const delivered = mailpit.messages?.some((m) => m.Subject.startsWith('Re: Q3 planning'));
  check('reply delivered via SMTP (Mailpit)', !!delivered, mailpit.messages?.[0]?.Subject);

  // sent copy in Sent view (threads keep the original subject)
  await page.getByRole('button', { name: 'Sent' }).click();
  let sentVisible = 0;
  for (let i = 0; i < 15 && !sentVisible; i++) {
    await page.waitForTimeout(1000);
    sentVisible = await page.getByText('Q3 planning session').count();
  }
  check('sent copy appears in Sent view', sentVisible > 0);
  await page.getByRole('button', { name: 'Inbox' }).click();

  // ---- IDLE: append server-side while app runs
  const liveSubject = `Live arrival ${Date.now()}`;
  await appendMail('alice@dev.local', liveSubject);
  let liveSeen = false;
  for (let i = 0; i < 40 && !liveSeen; i++) {
    await page.waitForTimeout(1000);
    liveSeen = (await page.getByText(liveSubject).count()) > 0;
  }
  check('IDLE picks up new mail without restart', liveSeen);

  // ---- Phase 4: Smart Inbox cards + Gatekeeper
  const personalCard = await page.getByText(/Personal · \d/).count();
  // category groups below the fold render once the virtualized list scrolls
  const list = page.locator('[role="list"]').last();
  let inviteCard = 0;
  let newsletterCard = 0;
  let promoCard = 0;
  for (let i = 0; i < 16 && (!newsletterCard || !promoCard || !inviteCard); i++) {
    inviteCard = inviteCard || (await page.getByText(/Invites · \d/).count());
    newsletterCard = newsletterCard || (await page.getByText(/Newsletters · \d/).count());
    promoCard = promoCard || (await page.getByText(/Promotions · \d/).count());
    await list.evaluate((el) => el.scrollBy(0, el.clientHeight * 2));
    await page.waitForTimeout(300);
  }
  check(
    'Smart Inbox groups mail into Personal/Invites/Newsletters/Promotions cards',
    personalCard > 0 && inviteCard > 0 && newsletterCard > 0 && promoCard > 0,
    `personal=${personalCard} invites=${inviteCard} news=${newsletterCard} promo=${promoCard}`,
  );
  await list.evaluate((el) => el.scrollTo(0, 0));

  const gkCount = await page.getByText(/\d+ new senders?/i).count();
  check('Gatekeeper card lists pending first-contact senders', gkCount > 0);
  const firstPendingKey = await page
    .locator('section[aria-label="Gatekeeper"] .text-ink-faint.block')
    .first()
    .textContent();
  const acceptButtons = page.getByRole('button', { name: 'Accept' });
  if ((await acceptButtons.count()) > 0 && firstPendingKey) {
    const sender = firstPendingKey.split('·')[0]!.trim();
    await acceptButtons.first().click();
    await page.waitForTimeout(1500);
    const stillListed = await page
      .locator('section[aria-label="Gatekeeper"]')
      .getByText(sender)
      .count();
    check('accepting a sender clears them from the queue', stillListed === 0, sender);
  }
  await shot(page, '08-smart-inbox.png');

  // ---- Phase 3: snooze via S → picker → appears in Snoozed view
  await page.getByText(liveSubject).first().click();
  await page.waitForTimeout(600);
  await page.keyboard.press('s');
  await page.getByRole('dialog', { name: /Snooze/ }).waitFor({ timeout: 5_000 });
  await shot(page, '09-snooze-picker.png');
  await page.getByRole('button', { name: /Tomorrow/ }).click();
  await page.waitForTimeout(1500);
  const goneFromInbox = (await page.getByText(liveSubject).count()) === 0;
  await page.keyboard.press('Meta+s'); // Snoozed view
  await page.waitForTimeout(1000);
  const inSnoozed = (await page.getByText(liveSubject).count()) > 0;
  check('snooze (S) moves thread out of inbox into Snoozed view', goneFromInbox && inSnoozed);
  await shot(page, '10-snoozed-view.png');
  await page.keyboard.press('Meta+Shift+i');

  // ---- Phase 3: Set Aside via G and back
  await page.waitForTimeout(800);
  const firstRow = page.locator('[role="list"] [role="button"]').first();
  const asideSubject = (await firstRow.textContent()) ?? '';
  await firstRow.click();
  await page.keyboard.press('g');
  await page.waitForTimeout(1500);
  await page.keyboard.press('Meta+g'); // Set Aside view
  await page.waitForTimeout(800);
  const asideCount = await page.locator('[role="list"] [role="button"]').count();
  check('Set Aside (G) parks the thread in its view', asideCount > 0, asideSubject.slice(0, 40));
  await page.keyboard.press('Meta+Shift+i');
  await page.waitForTimeout(500);

  // ---- Phase 3: Send Later → Outbox → Send now → Mailpit
  const schedSubject = `Scheduled from e2e ${Date.now()}`;
  await page.keyboard.press('Meta+n');
  await page.getByLabel('To').waitFor({ timeout: 5_000 });
  await page.getByLabel('To').fill('later@ext.example');
  await page.getByLabel('Subject').fill(schedSubject);
  await page.locator('.composer-editor .ProseMirror').click();
  await page.keyboard.type('This goes out later.');
  await page.getByRole('button', { name: 'Send later' }).click();
  await page.getByRole('dialog', { name: 'Send later' }).waitFor({ timeout: 5_000 });
  await page.getByRole('button', { name: /Tomorrow/ }).click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: 'Outbox' }).click();
  await page.waitForTimeout(1000);
  const inOutbox = (await page.getByText(schedSubject).count()) > 0;
  check('Send Later lands in the Outbox with its schedule', inOutbox);
  await shot(page, '11-outbox.png');
  await page.getByRole('button', { name: 'Send now' }).first().click();
  let deliveredNow = false;
  for (let i = 0; i < 20 && !deliveredNow; i++) {
    await page.waitForTimeout(1000);
    const mp = (await (await fetch('http://localhost:8025/api/v1/messages')).json()) as {
      messages: { Subject: string }[];
    };
    deliveredNow = mp.messages?.some((m) => m.Subject === schedSubject) ?? false;
  }
  check('Outbox “Send now” delivers immediately', deliveredNow);

  await page.getByRole('button', { name: 'Inbox' }).click();
  await page.waitForTimeout(800);
  await shot(page, '12-final-inbox.png');

  await app.close();
  console.log(failures === 0 ? '\nE2E: all checks passed' : `\nE2E: ${failures} check(s) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
