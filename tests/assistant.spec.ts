/** Playwright E2E for the Assistant sidebar (v0.6.0). Requires dev server on :5173. */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page): Promise<void> {
  await page.goto('http://localhost:5173');
  await expect(page.locator('#terminal-output')).toContainText('Connected.', { timeout: 8000 });
}

async function clickAction(page: Page, label: string): Promise<void> {
  await page.locator('#assistant-sidebar .as-action', { hasText: label }).first().click();
}

test.describe('Assistant sidebar', () => {
  test('renders categories and collapses', async ({ page }) => {
    await boot(page);
    const sb = page.locator('#assistant-sidebar');
    await expect(sb).toBeVisible();
    for (const cat of ['Database', 'Tables', 'Data', 'Search', 'Reports', 'Programs']) {
      await expect(sb).toContainText(cat);
    }
    await sb.locator('.as-header').click();
    await expect(sb).toHaveClass(/collapsed/);
    await sb.locator('.as-header').click();
    await expect(sb).not.toHaveClass(/collapsed/);
  });

  test('open database via picker echoes USE DATABASE into the terminal', async ({ page }) => {
    await boot(page);
    // Seed a db so the picker has an entry
    await page.locator('#terminal-input').fill('USE DATABASE ASSISTDEMO');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(600);
    await page.reload();
    await boot(page);

    await clickAction(page, 'Open database');
    await page.locator('#assistant-sidebar .as-pick', { hasText: 'ASSISTDEMO' }).click();
    await expect(page.locator('#terminal-output')).toContainText('. USE DATABASE ASSISTDEMO', { timeout: 5000 });
    await expect(page.locator('#status-db')).toContainText('ASSISTDEMO', { timeout: 5000 });
  });

  test('table-dependent actions disabled without a table, enabled with one', async ({ page }) => {
    await boot(page);
    const browse = page.locator('#assistant-sidebar .as-action', { hasText: 'Browse' }).first();
    await expect(browse).toHaveClass(/disabled/);

    await page.locator('#terminal-input').fill('USE DATABASE ASSISTDEMO');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(400);
    await page.locator('#terminal-input').fill('CREATE TABLE asst_t (NAME CHAR(20))');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(600);
    await expect(browse).not.toHaveClass(/disabled/);

    await browse.click();
    await expect(page.locator('#grid-view')).toBeVisible({ timeout: 5000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('#terminal-view')).toBeVisible({ timeout: 5000 });
  });

  // #45 — the grid opened from the Assistant validates edits per declared type.
  test('grid opened via the Assistant Browse action validates cell edits', async ({ page }) => {
    await boot(page);
    for (const c of [
      'USE DATABASE ASSISTDEMO',
      'DROP TABLE asst_shifts',
      'CREATE TABLE asst_shifts (STARTTIME TIME(15))',
      'USE asst_shifts',
      'APPEND RECORD',
    ]) {
      await page.locator('#terminal-input').fill(c);
      await page.locator('#terminal-input').press('Enter');
      await page.waitForTimeout(400);
    }

    await clickAction(page, 'Browse');
    await expect(page.locator('#grid-view')).toBeVisible({ timeout: 5000 });

    const td = page.locator('#grid-tbody td[data-ri="0"][data-ci="0"]');
    await td.dblclick();
    await td.locator('input.cell-ed').fill('08:07');
    await page.keyboard.press('Enter');
    await expect(td).toHaveClass(/cell-invalid/);
    await expect(td.locator('.cell-error')).toContainText('multiple of 15');

    await td.locator('input.cell-ed').fill('08:30');
    await page.keyboard.press('Enter');
    await expect(td).toContainText('08:30');

    await page.keyboard.press('Escape');
    await expect(page.locator('#terminal-view')).toBeVisible({ timeout: 5000 });
  });
});

test.describe('Assistant wizards — table', () => {
  test('New table wizard emits CREATE TABLE and the echo lands in the terminal', async ({ page }) => {
    await boot(page);
    await page.locator('#terminal-input').fill('USE DATABASE ASSISTDEMO');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(400);
    await page.locator('#terminal-input').fill('DROP TABLE wiz_products');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(400);

    await clickAction(page, 'New table…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });

    await page.locator('#wz-table-name').fill('wiz_products');
    await page.locator('.wz-col-name').first().fill('NAME');
    await page.locator('.wz-col-type').first().selectOption('CHAR');
    await page.locator('.wz-col-len').first().fill('30');

    // live preview shows the exact command
    await expect(page.locator('.wz-preview')).toContainText('CREATE TABLE wiz_products (NAME CHAR(30))');

    await page.locator('#wizard-view button', { hasText: 'Create table' }).click();
    await expect(page.locator('#terminal-view')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#terminal-output')).toContainText('. CREATE TABLE wiz_products (NAME CHAR(30))');
    await expect(page.locator('#status-table')).toContainText('WIZ_PRODUCTS', { timeout: 5000 });
  });

  test('New table wizard supports TIME(n) and REPLACE validates it end-to-end', async ({ page }) => {
    await boot(page);
    await page.locator('#terminal-input').fill('USE DATABASE ASSISTDEMO');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(400);
    await page.locator('#terminal-input').fill('DROP TABLE wiz_shifts');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(400);

    await clickAction(page, 'New table…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });

    await page.locator('#wz-table-name').fill('wiz_shifts');
    await page.locator('.wz-col-name').first().fill('STARTTIME');
    await page.locator('.wz-col-type').first().selectOption('TIME');
    await page.locator('.wz-col-len').first().fill('15');

    await expect(page.locator('.wz-preview')).toContainText('CREATE TABLE wiz_shifts (STARTTIME TIME(15))');
    await page.locator('#wizard-view button', { hasText: 'Create table' }).click();
    await expect(page.locator('#terminal-view')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#terminal-output')).toContainText('. CREATE TABLE wiz_shifts (STARTTIME TIME(15))');

    await page.locator('#terminal-input').fill('LIST STRUCTURE');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(400);
    await expect(page.locator('#terminal-output')).toContainText('TIME(15)');

    await page.locator('#terminal-input').fill('APPEND RECORD');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(400);

    // Off-granularity value is rejected — no silent coercion.
    await page.locator('#terminal-input').fill('REPLACE STARTTIME WITH "08:07"');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(400);
    await expect(page.locator('#terminal-output')).toContainText('** Error');

    // Valid quarter-hour value commits.
    await page.locator('#terminal-input').fill('REPLACE STARTTIME WITH "08:15"');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(400);
    await expect(page.locator('#terminal-output')).toContainText('Replaced');

    await page.locator('#terminal-input').fill('LIST');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(400);
    await expect(page.locator('#terminal-output')).toContainText('08:15');
  });

  // #50 — NUM(p,s) is a real qualifier now, so the wizard must be able to express it.
  test('New table wizard emits NUM(p,s) and the table has exactly the declared columns', async ({ page }) => {
    await boot(page);
    for (const c of ['USE DATABASE ASSISTDEMO', 'DROP TABLE wiz_priced']) {
      await page.locator('#terminal-input').fill(c);
      await page.locator('#terminal-input').press('Enter');
      await page.waitForTimeout(400);
    }

    await clickAction(page, 'New table…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });

    await page.locator('#wz-table-name').fill('wiz_priced');
    await page.locator('.wz-col-name').first().fill('PRICE');
    await page.locator('.wz-col-type').first().selectOption('NUM');
    await page.locator('.wz-col-len').first().fill('8,2');
    await expect(page.locator('.wz-preview')).toContainText('CREATE TABLE wiz_priced (PRICE NUM(8,2))');

    // Scale must be smaller than precision — the wizard blocks it.
    await page.locator('.wz-col-len').first().fill('2,8');
    await expect(page.locator('.wz-error')).toContainText('Scale must be smaller');

    await page.locator('.wz-col-len').first().fill('8,2');
    await page.locator('#wizard-view button', { hasText: 'Create table' }).click();
    await expect(page.locator('#terminal-view')).toBeVisible({ timeout: 5000 });

    await page.locator('#terminal-input').fill('LIST STRUCTURE');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(500);
    await expect(page.locator('#terminal-output')).toContainText('NUM(8,2)');

    // Exactly one column — no phantom "2" from the scale.
    const lines = await page.locator('#terminal-output .t-line').allTextContents();
    const numbered = lines.filter(l => /^\s*\d+\s+\w+/.test(l) && !/record/i.test(l));
    expect(numbered).toHaveLength(1);
  });
});

test.describe('Assistant wizards — filter / index / search', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    const cmds = [
      'USE DATABASE ASSISTDEMO',
      'DROP TABLE wiz_stock',
      'CREATE TABLE wiz_stock (NAME CHAR(20), QTY NUM(6))',
      'APPEND RECORD', 'REPLACE NAME WITH "Anvil", QTY WITH 3',
      'APPEND RECORD', 'REPLACE NAME WITH "Rope", QTY WITH 50',
    ];
    for (const c of cmds) {
      await page.locator('#terminal-input').fill(c);
      await page.locator('#terminal-input').press('Enter');
      await page.waitForTimeout(250);
    }
  });

  test('opening Filter wizard while BROWSE is active tears down the grid', async ({ page }) => {
    // Open BROWSE via the sidebar action
    await clickAction(page, 'Browse');
    await expect(page.locator('#grid-view')).toBeVisible({ timeout: 5000 });

    // Click Filter… while the grid is open — wizard must replace the grid, not stack on top
    await clickAction(page, 'Filter…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#grid-view')).toBeHidden({ timeout: 2000 });

    // Single Escape should close the wizard and return to terminal — an orphaned grid
    // listener would intercept Escape first and send a spurious grid-exit message
    await page.keyboard.press('Escape');
    await expect(page.locator('#terminal-view')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#wizard-view')).toBeHidden({ timeout: 2000 });
  });

  test('Filter wizard emits SET FILTER TO with quoted string value', async ({ page }) => {
    await clickAction(page, 'Filter…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });
    await page.locator('#wz-filter-col').selectOption({ value: 'NAME' });
    await page.locator('#wz-filter-op').selectOption('==');
    await page.locator('#wz-filter-val').fill('Anvil');
    await expect(page.locator('.wz-preview')).toContainText('SET FILTER TO NAME == "Anvil"');
    await page.locator('#wizard-view button', { hasText: 'Apply filter' }).click();
    await expect(page.locator('#terminal-output')).toContainText('. SET FILTER TO NAME == "Anvil"', { timeout: 5000 });
  });

  test('Index wizard + Find record positions the pointer via SEEK', async ({ page }) => {
    await clickAction(page, 'New index…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });
    await page.locator('#wz-index-expr').fill('NAME');
    await page.locator('#wz-index-tag').fill('WIZBYNAME');
    await expect(page.locator('.wz-preview')).toContainText('INDEX ON NAME TO WIZBYNAME');
    await page.locator('#wizard-view button', { hasText: 'Create index' }).click();
    await expect(page.locator('#terminal-output')).toContainText('. INDEX ON NAME TO WIZBYNAME', { timeout: 5000 });
    await page.waitForTimeout(400); // let the catalog refresh round-trip land so Find record sees the new index

    await clickAction(page, 'Find record…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });
    await page.locator('#wz-search-val').fill('Rope');
    await expect(page.locator('.wz-preview')).toContainText('SEEK "Rope"');
    await page.locator('#wizard-view button', { hasText: 'Find' }).click();
    await expect(page.locator('#terminal-output')).toContainText('Found at position', { timeout: 5000 });
  });
});

test.describe('Assistant — programs', () => {
  test('runs the inventory demo from the sidebar', async ({ page }) => {
    await boot(page);
    await clickAction(page, 'Run program…');
    await page.locator('#assistant-sidebar .as-pick', { hasText: 'inventory' }).click();
    // Menu form opens (program runs)
    await expect(page.locator('#form-view')).toBeVisible({ timeout: 8000 });
    const input = page.locator('#form-view input.f-get').last();
    await input.fill('Q');
    await input.press('Enter');
    await expect(page.locator('#form-view')).toBeHidden({ timeout: 6000 });
  });
});

test.describe('Assistant wizards — modify structure', () => {
  test('MODIFY STRUCTURE wizard round-trip: rename a column', async ({ page }) => {
    await boot(page);
    const cmds = [
      'USE DATABASE ASSISTDEMO',
      'DROP TABLE wiz_modstruct',
      'CREATE TABLE wiz_modstruct (FIRSTNAME CHAR(20), AGE INT)',
    ];
    for (const c of cmds) {
      await page.locator('#terminal-input').fill(c);
      await page.locator('#terminal-input').press('Enter');
      await page.waitForTimeout(300);
    }

    // Trigger MODIFY STRUCTURE via terminal command
    await page.locator('#terminal-input').fill('MODIFY STRUCTURE');
    await page.locator('#terminal-input').press('Enter');

    // Wizard view must appear
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 8000 });

    // Two column name inputs should be pre-filled
    const colNames = page.locator('.wz-col-name');
    await expect(colNames).toHaveCount(2, { timeout: 5000 });
    await expect(colNames.nth(0)).toHaveValue('FIRSTNAME');
    await expect(colNames.nth(1)).toHaveValue('AGE');

    // Rename the second column
    await colNames.nth(1).fill('YEARS');

    // Apply changes
    await page.locator('#wizard-view button', { hasText: 'Apply changes' }).click();

    // Back to terminal
    await expect(page.locator('#terminal-view')).toBeVisible({ timeout: 5000 });

    // Verify the rename took effect
    await page.locator('#terminal-input').fill('LIST STRUCTURE');
    await page.locator('#terminal-input').press('Enter');
    await expect(page.locator('#terminal-output')).toContainText('YEARS', { timeout: 5000 });
  });
});

test.describe('Assistant — post-v0.6 commands (CSV / REINDEX / PACK)', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    const cmds = [
      'USE DATABASE ASSISTDEMO',
      'DROP TABLE wiz_post',
      'CREATE TABLE wiz_post (NAME CHAR(20), QTY NUM(6))',
      'APPEND RECORD', 'REPLACE NAME WITH "Anvil", QTY WITH 3',
      'APPEND RECORD', 'REPLACE NAME WITH "Rope", QTY WITH 50',
      'USE wiz_post',
    ];
    for (const c of cmds) {
      await page.locator('#terminal-input').fill(c);
      await page.locator('#terminal-input').press('Enter');
      await page.waitForTimeout(250);
    }
  });

  test('Export to CSV triggers a download of the active table', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download');
    await clickAction(page, 'Export to CSV');
    const download = await downloadPromise;
    expect(download.suggestedFilename().toLowerCase()).toContain('wiz_post');
    await expect(page.locator('#terminal-output')).toContainText('record(s) copied', { timeout: 5000 });
  });

  test('Import from CSV opens a file picker', async ({ page }) => {
    const chooserPromise = page.waitForEvent('filechooser');
    await clickAction(page, 'Import from CSV');
    const chooser = await chooserPromise;
    expect(chooser).toBeTruthy();
  });

  test('Reindex rebuilds indexes', async ({ page }) => {
    await clickAction(page, 'Reindex');
    await expect(page.locator('#terminal-output')).toContainText('Indexes rebuilt', { timeout: 5000 });
  });

  test('Pack database VACUUMs after confirm', async ({ page }) => {
    page.on('dialog', d => d.accept());
    await clickAction(page, 'Pack database');
    await expect(page.locator('#terminal-output')).toContainText('VACUUM complete', { timeout: 5000 });
  });
});

test.describe('Assistant wizards — report designer', () => {
  test('builds, saves, and runs a report', async ({ page }) => {
    await boot(page);
    const cmds = [
      'USE DATABASE ASSISTDEMO',
      'DROP TABLE wiz_rep',
      'CREATE TABLE wiz_rep (NAME CHAR(20), QTY NUM(6))',
      'APPEND RECORD', 'REPLACE NAME WITH "Anvil", QTY WITH 3',
    ];
    for (const c of cmds) {
      await page.locator('#terminal-input').fill(c);
      await page.locator('#terminal-input').press('Enter');
      await page.waitForTimeout(250);
    }

    await clickAction(page, 'New report…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });

    // Step 1: name + title
    await page.locator('#wz-rep-name').fill('wizstock');
    await page.locator('#wz-rep-title').fill('Stock List');
    await page.locator('#wizard-view button', { hasText: 'Next' }).click();

    // Step 2: include both columns, give QTY a total
    await page.locator('.wz-rep-include').first().check();
    await page.locator('.wz-rep-include').nth(1).check();
    await page.locator('.wz-rep-total').nth(1).check();
    await page.locator('#wizard-view button', { hasText: 'Next' }).click();

    // Step 3: no grouping — save & run
    await page.locator('#wizard-view button', { hasText: 'Save & run' }).click();

    await expect(page.locator('#terminal-output')).toContainText('. REPORT FORM wizstock', { timeout: 6000 });
    await expect(page.locator('#report-preview-view')).toBeVisible({ timeout: 6000 });
    await page.keyboard.press('Escape');
  });
});

test.describe('Assistant wizards — sort', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    const cmds = [
      'USE DATABASE ASSISTDEMO',
      'DROP TABLE wiz_sortsrc',
      'DROP TABLE wiz_sorted',
      'CREATE TABLE wiz_sortsrc (NAME CHAR(20), QTY NUM(6))',
      'APPEND RECORD', 'REPLACE NAME WITH "Rope", QTY WITH 50',
      'APPEND RECORD', 'REPLACE NAME WITH "Anvil", QTY WITH 3',
      'USE wiz_sortsrc',
    ];
    for (const c of cmds) {
      await page.locator('#terminal-input').fill(c);
      await page.locator('#terminal-input').press('Enter');
      await page.waitForTimeout(250);
    }
  });

  test('Sort wizard emits SORT ON … TO and creates the new table', async ({ page }) => {
    await clickAction(page, 'Sort to new table…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });
    await page.locator('#wz-sort-field').selectOption({ value: 'NAME' });
    await page.locator('#wz-sort-target').fill('wiz_sorted');
    await expect(page.locator('.wz-preview')).toContainText('SORT ON NAME TO wiz_sorted');
    await page.locator('#wizard-view button', { hasText: 'Sort' }).click();
    await expect(page.locator('#terminal-output')).toContainText('Sorted 2 record(s) into WIZ_SORTED', { timeout: 5000 });
  });

  test('Sort wizard adds /D when Descending is checked', async ({ page }) => {
    await clickAction(page, 'Sort to new table…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });
    await page.locator('#wz-sort-field').selectOption({ value: 'QTY' });
    await page.locator('#wz-sort-desc').check();
    await page.locator('#wz-sort-target').fill('wiz_sorted');
    await expect(page.locator('.wz-preview')).toContainText('SORT ON QTY/D TO wiz_sorted');
  });
});

test.describe('Assistant wizards — aggregate', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    const cmds = [
      'USE DATABASE ASSISTDEMO',
      'DROP TABLE wiz_agg',
      'CREATE TABLE wiz_agg (NAME CHAR(20), QTY NUM(6))',
      'APPEND RECORD', 'REPLACE NAME WITH "Anvil", QTY WITH 3',
      'APPEND RECORD', 'REPLACE NAME WITH "Rope", QTY WITH 50',
      'USE wiz_agg',
    ];
    for (const c of cmds) {
      await page.locator('#terminal-input').fill(c);
      await page.locator('#terminal-input').press('Enter');
      await page.waitForTimeout(250);
    }
  });

  test('Aggregate wizard sums a numeric field', async ({ page }) => {
    await clickAction(page, 'Sum / Average…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });
    await page.locator('#wz-agg-op').selectOption({ value: 'SUM' });
    await page.locator('#wz-agg-field').selectOption({ value: 'QTY' });
    await expect(page.locator('.wz-preview')).toContainText('SUM QTY');
    await page.locator('#wizard-view button', { hasText: 'Compute' }).click();
    await expect(page.locator('#terminal-output')).toContainText('53', { timeout: 5000 });
  });

  test('Aggregate wizard offers only numeric fields', async ({ page }) => {
    await clickAction(page, 'Sum / Average…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });
    const opts = page.locator('#wz-agg-field option');
    await expect(opts).toHaveCount(1);          // only QTY (NUM); NAME (CHAR) excluded
    await expect(opts.first()).toHaveText(/QTY/);
  });
});

test.describe('Assistant — demo launchers', () => {
  test('Run CRM demo launches the CRM and opens its menu', async ({ page }) => {
    await boot(page);
    await clickAction(page, 'Run CRM demo');
    await expect(page.locator('#form-view')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#form-view')).toContainText('CRM', { timeout: 6000 });
  });

  test('Run Inventory demo launches the inventory and opens its menu', async ({ page }) => {
    await boot(page);
    await clickAction(page, 'Run Inventory demo');
    await expect(page.locator('#form-view')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#form-view')).toContainText('INVENTORY', { timeout: 6000 });
  });
});
