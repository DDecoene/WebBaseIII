/** Playwright E2E for demos/overtime.prg — overtime tracker showcase (#46). */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRG_SRC = fs.readFileSync(path.join(__dirname, '..', 'demos', 'overtime.prg'), 'utf8');
const PRG_NAME = 'overtime';
const WEEK = '2026-07-06';          // a Monday; ISO week 28

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
/** Submit the menu's GET field (or any single-field form). */
async function menuChoice(page: Page, choice: string, waitMs = 1500): Promise<void> {
  await expect(page.locator('#form-view')).toBeVisible({ timeout: 6000 });
  const input = page.locator('#form-view input.f-get').last();
  await input.fill(choice);
  await input.press('Enter');
  await page.waitForTimeout(waitMs);
}
/** Fill the visible form's GET fields in order, then submit. */
async function fillForm(page: Page, values: string[], waitMs = 1500): Promise<void> {
  await expect(page.locator('#form-view')).toBeVisible({ timeout: 6000 });
  const fields = page.locator('#form-view input.f-get');
  for (let i = 0; i < values.length; i++) await fields.nth(i).fill(values[i]);
  await fields.nth(values.length - 1).press('Enter');
  await page.waitForTimeout(waitMs);
}
/** In the open TIMESHEET grid, make Friday (row 5) finish 2h late. */
async function workLateOnFriday(page: Page): Promise<void> {
  await expect(page.locator('#grid-view')).toBeVisible({ timeout: 6000 });
  // TIMESHEET columns: EMPID(0) WEEKDATE(1) DOW(2) WORKDATE(3) TIMEIN(4) BSTART(5) BEND(6) TIMEOUT(7)
  const td = page.locator('#grid-tbody td[data-ri="4"][data-ci="7"]');
  await td.dblclick();
  await td.locator('input.cell-ed').fill('18:30');
  await page.keyboard.press('Enter');
  await expect(td).toContainText('18:30');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');          // leave grid, back to the menu
  await page.waitForTimeout(1200);
}

/** Dismiss an "Press Enter to continue" INPUT prompt. */
async function ack(page: Page, waitMs = 1000): Promise<void> {
  const form = page.locator('#form-view');
  if (await form.isVisible({ timeout: 1500 }).catch(() => false)) {
    const input = form.locator('input.f-get').last();
    await input.fill('');
    await input.press('Enter');
    await page.waitForTimeout(waitMs);
  }
}

test.describe('Overtime demo', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    await seedProgram(page);
    // Clean slate: the OVERTIME database persists server-side across suites.
    await cmd(page, 'USE DATABASE OVERTIME');
    for (const t of ['EMPLOYEES', 'SCHEDULEDAYS', 'TIMESHEET', 'WEEKSUMMARY', 'LEAVETAKEN']) {
      await cmd(page, `DROP TABLE ${t}`, 150);
    }
    await cmd(page, `DO ${PRG_NAME}`, 2000);
  });

  test('runs and shows the main menu', async ({ page }) => {
    await expect(page.locator('#form-view')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#form-view')).toContainText('OVERTIME TRACKER', { timeout: 6000 });
  });

  test('seeds two employees on different schedules', async ({ page }) => {
    await menuChoice(page, '9');                 // table tour → LIST to the terminal
    // Assert before dismissing: the menu loop's CLEAR wipes the terminal on its
    // next iteration, and the form overlay is merely covering it, not clearing it.
    await expect(page.locator('#terminal-output')).toContainText('Ada Lovelace');
    await expect(page.locator('#terminal-output')).toContainText('Grace Hopper');
    await expect(page.locator('#terminal-output')).toContainText('S002');
    await ack(page);
  });

  test('prep week derives Mon-Fri work dates with DATEADD and shows the ISO week', async ({ page }) => {
    await menuChoice(page, '3');
    await fillForm(page, ['E001', WEEK], 2000);
    // WEEK("2026-07-06") == 28, rendered in the form next to its label.
    await expect(page.locator('#form-view')).toContainText('28', { timeout: 6000 });
    await expect(page.locator('#form-view')).toContainText(/created 5 timesheet days/i, { timeout: 6000 });

    await ack(page, 1500);                       // "Press Enter to edit this week" → BROWSE
    await expect(page.locator('#grid-view')).toBeVisible({ timeout: 6000 });
    // DATEADD walked Monday..Friday.
    await expect(page.locator('#grid-tbody')).toContainText('2026-07-06');
    await expect(page.locator('#grid-tbody')).toContainText('2026-07-10');
    // Leaving the grid resumes the program, so the menu comes back — not the terminal.
    await page.keyboard.press('Escape');
    await expect(page.locator('#form-view')).toContainText('OVERTIME TRACKER', { timeout: 6000 });
  });

  test('the schedule grid rejects an off-quarter TIME(15) edit', async ({ page }) => {
    await menuChoice(page, '2');
    await ack(page, 1500);                       // "Press Enter to open the grid"
    await expect(page.locator('#grid-view')).toBeVisible({ timeout: 6000 });

    // TIMEIN is column index 2 (SCHEDID, DOW, TIMEIN, ...).
    const td = page.locator('#grid-tbody td[data-ri="0"][data-ci="2"]');
    await td.dblclick();
    await td.locator('input.cell-ed').fill('08:07');
    await page.keyboard.press('Enter');
    await expect(td).toHaveClass(/cell-invalid/);
    await expect(td.locator('.cell-error')).toContainText('multiple of 15');

    await td.locator('input.cell-ed').fill('08:15');
    await page.keyboard.press('Enter');
    await expect(td).toContainText('08:15');
    await page.keyboard.press('Escape');
  });

  test('recalculate computes worked, standard and overtime hours', async ({ page }) => {
    await menuChoice(page, '3');
    await fillForm(page, ['E001', WEEK], 2000);
    await ack(page, 1500);                       // → BROWSE the new week
    await workLateOnFriday(page);                // 16:30 → 18:30, through the validated grid

    await menuChoice(page, '4');
    await fillForm(page, ['E001', WEEK], 2500);

    // 4 x 8.00 + 10.00 = 42.00 worked; schedule S001 = 40.00 standard; +2.00 overtime.
    const form = page.locator('#form-view');
    await expect(form).toContainText('42.00', { timeout: 6000 });
    await expect(form).toContainText('40.00', { timeout: 6000 });
    await expect(form).toContainText('2.00', { timeout: 6000 });
  });

  test('overtime balance = banked overtime minus leave taken', async ({ page }) => {
    // Bank 2h of overtime first.
    await menuChoice(page, '3');
    await fillForm(page, ['E001', WEEK], 2000);
    await ack(page, 1500);
    await workLateOnFriday(page);

    await menuChoice(page, '4');
    await fillForm(page, ['E001', WEEK], 2500);
    await ack(page, 1200);

    // Take 1.5h of leave.
    await menuChoice(page, '5');
    await fillForm(page, ['E001', '2026-07-13', '1.5', 'early friday'], 2000);
    await expect(page.locator('#form-view')).toContainText(/leave registered/i, { timeout: 6000 });
    await ack(page, 1200);

    // Balance = 2.00 banked - 1.50 taken = 0.50
    await menuChoice(page, '6');
    await fillForm(page, ['E001'], 2000);
    const form = page.locator('#form-view');
    await expect(form).toContainText('2.00', { timeout: 6000 });   // banked
    await expect(form).toContainText('1.50', { timeout: 6000 });   // taken
    await expect(form).toContainText('0.50', { timeout: 6000 });   // balance
  });

  test('leave form rejects hours that are not a quarter-hour step', async ({ page }) => {
    await menuChoice(page, '5');
    await fillForm(page, ['E001', '2026-07-13', '1.3', 'bad step'], 2000);
    await expect(page.locator('#form-view')).toContainText(/not a quarter-hour step/i, { timeout: 6000 });
  });

  test('overtime report renders grouped by employee', async ({ page }) => {
    await menuChoice(page, '3');
    await fillForm(page, ['E001', WEEK], 2000);
    await ack(page, 1500);
    await workLateOnFriday(page);
    await menuChoice(page, '4');
    await fillForm(page, ['E001', WEEK], 2500);
    await ack(page, 1200);

    await menuChoice(page, '7', 2500);
    // Assert before the menu's next CLEAR wipes the terminal.
    await expect(page.locator('#terminal-output')).toContainText('Overtime by Employee', { timeout: 6000 });
    await expect(page.locator('#terminal-output')).toContainText('E001');
  });

  test('exports the week summary to CSV', async ({ page }) => {
    await menuChoice(page, '3');
    await fillForm(page, ['E001', WEEK], 2000);
    await ack(page, 1500);
    await workLateOnFriday(page);
    await menuChoice(page, '4');
    await fillForm(page, ['E001', WEEK], 2500);
    await ack(page, 1200);

    const download = page.waitForEvent('download', { timeout: 10000 });
    await menuChoice(page, '8', 2000);
    const file = await download;
    expect(file.suggestedFilename()).toBe('weeksummary.csv');
  });
});
