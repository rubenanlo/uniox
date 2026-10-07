/** Keyboard panel-navigation sweep against the built app (modeled on dev/e2e.ts). */
import { _electron as electron, type ElectronApplication, type Page } from 'playwright-core';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// evaluate() callbacks run in the page; keep tsconfig.node DOM-free
// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const document: any;

const artifacts = '/Users/rubenandino/Developer/Projects/spark-clone/dev/e2e-artifacts';
mkdirSync(artifacts, { recursive: true });

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures += 1;
}

async function activePanel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'body';
    if (el.closest('nav[aria-label="Mailboxes"]')) return 'sidebar';
    if (el.closest('.reading-pane')) return 'reading';
    if (el.closest('[data-thread-list]')) return 'list';
    return `other:${el.tagName}`;
  });
}

async function main() {
  const userData = mkdtempSync(join(tmpdir(), 'sparkclone-e2e-keys-'));
  const app: ElectronApplication = await electron.launch({
    cwd: '/Users/rubenandino/Developer/Projects/spark-clone',
    args: ['out/main/index.js'],
    env: { ...process.env, SPARKCLONE_USER_DATA: userData, ELECTRON_ENABLE_LOGGING: '1' },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (err) => console.log('  [renderer:pageerror]', err.message));

  // onboard alice against the dev Dovecot
  await page.getByText('Use local dev server').click();
  await page.getByLabel('Email address').fill('alice@dev.local');
  await page.getByLabel('Password').fill('pass');
  await page.getByRole('button', { name: 'Add account' }).click();
  await page.waitForSelector('[data-thread-list]', { timeout: 30_000 });
  // wait for at least one thread row
  await page.waitForFunction(
    () => document.querySelectorAll('[data-thread-list] [role="button"]').length > 0,
    undefined,
    { timeout: 45_000 },
  );
  console.log('▶ app ready with mail');

  // Bundle rows (Notifications etc.) sit at the top of the inbox; step past
  // them so the thread-focused checks act on a real email row.
  const selectPlainThread = async () => {
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(150);
      const onBundle = await page.evaluate(() =>
        [...document.querySelectorAll('[data-bundle]')].some((el: { className: string }) =>
          el.className.includes('bg-accent-soft'),
        ),
      );
      if (!onBundle) break;
    }
  };

  // 1. From cold (focus on body): ↓ selects, → enters the reading pane
  await selectPlainThread();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  check('→ from list focuses reading pane', (await activePanel(page)) === 'reading', await activePanel(page));

  // 2. ← back to the list
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  check('← from reading focuses list', (await activePanel(page)) === 'list', await activePanel(page));

  // 3. ← again lands on the sidebar's active mailbox
  await page.keyboard.press('ArrowLeft');
  await page.waitForTimeout(300);
  check('← from list focuses sidebar', (await activePanel(page)) === 'sidebar', await activePanel(page));

  // 4. ↓ inside sidebar stays in sidebar (folder walk), → returns to list
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(150);
  check('↓ in sidebar stays in sidebar', (await activePanel(page)) === 'sidebar', await activePanel(page));
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  check('→ from sidebar focuses list', (await activePanel(page)) === 'list', await activePanel(page));

  // 5. Enter on a sidebar folder switches view AND moves focus to the list
  await page.keyboard.press('ArrowLeft'); // back to sidebar (on Inbox)
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowDown'); // Pinned
  await page.keyboard.press('ArrowDown'); // Snoozed
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check('Enter on folder focuses list', (await activePanel(page)) === 'list', await activePanel(page));

  // back to inbox for the rest
  await page.keyboard.press('Meta+Shift+i');
  await page.waitForTimeout(400);

  // 6. Enter on a list row steps into the thread (reading pane header)
  await selectPlainThread();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const p6 = await activePanel(page);
  check('Enter on row focuses reading pane', p6 === 'reading', p6);

  // 7. Enter on the focused message header collapses/expands it
  const before = await page.evaluate(
    () => document.querySelectorAll('.reading-pane article > button[aria-expanded="true"]').length,
  );
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const after = await page.evaluate(
    () => document.querySelectorAll('.reading-pane article > button[aria-expanded="true"]').length,
  );
  check('Enter toggles message expansion', before !== after, `${before} → ${after}`);

  // 8. Click inside the email body iframe, then ← must still return to the list
  await page.keyboard.press('Enter'); // re-expand
  await page.waitForTimeout(400);
  const frameEl = await page.$('.reading-pane iframe');
  if (frameEl) {
    const box = await frameEl.boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + Math.min(box.height / 2, 40));
    await page.waitForTimeout(200);
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    check('← from inside email iframe focuses list', (await activePanel(page)) === 'list', await activePanel(page));
  } else {
    check('← from inside email iframe focuses list', false, 'no iframe found');
  }

  // 9. With focus in the reading pane, `/` still toggles the sidebar
  await page.keyboard.press('ArrowRight'); // back into reading
  await page.waitForTimeout(300);
  const navWidthBefore = await page.evaluate(
    () => document.querySelector('nav[aria-label="Mailboxes"]')!.getBoundingClientRect().width,
  );
  await page.keyboard.press('/');
  await page.waitForTimeout(300);
  const navWidthAfter = await page.evaluate(
    () => document.querySelector('nav[aria-label="Mailboxes"]')!.getBoundingClientRect().width,
  );
  check('/ toggles sidebar from reading pane', navWidthBefore !== navWidthAfter, `${navWidthBefore} → ${navWidthAfter}`);

  await page.screenshot({ path: join(artifacts, 'keyboard-nav.png') });
  await app.close();
  console.log(failures === 0 ? '✅ keyboard navigation sweep passed' : `❌ ${failures} failures`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
