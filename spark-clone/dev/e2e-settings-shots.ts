/** Screenshot sweep of the Settings dialog sections (light + dark, empty + filled). */
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const artifacts = '/Users/rubenandino/Developer/Projects/spark-clone/dev/e2e-artifacts';
mkdirSync(artifacts, { recursive: true });

async function main() {
  const userData = mkdtempSync(join(tmpdir(), 'sparkclone-e2e-settings-'));
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

  await page.getByTitle('Settings').click();
  await page.waitForSelector('[role="dialog"]');

  for (const section of ['appearance', 'priority', 'scheduling', 'signatures', 'templates']) {
    await page.locator(`[data-settings-section="${section}"]`).click();
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(artifacts, `settings-${section}.png`) });
  }

  // priority with entries
  await page.locator('[data-settings-section="priority"]').click();
  await page.getByLabel('Priority email address').fill('anna@partner.example, vip@ext.example');
  await page.getByRole('button', { name: 'Add sender' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(artifacts, 'settings-priority-filled.png') });

  // dark mode pass
  await page.locator('[data-settings-section="appearance"]').click();
  await page.getByRole('radio', { name: 'Dark' }).click();
  await page.waitForTimeout(300);
  await page.locator('[data-settings-section="priority"]').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(artifacts, 'settings-priority-dark.png') });
  await page.locator('[data-settings-section="scheduling"]').click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: join(artifacts, 'settings-scheduling-dark.png') });

  await app.close();
  console.log('done');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
