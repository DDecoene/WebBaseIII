# Report Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `REPORT FORM` to WebBase-III — stored columnar report definitions, ASCII terminal rendering, and in-browser HTML preview panel.

**Architecture:** Report definitions are stored as JSON in `system.sqlite3` via a new `ReportStore` (mirrors `ProgramStore`). A new `ReportRunner` class takes a `ReportDef` and row data and returns `{ ascii, html }`. The Executor delegates report commands to a new `ReportCommands` class, and index commands are simultaneously extracted into `IndexCommands` — establishing the per-command-group pattern for all future sub-projects.

**Tech Stack:** TypeScript, better-sqlite3, Vitest (unit + integration tests), Playwright (E2E via demos.spec.ts)

---

## File Map

| File | Status | Purpose |
|---|---|---|
| `server/ReportStore.ts` | **Create** | save/load/list/delete report JSON in system.sqlite3 |
| `server/ReportRunner.ts` | **Create** | pure rendering: ReportDef + rows → { ascii, html } |
| `src/interpreter/IndexCommands.ts` | **Create** | index methods extracted from Executor |
| `src/interpreter/ReportCommands.ts` | **Create** | report methods delegating to ReportRunner |
| `src/ui/ReportPreview.ts` | **Create** | browser panel: show/hide #report-preview-view |
| `src/shared/types.ts` | **Modify** | add ReportDef type + report-preview ServerMessage |
| `src/interpreter/Parser.ts` | **Modify** | add CREATE_REPORT, MODIFY_REPORT, REPORT_FORM, LIST_REPORTS, DELETE_REPORT AST nodes |
| `src/interpreter/Executor.ts` | **Modify** | delegate index→IndexCommands, report→ReportCommands |
| `server/Session.ts` | **Modify** | instantiate ReportStore, handle report-related actions |
| `src/main.ts` | **Modify** | wire report-preview WS message to ReportPreview |
| `index.html` | **Modify** | add #report-preview-view panel |
| `tests/ReportStore.test.ts` | **Create** | unit tests for ReportStore |
| `tests/ReportRunner.test.ts` | **Create** | unit tests for ReportRunner rendering |
| `demos/REPORT.prg` | **Create** | demo program for demos.spec.ts auto-discovery |

---

## Task 1: ReportDef type + ServerMessage

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add ReportDef type and report-preview message**

Open `src/shared/types.ts`. After the `IIndexStore` interface, add:

```typescript
export interface ReportColumn {
  field: string;
  heading: string;
  width: number;
  total?: boolean;
}

export interface ReportDef {
  title: string;
  pageWidth?: number;
  columns: ReportColumn[];
  groupBy?: string;
  pageHeader?: string;
  pageFooter?: string;
}
```

In the `ServerMessage` union, add:
```typescript
  | { type: 'report-preview'; html: string }
```

- [ ] **Step 2: Run tests to confirm no regressions**

```bash
npm test
```
Expected: all existing tests pass (125).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add ReportDef type and report-preview ServerMessage"
```

---

## Task 2: ReportStore

**Files:**
- Create: `server/ReportStore.ts`
- Create: `tests/ReportStore.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/ReportStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ReportStore } from '../server/ReportStore.js';
import fs from 'fs';
import path from 'path';

const TEST_DB = path.join(process.cwd(), 'data', 'test_reportstore.sqlite3');

function makeStore() {
  return new ReportStore(TEST_DB);
}

afterEach(() => {
  [TEST_DB, TEST_DB + '-shm', TEST_DB + '-wal'].forEach(f => {
    if (fs.existsSync(f)) fs.unlinkSync(f);
  });
});

describe('ReportStore', () => {
  it('saves and loads a report', () => {
    const store = makeStore();
    store.save('emp', '{"title":"Emp"}');
    expect(store.load('emp')).toBe('{"title":"Emp"}');
  });

  it('returns null for missing report', () => {
    const store = makeStore();
    expect(store.load('nope')).toBeNull();
  });

  it('lists saved reports', () => {
    const store = makeStore();
    store.save('beta', '{}');
    store.save('alpha', '{}');
    expect(store.list()).toEqual(['alpha', 'beta']);
  });

  it('overwrites existing report on save', () => {
    const store = makeStore();
    store.save('emp', '{"title":"Old"}');
    store.save('emp', '{"title":"New"}');
    expect(store.load('emp')).toBe('{"title":"New"}');
  });

  it('deletes a report', () => {
    const store = makeStore();
    store.save('emp', '{}');
    store.delete('emp');
    expect(store.load('emp')).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it('delete of non-existent report does not throw', () => {
    const store = makeStore();
    expect(() => store.delete('ghost')).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to watch them fail**

```bash
npm test tests/ReportStore.test.ts
```
Expected: FAIL — `ReportStore` not found.

- [ ] **Step 3: Implement ReportStore**

Create `server/ReportStore.ts`:

```typescript
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH  = path.join(DATA_DIR, 'system.sqlite3');

export class ReportStore {
  private db: Database.Database;

  constructor(dbPath = DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        name       TEXT PRIMARY KEY,
        content    TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  load(name: string): string | null {
    const row = this.db.prepare('SELECT content FROM reports WHERE name = ?').get(name) as { content: string } | undefined;
    return row ? row.content : null;
  }

  save(name: string, content: string): void {
    this.db.prepare(`
      INSERT INTO reports (name, content, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `).run(name, content);
  }

  list(): string[] {
    const rows = this.db.prepare('SELECT name FROM reports ORDER BY name').all() as { name: string }[];
    return rows.map(r => r.name);
  }

  delete(name: string): void {
    this.db.prepare('DELETE FROM reports WHERE name = ?').run(name);
  }
}

export const reportStore = new ReportStore();
```

- [ ] **Step 4: Run tests to watch them pass**

```bash
npm test tests/ReportStore.test.ts
```
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/ReportStore.ts tests/ReportStore.test.ts
git commit -m "feat: ReportStore — save/load/list/delete report definitions in system.sqlite3"
```

---

## Task 3: ReportRunner

**Files:**
- Create: `server/ReportRunner.ts`
- Create: `tests/ReportRunner.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/ReportRunner.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { ReportRunner } from '../server/ReportRunner.js';
import type { ReportDef } from '../src/shared/types.js';

const runner = new ReportRunner();

const DEF: ReportDef = {
  title: 'Employee Report',
  pageWidth: 80,
  columns: [
    { field: 'name',   heading: 'Name',   width: 20 },
    { field: 'dept',   heading: 'Dept',   width: 15 },
    { field: 'salary', heading: 'Salary', width: 10, total: true },
  ],
  groupBy: 'dept',
  pageHeader: 'Confidential',
  pageFooter: 'Page {PAGE}',
};

const ROWS = [
  { name: 'Alice Moreau',  dept: 'Engineering', salary: 92000 },
  { name: 'Carol Smith',   dept: 'Engineering', salary: 105000 },
  { name: 'Bob Tanaka',    dept: 'Marketing',   salary: 74000 },
];

describe('ReportRunner', () => {
  it('returns ascii and html strings', () => {
    const { ascii, html } = runner.run(DEF, ROWS);
    expect(typeof ascii).toBe('string');
    expect(typeof html).toBe('string');
  });

  it('ascii includes title and page header', () => {
    const { ascii } = runner.run(DEF, ROWS);
    expect(ascii).toContain('Employee Report');
    expect(ascii).toContain('Confidential');
  });

  it('ascii includes column headings', () => {
    const { ascii } = runner.run(DEF, ROWS);
    expect(ascii).toContain('Name');
    expect(ascii).toContain('Dept');
    expect(ascii).toContain('Salary');
  });

  it('ascii includes all row data', () => {
    const { ascii } = runner.run(DEF, ROWS);
    expect(ascii).toContain('Alice Moreau');
    expect(ascii).toContain('Carol Smith');
    expect(ascii).toContain('Bob Tanaka');
  });

  it('ascii includes group subtotals', () => {
    const { ascii } = runner.run(DEF, ROWS);
    // Engineering subtotal = 92000 + 105000 = 197000
    expect(ascii).toContain('197000');
    expect(ascii).toContain('Engineering');
  });

  it('ascii includes grand total', () => {
    const { ascii } = runner.run(DEF, ROWS);
    // Grand total = 92000 + 105000 + 74000 = 271000
    expect(ascii).toContain('271000');
  });

  it('ascii includes page footer with page number', () => {
    const { ascii } = runner.run(DEF, ROWS);
    expect(ascii).toContain('Page 1');
  });

  it('handles empty result set', () => {
    const { ascii } = runner.run(DEF, []);
    expect(ascii).toContain('(No records)');
  });

  it('skips missing fields gracefully', () => {
    const { ascii } = runner.run(DEF, [{ name: 'Alice', dept: 'Eng' }]); // salary missing
    expect(ascii).toContain('Alice');
  });

  it('html contains a table element', () => {
    const { html } = runner.run(DEF, ROWS);
    expect(html).toContain('<table');
    expect(html).toContain('</table>');
  });

  it('html contains title', () => {
    const { html } = runner.run(DEF, ROWS);
    expect(html).toContain('Employee Report');
  });
});
```

- [ ] **Step 2: Run tests to watch them fail**

```bash
npm test tests/ReportRunner.test.ts
```
Expected: FAIL — `ReportRunner` not found.

- [ ] **Step 3: Implement ReportRunner**

Create `server/ReportRunner.ts`:

```typescript
import type { ReportDef, ReportColumn } from '../src/shared/types.js';

function pad(val: unknown, width: number): string {
  const s = val == null ? '' : String(val);
  return s.length >= width ? s.slice(0, width) : s + ' '.repeat(width - s.length);
}

function rpad(val: unknown, width: number): string {
  const s = val == null ? '' : String(val);
  return s.length >= width ? s.slice(0, width) : ' '.repeat(width - s.length) + s;
}

function fieldVal(row: Record<string, unknown>, field: string): unknown {
  return row[field] ?? row[field.toUpperCase()] ?? row[field.toLowerCase()] ?? '';
}

export class ReportRunner {
  run(def: ReportDef, rows: Record<string, unknown>[]): { ascii: string; html: string } {
    const cols = def.columns;
    const pageWidth = def.pageWidth ?? 80;
    const sep = '-'.repeat(pageWidth);
    const lines: string[] = [];

    // Header
    if (def.pageHeader) lines.push(def.pageHeader);
    lines.push(def.title ?? '');
    lines.push('');

    // Column headings
    lines.push(cols.map(c => pad(c.heading, c.width)).join('  '));
    lines.push(cols.map(c => '-'.repeat(c.width)).join('  '));

    if (rows.length === 0) {
      lines.push('(No records)');
    } else {
      const grandTotals: Map<number, number> = new Map();
      cols.forEach((c, i) => { if (c.total) grandTotals.set(i, 0); });

      let currentGroup: unknown = undefined;
      const groupTotals: Map<number, number> = new Map();
      cols.forEach((c, i) => { if (c.total) groupTotals.set(i, 0); });

      const flushGroup = (groupVal: unknown) => {
        if (def.groupBy && currentGroup !== undefined) {
          const row = cols.map((c, i) => {
            if (c.total) return rpad(groupTotals.get(i)?.toFixed(2) ?? '', c.width);
            return ' '.repeat(c.width);
          }).join('  ');
          lines.push(cols.filter(c => c.total).map(c => '-'.repeat(c.width)).reduce((_, v) => sep, sep));
          lines.push(`** ${groupVal} **  ${row.trimStart()}`);
          lines.push('');
          cols.forEach((_, i) => { if (groupTotals.has(i)) groupTotals.set(i, 0); });
        }
      };

      for (const row of rows) {
        const groupVal = def.groupBy ? fieldVal(row, def.groupBy) : undefined;
        if (def.groupBy && groupVal !== currentGroup) {
          flushGroup(currentGroup);
          currentGroup = groupVal;
        }
        lines.push(cols.map((c, i) => {
          const v = fieldVal(row, c.field);
          if (c.total) {
            const n = Number(v) || 0;
            groupTotals.set(i, (groupTotals.get(i) ?? 0) + n);
            grandTotals.set(i, (grandTotals.get(i) ?? 0) + n);
            return rpad(n.toFixed(2), c.width);
          }
          return pad(v, c.width);
        }).join('  '));
      }
      flushGroup(currentGroup);

      // Grand total
      lines.push(sep);
      lines.push('** Total **  ' + cols.map((c, i) => {
        if (c.total) return rpad(grandTotals.get(i)?.toFixed(2) ?? '', c.width);
        return ' '.repeat(c.width);
      }).join('  ').trimStart());
    }

    // Footer
    if (def.pageFooter) lines.push(def.pageFooter.replace('{PAGE}', '1'));

    const ascii = lines.join('\n');
    const html = this.toHtml(def, rows, cols);
    return { ascii, html };
  }

  private toHtml(def: ReportDef, rows: Record<string, unknown>[], cols: ReportColumn[]): string {
    const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const grandTotals: Map<number, number> = new Map();
    cols.forEach((c, i) => { if (c.total) grandTotals.set(i, 0); });

    let bodyRows = '';
    let currentGroup: unknown = undefined;
    const groupTotals: Map<number, number> = new Map();
    cols.forEach((c, i) => { if (c.total) groupTotals.set(i, 0); });

    const flushGroupHtml = (groupVal: unknown) => {
      if (def.groupBy && currentGroup !== undefined) {
        bodyRows += `<tr class="subtotal"><td colspan="${cols.filter(c => !c.total).length}"><strong>** ${esc(groupVal)} **</strong></td>`;
        cols.forEach((c, i) => {
          if (c.total) bodyRows += `<td class="num"><strong>${(groupTotals.get(i) ?? 0).toFixed(2)}</strong></td>`;
        });
        bodyRows += '</tr>';
        cols.forEach((_, i) => { if (groupTotals.has(i)) groupTotals.set(i, 0); });
      }
    };

    if (rows.length === 0) {
      bodyRows = `<tr><td colspan="${cols.length}">(No records)</td></tr>`;
    } else {
      for (const row of rows) {
        const groupVal = def.groupBy ? fieldVal(row, def.groupBy) : undefined;
        if (def.groupBy && groupVal !== currentGroup) {
          flushGroupHtml(currentGroup);
          currentGroup = groupVal;
        }
        bodyRows += '<tr>' + cols.map((c, i) => {
          const v = fieldVal(row, c.field);
          if (c.total) {
            const n = Number(v) || 0;
            groupTotals.set(i, (groupTotals.get(i) ?? 0) + n);
            grandTotals.set(i, (grandTotals.get(i) ?? 0) + n);
            return `<td class="num">${esc(n.toFixed(2))}</td>`;
          }
          return `<td>${esc(v)}</td>`;
        }).join('') + '</tr>';
      }
      flushGroupHtml(currentGroup);
      bodyRows += `<tr class="grandtotal"><td colspan="${cols.filter(c => !c.total).length}"><strong>** Total **</strong></td>`;
      cols.forEach((c, i) => {
        if (c.total) bodyRows += `<td class="num"><strong>${(grandTotals.get(i) ?? 0).toFixed(2)}</strong></td>`;
      });
      bodyRows += '</tr>';
    }

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>${esc(def.title)}</title>
<style>
  body { font-family: monospace; padding: 2rem; background: #fff; color: #000; }
  h1 { font-size: 1.2rem; margin-bottom: 0.25rem; }
  .pageheader { color: #666; font-size: 0.9rem; margin-bottom: 1rem; }
  table { border-collapse: collapse; width: 100%; }
  th { border-bottom: 2px solid #333; text-align: left; padding: 4px 8px; }
  td { padding: 2px 8px; }
  .num { text-align: right; }
  tr.subtotal td { border-top: 1px solid #999; background: #f5f5f5; }
  tr.grandtotal td { border-top: 2px solid #333; background: #eee; }
  .footer { margin-top: 1rem; font-size: 0.85rem; color: #666; }
  @media print { body { padding: 0; } }
</style>
</head><body>
${def.pageHeader ? `<div class="pageheader">${esc(def.pageHeader)}</div>` : ''}
<h1>${esc(def.title)}</h1>
<table>
<thead><tr>${cols.map(c => `<th>${esc(c.heading)}</th>`).join('')}</tr></thead>
<tbody>${bodyRows}</tbody>
</table>
${def.pageFooter ? `<div class="footer">${esc(def.pageFooter.replace('{PAGE}', '1'))}</div>` : ''}
</body></html>`;
  }
}
```

- [ ] **Step 4: Run tests to watch them pass**

```bash
npm test tests/ReportRunner.test.ts
```
Expected: 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/ReportRunner.ts tests/ReportRunner.test.ts
git commit -m "feat: ReportRunner — ASCII and HTML rendering with grouping, subtotals, grand totals"
```

---

## Task 4: Parser — report AST nodes

**Files:**
- Modify: `src/interpreter/Parser.ts`

- [ ] **Step 1: Add AST node types**

In `src/interpreter/Parser.ts`, find the `ASTNode` union type (around line 13). Add after `| { type: 'LIST_DATABASES' }`:

```typescript
  | { type: 'CREATE_REPORT'; name: string }
  | { type: 'MODIFY_REPORT'; name: string }
  | { type: 'REPORT_FORM';   name: string }
  | { type: 'LIST_REPORTS' }
  | { type: 'DELETE_REPORT'; name: string }
```

- [ ] **Step 2: Add parsing rules**

In `parseList()`, add after the `LIST_DATABASES` line:
```typescript
    if (this.peekKw('REPORTS')) { this.adv(); return { type: 'LIST_REPORTS' }; }
```

In the main `stmt()` switch, add new cases. Find the `case 'EDIT':` line and add nearby:
```typescript
      case 'CREATE': {
        this.adv();
        if (this.peekKw('REPORT')) { this.adv(); return { type: 'CREATE_REPORT', name: this.ident() }; }
        if (this.peekKw('TABLE'))  return this.parseCreateTable();
        throw new Error('Expected REPORT or TABLE after CREATE');
      }
      case 'MODIFY': {
        this.adv();
        if (this.peekKw('REPORT')) { this.adv(); return { type: 'MODIFY_REPORT', name: this.ident() }; }
        throw new Error('Expected REPORT after MODIFY');
      }
      case 'REPORT': {
        this.adv();
        if (this.peekKw('FORM')) { this.adv(); return { type: 'REPORT_FORM', name: this.ident() }; }
        throw new Error('Expected FORM after REPORT');
      }
      case 'DELETE': {
        this.adv();
        if (this.peekKw('REPORT')) { this.adv(); return { type: 'DELETE_REPORT', name: this.ident() }; }
        if (this.peekKw('ALL'))    return { type: 'DELETE_ALL' };
        return { type: 'DELETE' };
      }
```

> **Note:** The existing `DELETE` / `DELETE ALL` handling must be preserved — the new `DELETE REPORT` case checks for the `REPORT` keyword first, then falls through to the existing behavior.

- [ ] **Step 3: Add parser unit tests to Session.test.ts**

In `tests/Session.test.ts`, find the parser unit test section (around the `it('parses LIST AREAS'` tests) and add:

```typescript
  it('parses CREATE REPORT', () => {
    const nodes = parse('CREATE REPORT sales');
    expect(nodes[0]).toEqual({ type: 'CREATE_REPORT', name: 'sales' });
  });

  it('parses MODIFY REPORT', () => {
    const nodes = parse('MODIFY REPORT sales');
    expect(nodes[0]).toEqual({ type: 'MODIFY_REPORT', name: 'sales' });
  });

  it('parses REPORT FORM', () => {
    const nodes = parse('REPORT FORM sales');
    expect(nodes[0]).toEqual({ type: 'REPORT_FORM', name: 'sales' });
  });

  it('parses LIST REPORTS', () => {
    const nodes = parse('LIST REPORTS');
    expect(nodes[0]).toEqual({ type: 'LIST_REPORTS' });
  });

  it('parses DELETE REPORT', () => {
    const nodes = parse('DELETE REPORT sales');
    expect(nodes[0]).toEqual({ type: 'DELETE_REPORT', name: 'sales' });
  });

  it('DELETE still works after DELETE REPORT added', () => {
    const nodes = parse('DELETE');
    expect(nodes[0]).toEqual({ type: 'DELETE' });
  });

  it('DELETE ALL still works after DELETE REPORT added', () => {
    const nodes = parse('DELETE ALL');
    expect(nodes[0]).toEqual({ type: 'DELETE_ALL' });
  });
```

- [ ] **Step 4: Run all tests**

```bash
npm test
```
Expected: all tests pass (including new parser tests).

- [ ] **Step 5: Commit**

```bash
git add src/interpreter/Parser.ts tests/Session.test.ts
git commit -m "feat: parser — CREATE/MODIFY REPORT, REPORT FORM, LIST REPORTS, DELETE REPORT AST nodes"
```

---

## Task 5: Executor refactor — IndexCommands extraction

**Files:**
- Create: `src/interpreter/IndexCommands.ts`
- Modify: `src/interpreter/Executor.ts`

- [ ] **Step 1: Run tests before touching anything**

```bash
npm test
```
All must pass. This is the baseline.

- [ ] **Step 2: Create IndexCommands.ts**

Create `src/interpreter/IndexCommands.ts`. This file contains the 6 index methods extracted from `Executor.ts`. They need access to the Executor's private state — pass `Executor` as the host and access via a minimal interface:

```typescript
import type { ExecResult } from './Executor.js';
import type { Expr } from './Parser.js';
import type { IIndexStore, IndexDef } from '../shared/types.js';
import type { WorkArea } from '../shared/types.js';

export interface IndexCommandsHost {
  readonly area: WorkArea;
  readonly activeAlias: string;
  readonly indexStore: IIndexStore | null;
  readonly db: import('../shared/types.js').IDatabaseBridge;
  evalExpr(e: Expr): unknown;
  requireTable(): void;
}

export class IndexCommands {
  constructor(private host: IndexCommandsHost) {}

  async doIndexOn(expression: string, tag: string): Promise<ExecResult> {
    this.host.requireTable();
    const table = this.host.area.table!;
    const colName = `_idx_${tag.toLowerCase()}`;
    await this.host.db.exec(`ALTER TABLE ${JSON.stringify(table)} ADD COLUMN ${colName} TEXT`).catch(() => {});
    const rows = await this.host.db.query(`SELECT rowid FROM ${JSON.stringify(table)}`);
    // expression evaluation for index values happens server-side via raw SQL
    await this.host.db.exec(`UPDATE ${JSON.stringify(table)} SET ${colName} = (${expression})`).catch(async () => {
      // fallback: expression may use W3Script syntax — update via JS evaluation is not available here
      // index tag is stored for SEEK; SQLite expression may not parse — store tag only
    });
    await this.host.db.exec(`CREATE INDEX IF NOT EXISTS ${JSON.stringify('idx_' + tag.toLowerCase())} ON ${JSON.stringify(table)}(${colName})`).catch(() => {});
    this.host.indexStore?.saveIndex(table, tag, expression);
    this.host.indexStore?.setActive(table, tag);
    this.host.area.activeIndex = { tag, expression };
    return { output: [{ text: `Index created: ${tag}  ON  ${expression}`, cls: 'ok' }] };
  }

  async doSetIndex(tag: string | null): Promise<ExecResult> {
    if (!this.host.area.table) return { output: [{ text: 'No table open', cls: 'warn' }] };
    if (!tag) {
      this.host.indexStore?.clearActive(this.host.area.table);
      this.host.area.activeIndex = null;
      return { output: [{ text: 'Active index cleared — natural order', cls: 'info' }] };
    }
    const def = this.host.indexStore?.listIndexes(this.host.area.table).find(d => d.tag.toUpperCase() === tag.toUpperCase());
    if (!def) return { output: [{ text: `Index '${tag}' not found — use INDEX ON to create it`, cls: 'warn' }] };
    this.host.indexStore?.setActive(this.host.area.table, tag);
    this.host.area.activeIndex = def;
    return { output: [{ text: `Active index: ${tag}`, cls: 'ok' }] };
  }

  async doReindex(): Promise<ExecResult> {
    await this.host.db.exec('REINDEX');
    return { output: [{ text: 'REINDEX complete', cls: 'ok' }] };
  }

  async doListIndexes(): Promise<ExecResult> {
    if (!this.host.area.table) return { output: [{ text: 'No table open', cls: 'warn' }] };
    const indexes: IndexDef[] = this.host.indexStore?.listIndexes(this.host.area.table) ?? [];
    if (!indexes.length) return { output: [{ text: '(No indexes)', cls: 'info' }] };
    const active = this.host.area.activeIndex?.tag?.toUpperCase();
    const out = [
      { text: `Indexes for table: ${this.host.area.table}`, cls: 'hdr' as const },
      { text: `${'Tag'.padEnd(20)}  ${'Expression'.padEnd(40)}  Active` },
      { text: `${'-'.repeat(20)}  ${'-'.repeat(40)}  ------` },
      ...indexes.map(ix => ({
        text: `${ix.tag.padEnd(20)}  ${ix.expression.padEnd(40)}  ${ix.tag.toUpperCase() === active ? '*' : ''}`
      })),
    ];
    return { output: out };
  }

  async doSeek(valueExpr: Expr): Promise<ExecResult> {
    if (!this.host.area.activeIndex) {
      return { output: [{ text: 'No index active — use SET INDEX TO <tag> first', cls: 'warn' }] };
    }
    this.host.requireTable();
    const val = this.host.evalExpr(valueExpr);
    const tag = this.host.area.activeIndex.tag;
    const colName = `_idx_${tag.toLowerCase()}`;
    const table = this.host.area.table!;
    const rows = await this.host.db.query(
      `SELECT rowid FROM ${JSON.stringify(table)} WHERE ${colName} = ? ORDER BY ${colName} LIMIT 1`,
      [val]
    );
    if (!rows.length) {
      this.host.area._found = false;
      return { output: [{ text: 'Record not found', cls: 'warn' }] };
    }
    const rowid = (rows[0] as any).rowid as number;
    const allRows = await this.host.db.query(`SELECT rowid FROM ${JSON.stringify(table)} ORDER BY ${colName}`);
    const pos = allRows.findIndex((r: any) => r.rowid === rowid);
    this.host.area.rowPtr = pos + 1;
    this.host.area._found = true;
    const found = await this.host.db.query(`SELECT * FROM ${JSON.stringify(table)} WHERE rowid = ?`, [rowid]);
    if (found[0]) {
      const row = found[0] as Record<string, unknown>;
      return { output: [{ text: `Found at position ${pos + 1}: ` + Object.entries(row).map(([k, v]) => `${k}: ${v}`).join('  ') }] };
    }
    return { output: [] };
  }

  doFind(value: string): Promise<ExecResult> {
    const litExpr: Expr = { k: 'lit', v: value };
    return this.doSeek(litExpr);
  }
}
```

> **Important:** Before removing methods from Executor.ts, read the actual implementation of `doIndexOn`, `doSetIndex`, `doReindex`, `doListIndexes`, `doSeek`, `doFind` in `src/interpreter/Executor.ts` (lines ~573–661) and copy them verbatim into `IndexCommands`. The code above is a structural template — use the actual current Executor code.

- [ ] **Step 3: Wire IndexCommands into Executor**

In `src/interpreter/Executor.ts`:

1. Add import at top:
```typescript
import { IndexCommands } from './IndexCommands.js';
```

2. In the `Executor` class, add a field after the constructor properties:
```typescript
private indexCmds: IndexCommands;
```

3. At the end of the constructor, initialize it:
```typescript
this.indexCmds = new IndexCommands(this);
```

4. Replace the 6 index cases in the `run()` switch:
```typescript
case 'INDEX_ON':    return this.indexCmds.doIndexOn(node.expression, node.tag);
case 'SET_INDEX':   return this.indexCmds.doSetIndex(node.tag);
case 'REINDEX':     return this.indexCmds.doReindex();
case 'LIST_INDEXES':return this.indexCmds.doListIndexes();
case 'SEEK':        return this.indexCmds.doSeek(node.value);
case 'FIND':        return this.indexCmds.doFind(node.value);
```

5. Delete the 6 private methods from Executor: `doIndexOn`, `doSetIndex`, `doReindex`, `doListIndexes`, `doSeek`, `doFind`.

6. Implement the `IndexCommandsHost` interface on `Executor` — add `public` modifiers to `area`, `activeAlias`, `indexStore`, `db`, `evalExpr`, `requireTable` if they aren't already accessible.

- [ ] **Step 4: Run all tests**

```bash
npm test
```
Expected: all tests still pass. If any fail, the IndexCommands methods diverged from the originals — fix by comparing against git diff.

- [ ] **Step 5: Commit**

```bash
git add src/interpreter/IndexCommands.ts src/interpreter/Executor.ts
git commit -m "refactor: extract IndexCommands from Executor — establish command-group pattern"
```

---

## Task 6: ReportCommands + Executor wiring

**Files:**
- Create: `src/interpreter/ReportCommands.ts`
- Modify: `src/interpreter/Executor.ts`
- Modify: `server/Session.ts`

- [ ] **Step 1: Write failing integration tests**

In `tests/Session.test.ts`, add to the `describe('Session')` block:

```typescript
  it('LIST REPORTS returns empty list initially', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'command', text: 'LIST REPORTS' });
    const msg = sent.find(m => m.type === 'output');
    expect(msg).toBeDefined();
  });

  it('CREATE REPORT opens editor with blank JSON', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'command', text: 'CREATE REPORT sales' });
    const msg = sent.find(m => m.type === 'program-open') as any;
    expect(msg).toBeDefined();
    expect(msg.name).toBe('sales');
    expect(msg.content).toContain('"title"');
  });

  it('REPORT FORM returns error when report not found', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t (name CHAR(20))' });
    await session.handleMessage({ type: 'command', text: 'USE t' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'REPORT FORM ghost' });
    const out = sent.find(m => m.type === 'output') as any;
    expect(out.lines.some((l: any) => l.text.includes('not found'))).toBe(true);
  });

  it('REPORT FORM renders ASCII and sends report-preview', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE employees (name CHAR(40), dept CHAR(20), salary NUM(8,2))' });
    await session.handleMessage({ type: 'command', text: 'USE employees' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Alice", dept WITH "Eng", salary WITH 90000' });

    const reportDef = JSON.stringify({
      title: 'Test Report', columns: [
        { field: 'name', heading: 'Name', width: 20 },
        { field: 'salary', heading: 'Salary', width: 10, total: true }
      ]
    });
    await session.handleMessage({ type: 'save-program', name: '__report_testrpt', content: reportDef });
    // Seed directly into reportStore via save-report message (added in Task 6)
    await session.handleMessage({ type: 'save-report', name: 'testrpt', content: reportDef } as any);
    sent.length = 0;

    await session.handleMessage({ type: 'command', text: 'REPORT FORM testrpt' });
    const preview = sent.find(m => m.type === 'report-preview') as any;
    expect(preview).toBeDefined();
    expect(preview.html).toContain('Test Report');
    const output = sent.find(m => m.type === 'output') as any;
    expect(output.lines.some((l: any) => l.text.includes('Alice'))).toBe(true);
  });

  it('DELETE REPORT removes the definition', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'save-report', name: 'myrpt', content: '{"title":"x","columns":[]}' } as any);
    await session.handleMessage({ type: 'command', text: 'DELETE REPORT myrpt' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'REPORT FORM myrpt' });
    const out = sent.find(m => m.type === 'output') as any;
    expect(out.lines.some((l: any) => l.text.includes('not found'))).toBe(true);
  });
```

- [ ] **Step 2: Run tests to watch them fail**

```bash
npm test
```
Expected: new tests fail — `save-report` message not handled, `CREATE_REPORT` not in Executor.

- [ ] **Step 3: Create ReportCommands.ts**

Create `src/interpreter/ReportCommands.ts`:

```typescript
import type { ExecResult } from './Executor.js';
import type { ReportDef } from '../shared/types.js';
import type { IDatabaseBridge } from '../shared/types.js';
import type { WorkArea } from '../shared/types.js';
import { ReportRunner } from '../../server/ReportRunner.js';
import { reportStore } from '../../server/ReportStore.js';

export interface ReportCommandsHost {
  readonly area: WorkArea;
  readonly db: IDatabaseBridge;
}

const BLANK_REPORT = JSON.stringify({
  title: 'New Report',
  pageWidth: 80,
  columns: [
    { field: 'field1', heading: 'Heading 1', width: 20 },
    { field: 'field2', heading: 'Heading 2', width: 20, total: false }
  ],
  groupBy: '',
  pageHeader: '',
  pageFooter: 'Page {PAGE}'
}, null, 2);

const runner = new ReportRunner();

export class ReportCommands {
  constructor(private host: ReportCommandsHost) {}

  doCreateReport(name: string): ExecResult {
    const existing = reportStore.load(name) ?? BLANK_REPORT;
    return { output: [], action: 'EDIT_PRG' as any, prgName: `__report_${name}`, _reportName: name, _reportContent: existing } as any;
  }

  doModifyReport(name: string): ExecResult {
    const content = reportStore.load(name) ?? BLANK_REPORT;
    return { output: [], action: 'EDIT_PRG' as any, prgName: `__report_${name}`, _reportName: name, _reportContent: content } as any;
  }

  async doReportForm(name: string): Promise<ExecResult> {
    const json = reportStore.load(name);
    if (!json) return { output: [{ text: `** Report '${name}' not found`, cls: 'error' }] };
    if (!this.host.area.table) return { output: [{ text: '** No table open', cls: 'error' }] };

    let def: ReportDef;
    try {
      def = JSON.parse(json) as ReportDef;
    } catch (e) {
      return { output: [{ text: `** Invalid report definition: ${(e as Error).message}`, cls: 'error' }] };
    }

    const filter = this.host.area.filter;
    const sql = `SELECT * FROM ${JSON.stringify(this.host.area.table)}${filter ? ` WHERE ${filter}` : ''}`;
    const rows = await this.host.db.query(sql);
    const { ascii, html } = runner.run(def, rows);
    const lines = ascii.split('\n').map(text => ({ text }));
    return { output: lines, action: 'REPORT_PREVIEW' as any, reportHtml: html } as any;
  }

  doListReports(): ExecResult {
    const names = reportStore.list();
    if (!names.length) return { output: [{ text: '(No reports)', cls: 'info' }] };
    const out = [
      { text: 'Reports:', cls: 'hdr' as const },
      ...names.map(n => ({ text: `  ${n}` })),
    ];
    return { output: out };
  }

  doDeleteReport(name: string): ExecResult {
    reportStore.delete(name);
    return { output: [{ text: `Report deleted: ${name}`, cls: 'ok' }] };
  }
}
```

- [ ] **Step 4: Wire ReportCommands into Executor**

In `src/interpreter/Executor.ts`:

1. Add import:
```typescript
import { ReportCommands } from './ReportCommands.js';
```

2. Add field:
```typescript
private reportCmds: ReportCommands;
```

3. Initialize in constructor:
```typescript
this.reportCmds = new ReportCommands(this);
```

4. Add cases to `run()` switch:
```typescript
case 'CREATE_REPORT':  return this.reportCmds.doCreateReport(node.name);
case 'MODIFY_REPORT':  return this.reportCmds.doModifyReport(node.name);
case 'REPORT_FORM':    return this.reportCmds.doReportForm(node.name);
case 'LIST_REPORTS':   return this.reportCmds.doListReports();
case 'DELETE_REPORT':  return this.reportCmds.doDeleteReport(node.name);
```

5. Add `ExecResult` action types — in `Executor.ts` at the top where `action?` is defined:
```typescript
action?: 'BROWSE' | 'QUIT' | 'FORM_READY' | 'FORM_SUBMIT' | 'DO_PRG' | 'EDIT_PRG' | 'LIST_PROGRAMS' | 'REPORT_PREVIEW';
reportHtml?: string;
```

- [ ] **Step 5: Wire Session.ts**

In `server/Session.ts`:

1. Add import:
```typescript
import { reportStore } from './ReportStore.js';
```

2. Handle `save-report` client message (add to `handleMessage` alongside `save-program`):
```typescript
if (msg.type === 'save-report') {
  const safeName = (msg.name as string).replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  reportStore.save(safeName, msg.content as string);
  return;
}
```

3. Handle `REPORT_PREVIEW` action (add alongside the `EDIT_PRG` handler):
```typescript
if (result.action === 'REPORT_PREVIEW' && (result as any).reportHtml) {
  this.send({ type: 'report-preview', html: (result as any).reportHtml });
}
```

4. Handle `CREATE_REPORT` / `MODIFY_REPORT` — they emit `EDIT_PRG` with a `__report_` prefixed name. When the editor saves a `__report_*` program, save it to `reportStore` instead of `programStore`:
```typescript
if (msg.type === 'save-program') {
  const safeName = (msg.name as string).replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  if (safeName.startsWith('__report_')) {
    const reportName = safeName.slice('__report_'.length);
    reportStore.save(reportName, msg.content);
  } else {
    programStore.save(safeName, msg.content);
  }
  return;
}
```

- [ ] **Step 6: Run all tests**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/interpreter/ReportCommands.ts src/interpreter/Executor.ts server/Session.ts tests/Session.test.ts
git commit -m "feat: report commands — CREATE/MODIFY/REPORT FORM/LIST/DELETE wired through Executor and Session"
```

---

## Task 7: Browser — ReportPreview panel

**Files:**
- Create: `src/ui/ReportPreview.ts`
- Modify: `index.html`
- Modify: `src/main.ts`

- [ ] **Step 1: Add #report-preview-view to index.html**

In `index.html`, find the `#form-view` div and add a sibling after it:

```html
<div id="report-preview-view" class="hidden">
  <div id="report-toolbar">
    <span id="report-title">Report Preview</span>
    <span class="report-keys">Ctrl+P: print &nbsp;|&nbsp; Esc: close</span>
  </div>
  <iframe id="report-iframe" sandbox="allow-same-origin"></iframe>
</div>
```

- [ ] **Step 2: Add CSS for the preview panel**

In the project's CSS file (check `src/style.css` or similar), add:

```css
#report-preview-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #1a1a2e;
}
#report-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.4rem 1rem;
  background: #0f3460;
  color: #00ff99;
  font-family: monospace;
  font-size: 0.85rem;
}
.report-keys { color: #88ccaa; font-size: 0.8rem; }
#report-iframe {
  flex: 1;
  border: none;
  background: #fff;
}
```

- [ ] **Step 3: Create ReportPreview.ts**

Create `src/ui/ReportPreview.ts`:

```typescript
export class ReportPreview {
  private view: HTMLElement;
  private iframe: HTMLIFrameElement;
  private onClose: () => void;

  constructor(onClose: () => void) {
    this.view = document.getElementById('report-preview-view')!;
    this.iframe = document.getElementById('report-iframe') as HTMLIFrameElement;
    this.onClose = onClose;

    document.addEventListener('keydown', (e) => {
      if (!this.view.classList.contains('hidden') && e.key === 'Escape') {
        this.hide();
      }
    });
  }

  show(html: string): void {
    this.iframe.srcdoc = html;
    this.view.classList.remove('hidden');
    document.getElementById('terminal-view')?.classList.add('hidden');
    document.getElementById('grid-view')?.classList.add('hidden');
    document.getElementById('editor-view')?.classList.add('hidden');
    document.getElementById('form-view')?.classList.add('hidden');
  }

  hide(): void {
    this.view.classList.add('hidden');
    this.iframe.srcdoc = '';
    this.onClose();
  }
}
```

- [ ] **Step 4: Wire in main.ts**

In `src/main.ts`, import and instantiate `ReportPreview`, and handle the `report-preview` WS message:

1. Add import:
```typescript
import { ReportPreview } from './ui/ReportPreview.js';
```

2. After the other UI instantiations, add:
```typescript
const reportPreview = new ReportPreview(() => {
  document.getElementById('terminal-view')?.classList.remove('hidden');
});
```

3. In the WS `onmessage` handler, add a case for `report-preview`:
```typescript
} else if (msg.type === 'report-preview') {
  reportPreview.show(msg.html);
}
```

- [ ] **Step 5: Run all tests**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/ui/ReportPreview.ts index.html src/main.ts
git commit -m "feat: ReportPreview browser panel — iframe-based HTML preview, Esc to close"
```

---

## Task 8: Demo program + HELP text

**Files:**
- Create: `demos/REPORT.prg`
- Modify: `src/interpreter/Executor.ts`

- [ ] **Step 1: Create demos/REPORT.prg**

Create `demos/REPORT.prg`:

```
* ============================================================
* REPORT.prg  —  WebBase-III Report Engine showcase
* Demonstrates: CREATE REPORT, MODIFY REPORT, REPORT FORM,
*               LIST REPORTS, DELETE REPORT
* ============================================================

USE DATABASE REPORTDEMO
DROP TABLE SALES
CREATE TABLE SALES (REGION CHAR(20), PRODUCT CHAR(30), AMOUNT NUM(10,2), QTY NUM(6))
USE SALES
INDEX ON REGION TO BYREGION

APPEND RECORD
REPLACE REGION WITH "North", PRODUCT WITH "Widget A", AMOUNT WITH 1200.00, QTY WITH 10
APPEND RECORD
REPLACE REGION WITH "North", PRODUCT WITH "Widget B", AMOUNT WITH 850.50, QTY WITH 7
APPEND RECORD
REPLACE REGION WITH "South", PRODUCT WITH "Widget A", AMOUNT WITH 2100.00, QTY WITH 18
APPEND RECORD
REPLACE REGION WITH "South", PRODUCT WITH "Gadget X", AMOUNT WITH 3400.75, QTY WITH 25
APPEND RECORD
REPLACE REGION WITH "West", PRODUCT WITH "Gadget X", AMOUNT WITH 975.00, QTY WITH 8

SET INDEX TO BYREGION

* Create the report definition
STORE '{"title":"Regional Sales Report","pageWidth":80,"columns":[{"field":"REGION","heading":"Region","width":12},{"field":"PRODUCT","heading":"Product","width":25},{"field":"AMOUNT","heading":"Amount","width":12,"total":true},{"field":"QTY","heading":"Qty","width":6,"total":true}],"groupBy":"REGION","pageHeader":"WebBase-III Demo","pageFooter":"Page {PAGE}"}' TO rptdef

* Save and run
STORE .T. TO running
DO WHILE running
  CLEAR
  @ 1, 5 SAY "=== Report Engine Demo ==="
  @ 3, 5 SAY "1. Run Sales Report"
  @ 4, 5 SAY "2. List Reports"
  @ 5, 5 SAY "Q. Quit"
  STORE " " TO choice
  @ 7, 5 SAY "Choice: " GET choice
  READ

  IF UPPER(TRIM(choice)) == "1"
    REPORT FORM salesrpt
  ENDIF

  IF UPPER(TRIM(choice)) == "2"
    CLEAR
    LIST REPORTS
    INPUT "Press Enter" TO pause
  ENDIF

  IF UPPER(TRIM(choice)) == "Q"
    STORE .F. TO running
  ENDIF
ENDDO

CLOSE ALL
CLEAR
@ 2, 5 SAY "Report demo complete."
```

> **Note:** The demo relies on the report being saved before running. The `save-report` WS message is the mechanism — the demo `.prg` itself cannot call `CREATE REPORT` interactively in a smoke test. The `demos.spec.ts` smoke test just verifies the program starts without errors and quits cleanly.

- [ ] **Step 2: Add REPORT commands to HELP output**

In `src/interpreter/Executor.ts`, find the `doHelp()` method and add:

```typescript
{ text: 'CREATE REPORT <name>    — create a new report definition (opens editor)' },
{ text: 'MODIFY REPORT <name>    — edit an existing report definition' },
{ text: 'REPORT FORM <name>      — run report: ASCII + HTML preview' },
{ text: 'LIST REPORTS            — list all saved reports' },
{ text: 'DELETE REPORT <name>    — delete a report definition' },
```

- [ ] **Step 3: Run all tests**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add demos/REPORT.prg src/interpreter/Executor.ts
git commit -m "feat: REPORT.prg demo + HELP text for report commands"
```

---

## Task 9: Definition of Done

- [ ] **Step 1: Run full test suite**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 2: Bump version**

```bash
npm version 0.5.0 --no-git-tag-version
```

- [ ] **Step 3: Update CHANGELOG.md**

Add at the top (after the `---` divider):

```markdown
## [0.5.0] — 2026-06-09 — Report Engine

### Added
- **`CREATE REPORT <name>`** — create a report definition (JSON) in the editor
- **`MODIFY REPORT <name>`** — edit an existing report definition
- **`REPORT FORM <name>`** — run a columnar report: ASCII output to terminal + HTML preview panel in browser
- **`LIST REPORTS`** — list all saved report definitions
- **`DELETE REPORT <name>`** — delete a report definition
- **Report definitions** stored as JSON in `system.sqlite3` (`reports` table)
- **HTML preview panel** — print-ready iframe panel, Esc to close, Ctrl+P to print
- **`demos/REPORT.prg`** — report engine showcase, auto-discovered by `demos.spec.ts`

### Changed
- **Executor refactored** — index commands extracted to `IndexCommands.ts`; report commands in `ReportCommands.ts`; establishes the per-command-group pattern for future sub-projects
```

- [ ] **Step 4: Update README.md**

Add to the W3Script commands table (Reports section):

```markdown
### Reports
| Command | What it does |
|---|---|
| `CREATE REPORT <name>` | Create a new report definition (opens JSON editor) |
| `MODIFY REPORT <name>` | Edit an existing report definition |
| `REPORT FORM <name>` | Run report — ASCII to terminal + HTML preview panel |
| `LIST REPORTS` | List all saved report definitions |
| `DELETE REPORT <name>` | Delete a report definition |
```

Also update the Roadmap section:
```markdown
4. ~~Report & Label Engine~~ — `REPORT FORM`, group breaks, subtotals, HTML preview ✅
```

- [ ] **Step 5: Update CLAUDE.md**

Add the Reports commands table section and update the roadmap status (item 4 → ✅). Also update the architecture section to mention `ReportStore.ts`, `ReportRunner.ts`, `IndexCommands.ts`, `ReportCommands.ts`, `ReportPreview.ts`.

- [ ] **Step 6: Refresh screenshots**

Start the dev server (`npm run dev`), create a report, run `REPORT FORM`, and retake:
- `docs/screenshots/screenshot-terminal.png` (if status bar changed)
- Add new `docs/screenshots/screenshot-report.png` showing the HTML preview panel

- [ ] **Step 7: Mark spec complete**

In `docs/superpowers/specs/2026-06-09-report-engine-design.md`, add at the top:

```markdown
> **Status: COMPLETE** — implemented in v0.5.0
```

- [ ] **Step 8: Final commit**

```bash
git add .
git commit -m "release: v0.5.0 — Report Engine (REPORT FORM, HTML preview, IndexCommands refactor)"
git push
```
