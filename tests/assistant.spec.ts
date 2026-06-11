/** Playwright E2E for the Assistant sidebar (v0.6.0). Requires dev server on :5173. */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page): Promise<void> {
  await page.goto('http://localhost:5173');
  await expect(page.locator('#terminal-output')).toContainText('Connected.', { timeout: 8000 });
}

async function clickAction(page: Page, label: string): Promise<void> {
  await page.locator('#assistant-sidebar .as-action', { hasText: label }).first().click();
}

test.describe('Assistant sidebar', () => {
  test('renders categories and collapses', async ({ page }) => {
    await boot(page);
    const sb = page.locator('#assistant-sidebar');
    await expect(sb).toBeVisible();
    for (const cat of ['Database', 'Tables', 'Data', 'Search', 'Reports', 'Programs']) {
      await expect(sb).toContainText(cat);
    }
    await sb.locator('.as-header').click();
    await expect(sb).toHaveClass(/collapsed/);
    await sb.locator('.as-header').click();
    await expect(sb).not.toHaveClass(/collapsed/);
  });

  test('open database via picker echoes USE DATABASE into the terminal', async ({ page }) => {
    await boot(page);
    // Seed a db so the picker has an entry
    await page.locator('#terminal-input').fill('USE DATABASE ASSISTDEMO');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(600);
    await page.reload();
    await boot(page);

    await clickAction(page, 'Open database');
    await page.locator('#assistant-sidebar .as-pick', { hasText: 'ASSISTDEMO' }).click();
    await expect(page.locator('#terminal-output')).toContainText('. USE DATABASE ASSISTDEMO', { timeout: 5000 });
    await expect(page.locator('#status-db')).toContainText('ASSISTDEMO', { timeout: 5000 });
  });

  test('table-dependent actions disabled without a table, enabled with one', async ({ page }) => {
    await boot(page);
    const browse = page.locator('#assistant-sidebar .as-action', { hasText: 'Browse' }).first();
    await expect(browse).toHaveClass(/disabled/);

    await page.locator('#terminal-input').fill('USE DATABASE ASSISTDEMO');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(400);
    await page.locator('#terminal-input').fill('CREATE TABLE asst_t (NAME CHAR(20))');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(600);
    await expect(browse).not.toHaveClass(/disabled/);

    await browse.click();
    await expect(page.locator('#grid-view')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('#terminal-view')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Assistant wizards — table', () => {
  test('New table wizard emits CREATE TABLE and the echo lands in the terminal', async ({ page }) => {
    await boot(page);
    await page.locator('#terminal-input').fill('USE DATABASE ASSISTDEMO');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(400);
    await page.locator('#terminal-input').fill('DROP TABLE wiz_products');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(400);

    await clickAction(page, 'New table…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });

    await page.locator('#wz-table-name').fill('wiz_products');
    await page.locator('.wz-col-name').first().fill('NAME');
    await page.locator('.wz-col-type').first().selectOption('CHAR');
    await page.locator('.wz-col-len').first().fill('30');

    // live preview shows the exact command
    await expect(page.locator('.wz-preview')).toContainText('CREATE TABLE wiz_products (NAME CHAR(30))');

    await page.locator('#wizard-view button', { hasText: 'Create table' }).click();
    await expect(page.locator('#terminal-view')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#terminal-output')).toContainText('. CREATE TABLE wiz_products (NAME CHAR(30))');
    await expect(page.locator('#status-table')).toContainText('WIZ_PRODUCTS', { timeout: 5000 });
  });
});

test.describe('Assistant wizards — filter / index / search', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    const cmds = [
      'USE DATABASE ASSISTDEMO',
      'DROP TABLE wiz_stock',
      'CREATE TABLE wiz_stock (NAME CHAR(20), QTY NUM(6))',
      'APPEND RECORD', 'REPLACE NAME WITH "Anvil", QTY WITH 3',
      'APPEND RECORD', 'REPLACE NAME WITH "Rope", QTY WITH 50',
    ];
    for (const c of cmds) {
      await page.locator('#terminal-input').fill(c);
      await page.locator('#terminal-input').press('Enter');
      await page.waitForTimeout(250);
    }
  });

  test('Filter wizard emits SET FILTER TO with quoted string value', async ({ page }) => {
    await clickAction(page, 'Filter…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });
    await page.locator('#wz-filter-col').selectOption({ value: 'NAME' });
    await page.locator('#wz-filter-op').selectOption('==');
    await page.locator('#wz-filter-val').fill('Anvil');
    await expect(page.locator('.wz-preview')).toContainText('SET FILTER TO NAME == "Anvil"');
    await page.locator('#wizard-view button', { hasText: 'Apply filter' }).click();
    await expect(page.locator('#terminal-output')).toContainText('. SET FILTER TO NAME == "Anvil"', { timeout: 5000 });
  });

  test('Index wizard + Find record positions the pointer via SEEK', async ({ page }) => {
    await clickAction(page, 'New index…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });
    await page.locator('#wz-index-expr').fill('NAME');
    await page.locator('#wz-index-tag').fill('WIZBYNAME');
    await expect(page.locator('.wz-preview')).toContainText('INDEX ON NAME TO WIZBYNAME');
    await page.locator('#wizard-view button', { hasText: 'Create index' }).click();
    await expect(page.locator('#terminal-output')).toContainText('. INDEX ON NAME TO WIZBYNAME', { timeout: 5000 });
    await page.waitForTimeout(400); // let the catalog refresh round-trip land so Find record sees the new index

    await clickAction(page, 'Find record…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });
    await page.locator('#wz-search-val').fill('Rope');
    await expect(page.locator('.wz-preview')).toContainText('SEEK "Rope"');
    await page.locator('#wizard-view button', { hasText: 'Find' }).click();
    await expect(page.locator('#terminal-output')).toContainText('Found at position', { timeout: 5000 });
  });
});
