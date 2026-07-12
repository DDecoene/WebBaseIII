/**
 * Regenerates all docs/screenshots/*.png against a running dev server.
 * Usage: node scripts/capture-screenshots.mjs
 * Requires: dev server on http://localhost:5173 (npm run dev)
 */
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, '../docs/screenshots');
mkdirSync(OUT, { recursive: true });

const BASE = 'http://localhost:5173';

const browser = await chromium.launch();

async function newPage(w = 1100, h = 720) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  return page;
}

async function boot(page) {
  await page.goto(BASE);
  await page.waitForSelector('#terminal-input', { timeout: 10000 });
  await page.waitForFunction(
    () => document.querySelector('#terminal-output')?.textContent?.includes('Connected.'),
    { timeout: 12000 }
  );
  await page.waitForTimeout(400);
}

async function cmd(page, command, waitMs = 700) {
  await page.fill('#terminal-input', command);
  await page.press('#terminal-input', 'Enter');
  await page.waitForTimeout(waitMs);
}

async function waitFor(page, text, timeout = 6000) {
  await page.waitForFunction(
    (t) => document.querySelector('#terminal-output')?.textContent?.toLowerCase().includes(t.toLowerCase()),
    text,
    { timeout }
  );
}

async function snap(page, name) {
  const path = `${OUT}/${name}`;
  await page.screenshot({ path, fullPage: false });
  console.log(`  -> ${name}`);
}

// ── 1. screenshot-terminal.png ─────────────────────────────────────────────
console.log('1. terminal (splash + version banner)');
{
  const page = await newPage();
  await boot(page);
  await snap(page, 'screenshot-terminal.png');
  await page.close();
}

// ── 2. screenshot-list.png ─────────────────────────────────────────────────
console.log('2. LIST output with rows');
{
  const page = await newPage();
  await boot(page);
  await cmd(page, 'USE DATABASE screenshotdb', 800);
  await cmd(page, 'DROP TABLE products', 600);
  await cmd(page, 'CREATE TABLE products (name CHAR(30), price FLOAT, qty INTEGER)', 800);
  await waitFor(page, 'created');
  await cmd(page, 'USE products', 500);
  for (const [n, p, q] of [
    ['Widget A', 9.99, 100], ['Gadget B', 24.50, 45],
    ['Doohickey C', 4.75, 200], ['Thingamajig D', 49.00, 10],
    ['Whatsit E', 14.99, 75],
  ]) {
    await cmd(page, 'APPEND RECORD', 400);
    await cmd(page, `REPLACE name WITH "${n}", price WITH ${p}, qty WITH ${q}`, 600);
  }
  await cmd(page, 'LIST', 800);
  await waitFor(page, 'Widget');
  await snap(page, 'screenshot-list.png');
  await page.close();
}

// ── 3. screenshot-index.png ────────────────────────────────────────────────
console.log('3. INDEX ON + SEEK');
{
  const page = await newPage();
  await boot(page);
  await cmd(page, 'USE DATABASE screenshotdb', 800);
  await cmd(page, 'USE products', 500);
  await cmd(page, 'INDEX ON name TO BYNAME', 800);
  await waitFor(page, 'Index created');
  await cmd(page, 'LIST', 700);
  await waitFor(page, 'Gadget');
  await cmd(page, 'SEEK "Widget A"', 600);
  await snap(page, 'screenshot-index.png');
  await page.close();
}

// ── 4. screenshot-browse.png ───────────────────────────────────────────────
console.log('4. BROWSE grid');
{
  const page = await newPage();
  await boot(page);
  await cmd(page, 'USE DATABASE screenshotdb', 800);
  await cmd(page, 'USE products', 500);
  await cmd(page, 'BROWSE', 800);
  await page.waitForSelector('#grid-view', { state: 'visible', timeout: 6000 });
  await page.waitForTimeout(400);
  await snap(page, 'screenshot-browse.png');
  await page.keyboard.press('Escape');
  await page.close();
}

// ── 5. screenshot-program-editor.png ──────────────────────────────────────
console.log('5. Program editor with source');
{
  const page = await newPage();
  await boot(page);
  await cmd(page, 'USE DATABASE screenshotdb', 800);
  await cmd(page, 'EDIT inventory', 1000); // a real seeded program (demos/INVENTORY.prg) — not a blank new buffer
  await page.waitForSelector('#editor-view', { state: 'visible', timeout: 6000 });
  await page.waitForTimeout(700);          // let the .prg source render into the editor
  await snap(page, 'screenshot-program-editor.png');
  await page.keyboard.press('Escape');
  await page.close();
}

// ── 6. screenshot-editor-empty.png ────────────────────────────────────────
console.log('6. Empty program editor (new program)');
{
  const page = await newPage();
  await boot(page);
  await cmd(page, 'EDIT newprogram', 800);
  await page.waitForSelector('#editor-view', { state: 'visible', timeout: 6000 });
  await page.waitForTimeout(400);
  await snap(page, 'screenshot-editor-empty.png');
  await page.keyboard.press('Escape');
  await page.close();
}

// ── 7. screenshot-form.png ─────────────────────────────────────────────────
console.log('7. @ SAY GET form');
{
  const page = await newPage();
  await boot(page);
  await cmd(page, 'USE DATABASE screenshotdb', 800);
  await cmd(page, 'STORE "" TO custname', 400);
  await cmd(page, 'STORE 0 TO custage', 400);
  await cmd(page, '@ 2,5 SAY "Customer Name:" GET custname', 400);
  await cmd(page, '@ 4,5 SAY "Age:" GET custage', 400);
  await cmd(page, 'READ', 600);
  await page.waitForSelector('#form-view', { state: 'visible', timeout: 6000 });
  await page.waitForTimeout(500);
  await snap(page, 'screenshot-form.png');
  // submit the form to unblock
  await page.keyboard.press('Tab');
  await page.waitForTimeout(300);
  // look for submit button
  const submitBtn = page.locator('#form-view button, #form-view [type=submit]').first();
  if (await submitBtn.isVisible().catch(() => false)) {
    await submitBtn.click();
  } else {
    await page.keyboard.press('Escape');
  }
  await page.close();
}

// ── 8. screenshot-assistant.png ────────────────────────────────────────────
console.log('8. Assistant sidebar');
{
  const page = await newPage();
  await boot(page);
  await cmd(page, 'USE DATABASE screenshotdb', 800);
  await cmd(page, 'USE products', 600);
  await page.waitForSelector('#assistant-sidebar', { state: 'visible', timeout: 6000 });
  await page.waitForTimeout(300);
  await snap(page, 'screenshot-assistant.png');
  await page.close();
}

// ── 9. screenshot-assistant-wizard.png ────────────────────────────────────
console.log('9. New table wizard');
{
  const page = await newPage();
  await boot(page);
  await cmd(page, 'USE DATABASE screenshotdb', 800);
  // click "New table…" action in sidebar
  await page.locator('#assistant-sidebar .as-action', { hasText: 'New table' }).first().click();
  await page.waitForSelector('#wizard-view', { state: 'visible', timeout: 6000 });
  // Fill in some example data so it looks populated
  await page.locator('#wz-table-name').fill('orders');
  await page.locator('.wz-col-name').first().fill('CUSTOMER');
  await page.locator('.wz-col-type').first().selectOption('CHAR');
  await page.locator('.wz-col-len').first().fill('40');
  await page.waitForTimeout(300);
  await snap(page, 'screenshot-assistant-wizard.png');
  await page.keyboard.press('Escape');
  await page.close();
}

// ── 10. screenshot-repl-session.png ───────────────────────────────────────
console.log('10. Fuller REPL session');
{
  const page = await newPage();
  await boot(page);
  await cmd(page, 'USE DATABASE screenshotdb', 800);
  await cmd(page, 'LIST TABLES', 700);
  await waitFor(page, 'products');
  await cmd(page, 'USE products', 500);
  await cmd(page, 'LIST STRUCTURE', 600);
  await waitFor(page, 'name');
  await cmd(page, 'GO TOP', 400);
  await cmd(page, 'LIST', 700);
  await waitFor(page, 'Widget');
  await snap(page, 'screenshot-repl-session.png');
  await page.close();
}

// ── 11. screenshot-parity.png (NEW) ───────────────────────────────────────
console.log('11. NEW: parity commands (ROUND, MAX, SUM, AVERAGE, SORT ON)');
{
  const page = await newPage();
  await boot(page);
  await cmd(page, 'USE DATABASE screenshotdb', 800);
  await cmd(page, 'USE products', 600);
  await cmd(page, '? ROUND(3.14159, 2)', 700);
  await cmd(page, '? MAX(3, 9)', 600);
  await cmd(page, 'SUM price', 700);
  await cmd(page, 'AVERAGE qty', 700);
  // DROP target if it already exists from a prior run
  await cmd(page, 'DROP TABLE sorted_products', 600);
  await cmd(page, 'SORT ON price TO sorted_products', 1000);
  await waitFor(page, 'Sorted');
  await snap(page, 'screenshot-parity.png');
  await page.close();
}

// ── 12. screenshot-modify-structure.png (NEW) ─────────────────────────────
console.log('12. NEW: MODIFY STRUCTURE wizard');
{
  const page = await newPage();
  await boot(page);
  await cmd(page, 'USE DATABASE screenshotdb', 800);
  await cmd(page, 'USE products', 600);
  await cmd(page, 'MODIFY STRUCTURE', 800);
  await page.waitForSelector('#wizard-view', { state: 'visible', timeout: 8000 });
  await page.waitForTimeout(500);
  await snap(page, 'screenshot-modify-structure.png');
  await page.keyboard.press('Escape');
  await page.close();
}

// ── 13. screenshot-csv.png (NEW) ──────────────────────────────────────────
console.log('13. NEW: COPY TO CSV output');
{
  const page = await newPage();
  await boot(page);
  await cmd(page, 'USE DATABASE screenshotdb', 800);
  await cmd(page, 'USE products', 600);
  // COPY TO triggers a download — we just capture the terminal output
  const downloadPromise = page.waitForEvent('download').catch(() => null);
  await cmd(page, 'COPY TO products.csv', 1000);
  await downloadPromise;
  await waitFor(page, 'copied');
  await snap(page, 'screenshot-csv.png');
  await page.close();
}

// ── 14. screenshot-grid-validation.png (NEW in v1.2.0) ────────────────────
console.log('14. NEW: BROWSE per-cell validation rejecting a TIME(15) edit');
{
  const page = await newPage();
  await boot(page);
  await cmd(page, 'USE DATABASE screenshotdb', 800);
  await cmd(page, 'DROP TABLE shifts', 400);
  await cmd(page, 'CREATE TABLE shifts (PERSON CHAR(20), STARTTIME TIME(15), DUE DATE)', 700);
  await cmd(page, 'USE shifts', 500);
  await cmd(page, 'APPEND RECORD', 500);
  await cmd(page, 'REPLACE PERSON WITH "Ada Lovelace", STARTTIME WITH "08:15"', 700);
  await cmd(page, 'BROWSE', 1200);
  await page.waitForSelector('#grid-view:not(.hidden)', { timeout: 8000 });

  // Type an off-quarter time into the TIME(15) column and let the grid reject it.
  const td = page.locator('#grid-tbody td[data-ri="0"][data-ci="1"]');
  await td.dblclick();
  await td.locator('input.cell-ed').fill('08:07');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#grid-tbody td.cell-invalid .cell-error', { timeout: 5000 });
  await page.waitForTimeout(300);
  await snap(page, 'screenshot-grid-validation.png');
  await page.close();
}

// ── 15. screenshot-lookup-browse.png (NEW in v1.3.0) ──────────────────────
console.log('15. NEW: BROWSE editing a LOOKUP column via dropdown');
{
  const page = await newPage();
  await boot(page);
  await cmd(page, 'USE DATABASE screenshotdb', 800);
  await cmd(page, 'DROP TABLE schedules', 400);
  await cmd(page, 'DROP TABLE staff', 400);
  await cmd(page, 'CREATE TABLE schedules (SCHEDID CHAR(4), DESCR CHAR(30))', 700);
  await cmd(page, 'USE schedules', 500);
  await cmd(page, 'APPEND RECORD', 400);
  await cmd(page, 'REPLACE SCHEDID WITH "S001", DESCR WITH "Standard 40h (08:00-16:30)"', 600);
  await cmd(page, 'APPEND RECORD', 400);
  await cmd(page, 'REPLACE SCHEDID WITH "S002", DESCR WITH "Short 31.25h (09:00-16:00)"', 600);
  await cmd(page, 'CREATE TABLE staff (NAME CHAR(30), SCHEDID CHAR(4) LOOKUP SCHEDULES.SCHEDID DISPLAY DESCR)', 700);
  await cmd(page, 'USE staff', 500);
  await cmd(page, 'APPEND RECORD', 500);
  await cmd(page, 'REPLACE NAME WITH "Ada Lovelace", SCHEDID WITH "S001"', 500);
  await cmd(page, 'BROWSE', 1200);
  await page.waitForSelector('#grid-view:not(.hidden)', { timeout: 8000 });

  const td = page.locator('#grid-tbody td[data-ri="0"][data-ci="1"]');
  await td.dblclick();
  await page.waitForSelector('#grid-tbody select.cell-ed', { timeout: 5000 });
  await page.waitForTimeout(300);
  await snap(page, 'screenshot-lookup-browse.png');
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await page.close();
}

// ── 16. screenshot-lookup-form.png (NEW in v1.3.0) ────────────────────────
console.log('16. NEW: field-bound GET rendering a LOOKUP picker in a form');
{
  const page = await newPage();
  await boot(page);
  await cmd(page, 'USE DATABASE screenshotdb', 800);
  await cmd(page, 'USE staff', 500);
  await cmd(page, '@ 2, 5 SAY "Name    : " GET NAME', 300);
  await cmd(page, '@ 3, 5 SAY "Schedule: " GET SCHEDID', 300);
  await cmd(page, 'READ', 900);
  await page.waitForSelector('#form-view', { state: 'visible', timeout: 6000 });
  await page.waitForSelector('#form-view select.f-get', { timeout: 5000 });
  await page.waitForTimeout(400);
  await snap(page, 'screenshot-lookup-form.png');
  await page.keyboard.press('Escape');
  await page.close();
}

await browser.close();
console.log('\nDone. All screenshots written to docs/screenshots/');
