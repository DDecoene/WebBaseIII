import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

const { version } = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'package.json'), 'utf-8')
);

test('splash screen shows version from package.json', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await expect(page.locator('#terminal-output')).toContainText('Connected.', { timeout: 8000 });

  const splash = await page.locator('#terminal-output').textContent();
  console.log('Version from package.json:', version);
  console.log('Splash text sample:', splash?.slice(0, 300));

  // Status bar version badge
  const statusVersion = await page.locator('#status-version').textContent();
  console.log('Status bar version:', statusVersion);
  expect(statusVersion).toBe(`v${version}`);

  // Splash banner in terminal output
  expect(splash).toContain(version);
});

test('splash advertises the demo example apps', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await expect(page.locator('#terminal-output')).toContainText('Connected.', { timeout: 8000 });
  await expect(page.locator('#terminal-output')).toContainText('DO crm', { timeout: 8000 });
  await expect(page.locator('#terminal-output')).toContainText('DO inventory', { timeout: 8000 });
});
