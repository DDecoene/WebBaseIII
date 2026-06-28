# Assistant Catalog Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the post-v0.6 REPL commands (CSV import/export, SORT, SUM/AVERAGE, REINDEX, PACK) in the Assistant sidebar with Playwright e2e coverage, and amend the Definition of Done to require Assistant parity going forward.

**Architecture:** The Assistant is data-driven — `CATEGORIES` (an array of `{name, actions: ActionDef[]}`) in `src/ui/Assistant.ts` describes every sidebar entry. Immediate commands are `ActionDef` entries; parameterized commands open a wizard (`src/ui/wizards/*`, registered via the `WizardName` union and the `wizards/index.ts` dispatcher). This plan adds immediate actions (CSV, REINDEX, PACK), two new wizards (Sort, Aggregate), a small `onRun` hook + active-table tracking for the dynamic CSV commands, and the DoD/doc updates.

**Tech Stack:** TypeScript, Vite, Playwright (e2e), Vitest (unit/integration).

**Execution note:** Tasks 1–3 all modify `src/ui/Assistant.ts`. Run them **serially in one worktree** (do not parallelize — concurrent agents corrupt shared git state). Each task ends green and committed before the next starts.

**Scope deferred to a follow-up issue:** JOIN and Work areas/SET RELATION (need work-area state the catalog does not expose). Out of this plan.

---

## Task 1: Active-table tracking + CSV / REINDEX / PACK actions

Adds the `onRun` action hook (a click handler that can read the active table name), immediate-action `confirm` support, active-table tracking, and the five immediate-command actions. Wizard registration for `'sort'`/`'aggregate'` is added here too (the wizard bodies land in Tasks 2–3) so the `WizardName` type and dispatcher only change once.

**Files:**
- Modify: `src/ui/Assistant.ts`
- Modify: `src/ui/wizards/index.ts`
- Test: `tests/assistant.spec.ts`

- [x] **Step 1: Write the failing e2e tests**

Append this block to `tests/assistant.spec.ts` (it reuses the file's existing `boot`/`clickAction` helpers defined at the top):

```typescript
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
```

- [x] **Step 2: Run the tests to verify they fail**

Run: `npx playwright test tests/assistant.spec.ts -g "post-v0.6"`
Expected: FAIL — the actions "Export to CSV", "Import from CSV", "Reindex", "Pack database" do not exist, so `clickAction` finds no element / times out.

- [x] **Step 3: Add `onRun`, immediate-action `confirm`, and active-table tracking to `Assistant.ts`**

In `src/ui/Assistant.ts`, extend the `WizardName` type (line 4) to include the two new wizards:

```typescript
export type WizardName = 'database' | 'table' | 'filter' | 'index' | 'search' | 'report' | 'sort' | 'aggregate';
```

Add an `onRun` field to the `ActionDef` interface (after the `onPick` line):

```typescript
  onRun?: (host: AssistantHost, table: string | null) => void;  // immediate, dynamic command
```

Add an `activeTable` field to the class (next to `hasTable`):

```typescript
  private activeTable: string | null = null;
```

In the `status` handler, record the active table name (add the one line shown):

```typescript
    ws.on('status', (msg) => {
      const m = msg as any;
      const changed = this.hasDb !== !!m.db || this.hasTable !== !!m.table;
      this.hasDb = !!m.db;
      this.hasTable = !!m.table;
      this.activeTable = m.table ?? null;
      if (changed) this.refresh();
    });
```

Update `activate()` to honour `confirm` on immediate actions and dispatch `onRun`:

```typescript
  private activate(a: ActionDef) {
    if (!this.actionEnabled(a)) return;
    if (a.picker) {
      this.openPicker = this.openPicker === a.label ? null : a.label;
      this.render();
      return;
    }
    this.openPicker = null;
    if (a.confirm) {
      const text = a.confirm(this.activeTable ?? '');
      if (text && !window.confirm(text)) { this.render(); return; }
    }
    if (a.command) { this.host.run(a.command); this.refresh(); }
    if (a.commands) { for (const c of a.commands) this.host.run(c); this.refresh(); }
    if (a.onRun) a.onRun(this.hostWithRefresh(), this.activeTable);
    if (a.wizard) this.host.openWizard(a.wizard);
    this.render();
  }
```

- [x] **Step 4: Add the catalog actions**

In `CATEGORIES`, append to the **Data** category's `actions` array (after `Clear filter`):

```typescript
    { label: 'Export to CSV', needs: 'table', onRun: (h, t) => { if (t) h.run(`COPY TO ${t}.csv`); } },
    { label: 'Import from CSV', needs: 'table', onRun: (h, t) => { if (t) h.run(`APPEND FROM ${t}.csv`); } },
    { label: 'Sort to new table…', needs: 'table', wizard: 'sort' },
    { label: 'Sum / Average…', needs: 'table', wizard: 'aggregate' },
```

Append to the **Search** category's `actions` array (after `Find record…`):

```typescript
    { label: 'Reindex', needs: 'table', command: 'REINDEX' },
```

Append to the **Tables** category's `actions` array (after `Drop table…`):

```typescript
    { label: 'Pack database', needs: 'table', command: 'PACK',
      confirm: () => 'VACUUM rewrites the database file to reclaim space. Continue?' },
```

- [x] **Step 5: Register the new wizards in the dispatcher**

In `src/ui/wizards/index.ts`, add imports next to the other wizard imports:

```typescript
import { openSortWizard } from './SortWizard';
import { openAggregateWizard } from './AggregateWizard';
```

Add two cases to the `switch (name)` in `openWizard`, after the `report` case:

```typescript
    case 'sort':     return openSortWizard(getCatalog(), run, onClose);
    case 'aggregate': return openAggregateWizard(getCatalog(), run, onClose);
```

> Note: `SortWizard.ts` and `AggregateWizard.ts` are created in Tasks 2 and 3. Until then the build will fail on the missing imports — that is expected; this task's e2e subset for CSV/REINDEX/PACK is verified after Tasks 2–3 land, OR temporarily stub the two wizard files with `export function openSortWizard(){}` / `export function openAggregateWizard(){}` to compile. Prefer doing Tasks 1→2→3 back-to-back and running the full suite once at the end of Task 3.

- [x] **Step 6: Commit**

```bash
git add src/ui/Assistant.ts src/ui/wizards/index.ts tests/assistant.spec.ts
git commit -m "feat(assistant): CSV/REINDEX/PACK actions + onRun hook + active-table tracking (#33)"
```

---

## Task 2: SortWizard

**Files:**
- Create: `src/ui/wizards/SortWizard.ts`
- Test: `tests/assistant.spec.ts`

- [x] **Step 1: Write the failing e2e test**

Append to `tests/assistant.spec.ts`:

```typescript
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
    await expect(page.locator('#terminal-output')).toContainText('Sorted 2 record(s) into wiz_sorted', { timeout: 5000 });
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
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/assistant.spec.ts -g "wizards — sort"`
Expected: FAIL — no `SortWizard`, so the wizard view / `#wz-sort-field` never appears.

- [x] **Step 3: Create `src/ui/wizards/SortWizard.ts`**

```typescript
import { WizardShell } from './WizardShell';
import type { Catalog } from '../../shared/types';

export function openSortWizard(catalog: Catalog, run: (cmd: string) => void, onClose: () => void): void {
  let shell: WizardShell;

  const field = document.createElement('select');
  field.id = 'wz-sort-field';
  for (const c of catalog.columns) {
    const o = document.createElement('option');
    o.value = c.name; o.textContent = `${c.name} (${c.type})`;
    field.appendChild(o);
  }
  const desc = document.createElement('input');
  desc.type = 'checkbox'; desc.id = 'wz-sort-desc';
  const target = document.createElement('input');
  target.type = 'text'; target.id = 'wz-sort-target';

  const build = (): string | null => {
    const t = target.value.trim();
    if (!field.value || !t) return null;
    return `SORT ON ${field.value}${desc.checked ? '/D' : ''} TO ${t}`;
  };
  const update = () => {
    const cmd = build();
    if (!cmd) { shell.setPreview(null, target.value.trim() ? 'Pick a field to sort on.' : 'Enter a name for the new table.'); return; }
    shell.setPreview(cmd);
  };

  shell = new WizardShell(
    'Sort to new table',
    'Writes a sorted copy of the current table (honouring the active filter) into a new table.',
    { okLabel: 'Sort', onOk: () => { const cmd = build(); if (cmd) { run(cmd); shell.close(); } } },
    onClose,
  );
  shell.field('Field', field);
  shell.field('Descending', desc);
  shell.field('New table', target);
  for (const el of [field, desc, target]) el.addEventListener('input', update);
  update();
  target.focus();
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `npx playwright test tests/assistant.spec.ts -g "wizards — sort"`
Expected: PASS (both cases).

- [x] **Step 5: Commit**

```bash
git add src/ui/wizards/SortWizard.ts tests/assistant.spec.ts
git commit -m "feat(assistant): Sort wizard (SORT ON … TO) (#33)"
```

---

## Task 3: AggregateWizard

**Files:**
- Create: `src/ui/wizards/AggregateWizard.ts`
- Test: `tests/assistant.spec.ts`

- [x] **Step 1: Write the failing e2e test**

Append to `tests/assistant.spec.ts`:

```typescript
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
```

- [x] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/assistant.spec.ts -g "wizards — aggregate"`
Expected: FAIL — no `AggregateWizard`, so `#wz-agg-op` never appears.

- [x] **Step 3: Create `src/ui/wizards/AggregateWizard.ts`**

```typescript
import { WizardShell } from './WizardShell';
import type { Catalog } from '../../shared/types';

const NUMERIC = /INT|REAL|NUM|DEC|FLOAT|DOUB/i;

export function openAggregateWizard(catalog: Catalog, run: (cmd: string) => void, onClose: () => void): void {
  let shell: WizardShell;

  const op = document.createElement('select');
  op.id = 'wz-agg-op';
  for (const o of ['SUM', 'AVERAGE']) {
    const e = document.createElement('option');
    e.value = o; e.textContent = o === 'SUM' ? 'Sum' : 'Average';
    op.appendChild(e);
  }
  const field = document.createElement('select');
  field.id = 'wz-agg-field';
  const numeric = catalog.columns.filter(c => NUMERIC.test(c.type));
  for (const c of numeric) {
    const o = document.createElement('option');
    o.value = c.name; o.textContent = `${c.name} (${c.type})`;
    field.appendChild(o);
  }

  const update = () => {
    if (!numeric.length) { shell.setPreview(null, 'This table has no numeric fields to total.'); return; }
    shell.setPreview(`${op.value} ${field.value}`);
  };

  shell = new WizardShell(
    'Sum / Average',
    'Totals or averages a numeric field over the current table (honours the active filter).',
    { okLabel: 'Compute', onOk: () => { if (numeric.length) { run(`${op.value} ${field.value}`); shell.close(); } } },
    onClose,
  );
  shell.field('Operation', op);
  shell.field('Field', field);
  for (const el of [op, field]) el.addEventListener('input', update);
  update();
}
```

- [x] **Step 4: Run the full Assistant suite to verify everything passes**

Run: `npx playwright test tests/assistant.spec.ts`
Expected: PASS — all existing cases plus the new CSV/REINDEX/PACK, sort, and aggregate cases.

- [x] **Step 5: Commit**

```bash
git add src/ui/wizards/AggregateWizard.ts tests/assistant.spec.ts
git commit -m "feat(assistant): Sum/Average wizard (#33)"
```

---

## Task 4: Definition-of-Done process fix + docs

Amends the DoD to require Assistant parity, and brings CHANGELOG/README/CLAUDE.md in line.

**Files:**
- Modify: `CLAUDE.md`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [x] **Step 1: Amend the Definition of Done in `CLAUDE.md`**

Replace the second bullet under step 2 (the `**CI gates this.**` bullet) by inserting a new Assistant-parity bullet **before** it. Find this exact text:

```
   - **CI gates this.** `.github/workflows/ci.yml` runs a `unit` job (vitest + build) and an `e2e` job (Playwright, auto-starting the dev server via the `webServer` block in `playwright.config.ts`) on every push/PR to `main` and `release/**`. A PR is not mergeable until both jobs are green — do not merge a release-branch PR with red or missing CI.
```

and replace it with:

```
   - **Assistant parity.** Every new user-facing command/feature is surfaced in the Assistant sidebar (a `CATEGORIES` action in `src/ui/Assistant.ts` and/or a wizard) **and** ships with a Playwright e2e case that clicks the Assistant action (or drives its wizard) and asserts the rendered REPL/UI result — OR the PR explicitly notes why the command does not belong in the Assistant (e.g. BROWSE already covers it, or it is not GUI-shaped). A vitest test does not satisfy this; the Assistant path must run in a real browser.
   - **CI gates this.** `.github/workflows/ci.yml` runs a `unit` job (vitest + build) and an `e2e` job (Playwright, auto-starting the dev server via the `webServer` block in `playwright.config.ts`) on every push/PR to `main` and `release/**`. A PR is not mergeable until both jobs are green — do not merge a release-branch PR with red or missing CI.
```

- [x] **Step 2: Update the Assistant architecture note in `CLAUDE.md`**

Find the `Assistant.ts` line in the `src/ui/` architecture block:

```
    Assistant.ts        Permanent left sidebar — 6 categories, catalog-driven pickers, action dispatch
```

Replace with:

```
    Assistant.ts        Permanent left sidebar — catalog-driven pickers, action dispatch (incl. CSV, SORT, SUM/AVERAGE, REINDEX, PACK)
```

And in the `src/ui/wizards/` line, add the two new wizards:

```
    wizards/            Wizard panels (take over main area): WizardShell, DatabaseWizard, TableWizard,
                        FilterWizard, IndexWizard, SearchWizard, ReportWizard, ModStructWizard,
                        SortWizard, AggregateWizard, index.ts dispatcher
```

- [x] **Step 3: Update the `tests/assistant.spec.ts` count note in `CLAUDE.md`**

In the Testing section, the `assistant.spec.ts` description currently reads `10 tests`. Run `npx playwright test tests/assistant.spec.ts --list | tail -1` to get the new total for that file, then update the count and the overall Playwright suite total in the "Playwright suites (49 tests)" sentence accordingly (add the number of new cases: 4 CSV/REINDEX/PACK + 2 sort + 2 aggregate = 8 new).

- [x] **Step 4: Add a CHANGELOG entry**

In `CHANGELOG.md`, under the `1.1.0` version heading's `### Added` section, add:

```
- Assistant sidebar parity for post-v0.6 commands: Export/Import CSV, Sort-to-new-table wizard, Sum/Average wizard, Reindex, and Pack database actions (#33).
- Definition of Done now requires every new user-facing command to be surfaced in the Assistant with a Playwright e2e case (#33).
```

- [x] **Step 5: Update `README.md`**

In `README.md`, find the Assistant feature description / category list and update it to mention the new actions (CSV import/export, sort, sum/average, reindex, pack). Match the existing wording style of that section. (Search for "Assistant" in README.md to locate it.)

- [x] **Step 6: Run the full test suites**

Run: `npm test`
Expected: PASS (no unit regressions).

Run: `npx playwright test`
Expected: PASS (all e2e green).

- [x] **Step 7: Commit**

```bash
git add CLAUDE.md CHANGELOG.md README.md
git commit -m "docs: DoD Assistant-parity step + catalog parity docs (#33)"
```

---

## Post-plan: memory + PR

After all tasks are green:

- Update the `feedback_definition_of_done` memory file so its checklist includes "Assistant parity (#33)" as a step (the memory index already references it).
- Open a follow-up issue for the deferred JOIN + Work areas/SET RELATION Assistant entries (note they need an `areas` list added to the Catalog message).
- Open the PR **based on `release/v1.1.0`** (not `main`), referencing #33.
