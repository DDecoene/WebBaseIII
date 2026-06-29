import { test, expect, Page } from '@playwright/test';

async function cmd(page: Page, command: string, waitMs = 800): Promise<void> {
  const input = page.locator('#terminal-input');
  await input.fill(command);
  await input.press('Enter');
  await page.waitForTimeout(waitMs);
}

async function waitForOutput(page: Page, text: string, timeout = 5000): Promise<void> {
  await expect(page.locator('#terminal-output')).toContainText(text, { timeout, ignoreCase: true });
}

async function boot(page: Page, db: string): Promise<void> {
  await page.goto('http://localhost:5173');
  await waitForOutput(page, 'Connected.', 8000);
  await cmd(page, `USE DATABASE ${db}`);
  await waitForOutput(page, 'Opened database', 3000);
}

test.describe('Live multi-user propagation E2E', () => {
  test('mutation in one client repaints another clients BROWSE grid', async ({ browser }) => {
    const db = `prop_testdb_${Date.now()}`;
    const table = `prop_people_${Date.now()}`;

    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();

    // A sets up the database and table with one row.
    await boot(pageA, db);
    await cmd(pageA, `CREATE TABLE ${table} (name TEXT)`);
    await waitForOutput(pageA, 'created', 3000);
    await cmd(pageA, `USE ${table}`);
    await cmd(pageA, 'APPEND RECORD');
    await cmd(pageA, "REPLACE name WITH 'Ada'");

    // Both clients open the same table in a BROWSE grid.
    await cmd(pageA, 'BROWSE', 1500);
    await expect(pageA.locator('#grid-view')).toBeVisible({ timeout: 5000 });
    await expect(pageA.locator('#grid-tbody')).toContainText('Ada', { timeout: 5000 });

    await boot(pageB, db);
    await cmd(pageB, `USE ${table}`);
    await cmd(pageB, 'BROWSE', 1500);
    await expect(pageB.locator('#grid-view')).toBeVisible({ timeout: 5000 });
    await expect(pageB.locator('#grid-tbody')).toContainText('Ada', { timeout: 5000 });

    // A mutates the data. Exit grid back to terminal first so A can issue a command.
    await pageA.keyboard.press('Escape');
    await pageA.waitForTimeout(500);
    await cmd(pageA, "REPLACE name WITH 'Grace'");

    // B's grid should repaint WITHOUT any manual re-query in B.
    await expect(pageB.locator('#grid-tbody')).toContainText('Grace', { timeout: 8000 });

    await ctxA.close();
    await ctxB.close();
  });
});
