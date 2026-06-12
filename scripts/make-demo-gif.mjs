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
await run('CREATE TABLE customers (name CHAR(30), city CHAR(20), phone CHAR(12))');
const rows = [
  ['Ashton-Tate', 'Torrance', '555-1981'],
  ['Borland Intl', 'Scotts Valley', '555-1983'],
  ['Commodore', 'West Chester', '555-1982'],
  ['Digital Research', 'Pacific Grove', '555-1976'],
  ['Osborne Computing', 'Hayward', '555-1980'],
  ['Tandy Corp', 'Fort Worth', '555-1977'],
];
for (const [name, city, phone] of rows) {
  await run('APPEND RECORD');
  await run(`REPLACE name WITH "${name}", city WITH "${city}", phone WITH "${phone}"`);
}
await run('INDEX ON name TO BYNAME');
await run('CLOSE');
await run('CLEAR', 600);

// ---- recorded session ----
await snap(900);
await typeAndRun('USE customers', 1300);
await typeAndRun('LIST', 2600);
await typeAndRun('SEEK "Tandy Corp"', 1800);
await typeAndRun('BROWSE', 1200);
// a little life inside the grid
for (const key of ['ArrowDown', 'ArrowDown', 'ArrowRight']) {
  await page.keyboard.press(key);
  await page.waitForTimeout(150);
  await snap(450);
}
await snap(3200); // hold final frame

writeFileSync(`${OUT}/frames.json`, JSON.stringify(frames, null, 2));
await browser.close();
console.log(`captured ${frames.length} frames in ${OUT}`);
