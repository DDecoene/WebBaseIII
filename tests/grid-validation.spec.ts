/** #45 — BROWSE per-cell validation, exercised in a real browser. */
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

/** Open the cell editor for a given row/column index. */
async function editCell(page: Page, ri: number, ci: number) {
  const td = page.locator(`#grid-tbody td[data-ri="${ri}"][data-ci="${ci}"]`);
  await td.dblclick();
  await expect(td.locator('input.cell-ed')).toBeVisible();
  return td;
}

test.describe('BROWSE cell validation', () => {
  test('rejects an invalid TIME(15) edit inline and commits a valid one', async ({ page }) => {
    await boot(page, `e2e_gridval_time_${Date.now()}`);
    await cmd(page, 'CREATE TABLE shifts (person CHAR(20), starttime TIME(15))');
    await cmd(page, 'USE shifts');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'BROWSE', 1000);
    await expect(page.locator('#grid-view')).toBeVisible({ timeout: 5000 });

    // Malformed time — rejected, cell stays in edit mode with a visible reason.
    const td = await editCell(page, 0, 1);
    await td.locator('input.cell-ed').fill('9:30');
    await page.keyboard.press('Enter');
    await expect(td).toHaveClass(/cell-invalid/);
    await expect(td.locator('.cell-error')).toContainText('HH:MM');
    // The cell has `overflow: hidden`, so the message can be present, styled
    // visible, and still clipped away from the user. toBeInViewport uses an
    // IntersectionObserver and therefore accounts for ancestor clipping;
    // toContainText / toBeVisible do not.
    await expect(td.locator('.cell-error')).toBeInViewport();
    await expect(td.locator('input.cell-ed')).toBeVisible();   // still editing

    // Off-granularity time — rejected for a different reason.
    await td.locator('input.cell-ed').fill('08:07');
    await page.keyboard.press('Enter');
    await expect(td).toHaveClass(/cell-invalid/);
    await expect(td.locator('.cell-error')).toContainText('multiple of 15');
    await expect(td.locator('input.cell-ed')).toBeVisible();

    // Valid quarter-hour — the error clears as you type and the edit commits.
    await td.locator('input.cell-ed').fill('08:15');
    await expect(td).not.toHaveClass(/cell-invalid/);
    await page.keyboard.press('Enter');
    await expect(td.locator('input.cell-ed')).toHaveCount(0);   // edit closed
    await expect(td).toContainText('08:15');

    // And it really landed in the database.
    await page.keyboard.press('Escape');
    await expect(page.locator('#terminal-view')).toBeVisible({ timeout: 5000 });
    await cmd(page, 'LIST');
    await expect(page.locator('#terminal-output')).toContainText('08:15');
  });

  test('rejects a bad NUM(8,2) and DATE edit, and an unconstrained CHAR accepts anything', async ({ page }) => {
    await boot(page, `e2e_gridval_types_${Date.now()}`);
    await cmd(page, 'CREATE TABLE t (name CHAR(20), price NUM(8,2), due DATE)');
    await cmd(page, 'USE t');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'BROWSE', 1000);
    await expect(page.locator('#grid-view')).toBeVisible({ timeout: 5000 });

    // CHAR is unconstrained — commits as typed.
    const name = await editCell(page, 0, 0);
    await name.locator('input.cell-ed').fill('anything at all');
    await page.keyboard.press('Enter');
    await expect(name).toContainText('anything at all');

    // NUM(8,2) — too many decimals.
    const price = await editCell(page, 0, 1);
    await price.locator('input.cell-ed').fill('1.234');
    await page.keyboard.press('Enter');
    await expect(price).toHaveClass(/cell-invalid/);
    await expect(price.locator('.cell-error')).toContainText('2 decimal');
    await price.locator('input.cell-ed').fill('1.23');
    await page.keyboard.press('Enter');
    await expect(price).toContainText('1.23');

    // DATE — not a real calendar date.
    const due = await editCell(page, 0, 2);
    await due.locator('input.cell-ed').fill('2023-02-29');
    await page.keyboard.press('Enter');
    await expect(due).toHaveClass(/cell-invalid/);
    await expect(due.locator('.cell-error')).toContainText('not a real date');
    await due.locator('input.cell-ed').fill('2024-02-29');
    await page.keyboard.press('Enter');
    await expect(due).toContainText('2024-02-29');
  });

  test('Escape abandons an invalid edit and restores the original value', async ({ page }) => {
    await boot(page, `e2e_gridval_esc_${Date.now()}`);
    await cmd(page, 'CREATE TABLE s (starttime TIME(15))');
    await cmd(page, 'USE s');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE starttime WITH "09:00"');
    await cmd(page, 'BROWSE', 1000);

    const td = await editCell(page, 0, 0);
    await td.locator('input.cell-ed').fill('99:99');
    await page.keyboard.press('Enter');
    await expect(td).toHaveClass(/cell-invalid/);

    await page.keyboard.press('Escape');            // abandon the edit
    await expect(td.locator('input.cell-ed')).toHaveCount(0);
    await expect(td).toContainText('09:00');        // original value intact
  });
});
