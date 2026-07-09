/** #50 — CREATE TABLE fails loudly on malformed input instead of inventing columns. */
import { test, expect, Page } from '@playwright/test';

async function cmd(page: Page, command: string, waitMs = 600): Promise<void> {
  const input = page.locator('#terminal-input');
  await input.fill(command);
  await input.press('Enter');
  await page.waitForTimeout(waitMs);
}

async function boot(page: Page, db: string): Promise<void> {
  await page.goto('/');
  await expect(page.locator('#terminal-output')).toContainText('Connected.', { timeout: 8000 });
  await cmd(page, `USE DATABASE ${db}`);
}

test.describe('CREATE TABLE schema errors', () => {
  test('a malformed column list reports an error in the REPL', async ({ page }) => {
    await boot(page, `e2e_schema_err_${Date.now()}`);

    await cmd(page, 'CREATE TABLE bad (a CHAR(10) b INT)');   // missing comma
    await expect(page.locator('#terminal-output')).toContainText('Parse error');
    await expect(page.locator('#terminal-output')).toContainText("expected ')'");
    await expect(page.locator('#terminal-output')).toContainText("table 'BAD'");

    // The table must not exist — a failed parse creates nothing.
    await cmd(page, 'LIST TABLES');
    await expect(page.locator('#terminal-output')).toContainText('(No tables)');
  });

  test('NUM(p,s) creates exactly the declared columns — no phantom "2"', async ({ page }) => {
    await boot(page, `e2e_schema_nps_${Date.now()}`);

    await cmd(page, 'CREATE TABLE prod (name CHAR(20), price NUM(8,2), active LOGICAL)');
    await cmd(page, 'USE prod');
    await cmd(page, 'LIST STRUCTURE', 900);

    const text = await page.locator('#terminal-output').textContent() ?? '';
    expect(text).toContain('NAME');
    expect(text).toContain('PRICE');
    expect(text).toContain('ACTIVE');
    expect(text).toContain('NUM(8,2)');

    // Exactly three columns: the structure listing numbers them 1..n.
    const rows = await page.locator('#terminal-output .t-line').allTextContents();
    const numbered = rows.filter(l => /^\s*\d+\s+\w+/.test(l) && !/record/i.test(l));
    expect(numbered).toHaveLength(3);
  });
});

test.describe('INPUT at the REPL', () => {
  // A bare `INPUT … TO var` produces no continuation, and the submitted value used
  // to be discarded. It only worked inside a program, where a following statement
  // happened to create one. (#50)
  test('a bare INPUT stores the submitted value in the variable', async ({ page }) => {
    await boot(page, `e2e_input_${Date.now()}`);

    await cmd(page, 'INPUT "Name? " TO who');
    await expect(page.locator('#form-view')).toBeVisible({ timeout: 5000 });

    const field = page.locator('#form-view input.f-get').last();
    await field.fill('Ada');
    await field.press('Enter');
    await expect(page.locator('#form-view')).toBeHidden({ timeout: 5000 });

    await cmd(page, '? who');
    const last = await page.locator('#terminal-output .t-line').last().textContent();
    expect(last?.trim()).toBe('Ada');
  });
});
