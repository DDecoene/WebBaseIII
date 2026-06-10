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

    // Verify all 6 products were seeded with correct data (REPLACE must have
    // targeted each appended row, not overwritten record 1 repeatedly)
    await cmd(page, 'USE DATABASE INVDEMO');
    await cmd(page, 'USE PRODUCTS');
    await cmd(page, 'GO BOTTOM');
    await waitForOutput(page, 'Record pointer: 6 / 6', 5000);
    await cmd(page, 'LIST');
    const output = (await page.locator('#terminal-output').textContent()) ?? '';
    expect(output).not.toMatch(/\*\* Error/i);
    expect(output).toContain('Laptop Pro 15');
    expect(output).toContain('Stapler Heavy');
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

  test('option 3 — search finds Laptop Pro 15 by exact name', async ({ page }) => {
    await boot(page);
    await cmd(page, `DO ${PRG_NAME}`, 2500);
    await expect(page.locator('#form-view')).toBeVisible({ timeout: 6000 });

    // Choose option 3 and wait until the Search form appears
    await menuChoiceAndWait(page, '3', 'SEARCH PRODUCT');

    // Fill exact product name (SEEK is exact-match on UPPER(NAME) index)
    await fillFirstField(page, 'Laptop Pro 15');

    // Result should appear in form view (@ SAY + INPUT prompt)
    await expect(page.locator('#form-view')).toContainText('Laptop Pro 15', { timeout: 5000 });

    await ack(page);

    // Back at the main menu — quit (form closes when the program ends)
    await expect(page.locator('#form-view')).toContainText('WEBBASE-III', { timeout: 6000 });
    await menuChoice(page, 'Q');
    await waitForProgramExit(page);
  });

  test('option 5 — stock report shows product and total rows', async ({ page }) => {
    await boot(page);
    await cmd(page, `DO ${PRG_NAME}`, 2500);
    await expect(page.locator('#form-view')).toBeVisible({ timeout: 6000 });

    // Choose option 5 and wait for the report form (all @SAY + INPUT prompt)
    await menuChoiceAndWait(page, '5', 'STOCK REPORT');

    // Report content rendered as @SAY fields — check for total line
    await expect(page.locator('#form-view')).toContainText('Total', { timeout: 5000 });

    await ack(page);

    // Back at the main menu — quit (form closes when the program ends)
    await expect(page.locator('#form-view')).toContainText('WEBBASE-III', { timeout: 6000 });
    await menuChoice(page, 'Q');
    await waitForProgramExit(page);
  });

  test('option 6 + 7 — deactivate then reactivate Hammer 16oz', async ({ page }) => {
    await boot(page);
    await cmd(page, `DO ${PRG_NAME}`, 2500);
    await expect(page.locator('#form-view')).toBeVisible({ timeout: 6000 });

    // Deactivate (option 6) — wait for the Deactivate screen
    await menuChoiceAndWait(page, '6', 'DEACTIVATE PRODUCT');
    await fillFirstField(page, 'Hammer 16oz');

    // Confirm form shows the product found
    await expect(page.locator('#form-view')).toContainText('Hammer', { timeout: 5000 });

    // Fill confirm field (Y/N)
    const confirmInput = page.locator('#form-view input.f-get').last();
    await confirmInput.fill('Y');
    await confirmInput.press('Enter');
    await page.waitForTimeout(1200);
    await expect(page.locator('#form-view')).toContainText('deactivated', { timeout: 5000 });
    await ack(page);

    // Activate (option 7) — wait for the Activate screen
    await menuChoiceAndWait(page, '7', 'ACTIVATE PRODUCT');
    await fillFirstField(page, 'Hammer 16oz');
    await expect(page.locator('#form-view')).toContainText('Hammer', { timeout: 5000 });

    const confirmInput2 = page.locator('#form-view input.f-get').last();
    await confirmInput2.fill('Y');
    await confirmInput2.press('Enter');
    await page.waitForTimeout(1200);
    await expect(page.locator('#form-view')).toContainText('activated', { timeout: 5000 });
    await ack(page);

    // Back at the main menu — quit (form closes when the program ends)
    await expect(page.locator('#form-view')).toContainText('WEBBASE-III', { timeout: 6000 });
    await menuChoice(page, 'Q');
    await waitForProgramExit(page);
  });
});
