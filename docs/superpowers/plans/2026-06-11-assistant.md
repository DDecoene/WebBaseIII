# The Assistant (v0.6.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A permanent left-sidebar GUI ("the Assistant") that lets non-programmers drive WebBase-III entirely by generating W3Script commands, with main-area wizards for guided flows.

**Architecture:** Client-side sidebar (`src/ui/Assistant.ts`) + wizard views (`src/ui/wizards/`) that build W3Script strings and submit them through the normal terminal command path (echo + execute). One new WS pair `catalog-request` → `catalog` gives the client structured picker data from existing server stores. Spec: `docs/superpowers/specs/2026-06-11-assistant-design.md`.

**Tech Stack:** TypeScript, Vite frontend, Node WS server, better-sqlite3, vitest, Playwright.

**Conventions for every task:** run vitest as `npm test`; Playwright as `npx playwright test <file>` (requires `npm run dev` running — check with `lsof -i :5173 -sTCP:LISTEN`). TDD: watch each test fail before implementing. Commit after every task.

**One deviation from the spec (intentional):** `catalog.reports` is `Array<{name, content}>` (not `string[]`) so "Edit report…" can load the stored JSON back into the designer without a second protocol round-trip. Update the spec's catalog example in Task 10.

---

### Task 1: Catalog protocol — types + Session handler

**Files:**
- Modify: `src/shared/types.ts` (append to ClientMessage/ServerMessage unions, add Catalog types)
- Modify: `server/Session.ts` (new `catalog-request` case in `handleMessage`)
- Test: `tests/Session.test.ts`

- [ ] **Step 1: Write the failing test** — append inside `describe('Session', …)` in `tests/Session.test.ts`:

```ts
  it('catalog-request returns databases, tables, columns, indexes, reports, programs', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE cat_tbl (NAME CHAR(20), QTY NUM(6))' });
    await session.handleMessage({ type: 'command', text: 'INDEX ON NAME TO BYNAME' });
    await session.handleMessage({ type: 'save-program', name: 'test_cat_prog', content: 'LIST\n' });
    await session.handleMessage({
      type: 'save-program', name: '__report_test_cat_rep',
      content: JSON.stringify({ title: 'T', columns: [{ field: 'NAME', heading: 'Name', width: 10 }] }),
    });

    sent.length = 0;
    await session.handleMessage({ type: 'catalog-request' } as any);
    const msg = sent.find(m => m.type === 'catalog') as any;
    expect(msg).toBeDefined();
    const c = msg.catalog;
    expect(c.databases).toContain(db);
    expect(c.tables.map((t: any) => t.name)).toContain('cat_tbl');
    expect(c.columns.map((col: any) => col.name.toUpperCase())).toContain('NAME');
    expect(c.indexes).toEqual([{ tag: 'BYNAME', expression: 'NAME', active: true }]);
    expect(c.reports.map((r: any) => r.name)).toContain('test_cat_rep');
    expect(c.programs).toContain('test_cat_prog');
  });

  it('catalog-request with nothing open returns empty lists without error', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'catalog-request' } as any);
    const msg = sent.find(m => m.type === 'catalog') as any;
    expect(msg).toBeDefined();
    expect(msg.catalog.tables).toEqual([]);
    expect(msg.catalog.columns).toEqual([]);
    expect(msg.catalog.indexes).toEqual([]);
  });
```

Cleanup note: `test_cat_prog` is removed by the existing `test_` afterEach sweep. Add `__report_` cleanup: in the same `afterEach` in `tests/Session.test.ts`, after the program sweep, add:

```ts
  // (top of file) import { reportStore } from '../server/ReportStore';
  for (const name of reportStore.list()) {
    if (name.startsWith('test_')) reportStore.delete(name);
  }
```

(Check `server/ReportStore.ts` for a `delete` method; if absent, add one identical in shape to `ProgramStore.delete`: `this.db.prepare('DELETE FROM reports WHERE name = ?').run(name);`)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/Session.test.ts -t catalog`
Expected: FAIL — no `catalog` message found (handler missing).

- [ ] **Step 3: Add types** — in `src/shared/types.ts`, below the `WorkArea` interface:

```ts
export interface CatalogTable { name: string; count: number; }
export interface CatalogIndex { tag: string; expression: string; active: boolean; }
export interface CatalogReport { name: string; content: string; }

export interface Catalog {
  databases: string[];
  tables: CatalogTable[];
  columns: ColInfo[];          // columns of the ACTIVE table; [] when none
  indexes: CatalogIndex[];     // indexes of the ACTIVE table; [] when none
  reports: CatalogReport[];
  programs: string[];
}
```

Append to `ClientMessage`: `| { type: 'catalog-request' }`
Append to `ServerMessage`: `| { type: 'catalog'; catalog: Catalog }`

- [ ] **Step 4: Implement handler** — in `server/Session.ts`, add a case inside the `switch (msg.type)` in `handleMessage` (next to `grid-refresh`), plus the import of `Catalog` types:

```ts
        case 'catalog-request': {
          const area = this.executor.area;
          const databases = await this.bridge.listDatabases();
          let tables: { name: string; count: number }[] = [];
          let columns: import('../src/shared/types.js').ColInfo[] = [];
          let indexes: { tag: string; expression: string; active: boolean }[] = [];
          if (area.db) {
            const names = await this.bridge.getTables();
            tables = [];
            for (const n of names) {
              tables.push({ name: n, count: await this.bridge.getRowCount(n) });
            }
            if (area.table && await this.bridge.tableExists(area.table)) {
              columns = await this.bridge.getStructure(area.table);
              const active = indexStore.getActive(area.table);
              indexes = indexStore.listIndexes(area.table)
                .map(i => ({ tag: i.tag, expression: i.expression, active: active?.tag === i.tag }));
            }
          }
          const reports = reportStore.list().map(name => ({ name, content: reportStore.load(name) ?? '' }));
          this.send({ type: 'catalog', catalog: { databases, tables, columns, indexes, reports, programs: programStore.list() } });
          break;
        }
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npm test` — Expected: all pass, including the two new catalog tests.
Run: `npx tsc --noEmit` — Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts server/Session.ts server/ReportStore.ts tests/Session.test.ts
git commit -m "feat(assistant): catalog-request/catalog WS pair for structured picker data"
```

---

### Task 2: Layout — sidebar + main-area wrapper + wizard view container

**Files:**
- Modify: `index.html`
- Modify: `src/styles/main.css`

No unit test exists for raw layout; the Playwright test in Task 5 covers it. This task must keep **all existing Playwright suites green** (same element IDs, just nested one level deeper).

- [ ] **Step 1: Restructure `index.html`** — wrap the five existing views in `#main-area`, add the sidebar and the wizard view:

```html
  <div id="app">

    <div id="assistant-sidebar"></div>

    <div id="main-area">

      <div id="terminal-view">
        … (existing content unchanged) …
      </div>

      <div id="grid-view" class="hidden"> … unchanged … </div>
      <div id="editor-view" class="hidden"> … unchanged … </div>
      <div id="form-view" class="hidden"> … unchanged … </div>
      <div id="report-preview-view" class="hidden"> … unchanged … </div>

      <div id="wizard-view" class="hidden"></div>

    </div>

  </div>
```

(Keep every existing element verbatim; only the wrapper, sidebar div, and wizard div are new.)

- [ ] **Step 2: CSS** — in `src/styles/main.css`, change `#app` to a row and add sidebar/wizard styles:

```css
#app {
  width: 100%; height: 100%;
  display: flex; flex-direction: row;
}

#main-area {
  flex: 1; min-width: 0;
  display: flex; flex-direction: column;
}

/* ── ASSISTANT SIDEBAR ── */
#assistant-sidebar {
  width: 220px; flex-shrink: 0;
  background: #101010;
  border-right: 1px solid #2a2a2a;
  overflow-y: auto;
  font-family: system-ui, sans-serif;
  font-size: 13px;
  color: #bbb;
  display: flex; flex-direction: column;
}
#assistant-sidebar.collapsed { width: 28px; overflow: hidden; }
#assistant-sidebar .as-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 8px 10px; color: #33ff33; font-weight: 600;
  border-bottom: 1px solid #2a2a2a; cursor: pointer; user-select: none;
}
#assistant-sidebar .as-cat {
  padding: 8px 10px 2px; color: #33ff33;
  font-size: 11px; text-transform: uppercase; letter-spacing: .06em;
}
#assistant-sidebar .as-action {
  padding: 4px 10px 4px 18px; cursor: pointer; user-select: none; border-radius: 3px;
}
#assistant-sidebar .as-action:hover { background: #1f3f1f; color: #7dff7d; }
#assistant-sidebar .as-action.disabled { color: #555; cursor: default; }
#assistant-sidebar .as-action.disabled:hover { background: none; color: #555; }
#assistant-sidebar .as-pick {
  padding: 3px 10px 3px 32px; cursor: pointer; color: #9b9; font-size: 12px;
}
#assistant-sidebar .as-pick:hover { background: #1f3f1f; color: #7dff7d; }
#assistant-sidebar .as-empty { padding: 3px 10px 3px 32px; color: #555; font-size: 12px; }

/* ── WIZARD VIEW ── */
#wizard-view {
  flex: 1; overflow-y: auto; padding: 24px;
  font-family: system-ui, sans-serif; color: #ddd;
}
#wizard-view h2 { color: #33ff33; margin: 0 0 4px; font-size: 18px; }
#wizard-view .wz-sub { color: #888; margin: 0 0 18px; font-size: 13px; }
#wizard-view .wz-field { margin: 10px 0; }
#wizard-view .wz-field label { display: block; color: #9b9; font-size: 12px; margin-bottom: 3px; }
#wizard-view input[type=text], #wizard-view select {
  background: #0a0a0a; color: #33ff33; border: 1px solid #333;
  border-radius: 3px; padding: 5px 8px; font-family: 'Courier New', monospace;
  font-size: 13px; min-width: 260px;
}
#wizard-view input[type=checkbox] { accent-color: #33ff33; }
#wizard-view .wz-row { display: flex; gap: 8px; align-items: center; margin: 6px 0; }
#wizard-view .wz-preview {
  margin-top: 18px; padding-top: 12px; border-top: 1px dashed #333;
  font-family: 'Courier New', monospace; color: #ff6; font-size: 13px;
  min-height: 18px; white-space: pre-wrap;
}
#wizard-view .wz-error { color: #f66; font-size: 12px; margin-top: 8px; min-height: 15px; }
#wizard-view .wz-buttons { margin-top: 16px; display: flex; gap: 10px; }
#wizard-view button {
  background: #1f3f1f; color: #7dff7d; border: 1px solid #33ff33;
  border-radius: 3px; padding: 6px 16px; cursor: pointer; font-size: 13px;
}
#wizard-view button:disabled { opacity: .4; cursor: default; }
#wizard-view button.secondary { background: #161616; color: #999; border-color: #333; }
```

- [ ] **Step 3: Verify nothing broke**

Run: `npx tsc --noEmit` — Expected: clean.
Run: `npx playwright test tests/integration.spec.ts` — Expected: all 20 pass (IDs unchanged). The sidebar is an empty strip for now; that's fine.

- [ ] **Step 4: Commit**

```bash
git add index.html src/styles/main.css
git commit -m "feat(assistant): sidebar + wizard view containers, app layout becomes sidebar/main split"
```

---

### Task 3: Terminal plumbing — public runCommand + wizard view in the swap cycle

**Files:**
- Modify: `src/terminal/Terminal.ts`

- [ ] **Step 1: Add `wizardView` to the fields and constructor** (next to `reportView`):

```ts
  private wizardView: HTMLElement;
  // in constructor, after reportView assignment:
  this.wizardView = document.getElementById('wizard-view')!;
```

- [ ] **Step 2: Hide it in `showTerminal()`** — add one line beside the other `add('hidden')` calls:

```ts
    this.wizardView.classList.add('hidden');
```

- [ ] **Step 3: Add the public command entry point** (below `flushBlock()`):

```ts
  /** Submit a command exactly as if the user typed it: echo + send. Used by the Assistant. */
  runCommand(raw: string) {
    this.printLine(`. ${raw}`, 'echo');
    this.ws.send({ type: 'command', text: raw });
  }
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — Expected: clean. (Behavior covered by Task 5's Playwright test, which asserts the echo.)

- [ ] **Step 5: Commit**

```bash
git add src/terminal/Terminal.ts
git commit -m "feat(assistant): Terminal.runCommand public entry + wizard view in swap cycle"
```

---

### Task 4: WizardShell — shared wizard chrome

**Files:**
- Create: `src/ui/wizards/WizardShell.ts`

The shell renders into `#wizard-view`, manages show/hide, Esc, the live W3Script preview, validation message, and buttons. Wizards build their fields into `shell.body`.

- [ ] **Step 1: Create `src/ui/wizards/WizardShell.ts`:**

```ts
export interface ShellButtons {
  okLabel: string;
  onOk: () => void;
  extraLabel?: string;        // e.g. "Save & run"
  onExtra?: () => void;
}

/** Shared wizard chrome: title, body, live W3Script preview, error line, OK/Cancel, Esc. */
export class WizardShell {
  readonly view: HTMLElement;
  readonly body: HTMLElement;
  private previewEl: HTMLElement;
  private errorEl: HTMLElement;
  private okBtn: HTMLButtonElement;
  private extraBtn: HTMLButtonElement | null = null;
  private keyHandler: (e: KeyboardEvent) => void;

  constructor(
    title: string,
    subtitle: string,
    buttons: ShellButtons,
    private onClose: () => void,
  ) {
    this.view = document.getElementById('wizard-view')!;
    this.view.innerHTML = '';

    const h = document.createElement('h2');
    h.textContent = title;
    const sub = document.createElement('p');
    sub.className = 'wz-sub';
    sub.textContent = subtitle;
    this.body = document.createElement('div');

    this.previewEl = document.createElement('div');
    this.previewEl.className = 'wz-preview';
    this.errorEl = document.createElement('div');
    this.errorEl.className = 'wz-error';

    const btns = document.createElement('div');
    btns.className = 'wz-buttons';
    this.okBtn = document.createElement('button');
    this.okBtn.textContent = buttons.okLabel;
    this.okBtn.addEventListener('click', () => buttons.onOk());
    btns.appendChild(this.okBtn);
    if (buttons.extraLabel && buttons.onExtra) {
      this.extraBtn = document.createElement('button');
      this.extraBtn.textContent = buttons.extraLabel;
      this.extraBtn.addEventListener('click', () => buttons.onExtra!());
      btns.appendChild(this.extraBtn);
    }
    const cancel = document.createElement('button');
    cancel.className = 'secondary';
    cancel.textContent = 'Cancel (Esc)';
    cancel.addEventListener('click', () => this.close());
    btns.appendChild(cancel);

    this.view.append(h, sub, this.body, this.previewEl, this.errorEl, btns);

    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
    };
    document.addEventListener('keydown', this.keyHandler);
  }

  /** preview === null means "not well-formed yet": clears preview, disables OK. */
  setPreview(preview: string | null, error = '') {
    this.previewEl.textContent = preview ?? '';
    this.errorEl.textContent = error;
    this.okBtn.disabled = preview === null;
    if (this.extraBtn) this.extraBtn.disabled = preview === null;
  }

  field(labelText: string, input: HTMLElement): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'wz-field';
    const label = document.createElement('label');
    label.textContent = labelText;
    wrap.append(label, input);
    this.body.appendChild(wrap);
    return wrap;
  }

  close() {
    document.removeEventListener('keydown', this.keyHandler);
    this.view.innerHTML = '';
    this.onClose();
  }
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/ui/wizards/WizardShell.ts
git commit -m "feat(assistant): WizardShell shared wizard chrome"
```

---

### Task 5: Assistant sidebar + wiring + first Playwright tests

**Files:**
- Create: `src/ui/Assistant.ts`
- Modify: `src/main.ts`
- Test: `tests/assistant.spec.ts` (new)

- [ ] **Step 1: Write the failing Playwright test** — create `tests/assistant.spec.ts`:

```ts
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
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test tests/assistant.spec.ts`
Expected: FAIL — sidebar is empty (no `.as-header` / categories).

- [ ] **Step 3: Create `src/ui/Assistant.ts`:**

```ts
import { WsClient } from '../ws/WsClient';
import type { Catalog } from '../shared/types';

export type WizardName = 'database' | 'table' | 'filter' | 'index' | 'search' | 'report';

export interface AssistantHost {
  run(cmd: string): void;
  openWizard(name: WizardName, arg?: string): void;
}

type PickerSource = 'databases' | 'tables' | 'indexes' | 'reports' | 'programs';

interface ActionDef {
  label: string;
  needs?: 'db' | 'table';
  command?: string;                 // immediate single command
  commands?: string[];              // immediate sequence
  wizard?: WizardName;
  picker?: PickerSource;
  pickerExtra?: string;             // synthetic first entry, e.g. "(natural order)"
  onPick?: (name: string, host: AssistantHost) => void;
  confirm?: (name: string) => string | null;  // returns confirm() text, null = no confirm
}

const CATEGORIES: { name: string; actions: ActionDef[] }[] = [
  { name: 'Database', actions: [
    { label: 'Open database…', picker: 'databases', onPick: (n, h) => h.run(`USE DATABASE ${n}`) },
    { label: 'New database…', wizard: 'database' },
  ]},
  { name: 'Tables', actions: [
    { label: 'Open table…', needs: 'db', picker: 'tables', onPick: (n, h) => h.run(`USE ${n}`) },
    { label: 'New table…', needs: 'db', wizard: 'table' },
    { label: 'Structure', needs: 'table', command: 'LIST STRUCTURE' },
    { label: 'Drop table…', needs: 'db', picker: 'tables',
      confirm: n => `Drop table ${n}? This permanently deletes the table and all its data.`,
      onPick: (n, h) => h.run(`DROP TABLE ${n}`) },
  ]},
  { name: 'Data', actions: [
    { label: 'Browse', needs: 'table', command: 'BROWSE' },
    { label: 'Add record', needs: 'table', commands: ['APPEND RECORD', 'BROWSE'] },
    { label: 'Filter…', needs: 'table', wizard: 'filter' },
    { label: 'Clear filter', needs: 'table', command: 'SET FILTER TO' },
  ]},
  { name: 'Search', actions: [
    { label: 'Set index…', needs: 'table', picker: 'indexes', pickerExtra: '(natural order)',
      onPick: (n, h) => h.run(n === '(natural order)' ? 'SET INDEX TO' : `SET INDEX TO ${n}`) },
    { label: 'New index…', needs: 'table', wizard: 'index' },
    { label: 'Find record…', needs: 'table', wizard: 'search' },
  ]},
  { name: 'Reports', actions: [
    { label: 'Run report…', needs: 'table', picker: 'reports', onPick: (n, h) => h.run(`REPORT FORM ${n}`) },
    { label: 'New report…', needs: 'table', wizard: 'report' },
    { label: 'Edit report…', needs: 'table', picker: 'reports', onPick: (n, h) => h.openWizard('report', n) },
  ]},
  { name: 'Programs', actions: [
    { label: 'Run program…', picker: 'programs', onPick: (n, h) => h.run(`DO ${n}`) },
    { label: 'Edit program…', picker: 'programs', onPick: (n, h) => h.run(`EDIT ${n}`) },
  ]},
];

export class Assistant {
  private el: HTMLElement;
  private catalog: Catalog = { databases: [], tables: [], columns: [], indexes: [], reports: [], programs: [] };
  private hasDb = false;
  private hasTable = false;
  private openPicker: string | null = null;   // label of the action whose picker is expanded

  constructor(private ws: WsClient, private host: AssistantHost) {
    this.el = document.getElementById('assistant-sidebar')!;
    ws.on('catalog', (msg) => {
      this.catalog = (msg as any).catalog;
      this.render();
    });
    ws.on('status', (msg) => {
      const m = msg as any;
      const changed = this.hasDb !== !!m.db || this.hasTable !== !!m.table;
      this.hasDb = !!m.db;
      this.hasTable = !!m.table;
      if (changed) this.refresh();
    });
    this.render();
    this.refresh();
  }

  /** Re-request the catalog (server processes WS messages in order, so a
      catalog-request sent after a command reflects post-command state). */
  refresh() {
    this.ws.send({ type: 'catalog-request' });
  }

  /** Used by host: run a command, then refresh pickers. */
  runAndRefresh(cmd: string) {
    this.host.run(cmd);
    this.refresh();
  }

  latestCatalog(): Catalog {
    return this.catalog;
  }

  private pickerItems(src: PickerSource): string[] {
    switch (src) {
      case 'databases': return this.catalog.databases;
      case 'tables':    return this.catalog.tables.map(t => t.name);
      case 'indexes':   return this.catalog.indexes.map(i => i.tag);
      case 'reports':   return this.catalog.reports.map(r => r.name);
      case 'programs':  return this.catalog.programs.filter(p => !p.startsWith('__'));
    }
  }

  private actionEnabled(a: ActionDef): boolean {
    if (a.needs === 'db') return this.hasDb;
    if (a.needs === 'table') return this.hasTable;
    return true;
  }

  private render() {
    const collapsed = this.el.classList.contains('collapsed');
    this.el.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'as-header';
    header.textContent = collapsed ? '»' : 'Assistant  «';
    header.addEventListener('click', () => {
      this.el.classList.toggle('collapsed');
      this.render();
    });
    this.el.appendChild(header);
    if (collapsed) return;

    for (const cat of CATEGORIES) {
      const catEl = document.createElement('div');
      catEl.className = 'as-cat';
      catEl.textContent = cat.name;
      this.el.appendChild(catEl);

      for (const a of cat.actions) {
        const el = document.createElement('div');
        el.className = 'as-action' + (this.actionEnabled(a) ? '' : ' disabled');
        el.textContent = a.label;
        el.addEventListener('click', () => this.activate(a));
        this.el.appendChild(el);

        if (a.picker && this.openPicker === a.label) {
          const items = this.pickerItems(a.picker);
          const all = a.pickerExtra ? [a.pickerExtra, ...items] : items;
          if (!all.length) {
            const empty = document.createElement('div');
            empty.className = 'as-empty';
            empty.textContent = '(none)';
            this.el.appendChild(empty);
          }
          for (const item of all) {
            const pick = document.createElement('div');
            pick.className = 'as-pick';
            pick.textContent = item;
            pick.addEventListener('click', () => {
              this.openPicker = null;
              if (a.confirm) {
                const text = a.confirm(item);
                if (text && !window.confirm(text)) { this.render(); return; }
              }
              a.onPick!(item, this.hostWithRefresh());
              this.render();
            });
            this.el.appendChild(pick);
          }
        }
      }
    }
  }

  private hostWithRefresh(): AssistantHost {
    return {
      run: (cmd) => { this.host.run(cmd); this.refresh(); },
      openWizard: (name, arg) => this.host.openWizard(name, arg),
    };
  }

  private activate(a: ActionDef) {
    if (!this.actionEnabled(a)) return;
    if (a.picker) {
      this.openPicker = this.openPicker === a.label ? null : a.label;
      this.render();
      return;
    }
    this.openPicker = null;
    if (a.command) { this.host.run(a.command); this.refresh(); }
    if (a.commands) { for (const c of a.commands) this.host.run(c); this.refresh(); }
    if (a.wizard) this.host.openWizard(a.wizard);
    this.render();
  }
}
```

- [ ] **Step 4: Wire in `src/main.ts`** — after `terminal.mount()`:

```ts
import { Assistant } from './ui/Assistant';
import { openWizard } from './ui/wizards';   // Task 6 creates this; for THIS task stub it:

// in boot(), after terminal.mount():
  const assistant = new Assistant(ws, {
    run: (cmd) => terminal.runCommand(cmd),
    openWizard: (name, arg) => openWizard(name, arg, ws, terminal, () => assistant.latestCatalog(), () => assistant.refresh()),
  });
```

For this task, create a stub `src/ui/wizards/index.ts` so it compiles (Tasks 6-8 fill it in):

```ts
import type { WsClient } from '../../ws/WsClient';
import type { Terminal } from '../../terminal/Terminal';
import type { Catalog } from '../../shared/types';
import type { WizardName } from '../Assistant';

export function openWizard(
  name: WizardName,
  arg: string | undefined,
  ws: WsClient,
  terminal: Terminal,
  getCatalog: () => Catalog,
  refresh: () => void,
): void {
  console.warn(`wizard not implemented yet: ${name}`, arg, ws, terminal, getCatalog, refresh);
}
```

- [ ] **Step 5: Run tests to verify pass**

Run: `npx playwright test tests/assistant.spec.ts` — Expected: 3 pass.
Run: `npx playwright test tests/integration.spec.ts tests/inventory.spec.ts` — Expected: all pass (no regressions).
Run: `npx tsc --noEmit` — Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/Assistant.ts src/ui/wizards/index.ts src/main.ts tests/assistant.spec.ts
git commit -m "feat(assistant): sidebar with categories, pickers, status-driven enablement"
```

---

### Task 6: DatabaseWizard + TableWizard

**Files:**
- Create: `src/ui/wizards/DatabaseWizard.ts`
- Create: `src/ui/wizards/TableWizard.ts`
- Modify: `src/ui/wizards/index.ts`
- Test: `tests/assistant.spec.ts`

All wizards share this open/close contract: show `#wizard-view`, hide `#terminal-view` (and on close call `terminal.showTerminal()`). The dispatcher in `index.ts` handles that uniformly.

- [ ] **Step 1: Write the failing Playwright test** — append to `tests/assistant.spec.ts`:

```ts
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
    await expect(page.locator('#status-table')).toContainText('wiz_products', { timeout: 5000 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test tests/assistant.spec.ts -g "New table wizard"`
Expected: FAIL — wizard view never appears (stub logs a warning).

- [ ] **Step 3: Create `src/ui/wizards/DatabaseWizard.ts`:**

```ts
import { WizardShell } from './WizardShell';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function openDatabaseWizard(run: (cmd: string) => void, onClose: () => void): void {
  let shell: WizardShell;
  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'wz-db-name';

  const update = () => {
    const name = input.value.trim();
    if (!name) { shell.setPreview(null, ''); return; }
    if (!NAME_RE.test(name)) { shell.setPreview(null, 'Letters, digits and _ only; must not start with a digit.'); return; }
    shell.setPreview(`USE DATABASE ${name}`);
  };

  shell = new WizardShell(
    'New database',
    'Creates (or opens) a named SQLite database on the server.',
    { okLabel: 'Create database', onOk: () => { run(`USE DATABASE ${input.value.trim()}`); shell.close(); } },
    onClose,
  );
  shell.field('Database name', input);
  input.addEventListener('input', update);
  update();
  input.focus();
}
```

- [ ] **Step 4: Create `src/ui/wizards/TableWizard.ts`:**

```ts
import { WizardShell } from './WizardShell';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TYPES = ['CHAR', 'NUM', 'INT', 'DATE', 'LOGICAL', 'MEMO'] as const;
const NEEDS_LEN = new Set(['CHAR', 'NUM']);

interface ColRow { name: HTMLInputElement; type: HTMLSelectElement; len: HTMLInputElement; }

export function openTableWizard(run: (cmd: string) => void, onClose: () => void): void {
  let shell: WizardShell;
  const rows: ColRow[] = [];

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.id = 'wz-table-name';

  const colsWrap = document.createElement('div');

  const buildCommand = (): { cmd: string | null; err: string } => {
    const table = nameInput.value.trim();
    if (!table) return { cmd: null, err: '' };
    if (!NAME_RE.test(table)) return { cmd: null, err: 'Invalid table name.' };
    const cols: string[] = [];
    for (const r of rows) {
      const n = r.name.value.trim();
      if (!n) continue;                       // blank rows are skipped
      if (!NAME_RE.test(n)) return { cmd: null, err: `Invalid column name: ${n}` };
      const t = r.type.value;
      if (NEEDS_LEN.has(t)) {
        const len = parseInt(r.len.value, 10);
        if (!len || len < 1) return { cmd: null, err: `Length required for ${n} (${t})` };
        cols.push(`${n} ${t}(${len})`);
      } else {
        cols.push(`${n} ${t}`);
      }
    }
    if (!cols.length) return { cmd: null, err: 'At least one column.' };
    return { cmd: `CREATE TABLE ${table} (${cols.join(', ')})`, err: '' };
  };

  const update = () => {
    const { cmd, err } = buildCommand();
    shell.setPreview(cmd, err);
  };

  const addRow = () => {
    const row = document.createElement('div');
    row.className = 'wz-row';
    const name = document.createElement('input');
    name.type = 'text'; name.className = 'wz-col-name'; name.placeholder = 'column'; name.style.minWidth = '140px';
    const type = document.createElement('select');
    type.className = 'wz-col-type';
    for (const t of TYPES) {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      type.appendChild(o);
    }
    const len = document.createElement('input');
    len.type = 'text'; len.className = 'wz-col-len'; len.placeholder = 'len'; len.style.minWidth = '50px'; len.style.width = '50px';
    row.append(name, type, len);
    colsWrap.appendChild(row);
    rows.push({ name, type, len });
    for (const el of [name, type, len]) el.addEventListener('input', update);
  };

  shell = new WizardShell(
    'New table',
    'Define columns; blank rows are ignored. CHAR and NUM need a length.',
    { okLabel: 'Create table', onOk: () => {
        const { cmd } = buildCommand();
        if (cmd) { run(cmd); shell.close(); }
      } },
    onClose,
  );
  shell.field('Table name', nameInput);
  shell.field('Columns', colsWrap);
  const addBtn = document.createElement('button');
  addBtn.className = 'secondary';
  addBtn.textContent = '+ add column';
  addBtn.addEventListener('click', addRow);
  shell.body.appendChild(addBtn);

  addRow(); addRow(); addRow();
  nameInput.addEventListener('input', update);
  update();
  nameInput.focus();
}
```

- [ ] **Step 5: Implement the dispatcher** — replace the stub body in `src/ui/wizards/index.ts`:

```ts
import type { WsClient } from '../../ws/WsClient';
import type { Terminal } from '../../terminal/Terminal';
import type { Catalog } from '../../shared/types';
import type { WizardName } from '../Assistant';
import { openDatabaseWizard } from './DatabaseWizard';
import { openTableWizard } from './TableWizard';

function showWizardView(): void {
  document.getElementById('terminal-view')!.classList.add('hidden');
  document.getElementById('wizard-view')!.classList.remove('hidden');
}

export function openWizard(
  name: WizardName,
  arg: string | undefined,
  ws: WsClient,
  terminal: Terminal,
  getCatalog: () => Catalog,
  refresh: () => void,
): void {
  const run = (cmd: string) => { terminal.runCommand(cmd); refresh(); };
  const onClose = () => terminal.showTerminal();
  showWizardView();
  switch (name) {
    case 'database': return openDatabaseWizard(run, onClose);
    case 'table':    return openTableWizard(run, onClose);
    default:
      console.warn(`wizard not implemented yet: ${name}`, arg, ws, getCatalog);
      onClose();
  }
}
```

- [ ] **Step 6: Run tests to verify pass**

Run: `npx playwright test tests/assistant.spec.ts` — Expected: all pass.
Run: `npx tsc --noEmit` — Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/ui/wizards/ tests/assistant.spec.ts
git commit -m "feat(assistant): database and table wizards with live W3Script preview"
```

---

### Task 7: FilterWizard, IndexWizard, SearchWizard

**Files:**
- Create: `src/ui/wizards/FilterWizard.ts`
- Create: `src/ui/wizards/IndexWizard.ts`
- Create: `src/ui/wizards/SearchWizard.ts`
- Modify: `src/ui/wizards/index.ts`
- Test: `tests/assistant.spec.ts`

Shared value-quoting rule (used by Filter and Search): numeric-looking values stay raw, everything else gets double quotes; embedded `"` is rejected (the language has no escape syntax).

- [ ] **Step 1: Write the failing Playwright test** — append to `tests/assistant.spec.ts`:

```ts
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

  test('Filter wizard emits SET FILTER TO with quoted string value', async ({ page }) => {
    await clickAction(page, 'Filter…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });
    await page.locator('#wz-filter-col').selectOption({ label: /NAME/i });
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

    await clickAction(page, 'Find record…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });
    await page.locator('#wz-search-val').fill('Rope');
    await expect(page.locator('.wz-preview')).toContainText('SEEK "Rope"');
    await page.locator('#wizard-view button', { hasText: 'Find' }).click();
    await expect(page.locator('#terminal-output')).toContainText('Found at position', { timeout: 5000 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test tests/assistant.spec.ts -g "filter / index / search"`
Expected: FAIL — wizards not implemented (stub warning, view closes immediately).

- [ ] **Step 3: Create `src/ui/wizards/FilterWizard.ts`:**

```ts
import { WizardShell } from './WizardShell';
import type { Catalog } from '../../shared/types';

const OPS = ['==', '!=', '>', '<', '>=', '<='] as const;

export function quoteValue(raw: string): { val: string | null; err: string } {
  const v = raw.trim();
  if (!v) return { val: null, err: '' };
  if (/^-?\d+(\.\d+)?$/.test(v)) return { val: v, err: '' };
  if (v.includes('"')) return { val: null, err: 'Double quotes are not allowed in values.' };
  return { val: `"${v}"`, err: '' };
}

export function openFilterWizard(catalog: Catalog, run: (cmd: string) => void, onClose: () => void): void {
  let shell: WizardShell;

  const col = document.createElement('select');
  col.id = 'wz-filter-col';
  for (const c of catalog.columns) {
    const o = document.createElement('option');
    o.value = c.name; o.textContent = `${c.name} (${c.type})`;
    col.appendChild(o);
  }
  const op = document.createElement('select');
  op.id = 'wz-filter-op';
  for (const o of OPS) {
    const e = document.createElement('option');
    e.value = o; e.textContent = o;
    op.appendChild(e);
  }
  const val = document.createElement('input');
  val.type = 'text'; val.id = 'wz-filter-val';

  const update = () => {
    const { val: v, err } = quoteValue(val.value);
    if (!col.value || v === null) { shell.setPreview(null, err); return; }
    shell.setPreview(`SET FILTER TO ${col.value} ${op.value} ${v}`);
  };

  shell = new WizardShell(
    'Filter records',
    'Only rows matching the condition are shown by LIST, BROWSE, and reports. Use "Clear filter" to remove.',
    { okLabel: 'Apply filter', onOk: () => {
        const { val: v } = quoteValue(val.value);
        if (v !== null) { run(`SET FILTER TO ${col.value} ${op.value} ${v}`); shell.close(); }
      } },
    onClose,
  );
  shell.field('Column', col);
  shell.field('Operator', op);
  shell.field('Value', val);
  for (const el of [col, op, val]) el.addEventListener('input', update);
  update();
  val.focus();
}
```

- [ ] **Step 4: Create `src/ui/wizards/IndexWizard.ts`:**

```ts
import { WizardShell } from './WizardShell';
import type { Catalog } from '../../shared/types';

const TAG_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function openIndexWizard(catalog: Catalog, run: (cmd: string) => void, onClose: () => void): void {
  let shell: WizardShell;

  const expr = document.createElement('input');
  expr.type = 'text'; expr.id = 'wz-index-expr';
  expr.placeholder = catalog.columns[0]?.name ?? 'column or expression';

  const tag = document.createElement('input');
  tag.type = 'text'; tag.id = 'wz-index-tag';

  const update = () => {
    const e = expr.value.trim();
    const t = tag.value.trim();
    if (!e || !t) { shell.setPreview(null, ''); return; }
    if (!TAG_RE.test(t)) { shell.setPreview(null, 'Invalid tag name.'); return; }
    shell.setPreview(`INDEX ON ${e} TO ${t}`);
  };

  shell = new WizardShell(
    'New index',
    'Index on a column or expression — e.g. NAME or UPPER(NAME). The new index becomes active.',
    { okLabel: 'Create index', onOk: () => {
        run(`INDEX ON ${expr.value.trim()} TO ${tag.value.trim()}`); shell.close();
      } },
    onClose,
  );
  shell.field('Expression', expr);
  shell.field('Tag (index name)', tag);
  for (const el of [expr, tag]) el.addEventListener('input', update);
  update();
  expr.focus();
}
```

- [ ] **Step 5: Create `src/ui/wizards/SearchWizard.ts`:**

```ts
import { WizardShell } from './WizardShell';
import { quoteValue } from './FilterWizard';
import type { Catalog } from '../../shared/types';

export function openSearchWizard(catalog: Catalog, run: (cmd: string) => void, onClose: () => void): void {
  let shell: WizardShell;

  const idx = document.createElement('select');
  idx.id = 'wz-search-idx';
  for (const i of catalog.indexes) {
    const o = document.createElement('option');
    o.value = i.tag;
    o.textContent = `${i.tag} (${i.expression})${i.active ? ' — active' : ''}`;
    if (i.active) o.selected = true;
    idx.appendChild(o);
  }
  const val = document.createElement('input');
  val.type = 'text'; val.id = 'wz-search-val';

  const update = () => {
    if (!catalog.indexes.length) { shell.setPreview(null, 'No indexes on this table — create one first.'); return; }
    const { val: v, err } = quoteValue(val.value);
    if (v === null) { shell.setPreview(null, err); return; }
    shell.setPreview(`SET INDEX TO ${idx.value}\nSEEK ${v}`);
  };

  shell = new WizardShell(
    'Find record',
    'Activates the chosen index, then SEEKs the value (exact match on the index expression).',
    { okLabel: 'Find', onOk: () => {
        const { val: v } = quoteValue(val.value);
        if (v !== null && catalog.indexes.length) {
          run(`SET INDEX TO ${idx.value}`);
          run(`SEEK ${v}`);
          shell.close();
        }
      } },
    onClose,
  );
  shell.field('Index', idx);
  shell.field('Value', val);
  for (const el of [idx, val]) el.addEventListener('input', update);
  update();
  val.focus();
}
```

- [ ] **Step 6: Register in the dispatcher** — in `src/ui/wizards/index.ts`, add imports and cases:

```ts
import { openFilterWizard } from './FilterWizard';
import { openIndexWizard } from './IndexWizard';
import { openSearchWizard } from './SearchWizard';
// in the switch:
    case 'filter':   return openFilterWizard(getCatalog(), run, onClose);
    case 'index':    return openIndexWizard(getCatalog(), run, onClose);
    case 'search':   return openSearchWizard(getCatalog(), run, onClose);
```

- [ ] **Step 7: Run tests to verify pass**

Run: `npx playwright test tests/assistant.spec.ts` — Expected: all pass.
Run: `npx tsc --noEmit` — Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add src/ui/wizards/ tests/assistant.spec.ts
git commit -m "feat(assistant): filter, index, and search wizards"
```

---

### Task 8: ReportWizard — 3-step designer

**Files:**
- Create: `src/ui/wizards/ReportWizard.ts`
- Modify: `src/ui/wizards/index.ts`
- Test: `tests/assistant.spec.ts`

Produces the existing `ReportDef` JSON (`src/shared/types.ts`), saved through the existing `save-program` message with the `__report_` name prefix (the route `Session.handleMessage` already maps to `reportStore`).

- [ ] **Step 1: Write the failing Playwright test** — append to `tests/assistant.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test tests/assistant.spec.ts -g "report designer"`
Expected: FAIL — report wizard not implemented.

- [ ] **Step 3: Create `src/ui/wizards/ReportWizard.ts`:**

```ts
import { WizardShell } from './WizardShell';
import type { WsClient } from '../../ws/WsClient';
import type { Catalog, ReportDef } from '../../shared/types';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NUMERIC_TYPES = new Set(['REAL', 'INTEGER', 'NUM', 'INT']);

interface ColState { name: string; type: string; include: boolean; heading: string; width: number; total: boolean; }

export function openReportWizard(
  catalog: Catalog,
  existingName: string | undefined,
  ws: WsClient,
  run: (cmd: string) => void,
  refresh: () => void,
  onClose: () => void,
): void {
  // Load existing definition when editing
  let def: Partial<ReportDef> = {};
  let repName = existingName ?? '';
  if (existingName) {
    const found = catalog.reports.find(r => r.name === existingName);
    if (found) { try { def = JSON.parse(found.content); } catch { def = {}; } }
  }

  const cols: ColState[] = catalog.columns.map(c => {
    const existing = def.columns?.find(dc => dc.field.toUpperCase() === c.name.toUpperCase());
    return {
      name: c.name, type: c.type,
      include: !!existing,
      heading: existing?.heading ?? c.name,
      width: existing?.width ?? 12,
      total: existing?.total ?? false,
    };
  });
  let title = def.title ?? '';
  let groupBy = def.groupBy ?? '';
  let step = 1;

  const buildDef = (): ReportDef => ({
    title,
    pageWidth: 80,
    columns: cols.filter(c => c.include).map(c => ({
      field: c.name, heading: c.heading, width: c.width, ...(c.total ? { total: true } : {}),
    })),
    ...(groupBy ? { groupBy } : {}),
  });

  const save = () => {
    ws.send({ type: 'save-program', name: `__report_${repName}`, content: JSON.stringify(buildDef(), null, 2) });
    refresh();
  };

  const render = () => {
    const shell = new WizardShell(
      existingName ? `Edit report: ${existingName}` : 'New report',
      `Step ${step} of 3 — ${step === 1 ? 'name & title' : step === 2 ? 'columns' : 'grouping & save'}`,
      step < 3
        ? { okLabel: 'Next →', onOk: () => { collect(); step++; render(); } }
        : {
            okLabel: 'Save',
            onOk: () => { collect(); save(); shellRef.close(); },
            extraLabel: 'Save & run',
            onExtra: () => { collect(); save(); shellRef.close(); run(`REPORT FORM ${repName}`); },
          },
      onClose,
    );
    const shellRef = shell;
    let collect: () => void = () => {};

    if (step === 1) {
      const nameIn = document.createElement('input');
      nameIn.type = 'text'; nameIn.id = 'wz-rep-name'; nameIn.value = repName;
      nameIn.disabled = !!existingName;
      const titleIn = document.createElement('input');
      titleIn.type = 'text'; titleIn.id = 'wz-rep-title'; titleIn.value = title;
      shell.field('Report name', nameIn);
      shell.field('Title (printed at top)', titleIn);
      const update = () => {
        const ok = NAME_RE.test(nameIn.value.trim()) && titleIn.value.trim().length > 0;
        shell.setPreview(ok ? `(report "${nameIn.value.trim()}")` : null,
          nameIn.value.trim() && !NAME_RE.test(nameIn.value.trim()) ? 'Invalid report name.' : '');
      };
      for (const el of [nameIn, titleIn]) el.addEventListener('input', update);
      collect = () => { repName = nameIn.value.trim(); title = titleIn.value.trim(); };
      update();
      nameIn.focus();
    }

    if (step === 2) {
      const inputs: { c: ColState; inc: HTMLInputElement; head: HTMLInputElement; width: HTMLInputElement; tot: HTMLInputElement | null }[] = [];
      for (const c of cols) {
        const row = document.createElement('div');
        row.className = 'wz-row';
        const inc = document.createElement('input');
        inc.type = 'checkbox'; inc.className = 'wz-rep-include'; inc.checked = c.include;
        const name = document.createElement('span');
        name.textContent = c.name; name.style.minWidth = '110px'; name.style.display = 'inline-block';
        const head = document.createElement('input');
        head.type = 'text'; head.value = c.heading; head.style.minWidth = '130px'; head.title = 'heading';
        const width = document.createElement('input');
        width.type = 'text'; width.value = String(c.width); width.style.minWidth = '44px'; width.style.width = '44px'; width.title = 'width';
        row.append(inc, name, head, width);
        let tot: HTMLInputElement | null = null;
        if (NUMERIC_TYPES.has(c.type.toUpperCase())) {
          tot = document.createElement('input');
          tot.type = 'checkbox'; tot.className = 'wz-rep-total'; tot.checked = c.total; tot.title = 'total';
          const totLabel = document.createElement('span');
          totLabel.textContent = 'Σ'; totLabel.style.color = '#888';
          row.append(tot, totLabel);
        } else {
          // keep checkbox indexes aligned for tests: non-numeric columns get a hidden disabled box
          tot = document.createElement('input');
          tot.type = 'checkbox'; tot.className = 'wz-rep-total'; tot.disabled = true; tot.style.visibility = 'hidden';
          row.append(tot);
        }
        shell.body.appendChild(row);
        inputs.push({ c, inc, head, width, tot });
      }
      const update = () => {
        const any = inputs.some(i => i.inc.checked);
        shell.setPreview(any ? `(columns: ${inputs.filter(i => i.inc.checked).map(i => i.c.name).join(', ')})` : null,
          any ? '' : 'Include at least one column.');
      };
      for (const i of inputs) for (const el of [i.inc, i.head, i.width, i.tot]) el?.addEventListener('input', update);
      collect = () => {
        for (const i of inputs) {
          i.c.include = i.inc.checked;
          i.c.heading = i.head.value.trim() || i.c.name;
          i.c.width = Math.max(1, parseInt(i.width.value, 10) || 12);
          i.c.total = !!i.tot?.checked && !i.tot.disabled;
        }
      };
      update();
    }

    if (step === 3) {
      const group = document.createElement('select');
      group.id = 'wz-rep-group';
      const none = document.createElement('option');
      none.value = ''; none.textContent = '(no grouping)';
      group.appendChild(none);
      for (const c of cols.filter(c => c.include)) {
        const o = document.createElement('option');
        o.value = c.name; o.textContent = c.name;
        if (groupBy === c.name) o.selected = true;
        group.appendChild(o);
      }
      shell.field('Group by (subtotals on value change; set a matching index before running)', group);
      collect = () => { groupBy = group.value; };
      shell.setPreview(`REPORT FORM ${repName}`);
    }
  };

  render();
}
```

- [ ] **Step 4: Register in the dispatcher** — in `src/ui/wizards/index.ts`:

```ts
import { openReportWizard } from './ReportWizard';
// in the switch (replace the default-warn case usage for 'report'):
    case 'report':   return openReportWizard(getCatalog(), arg, ws, run, refresh, onClose);
```

After this task the `default:` case is unreachable — delete it and the `console.warn`.

- [ ] **Step 5: Run tests to verify pass**

Run: `npx playwright test tests/assistant.spec.ts` — Expected: all pass.
Run: `npx tsc --noEmit` — Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/ui/wizards/ tests/assistant.spec.ts
git commit -m "feat(assistant): three-step report designer producing ReportDef JSON"
```

---

### Task 9: Full regression + program-run test

**Files:**
- Test: `tests/assistant.spec.ts`

- [ ] **Step 1: Add the program-run test** — append to `tests/assistant.spec.ts`:

```ts
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
```

- [ ] **Step 2: Run everything**

Run: `npm test` — Expected: all vitest pass.
Run: `npx playwright test` — Expected: ALL suites pass (assistant, integration, inventory, crm, multiarea, demos, splash).
Run: `npx tsc --noEmit` — Expected: clean.

If any pre-existing suite fails, fix the regression before proceeding (likely suspects: layout CSS affecting view sizing, or focus stealing from the sidebar).

- [ ] **Step 3: Commit**

```bash
git add tests/assistant.spec.ts
git commit -m "test(assistant): run-program flow + full regression pass"
```

---

### Task 10: Release 0.6.0 — docs, screenshots, spec closure

**Files:**
- Modify: `package.json`, `CHANGELOG.md`, `README.md`, `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-06-11-assistant-design.md`
- Create: `docs/screenshots/screenshot-assistant.png`, `docs/screenshots/screenshot-assistant-wizard.png`

- [ ] **Step 1: Version bump**

Run: `npm version 0.6.0 --no-git-tag-version`

- [ ] **Step 2: CHANGELOG entry** — prepend under the header (adjust date if needed):

```markdown
## [0.6.0] — 2026-06-11 — The Assistant

### Added
- **The Assistant** — permanent left-sidebar GUI (roadmap sub-project 5): Database / Tables / Data / Search / Reports / Programs categories. Every action generates a W3Script command and submits it through the normal terminal path — commands echo into the terminal history, teaching the language as a side effect.
- **Wizards** in the main area (like BROWSE/editor): New database, New table, Filter, New index, Find record, and a 3-step report designer producing the existing `ReportDef` JSON. Each shows a live W3Script preview while you type.
- **`catalog-request` → `catalog` WS pair** — structured lists (databases, tables+counts, active-table columns, indexes, report definitions, programs) for sidebar pickers.
- **`ReportStore.delete(name)`** and report-store test cleanup.

### Changed
- App layout is now sidebar + main area (`#assistant-sidebar` / `#main-area`); all existing view IDs unchanged.
```

- [ ] **Step 3: README** — add an "Assistant" feature bullet in `## Features`, and a section after `## Quick start`:

```markdown
## The Assistant

The sidebar on the left drives everything without typing: open or create databases and tables,
browse and filter data, build indexes, search, design and run reports, and run programs.
Every click generates a real W3Script command that echoes into the terminal — watch it to
learn the language. Wizards (New table, Filter, report designer, …) open in the main area
and show a live preview of the command they will run.
```

- [ ] **Step 4: CLAUDE.md** — three edits:
  1. Architecture tree: add `src/ui/Assistant.ts` and `src/ui/wizards/` (one line each, matching existing style), and `tests/assistant.spec.ts` to the tests list.
  2. Roadmap: mark sub-project 5 done: `5. ~~The Assistant~~ — sidebar GUI, wizards, catalog protocol ✅`
  3. Playwright suites line: add `tests/assistant.spec.ts (8 tests — sidebar, wizards, report designer, program run)`.

- [ ] **Step 5: Spec closure** — edit `docs/superpowers/specs/2026-06-11-assistant-design.md`: add `> **Status: COMPLETE** — implemented in v0.6.0` at the top (matching the report-engine spec convention) and update the catalog example's `reports` field to `[{ "name": "stocklist", "content": "{…}" }]` with a one-line note that content rides along so Edit-report can prefill the designer.

- [ ] **Step 6: Screenshots** — with `npm run dev` running, capture:
  - `docs/screenshots/screenshot-assistant.png` — sidebar + terminal after a few Assistant actions
  - `docs/screenshots/screenshot-assistant-wizard.png` — the New table wizard with a live preview
  Reference them in README's Screenshots section (matching the existing `###` blocks).

- [ ] **Step 7: Touch `vite.config.ts`** so the dev server picks up the new version (`touch vite.config.ts`), then full verification:

Run: `npm test` — all pass.
Run: `npx playwright test` — all pass (splash test validates the 0.6.0 version).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "release: v0.6.0 — The Assistant (sidebar GUI, wizards, catalog protocol)"
```

---

## Self-review notes (done while writing)

- **Spec coverage:** catalog (Task 1), split layout (Task 2), command path + echo (Task 3), wizard chrome with live preview + Esc (Task 4), all six sidebar categories incl. enable/disable + drop-confirm (Task 5), every wizard from the spec incl. New database (Tasks 6-8), error handling (validation in each wizard's `update()`, quote rejection in `quoteValue`), testing (vitest Task 1; Playwright Tasks 5-9), DoD (Task 10).
- **Deviation:** `catalog.reports` carries content (spec update scheduled in Task 10 Step 5).
- **Type consistency check:** `Catalog`/`CatalogTable`/`CatalogIndex`/`CatalogReport` defined once in Task 1 and used by `Assistant.ts` (Task 5) and wizards (Tasks 7-8); `WizardName` defined in `Assistant.ts`, imported by `wizards/index.ts`; `quoteValue` exported from FilterWizard, reused by SearchWizard; `terminal.runCommand` (Task 3) used by main.ts wiring (Task 5) and dispatcher (Task 6).
