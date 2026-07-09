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

// Run `? <expr>` and return the printed value — the last rendered output line,
// which is the result rather than the echoed command.
async function printResult(page: Page, expr: string): Promise<string> {
  await cmd(page, `? ${expr}`);
  const text = await page.locator('#terminal-output .t-line').last().textContent() ?? '';
  return text.trim();
}

test.describe('Parity commands e2e', () => {

  test('1. ? / ?? print expressions', async ({ page }) => {
    await boot(page, `e2e_parity_print_${Date.now()}`);

    await cmd(page, '? 2 + 2');
    await waitForOutput(page, '4', 3000);

    await cmd(page, '? UPPER("hi")');
    await waitForOutput(page, 'HI', 3000);

    await cmd(page, '? "hello"');
    await waitForOutput(page, 'hello', 3000);
  });

  // #4 (PR #17, @kas2804) built-ins — exercised end-to-end through the REPL.
  test('2. Built-in functions via ?', async ({ page }) => {
    await boot(page, `e2e_parity_builtins_${Date.now()}`);

    await cmd(page, '? ROUND(3.14159, 2)');
    await waitForOutput(page, '3.14', 3000);

    await cmd(page, '? MOD(17, 5)');
    await waitForOutput(page, '2', 3000);

    await cmd(page, '? MAX(3, 9)');
    await waitForOutput(page, '9', 3000);

    await cmd(page, '? MIN(3, 9)');
    await waitForOutput(page, '3', 3000);

    await cmd(page, '? YEAR(CTOD("12/25/2026"))');
    await waitForOutput(page, '2026', 3000);

    await cmd(page, '? MONTH(CTOD("12/25/2026"))');
    await waitForOutput(page, '12', 3000);

    await cmd(page, '? DAY(CTOD("12/25/2026"))');
    await waitForOutput(page, '25', 3000);

    // TIME() -> HH:MM:SS
    await cmd(page, '? TIME()');
    await expect(page.locator('#terminal-output')).toContainText(/\d\d:\d\d:\d\d/, { timeout: 3000 });
  });

  // #44 — WEEK() ISO-8601 week number, asserted on the printed value (not just
  // "the digits appear somewhere in the scrollback").
  test('2b. WEEK() built-in via ?', async ({ page }) => {
    await boot(page, `e2e_parity_week_${Date.now()}`);

    expect(await printResult(page, 'WEEK("2024-05-12")')).toBe('19');

    // Week 1 is the week holding the year's first Thursday.
    expect(await printResult(page, 'WEEK("2026-01-01")')).toBe('1');

    // Early January can fall in the previous year's last week …
    expect(await printResult(page, 'WEEK("2021-01-01")')).toBe('53');
    expect(await printResult(page, 'WEEK("2023-01-01")')).toBe('52');

    // … and late December in week 1 of the next.
    expect(await printResult(page, 'WEEK("2024-12-30")')).toBe('1');

    // Composes with CTOD, like the other date built-ins.
    expect(await printResult(page, 'WEEK(CTOD("05/12/24"))')).toBe('19');
  });

  test('3. SUM and AVERAGE', async ({ page }) => {
    const db = `e2e_parity_sum_${Date.now()}`;
    await boot(page, db);

    await cmd(page, 'DROP TABLE orders');
    await page.waitForTimeout(500);

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

    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE amount WITH 900, country WITH "BE"');
    await waitForOutput(page, 'replaced', 2000);

    await cmd(page, 'SUM amount');
    await waitForOutput(page, '1250', 3000);

    await cmd(page, 'AVERAGE amount FOR country == "BE"');
    await waitForOutput(page, '500', 3000);
  });

  test('4. SORT ON ... TO creates sorted copy', async ({ page }) => {
    const db = `e2e_parity_sort_${Date.now()}`;
    await boot(page, db);

    await cmd(page, 'DROP TABLE sortbase');
    await page.waitForTimeout(300);
    await cmd(page, 'DROP TABLE sorted_t');
    await page.waitForTimeout(300);

    await cmd(page, 'CREATE TABLE sortbase (amount INTEGER)');
    await waitForOutput(page, 'created', 3000);

    await cmd(page, 'USE sortbase');
    await waitForOutput(page, 'sortbase', 2000);

    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE amount WITH 900');
    await waitForOutput(page, 'replaced', 2000);

    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE amount WITH 100');
    await waitForOutput(page, 'replaced', 2000);

    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE amount WITH 500');
    await waitForOutput(page, 'replaced', 2000);

    await cmd(page, 'SORT ON amount TO sorted_t');
    await waitForOutput(page, 'sorted', 3000);

    await cmd(page, 'USE sorted_t');
    await waitForOutput(page, 'sorted_t', 2000);

    await cmd(page, 'LIST');
    await page.waitForTimeout(1000);

    const text = await page.locator('#terminal-output').textContent() ?? '';
    const i100 = text.lastIndexOf('100');
    const i500 = text.lastIndexOf('500');
    const i900 = text.lastIndexOf('900');
    expect(i100).toBeGreaterThan(-1);
    expect(i500).toBeGreaterThan(-1);
    expect(i900).toBeGreaterThan(-1);
    expect(i100).toBeLessThan(i500);
    expect(i500).toBeLessThan(i900);
  });

});
