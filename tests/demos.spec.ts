/**
 * Demo programs smoke test — auto-discovers all demos/*.prg files, saves each
 * into the program store via the EDIT UI, then runs DO <name> and verifies the
 * program starts without errors. Interactive programs are exited by submitting
 * "Q" on the first form that appears.
 *
 * To add a new demo: drop a .prg file in demos/ — no test code changes needed.
 */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEMOS_DIR  = path.join(__dirname, '..', 'demos');

const demos: { name: string; src: string }[] = fs
  .readdirSync(DEMOS_DIR)
  .filter(f => f.toLowerCase().endsWith('.prg'))
  .map(f => ({
    name: path.basename(f, path.extname(f)).toLowerCase(),
    src:  fs.readFileSync(path.join(DEMOS_DIR, f), 'utf8'),
  }));

// ── helpers ───────────────────────────────────────────────────────────────────

async function typeCmd(page: Page, cmd: string, waitMs = 600): Promise<void> {
  const input = page.locator('#terminal-input');
  await input.fill(cmd);
  await input.press('Enter');
  await page.waitForTimeout(waitMs);
}

async function saveProgram(page: Page, name: string, src: string): Promise<void> {
  await typeCmd(page, `EDIT ${name}`, 1500);
  await expect(page.locator('#editor-view')).toBeVisible({ timeout: 5000 });
  const editor = page.locator('#editor-textarea');
  await editor.fill(src);
  await page.waitForTimeout(300);
  const saveBtn = page.locator('button:has-text("Save"), #editor-save');
  if (await saveBtn.isVisible()) {
    await saveBtn.click();
  } else {
    await page.keyboard.press('Control+s');
  }
  await page.waitForTimeout(400);
  const closeBtn = page.locator('button:has-text("Close"), #editor-close');
  if (await closeBtn.isVisible()) {
    await closeBtn.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(400);
}

async function quitProgram(page: Page): Promise<void> {
  // If a form is visible, fill the first input with Q and submit
  const form = page.locator('#form-view');
  if (await form.isVisible({ timeout: 1000 }).catch(() => false)) {
    const input = form.locator('input.f-get').first();
    await input.fill('Q');
    const submit = form.locator('button[type=submit], .f-read-submit');
    if (await submit.isVisible()) {
      await submit.click();
    } else {
      await input.press('Enter');
    }
    await page.waitForTimeout(600);
  }
}

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe('Demo programs', () => {
  test.beforeAll(async ({ browser }) => {
    // Seed all demo programs into the store once before running any test
    const page = await browser.newPage();
    await page.goto('http://localhost:5173');
    await expect(page.locator('#terminal-output')).toContainText('Connected.', { timeout: 8000 });
    for (const demo of demos) {
      await saveProgram(page, demo.name, demo.src);
    }
    await page.close();
  });

  for (const demo of demos) {
    test(`${demo.name} — starts without errors`, async ({ page }) => {
      await page.goto('http://localhost:5173');
      await expect(page.locator('#terminal-output')).toContainText('Connected.', { timeout: 8000 });

      const outputBefore = (await page.locator('#terminal-output').textContent()) ?? '';
      await typeCmd(page, `DO ${demo.name}`, 1200);

      // Program either shows a form/menu or outputs to terminal — either is fine.
      // Wait a moment for any async output to settle.
      await page.waitForTimeout(800);

      // No error class should appear in terminal output for this program's run
      const newOutput = ((await page.locator('#terminal-output').textContent()) ?? '').slice(outputBefore.length);
      expect(newOutput).not.toMatch(/^\*\* /m);  // ** prefix = runtime error

      // Attempt a graceful quit if the program is waiting for input
      await quitProgram(page);
    });
  }

  test('seeded report definitions are available', async ({ page }) => {
    await page.goto('http://localhost:5173');
    await expect(page.locator('#terminal-output')).toContainText('Connected.', { timeout: 8000 });
    await typeCmd(page, 'LIST REPORTS', 800);
    await expect(page.locator('#terminal-output')).toContainText('dealsbystage', { timeout: 5000 });
    await expect(page.locator('#terminal-output')).toContainText('lowstock', { timeout: 5000 });
  });
});
