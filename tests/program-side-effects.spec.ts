/**
 * Regression e2e (hotfix v1.0.1): client side-effects (CSV download, report
 * preview) emitted by commands run *inside a program block* (DO WHILE / DO CASE
 * / IF) must still reach the browser. Before the fix the server did the work but
 * the download/preview never fired. Here we drive COPY TO from inside a DO WHILE
 * loop and assert the browser receives the download.
 */
import { test, expect, Page } from '@playwright/test';

async function cmd(page: Page, command: string, waitMs = 500): Promise<void> {
  const input = page.locator('#terminal-input');
  await input.fill(command);
  await input.press('Enter');
  await page.waitForTimeout(waitMs);
}

test('COPY TO inside a DO WHILE program triggers a browser download', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await expect(page.locator('#terminal-output')).toContainText('Connected.', { timeout: 8000 });

  const db = `e2e_se_${Date.now()}`;
  await cmd(page, `USE DATABASE ${db}`);
  await cmd(page, 'CREATE TABLE se_prog (name CHARACTER, qty INTEGER)');
  await cmd(page, 'USE se_prog');
  await cmd(page, 'APPEND RECORD');
  await cmd(page, 'REPLACE name WITH "Anvil", qty WITH 3');

  // Author a program that exports from inside a DO WHILE / DO CASE block.
  await cmd(page, 'EDIT se_runner', 1200);
  await expect(page.locator('#editor-view')).toBeVisible({ timeout: 6000 });
  const src = [
    'USE se_prog',
    'STORE .T. TO go',
    'DO WHILE go',
    '  DO CASE',
    '    CASE go',
    '      COPY TO se_prog.csv',
    '      STORE .F. TO go',
    '  ENDCASE',
    'ENDDO',
  ].join('\n');
  await page.locator('#editor-textarea').fill(src);
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  const downloadPromise = page.waitForEvent('download');
  await cmd(page, 'DO se_runner', 1000);
  const download = await downloadPromise;
  expect(download.suggestedFilename().toLowerCase()).toContain('se_prog');
});
