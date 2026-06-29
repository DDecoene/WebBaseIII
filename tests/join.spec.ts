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

async function boot(page: Page, dbName: string): Promise<void> {
  await page.goto('/');
  await waitForOutput(page, 'Connected.', 8000);
  await cmd(page, `USE DATABASE ${dbName}`);
  await waitForOutput(page, 'Opened database', 3000);
}

test.describe('JOIN e2e', () => {
  test('JOIN materializes a combined table that can be listed', async ({ page }) => {
    const db = `e2e_join_${Date.now()}`;
    await boot(page, db);

    // Create customers table and insert one record
    await cmd(page, 'DROP TABLE jcustomers');
    await page.waitForTimeout(300);
    await cmd(page, 'CREATE TABLE jcustomers (id NUMERIC, name TEXT)');
    await waitForOutput(page, 'created', 3000);

    await cmd(page, 'USE jcustomers');
    await waitForOutput(page, 'jcustomers', 2000);

    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE id WITH 1, name WITH "Alice"');
    await waitForOutput(page, 'replaced', 2000);

    // Create orders table in area 2 and insert one record
    await cmd(page, 'SELECT ORD');
    await cmd(page, `USE DATABASE ${db}`);
    await waitForOutput(page, 'Opened database', 3000);

    await cmd(page, 'DROP TABLE jorders');
    await page.waitForTimeout(300);
    await cmd(page, 'CREATE TABLE jorders (custid NUMERIC, amount NUMERIC)');
    await waitForOutput(page, 'created', 3000);

    await cmd(page, 'USE jorders');
    await waitForOutput(page, 'jorders', 2000);

    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE custid WITH 1, amount WITH 100');
    await waitForOutput(page, 'replaced', 2000);

    // Switch back to customers area and run JOIN
    await cmd(page, 'SELECT CUST');
    await cmd(page, `USE DATABASE ${db}`);
    await waitForOutput(page, 'Opened database', 3000);

    await cmd(page, 'USE jcustomers');
    await waitForOutput(page, 'jcustomers', 2000);

    await cmd(page, 'DROP TABLE jcustord');
    await page.waitForTimeout(300);

    await cmd(page, 'JOIN WITH ORD TO jcustord FOR CUST.id = ORD.custid FIELDS CUST.name, ORD.amount', 2000);
    await waitForOutput(page, 'Joined 1 record', 5000);

    // Open the materialized table and list its records
    await cmd(page, 'USE jcustord');
    await waitForOutput(page, 'jcustord', 2000);

    await cmd(page, 'LIST', 1500);
    await waitForOutput(page, 'Alice', 5000);
    await waitForOutput(page, '100', 5000);
  });
});
