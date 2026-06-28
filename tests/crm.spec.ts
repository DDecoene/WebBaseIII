/** Playwright E2E for demos/crm.prg — usable mini-CRM showcase. */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRG_SRC = fs.readFileSync(path.join(__dirname, '..', 'demos', 'crm.prg'), 'utf8');
const PRG_NAME = 'crm';

async function cmd(page: Page, command: string, waitMs = 700): Promise<void> {
  const input = page.locator('#terminal-input');
  await input.fill(command);
  await input.press('Enter');
  await page.waitForTimeout(waitMs);
}
async function waitForOutput(page: Page, text: string, timeout = 6000): Promise<void> {
  await expect(page.locator('#terminal-output')).toContainText(text, { timeout, ignoreCase: true });
}
async function boot(page: Page): Promise<void> {
  await page.goto('http://localhost:5173');
  await waitForOutput(page, 'Connected.', 8000);
}
async function seedProgram(page: Page): Promise<void> {
  await cmd(page, `EDIT ${PRG_NAME}`, 1500);
  await expect(page.locator('#editor-view')).toBeVisible({ timeout: 6000 });
  await page.locator('#editor-textarea').fill(PRG_SRC);
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}
async function menuChoice(page: Page, choice: string): Promise<void> {
  await expect(page.locator('#form-view')).toBeVisible({ timeout: 6000 });
  const input = page.locator('#form-view input.f-get').last();
  await input.fill(choice);
  await input.press('Enter');
  await page.waitForTimeout(1500);
}

test.describe('CRM demo', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    await seedProgram(page);
    // Clean slate: drop the demo's tables so DO crm performs a fresh first-run
    // seed. The CRM database persists server-side and is shared across suites, so
    // without this a stale table/index from another test can break seeding.
    await cmd(page, 'USE DATABASE CRM');
    for (const t of ['COMPANIES', 'CONTACTS', 'DEALS', 'CUSTOMERS', 'TOPDEALS', 'PIPELINE']) {
      await cmd(page, `DROP TABLE ${t}`, 150);
    }
    await cmd(page, `DO ${PRG_NAME}`, 1800);
  });

  test('runs and shows the main menu', async ({ page }) => {
    await expect(page.locator('#form-view')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#form-view')).toContainText('CRM', { timeout: 6000 });
  });

  test('pipeline summary prints totals', async ({ page }) => {
    await menuChoice(page, '5');
    await expect(page.locator('#form-view')).toContainText(/pipeline/i, { timeout: 6000 });
  });

  test('top deals sorts into a new table', async ({ page }) => {
    await menuChoice(page, '6');
    await waitForOutput(page, 'TOPDEALS', 6000);
  });

  test('deals report renders the HTML preview', async ({ page }) => {
    await menuChoice(page, '7');
    await expect(page.locator('#report-preview-view')).toBeVisible({ timeout: 8000 });
    await page.keyboard.press('Escape');
  });

  test('export deals downloads a CSV', async ({ page }) => {
    const dl = page.waitForEvent('download');
    await menuChoice(page, '8');
    const d = await dl;
    expect(d.suggestedFilename().toLowerCase()).toContain('deals');
  });

  test('combined pipeline JOIN builds a table', async ({ page }) => {
    await menuChoice(page, '9');
    await waitForOutput(page, 'PIPELINE', 6000);
  });
});
