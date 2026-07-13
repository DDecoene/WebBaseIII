// Records the README demo GIF frames against a running server (:3000).
// Usage: node scripts/make-demo-gif.mjs   then: python3 scripts/make-demo-gif.py
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';

const OUT = '/tmp/wb3gif';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const frames = []; // { file, ms }
let n = 0;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 660 }, deviceScaleFactor: 1 });
await page.goto('http://localhost:3000');
await page.waitForSelector('#terminal-input');
await page.waitForTimeout(800);

const input = page.locator('#terminal-input');

async function run(cmd, settle = 350) {
  await input.fill(cmd);
  await input.press('Enter');
  await page.waitForTimeout(settle);
}

async function snap(ms) {
  const file = `${OUT}/frame-${String(n++).padStart(3, '0')}.png`;
  await page.screenshot({ path: file });
  frames.push({ file, ms });
}

async function typeAndRun(cmd, pauseAfter) {
  for (let i = 2; i <= cmd.length; i += 2) {
    await input.fill(cmd.slice(0, i));
    await snap(90);
  }
  await input.fill(cmd);
  await snap(250);
  await input.press('Enter');
  await page.waitForTimeout(500);
  await snap(pauseAfter);
}

// ---- setup (not recorded) ----
await run('USE DATABASE GIFDEMO');
await run('DROP TABLE customers');
await run('CREATE TABLE customers (name CHAR(30), city CHAR(20), founded INTEGER)');
const rows = [
  ['Ashton-Tate', 'Torrance', 1980],
  ['Borland Intl', 'Scotts Valley', 1983],
  ['Commodore', 'West Chester', 1954],
  ['Digital Research', 'Pacific Grove', 1974],
  ['Osborne Computing', 'Hayward', 1980],
  ['Tandy Corp', 'Fort Worth', 1977],
];
for (const [name, city, founded] of rows) {
  await run('APPEND RECORD');
  await run(`REPLACE name WITH "${name}", city WITH "${city}", founded WITH ${founded}`);
}
await run('INDEX ON name TO BYNAME');
await run('CLOSE');
await run('CLEAR', 600);

// ---- recorded session ----
await snap(900);
await typeAndRun('USE customers', 1300);
await typeAndRun('LIST', 2600);
await typeAndRun('AVERAGE founded', 2000);
await typeAndRun('? ROUND(1974.6667, 0)', 1800);
await typeAndRun('SORT ON founded TO byyear', 2000);
await typeAndRun('SEEK "Tandy Corp"', 1800);
await typeAndRun('BROWSE', 1200);
// a little life inside the grid
for (const key of ['ArrowDown', 'ArrowDown', 'ArrowRight']) {
  await page.keyboard.press(key);
  await page.waitForTimeout(150);
  await snap(450);
}
await snap(1200);

// ---- v1.3.0: LOOKUP columns — a column can pick from a list instead of typing ----
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await snap(500);
await typeAndRun('ALTER TABLE customers ADD SEGMENT CHAR(10) LOOKUP ("Startup","Enterprise")', 1600);
await typeAndRun('BROWSE', 1200);
for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight']) {
  await page.keyboard.press(key);
  await page.waitForTimeout(150);
  await snap(350);
}
await page.keyboard.press('Enter');     // opens the SEGMENT dropdown
await page.waitForTimeout(300);
await snap(1400);
await page.keyboard.press('ArrowDown'); // picks "Startup"
await page.waitForTimeout(150);
await snap(500);
await page.keyboard.press('Enter');     // commits
await page.waitForTimeout(300);
await snap(1400);
await page.keyboard.press('Escape');    // leave the grid
await page.waitForTimeout(300);
await snap(3000); // hold final frame

writeFileSync(`${OUT}/frames.json`, JSON.stringify(frames, null, 2));
await browser.close();
console.log(`captured ${frames.length} frames in ${OUT}`);
