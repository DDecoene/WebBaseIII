import * as fs from 'fs';
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

test.describe('CSV COPY TO / APPEND FROM', () => {

  test('COPY TO downloads a CSV with header + data', async ({ page }) => {
    const db = `e2e_csv_${Date.now()}`;

    await page.goto('/');
    await waitForOutput(page, 'Connected.', 8000);

    await cmd(page, `USE DATABASE ${db}`);
    await waitForOutput(page, 'Opened database', 3000);

    await cmd(page, 'CREATE TABLE orders (amount INTEGER, country CHARACTER)');
    await waitForOutput(page, 'created', 3000);

    await cmd(page, 'USE orders');
    await waitForOutput(page, 'orders', 2000);

    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE amount WITH 100, country WITH "BE"');
    await waitForOutput(page, 'replaced', 2000);

    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE amount WITH 250, country WITH "NL"');
    await waitForOutput(page, 'replaced', 2000);

    const downloadPromise = page.waitForEvent('download');
    await cmd(page, 'COPY TO orders.csv');
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('orders.csv');

    const p = await download.path();
    expect(p).toBeTruthy();
    const text = fs.readFileSync(p!, 'utf8');

    expect(text).toContain('AMOUNT');
    expect(text).toContain('COUNTRY');
    expect(text).toContain('100');
    expect(text).toContain('BE');
    expect(text).toContain('250');
    expect(text).toContain('NL');
  });

  test('APPEND FROM imports a CSV chosen via the file picker', async ({ page }) => {
    const db = `e2e_csv2_${Date.now()}`;

    await page.goto('/');
    await waitForOutput(page, 'Connected.', 8000);

    await cmd(page, `USE DATABASE ${db}`);
    await waitForOutput(page, 'Opened database', 3000);

    await cmd(page, 'CREATE TABLE people (name CHARACTER, age INTEGER)');
    await waitForOutput(page, 'created', 3000);

    await cmd(page, 'USE people');
    await waitForOutput(page, 'people', 2000);

    const fcPromise = page.waitForEvent('filechooser');
    await cmd(page, 'APPEND FROM people.csv');
    const fc = await fcPromise;
    await fc.setFiles({
      name: 'people.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('name,age\r\nAda,36\r\nBo,40'),
    });

    await waitForOutput(page, 'Appended 2 record(s)', 5000);

    await cmd(page, 'SUM age');
    await waitForOutput(page, '76', 3000);
  });

});
