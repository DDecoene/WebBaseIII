/**
 * Playwright E2E tests for demos/INVENTORY.prg
 *
 * Covers:
 *  - First run: tables created and seeded, no errors
 *  - Second run: no re-seeding (cachedRecCount fix regression guard)
 *  - Menu option 3: Search product by name
 *  - Menu option 5: Stock report renders without errors
 *  - Menu option 6 + 7: Deactivate then reactivate a product
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRG_SRC = fs.readFileSync(path.join(__dirname, '..', 'demos', 'INVENTORY.prg'), 'utf8');
const PRG_NAME = 'inventory';

// ── helpers ──────────────────────────────────────────────────────────────────

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

/** Submit a menu choice and wait for the form content to change away from the main menu. */
async function menuChoice(page: Page, choice: string): Promise<void> {
  await expect(page.locator('#form-view')).toBeVisible({ timeout: 6000 });
  const input = page.locator('#form-view input.f-get').last();
  await input.fill(choice);
  await input.press('Enter');
  // Give the server time to process and open the next screen
  await page.waitForTimeout(1500);
}

/** Submit a menu choice and wait until the form shows expectedText (next screen header). */
async function menuChoiceAndWait(page: Page, choice: string, expectedText: string): Promise<void> {
  await expect(page.locator('#form-view')).toBeVisible({ timeout: 6000 });
  const input = page.locator('#form-view input.f-get').last();
  await input.fill(choice);
  await input.press('Enter');
  // Wait until the form transitions away from the main menu to the expected screen
  await expect(page.locator('#form-view')).toContainText(expectedText, { timeout: 6000 });
}

/** Fill the first input in the current form and submit. */
async function fillFirstField(page: Page, value: string, waitMs = 1200): Promise<void> {
  await expect(page.locator('#form-view')).toBeVisible({ timeout: 5000 });
  const input = page.locator('#form-view input.f-get').first();
  await input.fill(value);
  await input.press('Enter');
  await page.waitForTimeout(waitMs);
}

/** Press Enter to dismiss an INPUT prompt (shown in form view). */
async function ack(page: Page, waitMs = 800): Promise<void> {
  const form = page.locator('#form-view');
  if (await form.isVisible({ timeout: 1500 }).catch(() => false)) {
    const input = form.locator('input.f-get').last();
    await input.fill('');
    await input.press('Enter');
    await page.waitForTimeout(waitMs);
  } else {
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(waitMs);
  }
}

/** Wait for program to fully exit: form hidden. */
async function waitForProgramExit(page: Page): Promise<void> {
  await expect(page.locator('#form-view')).toBeHidden({ timeout: 6000 });
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('INVENTORY.prg', () => {

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await boot(page);
    await seedProgram(page);
    // Drop tables so test 1 exercises first-run seeding
    await cmd(page, 'USE DATABASE INVDEMO');
    await cmd(page, 'DROP TABLE PRODUCTS');
    await cmd(page, 'DROP TABLE CATEGORIES');
    await page.close();
  });

  test('first run — tables created and seeded without errors', async ({ page }) => {
    await boot(page);

    // Menu form should appear (program seeds tables, then the DO WHILE menu opens)
    await cmd(page, `DO ${PRG_NAME}`, 100);
    await expect(page.locator('#form-view')).toBeVisible({ timeout: 8000 });

    // Quit cleanly
    await menuChoice(page, 'Q');
    await waitForProgramExit(page);

    // Verify all 5 products were seeded with correct data (REPLACE must have
    // targeted each appended row, not overwritten record 1 repeatedly)
    await cmd(page, 'USE DATABASE INVDEMO');
    await cmd(page, 'USE PRODUCTS');
    await cmd(page, 'GO BOTTOM');
    await waitForOutput(page, 'Record pointer: 5 / 5', 5000);
    await cmd(page, 'LIST');
    const output = (await page.locator('#terminal-output').textContent()) ?? '';
    expect(output).not.toMatch(/\*\* Error/i);
    expect(output).toContain('Laptop Pro 15');
    expect(output).toContain('Desk Chair Ergo');
  });

  test('second run — no re-seeding (RECCOUNT regression)', async ({ page }) => {
    await boot(page);

    // Run once to seed data (tables may already exist from test 1 but let's be safe)
    await cmd(page, `DO ${PRG_NAME}`, 2500);
    await expect(page.locator('#form-view')).toBeVisible({ timeout: 6000 });
    await menuChoice(page, 'Q');
    await waitForProgramExit(page);

    // Plant a marker: re-seeding (DROP + CREATE + APPEND) would erase it
    await cmd(page, 'USE DATABASE INVDEMO');
    await cmd(page, 'USE PRODUCTS');
    await cmd(page, 'SET INDEX TO BYNAME');
    await cmd(page, 'SEEK "Hammer 16oz"');
    await cmd(page, 'REPLACE STOCK WITH 99');

    // Second run: menu opens cleanly, then quit
    await cmd(page, `DO ${PRG_NAME}`, 2500);
    await expect(page.locator('#form-view')).toBeVisible({ timeout: 8000 });
    await menuChoice(page, 'Q');
    await waitForProgramExit(page);

    // Marker must have survived — data was not re-seeded
    await cmd(page, 'USE DATABASE INVDEMO');
    await cmd(page, 'USE PRODUCTS');
    await cmd(page, 'SET INDEX TO BYNAME');
    await cmd(page, 'SEEK "Hammer 16oz"');
    await waitForOutput(page, 'STOCK: 99', 5000);
  });

  test('option 5 — search finds Laptop Pro 15 and shows its category', async ({ page }) => {
    await boot(page);
    await cmd(page, `DO ${PRG_NAME}`, 2500);
    await expect(page.locator('#form-view')).toBeVisible({ timeout: 6000 });

    // Option 5 is now Search Product; wait until the Search form appears
    await menuChoiceAndWait(page, '5', 'SEARCH PRODUCT');

    // Fill exact product name (SEEK is exact-match on UPPER(NAME) index)
    await fillFirstField(page, 'Laptop Pro 15');

    // Result shows the product plus its category via the SET RELATION alias.field
    await expect(page.locator('#form-view')).toContainText('Laptop Pro 15', { timeout: 5000 });
    await expect(page.locator('#form-view')).toContainText('Electronics', { timeout: 5000 });

    await ack(page);
    await expect(page.locator('#form-view')).toContainText('WEBBASE-III', { timeout: 6000 });
    await menuChoice(page, 'Q');
    await waitForProgramExit(page);
  });
});

test.describe('Inventory demo — v1.0/v1.1 features', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    await seedProgram(page);
    await cmd(page, `DO ${PRG_NAME}`, 1800);
    await expect(page.locator('#form-view')).toBeVisible({ timeout: 8000 });
  });

  test('option 6 — valuation & stock summary prints totals', async ({ page }) => {
    await menuChoice(page, '6');
    // Totals must render inline next to their labels (value, not just caption).
    await expect(page.locator('#form-view')).toContainText(/stock units\s*:\s*\d/i, { timeout: 6000 });
    await expect(page.locator('#form-view')).toContainText(/average price\s*:\s*\d/i, { timeout: 6000 });
  });

  test('option 7 — low-stock report renders the HTML preview', async ({ page }) => {
    await menuChoice(page, '7');
    await expect(page.locator('#report-preview-view')).toBeVisible({ timeout: 8000 });
    await page.keyboard.press('Escape');
  });

  test('option 9 — top products by value sorts into a new table', async ({ page }) => {
    await menuChoice(page, '9');
    await waitForOutput(page, 'TOPPROD', 6000);
  });

  test('option 10 — export products downloads a CSV', async ({ page }) => {
    const dl = page.waitForEvent('download');
    await menuChoice(page, '10');
    const d = await dl;
    expect(d.suggestedFilename().toLowerCase()).toContain('products');
  });

  test('option 11 — combined catalog JOIN builds a table', async ({ page }) => {
    await menuChoice(page, '11');
    await waitForOutput(page, 'CATALOG', 6000);
  });
});
