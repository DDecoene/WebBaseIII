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
