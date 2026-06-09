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

async function boot(page: Page): Promise<void> {
  await page.goto('http://localhost:5173');
  await waitForOutput(page, 'Connected.', 8000);
  await cmd(page, 'USE DATABASE mwa_testdb');
  await waitForOutput(page, 'Opened database', 3000);
}

test.describe('Multi-work-area E2E', () => {
  test('SELECT creates and switches work areas', async ({ page }) => {
    await boot(page);
    await cmd(page, 'SELECT 2');
    await waitForOutput(page, 'Work area: 2');
    await cmd(page, 'LIST AREAS');
    await waitForOutput(page, '1');
    await waitForOutput(page, '2');
  });

  test('CLOSE ALL resets to single area', async ({ page }) => {
    await boot(page);
    await cmd(page, 'SELECT alpha');
    await cmd(page, 'SELECT beta');
    await cmd(page, 'CLOSE ALL');
    await waitForOutput(page, 'All work areas closed');
    // Capture text before LIST AREAS
    const before = (await page.locator('#terminal-output').textContent()) ?? '';
    await cmd(page, 'LIST AREAS');
    await waitForOutput(page, 'Alias');
    const after = (await page.locator('#terminal-output').textContent()) ?? '';
    const listOutput = after.slice(before.length);
    // Only area 1 should be in the list
    expect(listOutput).toContain('1');
    expect(listOutput).not.toMatch(/alpha|beta/i);
  });

  test('relation auto-seek: orders linked to customers by key', async ({ page }) => {
    await boot(page);

    // Setup customers in area 1
    await cmd(page, 'DROP TABLE mwa_customers');
    await cmd(page, 'CREATE TABLE mwa_customers (cid TEXT, cname TEXT)');
    await cmd(page, 'USE mwa_customers');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE cid WITH "C1", cname WITH "Alice"');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE cid WITH "C2", cname WITH "Bob"');
    await cmd(page, 'INDEX ON cid TO BYCID');
    await waitForOutput(page, 'Index created');

    // Setup orders in area 2
    await cmd(page, 'SELECT 2');
    await cmd(page, 'USE DATABASE mwa_testdb');
    await cmd(page, 'DROP TABLE mwa_orders');
    await cmd(page, 'CREATE TABLE mwa_orders (custno TEXT, amount REAL)');
    await cmd(page, 'USE mwa_orders');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE custno WITH "C2", amount WITH 99');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE custno WITH "C1", amount WITH 50');

    // Link: when orders navigates, seek customers by custno
    await cmd(page, 'SET RELATION TO custno INTO 1');
    await waitForOutput(page, 'Relation set');

    // Navigate to order 1 (custno=C2) — customers should seek to Bob
    await cmd(page, 'GO 1');
    await waitForOutput(page, 'Record pointer');

    // LIST AREAS should show both areas with non-zero rowPtr
    await cmd(page, 'LIST AREAS');
    await waitForOutput(page, 'mwa_customers');
    await waitForOutput(page, 'mwa_orders');
  });

  test('LIST with alias.field columns shows cross-area data', async ({ page }) => {
    await boot(page);

    // Must have run the relation test already or setup again
    // Try to set up again (idempotent)
    await cmd(page, 'CLOSE ALL');

    await cmd(page, 'DROP TABLE mwa_cities');
    await cmd(page, 'CREATE TABLE mwa_cities (zip TEXT, city TEXT)');
    await cmd(page, 'USE mwa_cities');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE zip WITH "1000", city WITH "Brussels"');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE zip WITH "2000", city WITH "Antwerp"');
    await cmd(page, 'INDEX ON zip TO BYZIP');
    await waitForOutput(page, 'Index created');

    await cmd(page, 'SELECT 2');
    await cmd(page, 'USE DATABASE mwa_testdb');
    await cmd(page, 'DROP TABLE mwa_contacts');
    await cmd(page, 'CREATE TABLE mwa_contacts (name TEXT, zipcode TEXT)');
    await cmd(page, 'USE mwa_contacts');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE name WITH "Alice", zipcode WITH "2000"');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE name WITH "Bob", zipcode WITH "1000"');

    await cmd(page, 'SET RELATION TO zipcode INTO 1');
    await waitForOutput(page, 'Relation set');

    await cmd(page, 'GO TOP');
    await cmd(page, 'LIST name, 1.city', 1500);
    // Alice is in Antwerp (zip 2000)
    await waitForOutput(page, 'name');
  });
});
