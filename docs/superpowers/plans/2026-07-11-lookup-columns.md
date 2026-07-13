# Lookup Columns + Field-Bound GET (v1.3.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declare a column's legal values once (`LOOKUP SCHEDULES.SCHEDID DISPLAY DESCR` or `LOOKUP ("Lead","Won")`), and have forms, the BROWSE grid, `REPLACE`, and `grid-edit` all offer a picker and enforce membership.

**Architecture:** The lookup is stored per-column in `ColumnMetaStore` (additive `ADD COLUMN` migration — never drop-recreate, v1.2.0 shipped). A pure `resolveLookup()` turns a lookup into `{value,label}[]` options (or `null` → degrade to free text, never truncate). `@ SAY GET <name>` binds to the active table's column when one matches (fields shadow memvars — dBASE III's own rule), captures the record's rowid at GET time, and `form-submit` writes by rowid exactly like `grid-edit`, all-or-nothing, with a new `form-error` message on rejection.

**Tech Stack:** TypeScript, better-sqlite3, Vitest, Playwright. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-10-lookup-columns-design.md` (approved). GitHub issues #58 (qualifier/storage/resolver), #59 (field-bound GET), #60 (grid/REPLACE enforcement), #61 (demos), #62 (Assistant wizards).

---

## Ground rules for this repo (read before Task 1)

- **Branch:** all work on `feature/lookup-columns`, branched off `release/v1.3.0`. One PR back into `release/v1.3.0` closing #58–#62. **Never** commit to `main`.
  ```bash
  git checkout release/v1.3.0 && git pull && git checkout -b feature/lookup-columns
  ```
- **NEVER add a `Co-Authored-By: Claude` (or any AI attribution) trailer to commits.** Repo rule, overrides all defaults.
- **Run suites serially, never concurrently:** `npm test` (vitest) and `npx playwright test` both mutate `data/`. Playwright needs the dev server (`npm run dev`) on :5173/:3000, or let `playwright.config.ts`'s `webServer` start it.
- **Test discipline:** assert exact structure with `toEqual` (never only `toContain`); anything that must be *readable* in the browser asserts `toBeInViewport()`; name-keyed state gets a two-database test.
- Run a single vitest file with: `npx vitest run tests/<name>.test.ts`

## File map (what changes where)

| File | Change |
|---|---|
| `src/shared/cellValidation.ts` | `Lookup`, `LookupOption` types; `ColumnMeta.lookup/options`; membership check |
| `src/shared/types.ts` | re-export `Lookup`/`LookupOption`; `FormField.target/value/options`; `form-error` ServerMessage |
| `src/interpreter/Parser.ts` | `LOOKUP` clause on CREATE/ALTER; `ColDef.lookup`; ALTER AST carries lookup |
| `src/interpreter/LookupResolver.ts` | **new** — resolve a `Lookup` to options against an `IDatabaseBridge` |
| `server/ColumnMetaStore.ts` | 5 lookup columns, additive migration, persist/parse lookup |
| `src/interpreter/Executor.ts` | CREATE/ALTER record lookup; REPLACE membership; field-bound `doAtSayGet` |
| `server/Session.ts` | grid-open options; grid-edit membership; form-submit field writes + `form-error`; retained field list |
| `src/ui/FormLayout.ts` | `<select>` GETs, `value` prefill, `showErrors` |
| `src/terminal/Terminal.ts` | no self-close on submit; `form-error` handler; `view-terminal` closes form |
| `src/ui/Grid.ts` | `<select>` cell editor for lookup columns |
| `src/styles/main.css` | select styling + invalid-form styling |
| `src/ui/wizards/TableWizard.ts`, `ModStructWizard.ts` | per-column Lookup input |
| `demos/overtime.prg` | `SCHEDULES` table, `LOOKUP … DISPLAY`, two-form Add Employee |
| `demos/crm.prg` | `STAGE … LOOKUP ("Lead","Qualified","Proposal","Won","Lost")` |
| Tests | extend `CellValidation`, `CreateTableParse`, `ColumnMetaStore`, `GridMessages`-style; new `LookupResolver.test.ts`, `LookupEnforcement.test.ts`, `FormFieldBinding.test.ts`, `lookup.spec.ts`; update `DemoSchemas.test.ts`, `overtime.spec.ts`, `assistant.spec.ts` |

---

### Task 1: Shared lookup types + membership validation

**Files:**
- Modify: `src/shared/cellValidation.ts`
- Modify: `src/shared/types.ts:54-58`
- Test: `tests/CellValidation.test.ts`

- [ ] **Step 1.1: Write the failing tests** — append to `tests/CellValidation.test.ts`:

```ts
describe('lookup membership', () => {
  const meta = {
    baseType: 'CHAR', qualifier: 12 as number | null, scale: null as number | null,
    lookup: { kind: 'list' as const, values: ['Lead', 'Won', 'Lost'] },
    options: [
      { value: 'Lead', label: 'Lead' },
      { value: 'Won', label: 'Won' },
      { value: 'Lost', label: 'Lost' },
    ],
  };

  it('accepts a value that is in the resolved options', () => {
    expect(validateCellValue('STAGE', 'Won', meta)).toBeNull();
  });

  it('rejects a value that is not in the resolved options', () => {
    expect(validateCellValue('STAGE', 'Maybe', meta)).toMatch(/not one of the allowed values/);
  });

  it('is case-sensitive: "won" is not "Won"', () => {
    expect(validateCellValue('STAGE', 'won', meta)).toMatch(/not one of the allowed values/);
  });

  it('still allows clearing the cell', () => {
    expect(validateCellValue('STAGE', '', meta)).toBeNull();
  });

  it('skips membership when options are absent (unresolvable lookup degrades)', () => {
    const degraded = { ...meta, options: undefined };
    expect(validateCellValue('STAGE', 'Anything', degraded)).toBeNull();
  });

  it('runs the declared-type check before membership', () => {
    const intMeta = {
      baseType: 'INT', qualifier: null, scale: null,
      lookup: { kind: 'list' as const, values: ['1', '2'] },
      options: [{ value: '1', label: '1' }, { value: '2', label: '2' }],
    };
    expect(validateCellValue('N', 'abc', intMeta)).toMatch(/whole number/);
    expect(validateCellValue('N', '3', intMeta)).toMatch(/not one of the allowed values/);
    expect(validateCellValue('N', '2', intMeta)).toBeNull();
  });
});
```

- [ ] **Step 1.2: Run to verify failure**

Run: `npx vitest run tests/CellValidation.test.ts`
Expected: FAIL — TS error (`lookup` not on `ColumnMeta`) or membership assertions fail.

- [ ] **Step 1.3: Implement.** In `src/shared/cellValidation.ts`, replace the `ColumnMeta` interface (lines 9-13) with:

```ts
/** A column's legal-values constraint — a WebBase-III extension, no dBASE III ancestor. */
export type Lookup =
  | { kind: 'list'; values: string[] }
  | { kind: 'table'; table: string; column: string; display?: string };

export interface LookupOption { value: string; label: string }

export interface ColumnMeta {
  baseType: string;
  qualifier: number | null;  // CHAR(n) length, TIME(n) minute granularity, NUM(p,s) precision
  scale: number | null;      // NUM(p,s) scale
  lookup?: Lookup | null;    // declared constraint (may be unresolvable)
  options?: LookupOption[];  // resolved values — absent when the lookup degraded
}
```

Then rename the existing `validateCellValue` body: change the `switch` so every `return null` inside a case falls through to a shared membership check. Concretely, replace the whole function with:

```ts
export function validateCellValue(
  colName: string,
  value: string,
  meta: ColumnMeta | null | undefined,
): string | null {
  if (!meta) return null;                       // untracked column — no constraint
  const v = value.trim();
  if (v === '') return null;                    // clearing a cell is always allowed
  const typeErr = declaredTypeError(colName, v, meta);
  if (typeErr) return typeErr;
  // Membership runs only when the lookup resolved; an unresolvable lookup
  // degrades to free text rather than locking the column.
  if (meta.options && meta.options.length && !meta.options.some(o => o.value === v)) {
    return `${colName}: "${v}" is not one of the allowed values`;
  }
  return null;
}

function declaredTypeError(colName: string, v: string, meta: ColumnMeta): string | null {
  switch (meta.baseType.toUpperCase()) {
    /* …the existing switch body from the old validateCellValue, verbatim… */
  }
}
```

Move the old `switch (meta.baseType.toUpperCase()) { … }` block (old lines 34-88) into `declaredTypeError` unchanged.

In `src/shared/types.ts`, directly under the `ColumnTypeInfo` line (58), add:

```ts
export type { Lookup, LookupOption } from './cellValidation';
```

- [ ] **Step 1.4: Run to verify pass**

Run: `npx vitest run tests/CellValidation.test.ts` → PASS. Then `npm test` → all green (nothing else touches the shape yet).

- [ ] **Step 1.5: Commit**

```bash
git add src/shared/cellValidation.ts src/shared/types.ts tests/CellValidation.test.ts
git commit -m "feat(#58): Lookup types + membership check in shared cell validation"
```

---

### Task 2: Parser — the LOOKUP clause

**Files:**
- Modify: `src/interpreter/Parser.ts` (`ColDef` line 79, ALTER AST lines 62-63, `parseCreate` line 467, `parseAlter` line 540)
- Test: `tests/CreateTableParse.test.ts`

- [ ] **Step 2.1: Write the failing tests** — append to `tests/CreateTableParse.test.ts`:

```ts
describe('LOOKUP column qualifier', () => {
  it('parses a table lookup with DISPLAY', () => {
    expect(cols('CREATE TABLE e (SCHEDID CHAR(4) LOOKUP SCHEDULES.SCHEDID DISPLAY DESCR)')).toEqual([
      { name: 'SCHEDID', colType: 'CHAR', size: 4,
        lookup: { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID', display: 'DESCR' } },
    ]);
  });

  it('parses a table lookup without DISPLAY', () => {
    expect(cols('CREATE TABLE e (SCHEDID CHAR(4) LOOKUP SCHEDULES.SCHEDID)')).toEqual([
      { name: 'SCHEDID', colType: 'CHAR', size: 4,
        lookup: { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID' } },
    ]);
  });

  it('parses a literal list, preserving case', () => {
    expect(cols('CREATE TABLE d (STAGE CHAR(12) LOOKUP ("Lead","Won","Lost"))')).toEqual([
      { name: 'STAGE', colType: 'CHAR', size: 12,
        lookup: { kind: 'list', values: ['Lead', 'Won', 'Lost'] } },
    ]);
  });

  it('a LOOKUP column can be followed by more columns', () => {
    expect(cols('CREATE TABLE d (STAGE CHAR(12) LOOKUP ("A","B"), VALUE NUM(8,2))').map((c: any) => c.name))
      .toEqual(['STAGE', 'VALUE']);
  });

  it('rejects an empty LOOKUP list', () => {
    expect(() => parse('CREATE TABLE d (STAGE CHAR(12) LOOKUP ())')).toThrow(/LOOKUP/i);
  });

  it('rejects unquoted values in a LOOKUP list', () => {
    expect(() => parse('CREATE TABLE d (STAGE CHAR(12) LOOKUP (Lead,Won))')).toThrow(/LOOKUP/i);
  });

  it('rejects LOOKUP with no source at all', () => {
    expect(() => parse('CREATE TABLE d (STAGE CHAR(12) LOOKUP)')).toThrow(/LOOKUP/i);
  });

  it('rejects a table lookup missing the .column part', () => {
    expect(() => parse('CREATE TABLE d (STAGE CHAR(12) LOOKUP SCHEDULES)')).toThrow(/LOOKUP/i);
  });

  it('carries LOOKUP through ALTER TABLE ADD', () => {
    const ast = parse('ALTER TABLE t ADD STAGE CHAR(12) LOOKUP ("A","B")')[0] as any;
    expect(ast.lookup).toEqual({ kind: 'list', values: ['A', 'B'] });
  });

  it('carries LOOKUP through ALTER TABLE ALTER', () => {
    const ast = parse('ALTER TABLE t ALTER STAGE CHAR LOOKUP S.C DISPLAY D')[0] as any;
    expect(ast.lookup).toEqual({ kind: 'table', table: 'S', column: 'C', display: 'D' });
  });
});
```

- [ ] **Step 2.2: Run to verify failure**

Run: `npx vitest run tests/CreateTableParse.test.ts`
Expected: FAIL — `lookup` is undefined on parsed cols / no throw for malformed forms.

- [ ] **Step 2.3: Implement.** In `src/interpreter/Parser.ts`:

At the top, add the import:
```ts
import type { Lookup } from '../shared/cellValidation';
```

Change line 79 to:
```ts
export interface ColDef { name: string; colType: string; size?: number; scale?: number; lookup?: Lookup; }
```

Change the ALTER AST variants (lines 62-63) to:
```ts
  | { type: 'ALTER_TABLE'; name: string; op: 'ADD'; col: string; colType: string; lookup: Lookup | null }
  | { type: 'ALTER_TABLE'; name: string; op: 'ALTER'; col: string; colType: string; lookup: Lookup | null }
```

In `parseCreate` (line 467), replace the `cols.push(...)` line (491) and the lines just above it so the loop body reads:

```ts
        const cname = this.colName();
        const ctype = this.colType(cname);
        let size: number | undefined;
        let scale: number | undefined;
        if (this.peek().type === 'LPAREN') {
          this.adv();
          size = this.typeArg(cname);
          if (this.peek().type === 'COMMA') {
            this.adv();
            scale = this.typeArg(cname);
          }
          this.expectRParen(`type qualifier for column '${cname}'`);
        }
        let lookup: Lookup | undefined;
        if (this.peekKw('LOOKUP')) lookup = this.parseLookupClause(cname);
        cols.push(lookup !== undefined
          ? { name: cname, colType: ctype, size, scale, lookup }
          : { name: cname, colType: ctype, size, scale });
```

(The conditional push keeps `toEqual` shapes in the pre-existing tests intact — no `lookup: undefined` key.)

Below `expectRParen` (line 532), add:

```ts
  // LOOKUP <table>.<column> [DISPLAY <column>]  |  LOOKUP ("a","b",...)
  // A WebBase-III extension (documented deviation — dBASE III had no lookup).
  private parseLookupClause(colName: string): Lookup {
    this.adv(); // LOOKUP
    if (this.peek().type === 'LPAREN') {
      this.adv();
      const values: string[] = [];
      while (!this.end() && this.peek().type !== 'RPAREN') {
        if (this.peek().type !== 'STR') {
          this.createErr(`expected a quoted string in the LOOKUP list for column '${colName}'`);
        }
        values.push(this.adv().val);
        if (this.peek().type === 'COMMA') this.adv();
        else break;
      }
      this.expectRParen(`LOOKUP list for column '${colName}'`);
      if (!values.length) this.createErr(`the LOOKUP list for column '${colName}' is empty`);
      return { kind: 'list', values };
    }
    const t = this.peek();
    if (t.type !== 'ID' && t.type !== 'KW') {
      this.createErr(`expected <table>.<column> or a ("…") list after LOOKUP for column '${colName}'`);
    }
    const table = this.adv().val;
    if (this.peek().type !== 'DOT') {
      this.createErr(`expected <table>.<column> after LOOKUP for column '${colName}'`);
    }
    this.adv(); // DOT
    const cTok = this.peek();
    if (cTok.type !== 'ID' && cTok.type !== 'KW') {
      this.createErr(`expected a column after '${table}.' in the LOOKUP for column '${colName}'`);
    }
    const column = this.adv().val;
    if (this.peekKw('DISPLAY')) {
      this.adv();
      const dTok = this.peek();
      if (dTok.type !== 'ID' && dTok.type !== 'KW') {
        this.createErr(`expected a display column after DISPLAY in the LOOKUP for column '${colName}'`);
      }
      return { kind: 'table', table, column, display: this.adv().val };
    }
    return { kind: 'table', table, column };
  }
```

In `parseAlter` (line 540), change the ADD and ALTER lines to parse an optional clause:

```ts
    if (this.peekKw('ADD'))    { this.adv(); this.skipKw('COLUMN'); const col = this.ident(); const colType = this.ident(); this.skipTypeSize(); const lookup = this.peekKw('LOOKUP') ? this.parseLookupClause(col) : null; return { type: 'ALTER_TABLE', name, op: 'ADD', col, colType, lookup }; }
    if (this.peekKw('ALTER'))  { this.adv(); this.skipKw('COLUMN'); const col = this.ident(); const colType = this.ident(); this.skipTypeSize(); const lookup = this.peekKw('LOOKUP') ? this.parseLookupClause(col) : null; return { type: 'ALTER_TABLE', name, op: 'ALTER', col, colType, lookup }; }
```

Note: `DISPLAY` is already a lexer keyword (`Lexer.ts:15`); `LOOKUP` lexes as `ID`, and `peekKw` matches both — **no lexer change**.

- [ ] **Step 2.4: Run to verify pass**

Run: `npx vitest run tests/CreateTableParse.test.ts` → PASS. Then `npm test` — `Executor.ts` will fail to compile until the ALTER node's new `lookup` property is consumed; if `npm test` reports type errors in `doAlterTable`, that is expected and fixed in Task 5. If vitest doesn't typecheck (it often doesn't), everything passes now.

- [ ] **Step 2.5: Commit**

```bash
git add src/interpreter/Parser.ts tests/CreateTableParse.test.ts
git commit -m "feat(#58): parse LOOKUP column qualifier in CREATE TABLE and ALTER TABLE"
```

---

### Task 3: ColumnMetaStore — persist lookups, additive migration

**Files:**
- Modify: `server/ColumnMetaStore.ts`
- Modify: `src/shared/types.ts:61-68` (`IColumnMetaStore`)
- Test: `tests/ColumnMetaStore.test.ts`

- [ ] **Step 3.1: Write the failing tests** — append to `tests/ColumnMetaStore.test.ts`:

```ts
describe('lookup persistence', () => {
  it('round-trips a table lookup with display', () => {
    const store = new ColumnMetaStore(tmpDbPath());
    store.setColumnType('DB', 'EMPLOYEES', 'SCHEDID', 'CHAR', 4, null,
      { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID', display: 'DESCR' });
    expect(store.getColumnType('DB', 'EMPLOYEES', 'SCHEDID')).toEqual({
      baseType: 'CHAR', qualifier: 4, scale: null,
      lookup: { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID', display: 'DESCR' },
    });
  });

  it('round-trips a literal list preserving order and case', () => {
    const store = new ColumnMetaStore(tmpDbPath());
    store.setColumnType('DB', 'DEALS', 'STAGE', 'CHAR', 12, null,
      { kind: 'list', values: ['Lead', 'Won', 'lost'] });
    expect(store.getColumnType('DB', 'DEALS', 'STAGE')?.lookup)
      .toEqual({ kind: 'list', values: ['Lead', 'Won', 'lost'] });
  });

  it('omits the lookup key entirely when none was declared', () => {
    const store = new ColumnMetaStore(tmpDbPath());
    store.setColumnType('DB', 'T', 'PLAIN', 'CHAR', 10, null);
    expect(store.getColumnType('DB', 'T', 'PLAIN')).toEqual({ baseType: 'CHAR', qualifier: 10, scale: null });
  });

  it('re-declaring a column without a lookup clears the stored one', () => {
    const store = new ColumnMetaStore(tmpDbPath());
    store.setColumnType('DB', 'T', 'C', 'CHAR', 4, null, { kind: 'list', values: ['A'] });
    store.setColumnType('DB', 'T', 'C', 'CHAR', 4, null);
    expect(store.getColumnType('DB', 'T', 'C')?.lookup).toBeUndefined();
  });

  it('scopes lookups per database (two DBs, same table+column)', () => {
    const store = new ColumnMetaStore(tmpDbPath());
    store.setColumnType('A', 'T', 'C', 'CHAR', 4, null, { kind: 'list', values: ['X'] });
    store.setColumnType('B', 'T', 'C', 'CHAR', 4, null, { kind: 'list', values: ['Y'] });
    expect(store.getColumnType('A', 'T', 'C')?.lookup).toEqual({ kind: 'list', values: ['X'] });
    expect(store.getColumnType('B', 'T', 'C')?.lookup).toEqual({ kind: 'list', values: ['Y'] });
  });

  it('listColumnTypes carries lookups', () => {
    const store = new ColumnMetaStore(tmpDbPath());
    store.setColumnType('DB', 'T', 'C', 'CHAR', 4, null, { kind: 'list', values: ['A'] });
    expect(store.listColumnTypes('DB', 'T').C.lookup).toEqual({ kind: 'list', values: ['A'] });
  });

  // A v1.2.0 store has db_name and scale but no lookup columns. It SHIPPED —
  // it must be migrated additively, never dropped (dropping erases users'
  // declared TIME(15)/NUM(p,s) types).
  it('adds lookup columns to a v1.2.0 store without losing existing rows', () => {
    const p = tmpDbPath();
    const v120 = new Database(p);
    v120.exec(`
      CREATE TABLE column_types (
        db_name    TEXT NOT NULL,
        table_name TEXT NOT NULL,
        col_name   TEXT NOT NULL,
        base_type  TEXT NOT NULL,
        qualifier  INTEGER,
        scale      INTEGER,
        PRIMARY KEY (db_name, table_name, col_name)
      );
    `);
    v120.prepare('INSERT INTO column_types VALUES (?,?,?,?,?,?)')
      .run('OVERTIME', 'SCHEDULEDAYS', 'TIMEIN', 'TIME', 15, null);
    v120.close();

    const store = new ColumnMetaStore(p);
    // The pre-existing row SURVIVES:
    expect(store.getColumnType('OVERTIME', 'SCHEDULEDAYS', 'TIMEIN'))
      .toEqual({ baseType: 'TIME', qualifier: 15, scale: null });
    // And the new columns work:
    store.setColumnType('OVERTIME', 'EMPLOYEES', 'SCHEDID', 'CHAR', 4, null,
      { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID' });
    expect(store.getColumnType('OVERTIME', 'EMPLOYEES', 'SCHEDID')?.lookup)
      .toEqual({ kind: 'table', table: 'SCHEDULES', column: 'SCHEDID' });
  });
});
```

- [ ] **Step 3.2: Run to verify failure**

Run: `npx vitest run tests/ColumnMetaStore.test.ts`
Expected: FAIL — `setColumnType` takes 6 args / no lookup columns.

- [ ] **Step 3.3: Implement.** In `src/shared/types.ts`, change the `IColumnMetaStore.setColumnType` signature (line 62) to:

```ts
  setColumnType(dbName: string, tableName: string, colName: string, baseType: string, qualifier: number | null, scale: number | null, lookup?: Lookup | null): void;
```

and add `Lookup` to the type import at the top of the interface's file — it's the same file; the re-export from Task 1 makes `Lookup` available; add a direct import so the interface can reference it:

```ts
import type { Lookup as _Lookup } from './cellValidation';
```

(Or simply reference `import('./cellValidation').Lookup` inline — match the style used for `ColumnTypeInfo` on line 58:)

```ts
  setColumnType(dbName: string, tableName: string, colName: string, baseType: string, qualifier: number | null, scale: number | null, lookup?: import('./cellValidation').Lookup | null): void;
```

In `server/ColumnMetaStore.ts`, replace the whole file body with:

```ts
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { IColumnMetaStore, ColumnTypeInfo, Lookup } from '../src/shared/types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH  = path.join(DATA_DIR, 'system.sqlite3');

const LOOKUP_COLS = ['lookup_kind', 'lookup_table', 'lookup_col', 'lookup_display', 'lookup_values'] as const;

interface Row {
  baseType: string; qualifier: number | null; scale: number | null;
  lookup_kind: string | null; lookup_table: string | null; lookup_col: string | null;
  lookup_display: string | null; lookup_values: string | null;
}

function rowToMeta(r: Row): ColumnTypeInfo {
  const meta: ColumnTypeInfo = { baseType: r.baseType, qualifier: r.qualifier, scale: r.scale };
  if (r.lookup_kind === 'list') {
    meta.lookup = { kind: 'list', values: JSON.parse(r.lookup_values ?? '[]') as string[] };
  } else if (r.lookup_kind === 'table' && r.lookup_table && r.lookup_col) {
    meta.lookup = r.lookup_display
      ? { kind: 'table', table: r.lookup_table, column: r.lookup_col, display: r.lookup_display }
      : { kind: 'table', table: r.lookup_table, column: r.lookup_col };
  }
  return meta;
}

const SELECT_COLS = `base_type AS baseType, qualifier, scale,
       lookup_kind, lookup_table, lookup_col, lookup_display, lookup_values`;

/**
 * Declared column types (+ optional lookup constraint), keyed by
 * (database, table, column).
 *
 * SQLite only records a storage affinity (TEXT/REAL/INTEGER), which cannot tell
 * TIME from DATE from CHAR, LOGICAL from INT, or recover a NUM(p,s) qualifier.
 * The grid, forms and REPLACE need the declared type + lookup to validate writes.
 *
 * Scoping by database matters: two databases may each hold a table of the same
 * name with different column types.
 */
export class ColumnMetaStore implements IColumnMetaStore {
  private db: Database.Database;

  constructor(dbPath = DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS column_types (
        db_name        TEXT NOT NULL,
        table_name     TEXT NOT NULL,
        col_name       TEXT NOT NULL,
        base_type      TEXT NOT NULL,
        qualifier      INTEGER,
        scale          INTEGER,
        lookup_kind    TEXT,
        lookup_table   TEXT,
        lookup_col     TEXT,
        lookup_display TEXT,
        lookup_values  TEXT,
        PRIMARY KEY (db_name, table_name, col_name)
      );
    `);
    // v1.2.0 dev migration: the first cut of this table (#43) had neither db_name
    // nor scale. Those rows never shipped in a release, so rebuilding was safe.
    let cols = this.db.prepare('PRAGMA table_info(column_types)').all() as { name: string }[];
    if (!cols.some(c => c.name === 'db_name') || !cols.some(c => c.name === 'scale')) {
      this.db.exec(`
        DROP TABLE column_types;
        CREATE TABLE column_types (
          db_name        TEXT NOT NULL,
          table_name     TEXT NOT NULL,
          col_name       TEXT NOT NULL,
          base_type      TEXT NOT NULL,
          qualifier      INTEGER,
          scale          INTEGER,
          lookup_kind    TEXT,
          lookup_table   TEXT,
          lookup_col     TEXT,
          lookup_display TEXT,
          lookup_values  TEXT,
          PRIMARY KEY (db_name, table_name, col_name)
        );
      `);
      cols = this.db.prepare('PRAGMA table_info(column_types)').all() as { name: string }[];
    }
    // v1.3.0 lookup migration (#58): v1.2.0 SHIPPED, so this one must be
    // additive — dropping the table here would silently erase every released
    // user's declared TIME(15)/NUM(p,s) types.
    for (const col of LOOKUP_COLS) {
      if (!cols.some(c => c.name === col)) {
        this.db.exec(`ALTER TABLE column_types ADD COLUMN ${col} TEXT`);
      }
    }
  }

  setColumnType(dbName: string, tableName: string, colName: string, baseType: string, qualifier: number | null, scale: number | null, lookup: Lookup | null = null): void {
    const kind = lookup?.kind ?? null;
    const lTable = lookup?.kind === 'table' ? lookup.table : null;
    const lCol = lookup?.kind === 'table' ? lookup.column : null;
    const lDisplay = lookup?.kind === 'table' ? (lookup.display ?? null) : null;
    const lValues = lookup?.kind === 'list' ? JSON.stringify(lookup.values) : null;
    this.db.prepare(`
      INSERT INTO column_types (db_name, table_name, col_name, base_type, qualifier, scale,
                                lookup_kind, lookup_table, lookup_col, lookup_display, lookup_values)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(db_name, table_name, col_name) DO UPDATE SET
        base_type = excluded.base_type, qualifier = excluded.qualifier, scale = excluded.scale,
        lookup_kind = excluded.lookup_kind, lookup_table = excluded.lookup_table,
        lookup_col = excluded.lookup_col, lookup_display = excluded.lookup_display,
        lookup_values = excluded.lookup_values
    `).run(dbName, tableName, colName, baseType, qualifier, scale, kind, lTable, lCol, lDisplay, lValues);
  }

  getColumnType(dbName: string, tableName: string, colName: string): ColumnTypeInfo | null {
    const row = this.db.prepare(
      `SELECT ${SELECT_COLS} FROM column_types WHERE db_name = ? AND table_name = ? AND col_name = ?`
    ).get(dbName, tableName, colName) as Row | undefined;
    return row ? rowToMeta(row) : null;
  }

  listColumnTypes(dbName: string, tableName: string): Record<string, ColumnTypeInfo> {
    const rows = this.db.prepare(
      `SELECT col_name AS colName, ${SELECT_COLS} FROM column_types WHERE db_name = ? AND table_name = ?`
    ).all(dbName, tableName) as Array<Row & { colName: string }>;
    const out: Record<string, ColumnTypeInfo> = {};
    for (const r of rows) out[r.colName] = rowToMeta(r);
    return out;
  }

  renameColumn(dbName: string, tableName: string, oldName: string, newName: string): void {
    this.db.prepare(
      'UPDATE column_types SET col_name = ? WHERE db_name = ? AND table_name = ? AND col_name = ?'
    ).run(newName, dbName, tableName, oldName);
  }

  dropColumn(dbName: string, tableName: string, colName: string): void {
    this.db.prepare('DELETE FROM column_types WHERE db_name = ? AND table_name = ? AND col_name = ?')
      .run(dbName, tableName, colName);
  }

  dropTable(dbName: string, tableName: string): void {
    this.db.prepare('DELETE FROM column_types WHERE db_name = ? AND table_name = ?').run(dbName, tableName);
  }
}

export const columnMetaStore = new ColumnMetaStore();
```

- [ ] **Step 3.4: Run to verify pass**

Run: `npx vitest run tests/ColumnMetaStore.test.ts` → PASS (including the pre-existing tests, whose `toEqual({baseType, qualifier, scale})` assertions survive because `rowToMeta` omits `lookup` when null). Run `npx vitest run tests/ColumnMeta.test.ts` too — it exercises the store through Session.

- [ ] **Step 3.5: Commit**

```bash
git add server/ColumnMetaStore.ts src/shared/types.ts tests/ColumnMetaStore.test.ts
git commit -m "feat(#58): persist lookups in ColumnMetaStore via additive ADD COLUMN migration"
```

---

### Task 4: LookupResolver

**Files:**
- Create: `src/interpreter/LookupResolver.ts`
- Test: `tests/LookupResolver.test.ts`

Note: the spec names `server/LookupResolver.ts`, but the Executor (in `src/interpreter/`) must call it for REPLACE enforcement and GET options, and `src/` must not import from `server/`. It lives in `src/interpreter/` — same behavior, dependency-clean. Record this deviation in the PR description.

- [ ] **Step 4.1: Write the failing tests** — create `tests/LookupResolver.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServerDatabaseBridge, __closeAndEvictForTest } from '../server/ServerDatabaseBridge';
import { resolveLookup, LOOKUP_MAX_VALUES } from '../src/interpreter/LookupResolver';
import fs from 'fs';
import path from 'path';

const TEST_DB = 'test_lookupresolver';
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, `${TEST_DB}.sqlite3`);

describe('resolveLookup', () => {
  let bridge: ServerDatabaseBridge;

  beforeEach(async () => {
    bridge = new ServerDatabaseBridge();
    await bridge.openDatabase(TEST_DB);
  });

  afterEach(async () => {
    await bridge.closeDatabase();
    __closeAndEvictForTest(TEST_DB);
    for (const f of [DB_PATH, DB_PATH + '-shm', DB_PATH + '-wal']) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  it('resolves a literal list verbatim, value === label', async () => {
    expect(await resolveLookup(bridge, { kind: 'list', values: ['Lead', 'Won'] })).toEqual([
      { value: 'Lead', label: 'Lead' },
      { value: 'Won', label: 'Won' },
    ]);
  });

  it('resolves a table lookup to DISTINCT ordered values', async () => {
    await bridge.exec('CREATE TABLE SCHEDULES (SCHEDID TEXT, DESCR TEXT)');
    await bridge.exec("INSERT INTO SCHEDULES VALUES ('S002','Short day'),('S001','Std day'),('S001','Std day')");
    expect(await resolveLookup(bridge, { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID' })).toEqual([
      { value: 'S001', label: 'S001' },
      { value: 'S002', label: 'S002' },
    ]);
  });

  it('uses the DISPLAY column as the label, storing the value', async () => {
    await bridge.exec('CREATE TABLE SCHEDULES (SCHEDID TEXT, DESCR TEXT)');
    await bridge.exec("INSERT INTO SCHEDULES VALUES ('S001','Std day'),('S002','Short day')");
    expect(await resolveLookup(bridge, { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID', display: 'DESCR' })).toEqual([
      { value: 'S001', label: 'Std day' },
      { value: 'S002', label: 'Short day' },
    ]);
  });

  it('returns null when the source table is missing', async () => {
    expect(await resolveLookup(bridge, { kind: 'table', table: 'NOPE', column: 'X' })).toBeNull();
  });

  it('returns null when the source column is missing', async () => {
    await bridge.exec('CREATE TABLE SCHEDULES (SCHEDID TEXT)');
    expect(await resolveLookup(bridge, { kind: 'table', table: 'SCHEDULES', column: 'MISSING' })).toBeNull();
  });

  it('returns null when the display column is missing', async () => {
    await bridge.exec('CREATE TABLE SCHEDULES (SCHEDID TEXT)');
    expect(await resolveLookup(bridge, { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID', display: 'MISSING' })).toBeNull();
  });

  it('returns null when the source is empty', async () => {
    await bridge.exec('CREATE TABLE SCHEDULES (SCHEDID TEXT)');
    expect(await resolveLookup(bridge, { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID' })).toBeNull();
  });

  it('degrades (null), never truncates, over the ceiling', async () => {
    await bridge.exec('CREATE TABLE BIG (V TEXT)');
    const values = Array.from({ length: LOOKUP_MAX_VALUES + 1 }, (_, i) => `('v${String(i).padStart(5, '0')}')`);
    await bridge.exec(`INSERT INTO BIG VALUES ${values.join(',')}`);
    expect(await resolveLookup(bridge, { kind: 'table', table: 'BIG', column: 'V' })).toBeNull();
  });

  it('skips NULL/empty values from the source', async () => {
    await bridge.exec('CREATE TABLE SCHEDULES (SCHEDID TEXT)');
    await bridge.exec("INSERT INTO SCHEDULES VALUES ('S001'),(NULL),('')");
    expect(await resolveLookup(bridge, { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID' })).toEqual([
      { value: 'S001', label: 'S001' },
    ]);
  });
});
```

- [ ] **Step 4.2: Run to verify failure**

Run: `npx vitest run tests/LookupResolver.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4.3: Implement.** Create `src/interpreter/LookupResolver.ts`:

```ts
import type { IDatabaseBridge } from '../shared/types';
import type { Lookup, LookupOption } from '../shared/cellValidation';

export const LOOKUP_MAX_VALUES = 1000;

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Resolve a lookup to concrete {value,label} options, or null when it cannot
 * be honoured (missing table/column, empty source, or over the ceiling).
 * Callers degrade to free text and skip membership enforcement on null —
 * an unresolvable lookup is a warning, not a lock. Never truncates: a clipped
 * option list would hide legal values while membership validation rejected them.
 */
export async function resolveLookup(db: IDatabaseBridge, lookup: Lookup): Promise<LookupOption[] | null> {
  if (lookup.kind === 'list') {
    return lookup.values.map(v => ({ value: v, label: v }));
  }
  if (!(await db.tableExists(lookup.table))) return null;
  const cols = await db.getStructure(lookup.table);
  const valueCol = cols.find(c => c.name.toUpperCase() === lookup.column.toUpperCase());
  if (!valueCol) return null;
  let displayCol;
  if (lookup.display) {
    displayCol = cols.find(c => c.name.toUpperCase() === lookup.display!.toUpperCase());
    if (!displayCol) return null;
  }
  const sel = displayCol ? `${q(valueCol.name)}, ${q(displayCol.name)}` : q(valueCol.name);
  const rows = await db.query(
    `SELECT DISTINCT ${sel} FROM ${q(lookup.table)} ORDER BY 1 LIMIT ${LOOKUP_MAX_VALUES + 1}`
  );
  const options: LookupOption[] = [];
  for (const r of rows) {
    const value = String(r[valueCol.name] ?? '');
    if (value === '') continue;                      // NULL/empty is not a pickable value
    const label = displayCol ? String(r[displayCol.name] ?? value) : value;
    options.push({ value, label });
  }
  if (options.length === 0 || options.length > LOOKUP_MAX_VALUES) return null;
  return options;
}
```

- [ ] **Step 4.4: Run to verify pass**

Run: `npx vitest run tests/LookupResolver.test.ts` → PASS.

- [ ] **Step 4.5: Commit**

```bash
git add src/interpreter/LookupResolver.ts tests/LookupResolver.test.ts
git commit -m "feat(#58): LookupResolver — options or degrade, never truncate"
```

---

### Task 5: Executor — record lookups on CREATE/ALTER, enforce on REPLACE

**Files:**
- Modify: `src/interpreter/Executor.ts` (`doCreateTable` line 762, `doAlterTable` lines 916-923 and 950-976, `doReplaceAll` line 427)
- Test: `tests/LookupEnforcement.test.ts` (new)

- [ ] **Step 5.1: Write the failing tests** — create `tests/LookupEnforcement.test.ts` (Session-harness style, same as `tests/GridMessages.test.ts`):

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { Session } from '../server/Session';
import type { ServerMessage } from '../src/shared/types';
import fs from 'fs';
import path from 'path';

let dbCounter = 0;
function uniqueDb() { return `test_lookupenf_${Date.now()}_${++dbCounter}`; }

afterEach(() => {
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.toLowerCase().startsWith('test_lookupenf_'))
      .forEach(f => fs.unlinkSync(path.join(dataDir, f)));
  }
});

async function setup() {
  const sent: ServerMessage[] = [];
  const session = new Session((m) => sent.push(m));
  const run = async (text: string) => {
    sent.length = 0;
    await session.handleMessage({ type: 'command', text });
    const out = sent.filter(m => m.type === 'output') as any[];
    return out.flatMap(o => o.lines).map((l: any) => l.text).join('\n');
  };
  await run(`USE DATABASE ${uniqueDb()}`);
  return { session, sent, run };
}

describe('REPLACE enforces lookup membership', () => {
  it('rejects an off-list value on a literal-lookup column and does not write it', async () => {
    const { run } = await setup();
    await run('CREATE TABLE DEALS (TITLE CHAR(20), STAGE CHAR(12) LOOKUP ("Lead","Won","Lost"))');
    await run('USE DEALS');
    await run('APPEND RECORD');
    const out = await run('REPLACE STAGE WITH "Maybe"');
    expect(out).toMatch(/not one of the allowed values/);
    expect(await run('LIST')).not.toContain('Maybe');
  });

  it('accepts an on-list value (exact case)', async () => {
    const { run } = await setup();
    await run('CREATE TABLE DEALS (TITLE CHAR(20), STAGE CHAR(12) LOOKUP ("Lead","Won","Lost"))');
    await run('USE DEALS');
    await run('APPEND RECORD');
    expect(await run('REPLACE STAGE WITH "Won"')).toContain('Replaced');
    expect(await run('LIST')).toContain('Won');
  });

  it('rejects the wrong case', async () => {
    const { run } = await setup();
    await run('CREATE TABLE DEALS (STAGE CHAR(12) LOOKUP ("Won"))');
    await run('USE DEALS');
    await run('APPEND RECORD');
    expect(await run('REPLACE STAGE WITH "won"')).toMatch(/not one of the allowed values/);
  });

  it('enforces a table lookup against live source rows', async () => {
    const { run } = await setup();
    await run('CREATE TABLE SCHEDULES (SCHEDID CHAR(4), DESCR CHAR(30))');
    await run('USE SCHEDULES');
    await run('APPEND RECORD');
    await run('REPLACE SCHEDID WITH "S001", DESCR WITH "Std day"');
    await run('CREATE TABLE EMPLOYEES (EMPID CHAR(4), SCHEDID CHAR(4) LOOKUP SCHEDULES.SCHEDID DISPLAY DESCR)');
    await run('USE EMPLOYEES');
    await run('APPEND RECORD');
    expect(await run('REPLACE SCHEDID WITH "S999"')).toMatch(/not one of the allowed values/);
    expect(await run('REPLACE SCHEDID WITH "S001"')).toContain('Replaced');
  });

  it('a new source row becomes legal immediately (fresh re-resolve at write time)', async () => {
    const { run } = await setup();
    await run('CREATE TABLE SCHEDULES (SCHEDID CHAR(4))');
    await run('USE SCHEDULES');
    await run('APPEND RECORD');
    await run('REPLACE SCHEDID WITH "S001"');
    await run('CREATE TABLE EMPLOYEES (SCHEDID CHAR(4) LOOKUP SCHEDULES.SCHEDID)');
    await run('USE EMPLOYEES');
    await run('APPEND RECORD');
    expect(await run('REPLACE SCHEDID WITH "S002"')).toMatch(/not one of the allowed values/);
    await run('USE SCHEDULES');
    await run('APPEND RECORD');
    await run('REPLACE SCHEDID WITH "S002"');
    await run('USE EMPLOYEES');
    expect(await run('REPLACE SCHEDID WITH "S002"')).toContain('Replaced');
  });

  it('an unresolvable lookup degrades: the write is allowed', async () => {
    const { run } = await setup();
    await run('CREATE TABLE EMPLOYEES (SCHEDID CHAR(4) LOOKUP GHOSTTABLE.SCHEDID)');
    await run('USE EMPLOYEES');
    await run('APPEND RECORD');
    expect(await run('REPLACE SCHEDID WITH "ANY"')).toContain('Replaced');
  });

  it('ALTER TABLE ADD carries the lookup', async () => {
    const { run } = await setup();
    await run('CREATE TABLE T (A CHAR(4))');
    await run('USE T');
    await run('ALTER TABLE T ADD STAGE CHAR LOOKUP ("X","Y")');
    await run('APPEND RECORD');
    expect(await run('REPLACE STAGE WITH "Z"')).toMatch(/not one of the allowed values/);
    expect(await run('REPLACE STAGE WITH "X"')).toContain('Replaced');
  });

  it('two databases keep independent lookups for the same table+column', async () => {
    const sent: ServerMessage[] = [];
    const session = new Session((m) => sent.push(m));
    const run = async (text: string) => {
      sent.length = 0;
      await session.handleMessage({ type: 'command', text });
      const out = sent.filter(m => m.type === 'output') as any[];
      return out.flatMap(o => o.lines).map((l: any) => l.text).join('\n');
    };
    const dbA = uniqueDb(); const dbB = uniqueDb();
    await run(`USE DATABASE ${dbA}`);
    await run('CREATE TABLE T (C CHAR(4) LOOKUP ("A"))');
    await run(`USE DATABASE ${dbB}`);
    await run('CREATE TABLE T (C CHAR(4) LOOKUP ("B"))');
    await run('USE T');
    await run('APPEND RECORD');
    expect(await run('REPLACE C WITH "A"')).toMatch(/not one of the allowed values/);
    expect(await run('REPLACE C WITH "B"')).toContain('Replaced');
  });
});
```

- [ ] **Step 5.2: Run to verify failure**

Run: `npx vitest run tests/LookupEnforcement.test.ts`
Expected: FAIL — off-list REPLACE succeeds (`Replaced` where a rejection is expected).

- [ ] **Step 5.3: Implement.** In `src/interpreter/Executor.ts`:

Add the import (top of file, next to the `cellValidation` import):
```ts
import { resolveLookup } from './LookupResolver';
```

In `doCreateTable` (line 782-786), pass the lookup through:
```ts
    for (const c of cols) {
      this.columnMetaStore?.setColumnType(
        this.metaDb, name, c.name, c.colType.toUpperCase(), c.size ?? null, c.scale ?? null, c.lookup ?? null,
      );
    }
```

In `doAlterTable`, the ADD branch (line 920) and ALTER branch (line 971) each change their `setColumnType` call:
```ts
      this.columnMetaStore?.setColumnType(this.metaDb, name, node.col, node.colType.toUpperCase(), null, null, node.lookup);
```
(both places — the node now carries `lookup: Lookup | null` from Task 2).

In `doReplaceAll` (lines 431-441), replace the TIME-only validation loop with:

```ts
    // Declared-type enforcement on REPLACE is deliberately narrow: TIME since
    // #43, plus lookup membership (#58) — membership is additive, because no
    // pre-#58 column declares a lookup, so no existing program changes behavior.
    // The grid still validates every declared type (#45).
    for (const p of pairs) {
      if (p.value === null || p.value === undefined) continue;
      const info = this.columnMetaStore?.getColumnType(this.metaDb, this.area.table!, p.field);
      if (!info) continue;
      if (info.baseType === 'TIME') {
        const err = validateCellValue(p.field, String(p.value), info);
        if (err) throw new Error(err);
      }
      if (info.lookup) {
        // Re-resolve at write time: a value that became legal after any cached
        // list was built is accepted; a vanished one is rejected. Unresolvable
        // (null) skips membership — degradation, not a lock.
        const options = await resolveLookup(this.db, info.lookup);
        if (options) {
          const err = validateCellValue(p.field, String(p.value), { ...info, options });
          if (err) throw new Error(err);
        }
      }
    }
```

- [ ] **Step 5.4: Run to verify pass**

Run: `npx vitest run tests/LookupEnforcement.test.ts` → PASS. Then `npm test` → all green (fix any TypeScript fallout from the ALTER node change — the compiler will point at every site).

- [ ] **Step 5.5: Commit**

```bash
git add src/interpreter/Executor.ts tests/LookupEnforcement.test.ts
git commit -m "feat(#58,#60): record lookups on CREATE/ALTER; REPLACE enforces membership"
```

---

### Task 6: Session — grid-open ships options; grid-edit enforces membership

**Files:**
- Modify: `server/Session.ts` (`sendGridData` line 359, `grid-edit` case line 74)
- Test: `tests/LookupEnforcement.test.ts` (extend)

- [ ] **Step 6.1: Write the failing tests** — append to `tests/LookupEnforcement.test.ts`:

```ts
describe('grid messages with lookups', () => {
  it('grid-open ships resolved options for a lookup column — exact list', async () => {
    const { session, sent, run } = await setup();
    await run('CREATE TABLE DEALS (STAGE CHAR(12) LOOKUP ("Lead","Won","Lost"))');
    await run('USE DEALS');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const grid = sent.find(m => m.type === 'grid-open') as any;
    expect(grid.columnTypes.STAGE.options).toEqual([
      { value: 'Lead', label: 'Lead' },
      { value: 'Won', label: 'Won' },
      { value: 'Lost', label: 'Lost' },
    ]);
  });

  it('grid-open degrades an unresolvable lookup: no options, a warning line', async () => {
    const { session, sent, run } = await setup();
    await run('CREATE TABLE E (SCHEDID CHAR(4) LOOKUP GHOST.SCHEDID)');
    await run('USE E');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const grid = sent.find(m => m.type === 'grid-open') as any;
    expect(grid.columnTypes.SCHEDID.options).toBeUndefined();
    const out = sent.filter(m => m.type === 'output') as any[];
    expect(out.flatMap(o => o.lines).map((l: any) => l.text).join('\n')).toMatch(/lookup for SCHEDID/i);
  });

  it('grid-edit rejects an off-list value server-side (forged message path)', async () => {
    const { session, sent, run } = await setup();
    await run('CREATE TABLE DEALS (STAGE CHAR(12) LOOKUP ("Lead","Won"))');
    await run('USE DEALS');
    await run('APPEND RECORD');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const grid = sent.find(m => m.type === 'grid-open') as any;

    sent.length = 0;
    await session.handleMessage({ type: 'grid-edit', rowid: grid.rows[0]._rowid, col: 'STAGE', value: 'Hacked' });
    const out = sent.find(m => m.type === 'output') as any;
    expect(out.lines.map((l: any) => l.text).join('\n')).toMatch(/not one of the allowed values/);
    expect(await run('LIST')).not.toContain('Hacked');
  });

  it('grid-edit accepts an on-list value', async () => {
    const { session, sent, run } = await setup();
    await run('CREATE TABLE DEALS (STAGE CHAR(12) LOOKUP ("Lead","Won"))');
    await run('USE DEALS');
    await run('APPEND RECORD');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const grid = sent.find(m => m.type === 'grid-open') as any;
    await session.handleMessage({ type: 'grid-edit', rowid: grid.rows[0]._rowid, col: 'STAGE', value: 'Won' });
    expect(await run('LIST')).toContain('Won');
  });
});
```

- [ ] **Step 6.2: Run to verify failure**

Run: `npx vitest run tests/LookupEnforcement.test.ts`
Expected: FAIL — `options` undefined on grid-open; forged grid-edit writes 'Hacked'.

- [ ] **Step 6.3: Implement.** In `server/Session.ts`:

Add imports:
```ts
import { resolveLookup } from '../src/interpreter/LookupResolver.js';
import type { ClientMessage, ServerMessage, ColInfo, OutputLine, FormField } from '../src/shared/types.js';
```
(extends the existing type import on line 11; `FormField` is used in Task 8.)

Replace `sendGridData` (lines 359-369) with:

```ts
  private async sendGridData(): Promise<void> {
    const area = this.executor.area;
    if (!area.table) {
      this.send({ type: 'output', lines: [{ text: 'No table selected', cls: 'error' }] });
      return;
    }
    const columns = await this.bridge.getStructure(area.table);
    const columnTypes = columnMetaStore.listColumnTypes(area.db ?? '', area.table);
    const warns: OutputLine[] = [];
    for (const [col, meta] of Object.entries(columnTypes)) {
      if (!meta.lookup) continue;
      const options = await resolveLookup(this.bridge, meta.lookup);
      if (options) meta.options = options;
      else warns.push({ text: `** Warning: lookup for ${col} could not be resolved — free entry`, cls: 'warn' });
    }
    if (warns.length) this.send({ type: 'output', lines: warns });
    const rows = await this.executor.getOrderedRowsWithIds(2000);
    this.send({ type: 'grid-open', table: area.table, filter: area.filter, columns, columnTypes, rows });
  }
```

In the `grid-edit` case (lines 74-93), replace the validation lines (80-86) with:

```ts
            const db = this.executor.area.db ?? '';
            let meta = columnMetaStore.getColumnType(db, table, col);
            if (meta?.lookup) {
              // Fresh re-resolve at write time — the option list the client got
              // at grid-open may be stale, and a forged message never saw one.
              const options = await resolveLookup(this.bridge, meta.lookup);
              meta = { ...meta, options: options ?? undefined };
            }
            const err = validateCellValue(col, value, meta);
            if (err) {
              this.send({ type: 'output', lines: [{ text: `** ${err}`, cls: 'error' }] });
              await this.sendGridData();
              break;
            }
```

- [ ] **Step 6.4: Run to verify pass**

Run: `npx vitest run tests/LookupEnforcement.test.ts` → PASS. Then `npx vitest run tests/GridMessages.test.ts tests/ColumnMeta.test.ts` → still green.

- [ ] **Step 6.5: Commit**

```bash
git add server/Session.ts tests/LookupEnforcement.test.ts
git commit -m "feat(#60): grid-open resolves lookup options; grid-edit enforces membership fresh"
```

---

### Task 7: Executor — field-bound @ SAY GET

**Files:**
- Modify: `src/shared/types.ts:12-17` (`FormField`)
- Modify: `src/interpreter/Executor.ts:542-549` (`doAtSayGet`)
- Test: `tests/FormFieldBinding.test.ts` (new)

- [ ] **Step 7.1: Write the failing tests** — create `tests/FormFieldBinding.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { Session } from '../server/Session';
import type { ServerMessage } from '../src/shared/types';
import fs from 'fs';
import path from 'path';

let dbCounter = 0;
function uniqueDb() { return `test_formbind_${Date.now()}_${++dbCounter}`; }

afterEach(() => {
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.toLowerCase().startsWith('test_formbind_'))
      .forEach(f => fs.unlinkSync(path.join(dataDir, f)));
  }
});

async function setup() {
  const sent: ServerMessage[] = [];
  const session = new Session((m) => sent.push(m));
  const run = async (text: string) => {
    sent.length = 0;
    await session.handleMessage({ type: 'command', text });
    const out = sent.filter(m => m.type === 'output') as any[];
    return out.flatMap(o => o.lines).map((l: any) => l.text).join('\n');
  };
  await run(`USE DATABASE ${uniqueDb()}`);
  await run('CREATE TABLE EMPLOYEES (EMPID CHAR(4), NAME CHAR(30), SCHEDID CHAR(4) LOOKUP ("S001","S002"))');
  await run('USE EMPLOYEES');
  return { session, sent, run };
}

/** Run a multi-line block as one command (the terminal sends blocks whole). */
async function runBlock(session: Session, sent: ServerMessage[], src: string) {
  sent.length = 0;
  await session.handleMessage({ type: 'command', text: src });
}

describe('field-bound @ SAY GET', () => {
  it('binds a GET whose name matches a column: field target, prefill, options', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    await run('REPLACE EMPID WITH "E001", NAME WITH "Ada", SCHEDID WITH "S001"');

    await runBlock(session, sent, '@ 4, 5 SAY "Name: " GET NAME\n@ 5, 5 SAY "Sched: " GET SCHEDID\nREAD');
    const form = sent.find(m => m.type === 'form-open') as any;
    expect(form).toBeDefined();
    const nameField = form.fields.find((f: any) => f.varName === 'NAME');
    expect(nameField.target.kind).toBe('field');
    expect(nameField.target.column).toBe('NAME');
    expect(typeof nameField.target.rowid).toBe('number');
    expect(nameField.value).toBe('Ada');
    const schedField = form.fields.find((f: any) => f.varName === 'SCHEDID');
    expect(schedField.options).toEqual([
      { value: 'S001', label: 'S001' },
      { value: 'S002', label: 'S002' },
    ]);
    expect(schedField.value).toBe('S001');
  });

  it('fields shadow memory variables: an existing var of the same name loses', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    await run('STORE "not-the-field" TO NAME');
    await runBlock(session, sent, '@ 4, 5 SAY "Name: " GET NAME\nREAD');
    const form = sent.find(m => m.type === 'form-open') as any;
    expect(form.fields[0].target.kind).toBe('field');
  });

  it('falls back to a memory variable when no column matches', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    await runBlock(session, sent, '@ 4, 5 SAY "Id: " GET M_EMP\nREAD');
    const form = sent.find(m => m.type === 'form-open') as any;
    expect(form.fields[0].target.kind).toBe('var');
    expect(form.fields[0].value).toBe('');
  });

  it('is a variable GET when no table is in use', async () => {
    const sent: ServerMessage[] = [];
    const session = new Session((m) => sent.push(m));
    await session.handleMessage({ type: 'command', text: '@ 4, 5 SAY "X: " GET WHATEVER\nREAD' });
    const form = sent.find(m => m.type === 'form-open') as any;
    expect(form.fields[0].target.kind).toBe('var');
  });

  it('errors on a field-bound GET with no current record', async () => {
    const { session, sent } = await setup();  // table is empty
    await runBlock(session, sent, '@ 4, 5 SAY "Name: " GET NAME\nREAD');
    const out = sent.filter(m => m.type === 'output') as any[];
    expect(out.flatMap(o => o.lines).map((l: any) => l.text).join('\n'))
      .toMatch(/GET NAME: no current record/);
    expect(sent.find(m => m.type === 'form-open')).toBeUndefined();
  });

  it('degrades a dead lookup on a field GET: no options, warn line, form still opens', async () => {
    const { session, sent, run } = await setup();
    await run('ALTER TABLE EMPLOYEES ADD BADCOL CHAR LOOKUP GHOST.X');
    await run('APPEND RECORD');
    await runBlock(session, sent, '@ 4, 5 SAY "B: " GET BADCOL\nREAD');
    const form = sent.find(m => m.type === 'form-open') as any;
    expect(form.fields[0].options).toBeUndefined();
    const out = sent.filter(m => m.type === 'output') as any[];
    expect(out.flatMap(o => o.lines).map((l: any) => l.text).join('\n')).toMatch(/lookup for BADCOL/i);
  });
});
```

- [ ] **Step 7.2: Run to verify failure**

Run: `npx vitest run tests/FormFieldBinding.test.ts`
Expected: FAIL — `target` undefined on fields.

- [ ] **Step 7.3: Implement.** In `src/shared/types.ts`, replace `FormField` (lines 12-17) with:

```ts
export interface FormField {
  row: number;
  col: number;
  label: string;
  /** The submit key. For a field-bound GET this is the column name. */
  varName: string;
  /** What form-submit writes. Absent (legacy INPUT/@SAY paths) means 'var'. */
  target?:
    | { kind: 'var' }
    | { kind: 'field'; column: string; table: string; db: string; rowid: number };
  /** Prefill. Field GETs carry the record's value; var GETs stay '' (unchanged UX). */
  value?: string;
  /** Resolved lookup options — render a <select>. Absent = free text. */
  options?: import('./cellValidation').LookupOption[];
}
```

In `src/interpreter/Executor.ts`, replace `doAtSayGet` (lines 542-549) with:

```ts
  private async doAtSayGet(rowE: Expr, colE: Expr, textE: Expr, varName: string): Promise<ExecResult> {
    await this.refreshRecCount(true);
    const row = Number(this.evalExpr(rowE));
    const col = Number(this.evalExpr(colE));
    const text = String(this.evalExpr(textE));
    const out: OutputLine[] = [];

    // Field binding: a GET whose name matches a column of the active table edits
    // the current record (dBASE III behavior — fields shadow memory variables;
    // this is why the m_ prefix convention exists). Capturing the rowid here means
    // form-submit writes by rowid, like grid-edit — pointer motion between here
    // and submit cannot retarget the write.
    if (this.area.table) {
      const cols = await this.db.getStructure(this.area.table);
      const match = cols.find(c => c.name.toUpperCase() === varName.toUpperCase());
      if (match) {
        const cur = await this.fetchCurrentRow();
        if (!cur) throw new Error(`GET ${match.name}: no current record`);
        const field: FormField = {
          row, col, label: text, varName: match.name,
          target: {
            kind: 'field', column: match.name, table: this.area.table,
            db: this.area.db ?? '', rowid: Number(cur._rowid),
          },
          value: String(cur[match.name] ?? ''),
        };
        const info = this.columnMetaStore?.getColumnType(this.metaDb, this.area.table, match.name);
        if (info?.lookup) {
          const options = await resolveLookup(this.db, info.lookup);
          if (options) field.options = options;
          else out.push({ text: `** Warning: lookup for ${match.name} could not be resolved — free entry`, cls: 'warn' });
        }
        this.pendingForm.push(field);
        return { output: out };
      }
    }
    this.pendingForm.push({ row, col, label: text, varName, target: { kind: 'var' }, value: '' });
    return { output: out };
  }
```

(`OutputLine` and `FormField` are already imported at the top of `Executor.ts`.)

- [ ] **Step 7.4: Run to verify pass**

Run: `npx vitest run tests/FormFieldBinding.test.ts` → PASS. Then `npm test`: **expect fallout** in any test asserting exact `form-open` field shapes — `tests/GridMessages.test.ts:143` uses `toMatchObject` (safe). Fix anything that asserts exact field object equality by adding the new keys. All green before committing.

- [ ] **Step 7.5: Commit**

```bash
git add src/shared/types.ts src/interpreter/Executor.ts tests/FormFieldBinding.test.ts
git commit -m "feat(#59): field-bound @ SAY GET — fields shadow memvars, rowid captured at GET"
```

---

### Task 8: Session — form-submit writes fields, all-or-nothing, form-error

**Files:**
- Modify: `src/shared/types.ts` (ServerMessage union, line 143)
- Modify: `server/Session.ts` (`form-submit` case line 49, FORM_READY branch line 301, `grid-exit` line 158, `abort-suspended` line 175)
- Test: `tests/FormFieldBinding.test.ts` (extend)

- [ ] **Step 8.1: Write the failing tests** — append to `tests/FormFieldBinding.test.ts`:

```ts
describe('form-submit with field targets', () => {
  it('writes submitted field values to the record and resumes', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    await runBlock(session, sent, '@ 4, 5 SAY "Name: " GET NAME\n@ 5, 5 SAY "Sched: " GET SCHEDID\nREAD');
    expect(sent.find(m => m.type === 'form-open')).toBeDefined();

    sent.length = 0;
    await session.handleMessage({ type: 'form-submit', values: { NAME: 'Grace', SCHEDID: 'S002' } });
    expect(sent.find(m => m.type === 'view-terminal')).toBeDefined();
    const listing = await run('LIST');
    expect(listing).toContain('Grace');
    expect(listing).toContain('S002');
  });

  it('rejects the whole submit when one field is off-list: form-error, nothing written', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    await runBlock(session, sent, '@ 4, 5 SAY "Name: " GET NAME\n@ 5, 5 SAY "Sched: " GET SCHEDID\nREAD');

    sent.length = 0;
    await session.handleMessage({ type: 'form-submit', values: { NAME: 'Grace', SCHEDID: 'BOGUS' } });
    const err = sent.find(m => m.type === 'form-error') as any;
    expect(err).toBeDefined();
    expect(err.errors).toEqual([
      { varName: 'SCHEDID', message: 'SCHEDID: "BOGUS" is not one of the allowed values' },
    ]);
    expect(sent.find(m => m.type === 'view-terminal')).toBeUndefined();
    // All-or-nothing: NAME was valid but must NOT have been written.
    expect(await run('LIST')).not.toContain('Grace');
  });

  it('a corrected resubmit after form-error succeeds (state was retained)', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    await runBlock(session, sent, '@ 4, 5 SAY "Sched: " GET SCHEDID\nREAD');

    await session.handleMessage({ type: 'form-submit', values: { SCHEDID: 'BOGUS' } });
    sent.length = 0;
    await session.handleMessage({ type: 'form-submit', values: { SCHEDID: 'S001' } });
    expect(sent.find(m => m.type === 'form-error')).toBeUndefined();
    expect(await run('LIST')).toContain('S001');
  });

  it('a forged form-submit naming a column the form never offered cannot write it', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    // The form only offers the variable M_X — EMPID is NOT a field of this form.
    await runBlock(session, sent, '@ 4, 5 SAY "X: " GET M_X\nREAD');

    await session.handleMessage({ type: 'form-submit', values: { M_X: 'ok', EMPID: 'HAX' } });
    // EMPID lands in a memory variable at worst — never in the table.
    expect(await run('LIST')).not.toContain('HAX');
  });

  it('field type validation applies too (DATE column gets a real date)', async () => {
    const { session, sent, run } = await setup();
    await run('ALTER TABLE EMPLOYEES ADD HIRED DATE');
    await run('APPEND RECORD');
    await runBlock(session, sent, '@ 4, 5 SAY "Hired: " GET HIRED\nREAD');

    sent.length = 0;
    await session.handleMessage({ type: 'form-submit', values: { HIRED: '2026-02-30' } });
    const err = sent.find(m => m.type === 'form-error') as any;
    expect(err.errors[0].message).toMatch(/not a real date/);
  });

  it('Escape (grid-exit) writes nothing and clears the retained fields', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    await runBlock(session, sent, '@ 4, 5 SAY "Name: " GET NAME\nREAD');

    await session.handleMessage({ type: 'grid-exit' });
    expect(await run('LIST')).not.toContain('Grace');
    // A form-submit arriving after the cancel must not write the field either.
    await session.handleMessage({ type: 'form-submit', values: { NAME: 'Grace' } });
    expect(await run('LIST')).not.toContain('Grace');
  });

  it('bare INPUT still stores its value (the #50 regression stays fixed)', async () => {
    const sent: ServerMessage[] = [];
    const session = new Session((m) => sent.push(m));
    await session.handleMessage({ type: 'command', text: 'INPUT "Name? " TO who' });
    await session.handleMessage({ type: 'form-submit', values: { WHO: 'Ada' } });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: '? who' });
    const out = sent.find(m => m.type === 'output') as any;
    expect(out.lines.map((l: any) => l.text).join('\n')).toContain('Ada');
  });
});
```

- [ ] **Step 8.2: Run to verify failure**

Run: `npx vitest run tests/FormFieldBinding.test.ts`
Expected: FAIL — no `form-error` type; field values go to vars, not the table.

- [ ] **Step 8.3: Implement.** In `src/shared/types.ts`, add to the `ServerMessage` union (after the `'error'` line, 153):

```ts
  | { type: 'form-error'; errors: { varName: string; message: string }[] }
```

In `server/Session.ts`:

Add a member next to `pendingContinuation` (line 16):
```ts
  // The field list of the form currently awaiting submit. form-submit resolves
  // write targets from THIS, never from the client's message — a forged
  // form-submit cannot redirect a write to an arbitrary column (same reasoning
  // as grid-edit's authoritative re-check).
  private pendingFormFields: FormField[] | null = null;
```

Replace the whole `form-submit` case (lines 49-72) with:

```ts
        case 'form-submit': {
          const fields = this.pendingFormFields ?? [];
          const fieldByName = new Map<string, FormField>();
          for (const f of fields) {
            if (f.target?.kind === 'field') fieldByName.set(f.varName, f);
          }
          // Variables first — and always. A bare `INPUT "…" TO var` at the REPL
          // leaves no continuation, and gating the assignment on one silently
          // discarded the typed value (#50). Keys that are not field targets of
          // THIS form are variables, whatever the client claims.
          for (const [k, v] of Object.entries(msg.values)) {
            if (!fieldByName.has(k)) this.executor.setVar(k, v);
          }
          // Field writes are all-or-nothing: validate every value (declared type
          // + freshly-resolved lookup membership) before writing any.
          const errors: { varName: string; message: string }[] = [];
          const writes: { table: string; column: string; rowid: number; value: string }[] = [];
          for (const f of fieldByName.values()) {
            const t = f.target as Extract<NonNullable<FormField['target']>, { kind: 'field' }>;
            const value = msg.values[f.varName] ?? '';
            let meta = columnMetaStore.getColumnType(t.db, t.table, t.column);
            if (meta?.lookup) {
              const options = await resolveLookup(this.bridge, meta.lookup);
              meta = { ...meta, options: options ?? undefined };
            }
            const err = validateCellValue(t.column, value, meta);
            if (err) errors.push({ varName: f.varName, message: err });
            else writes.push({ table: t.table, column: t.column, rowid: t.rowid, value });
          }
          if (errors.length) {
            // Keep pendingFormFields AND pendingContinuation intact: the client
            // keeps the form open and resubmits corrected values.
            this.send({ type: 'form-error', errors });
            break;
          }
          this.pendingFormFields = null;
          for (const w of writes) {
            await this.bridge.exec(
              `UPDATE ${q(w.table)} SET ${q(w.column)} = ? WHERE rowid = ?`,
              [w.value, w.rowid]
            );
          }
          // The client no longer closes the form on submit — it waits for the
          // verdict. Success returns it to the terminal before resuming.
          this.send({ type: 'view-terminal' });
          if (this.pendingContinuation !== null) {
            const cont = this.pendingContinuation;
            const fromProgram = this.pendingFromProgram;
            this.pendingContinuation = null;
            if (fromProgram) this.executor.enterProgram();
            try {
              const done = await this.handleExecResult(await cont());
              if (!done) this.sendStatus();
            } finally {
              if (fromProgram) this.executor.exitProgram();
            }
          } else {
            this.sendStatus();
          }
          break;
        }
```

In `handleExecResult`, the FORM_READY branch (lines 301-306) gains one line:

```ts
    if (result.action === 'FORM_READY' && result.formFields) {
      this.pendingContinuation = result.continuation ?? null;
      this.pendingFromProgram = this.executor.isInProgram();
      this.pendingFormFields = result.formFields;
      this.send({ type: 'form-open', fields: result.formFields });
      return true;
    }
```

In the `grid-exit` case (line 158), add as the first statement of the case:
```ts
          this.pendingFormFields = null;   // Escape writes nothing
```

In the `abort-suspended` case (line 175), add the same line right after `this.pendingContinuation = null;`:
```ts
            this.pendingFormFields = null;
```

- [ ] **Step 8.4: Run to verify pass**

Run: `npx vitest run tests/FormFieldBinding.test.ts` → PASS. Then `npm test` full: the new success path sends `view-terminal` where it previously didn't — fix any test asserting exact message sequences around `form-submit` (search: `grep -rn "form-submit" tests/*.test.ts`). All green before committing.

- [ ] **Step 8.5: Commit**

```bash
git add src/shared/types.ts server/Session.ts tests/FormFieldBinding.test.ts
git commit -m "feat(#59): form-submit writes field targets by rowid, all-or-nothing, form-error on rejection"
```

---

### Task 9: Browser — FormLayout selects, prefill, error display; Terminal wiring

**Files:**
- Modify: `src/ui/FormLayout.ts` (whole file)
- Modify: `src/terminal/Terminal.ts:255-280` (`openForm`), `:115-122` (handlers)
- Modify: `src/styles/main.css` (next to the `.f-get` rules at line 281)

No unit test drives the DOM — Task 14's Playwright spec covers this in a real browser. Implement, then verify by hand (`npm run dev`, run the Task 14 scenario manually or move straight to Task 14).

- [ ] **Step 9.1: Rewrite `src/ui/FormLayout.ts`:**

```ts
import type { FormField } from '../shared/types';

// Character-cell dimensions (must match CSS --char-w / --char-h)
const CW = 8.4;
const CH = 21;

type GetControl = HTMLInputElement | HTMLSelectElement;

export class FormLayout {
  private canvas: HTMLElement;
  private footer: HTMLElement;
  private getInputs: Map<string, GetControl> = new Map();
  private onSubmit: (values: Map<string, string>) => void;
  private onCancel: () => void;
  private boundKey: (e: KeyboardEvent) => void;

  constructor(
    onSubmit: (values: Map<string, string>) => void,
    onCancel: () => void,
  ) {
    this.canvas = document.getElementById('form-canvas')!;
    this.footer = document.getElementById('form-footer')!;
    this.onSubmit = onSubmit;
    this.onCancel = onCancel;
    this.boundKey = this.handleKey.bind(this);
  }

  render(fields: FormField[]) {
    this.canvas.innerHTML = '';
    this.getInputs.clear();

    fields.forEach(f => {
      const x = Math.round(f.col * CW);
      const y = Math.round(f.row * CH);

      if (f.label) {
        const el = document.createElement('span');
        el.className = 'f-say';
        el.textContent = f.label;
        el.style.left = x + 'px';
        el.style.top  = y + 'px';
        this.canvas.appendChild(el);
      }

      if (f.varName) {
        const labelWidth = f.label.length * CW + 8;
        let ctl: GetControl;
        if (f.options && f.options.length) {
          // A resolved lookup renders as a dropdown — the picker IS the
          // client-side validation; the server still re-checks on submit.
          const sel = document.createElement('select');
          sel.className = 'f-get';
          const blank = document.createElement('option');
          blank.value = ''; blank.textContent = '';
          sel.appendChild(blank);
          for (const o of f.options) {
            const op = document.createElement('option');
            op.value = o.value;
            op.textContent = o.label === o.value ? o.value : `${o.label} (${o.value})`;
            sel.appendChild(op);
          }
          sel.value = f.value ?? '';
          ctl = sel;
        } else {
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.className = 'f-get';
          inp.value = f.value ?? '';
          inp.setAttribute('autocomplete', 'off');
          inp.setAttribute('spellcheck', 'false');
          ctl = inp;
        }
        ctl.dataset.var = f.varName;
        ctl.style.left = (x + labelWidth) + 'px';
        ctl.style.top  = y + 'px';
        ctl.addEventListener('input', () => this.clearError(ctl));
        this.canvas.appendChild(ctl);
        this.getInputs.set(f.varName, ctl);
      }
    });

    document.addEventListener('keydown', this.boundKey, true);
    this.focusFirst();
  }

  /** Server rejected the submit: outline the offending controls, keep the form. */
  showErrors(errors: { varName: string; message: string }[]) {
    for (const { varName, message } of errors) {
      const ctl = this.getInputs.get(varName);
      if (!ctl) continue;
      ctl.classList.add('f-invalid');
      ctl.title = message;
    }
    this.footer.textContent = errors.map(e => e.message).join('  ·  ');
    const first = errors[0] && this.getInputs.get(errors[0].varName);
    first?.focus();
  }

  private clearError(ctl: GetControl) {
    ctl.classList.remove('f-invalid');
    ctl.removeAttribute('title');
  }

  unmount() {
    document.removeEventListener('keydown', this.boundKey, true);
    this.canvas.innerHTML = '';
    this.getInputs.clear();
    this.footer.textContent = '';
  }

  private focusFirst() {
    const first = this.canvas.querySelector<HTMLElement>('.f-get');
    first?.focus();
  }

  private collect(): Map<string, string> {
    const values = new Map<string, string>();
    this.getInputs.forEach((ctl, varName) => values.set(varName, ctl.value));
    return values;
  }

  private handleKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      this.unmount();
      this.onCancel();
      return;
    }
    if (e.key === 'Enter') {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'SELECT') {
        e.preventDefault(); e.stopPropagation();
        // Move to next control, or submit if on last
        const ctls = Array.from(this.canvas.querySelectorAll<HTMLElement>('.f-get'));
        const idx = ctls.indexOf(target);
        if (idx >= 0 && idx < ctls.length - 1) {
          ctls[idx + 1].focus();
        } else {
          this.submit();
        }
      }
    }
  }

  private submit() {
    // Do NOT unmount here: the server validates and either sends view-terminal
    // (Terminal closes the form) or form-error (the form stays for correction).
    this.onSubmit(this.collect());
  }
}
```

Behavior notes locked in: var GETs prefill `''` exactly as before (`FormField.value` is `''` for var targets — the old `render(fields, new Map())` produced the same); Escape still cancels via `grid-exit`; **submit no longer self-closes**.

- [ ] **Step 9.2: Wire Terminal.** In `src/terminal/Terminal.ts`:

Replace `openForm` (lines 255-273) with:

```ts
  private openForm(fields: FormField[]) {
    this.termView.classList.add('hidden');
    this.formView.classList.remove('hidden');

    this.form = new FormLayout(
      (values) => {
        const obj: Record<string, string> = {};
        values.forEach((v, k) => { obj[k] = v; });
        // The form stays open until the server answers: view-terminal closes
        // it, form-error keeps it up with the offending fields outlined.
        this.ws.send({ type: 'form-submit', values: obj });
      },
      () => {
        this.ws.send({ type: 'grid-exit' });
        this.closeForm();
        this.printLine('READ cancelled', 'warn');
      }
    );
    this.form.render(fields);
  }
```

Change the `view-terminal` handler (lines 120-122) to close an open form:

```ts
    ws.on('view-terminal', () => {
      if (this.form) this.closeForm();
      else this.showTerminal();
    });
```

Add a `form-error` handler right after the `form-open` handler (line 118):

```ts
    ws.on('form-error', (msg) => {
      this.form?.showErrors((msg as any).errors);
    });
```

- [ ] **Step 9.3: CSS.** In `src/styles/main.css`, after the `.f-get:focus` rule (line 287), add:

```css
select.f-get { min-width: 140px; }
.f-get.f-invalid { border-color: #cc0000; background: #2a0000; }
```

- [ ] **Step 9.4: Typecheck + smoke.** Run `npm run build` (or `npx tsc --noEmit` if the build script bundles) — clean. Start `npm run dev`, open http://localhost:5173, run `INPUT "x" TO v` — form opens, Enter submits, terminal returns. That's the legacy path intact.

- [ ] **Step 9.5: Commit**

```bash
git add src/ui/FormLayout.ts src/terminal/Terminal.ts src/styles/main.css
git commit -m "feat(#59): form selects for lookup GETs, prefill from record, form-error display"
```

---

### Task 10: Browser — Grid `<select>` editor for lookup columns

**Files:**
- Modify: `src/ui/Grid.ts:166-197` (`startEdit`)
- Modify: `src/styles/main.css:255`

- [ ] **Step 10.1: Implement.** In `src/ui/Grid.ts`, inside `startEdit`, after `const cur = String(this.rows[ri][colName] ?? '');` (line 173) and the `td.classList` line (174), branch on options — replace lines 175-196 with:

```ts
    const meta = this.columnTypes[colName];
    if (meta?.options?.length) {
      // Lookup column: the dropdown IS the validation on the happy path
      // (the server still re-checks). Static cells keep showing the stored
      // value — only this editor shows display labels.
      const sel = document.createElement('select');
      sel.className = 'cell-ed';
      const blank = document.createElement('option');
      blank.value = ''; blank.textContent = '';
      sel.appendChild(blank);
      for (const o of meta.options) {
        const op = document.createElement('option');
        op.value = o.value;
        op.textContent = o.label === o.value ? o.value : `${o.label} (${o.value})`;
        sel.appendChild(op);
      }
      sel.value = cur;
      td.textContent = '';
      td.appendChild(sel);
      sel.focus();
      this.editingCell = { r: ri, c: ci };

      sel.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault(); e.stopPropagation();
          if (!this.commitEdit(sel.value)) return;
          if (e.key === 'Tab') this.selectCell(ri, ci + 2);
        } else if (e.key === 'Escape') {
          e.preventDefault(); e.stopPropagation();
          this.cancelEdit();
        }
      });
      return;
    }

    const inp = document.createElement('input');
    inp.className = 'cell-ed'; inp.value = cur;
    td.textContent = '';
    td.appendChild(inp);
    inp.focus(); inp.select();
    this.editingCell = { r: ri, c: ci };

    // Clear a stale error as soon as the value becomes valid again.
    inp.addEventListener('input', () => {
      if (!validateCellValue(colName, inp.value, this.columnTypes[colName])) this.clearCellError(td);
    });

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        if (!this.commitEdit(inp.value)) return;   // invalid — stay in edit mode
        if (e.key === 'Tab') this.selectCell(ri, ci + 2);
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        this.cancelEdit();
      }
    });
```

`commitEdit` needs no change — `validateCellValue` now sees `meta.options` and membership passes for picked values.

- [ ] **Step 10.2: CSS.** In `src/styles/main.css`, extend line 255 so selects get the invalid styling too (edit in place):

```css
#grid-table td.cell-invalid input.cell-ed,
#grid-table td.cell-invalid select.cell-ed { border-color: #cc0000; background: #2a0000; }
```

Also add, next to the `.cell-ed` base rule (grep `cell-ed` in the file):

```css
select.cell-ed { min-width: 110px; }
```

- [ ] **Step 10.3: Verify** — `npm run build` clean. Real-browser assertions land in Task 14.

- [ ] **Step 10.4: Commit**

```bash
git add src/ui/Grid.ts src/styles/main.css
git commit -m "feat(#60): BROWSE edits lookup columns through a dropdown"
```

---

### Task 11: overtime.prg — SCHEDULES table, lookup, two-form Add Employee

**Files:**
- Modify: `demos/overtime.prg` (seed block lines 53-96, CASE "1" lines 139-160, area setup lines 26-44)
- Modify: `tests/DemoSchemas.test.ts:28` (golden)
- Modify: `tests/overtime.spec.ts` (beforeEach table list line ~83; new test)

- [ ] **Step 11.1: Update the golden first (failing test).** In `tests/DemoSchemas.test.ts`, add to `DEMO_SCHEMAS` after the `EMPLOYEES` line:

```ts
  SCHEDULES:    ['SCHEDID', 'DESCR'],
```

Run: `npx vitest run tests/DemoSchemas.test.ts` → FAIL (`no CREATE TABLE SCHEDULES found in demos/*.prg`).

- [ ] **Step 11.2: Edit `demos/overtime.prg`.**

(a) Add a work area for SCHEDULES — after the `SELECT SCH … USE SCHEDULEDAYS` block (lines 30-32), insert:

```
SELECT SCD
USE DATABASE OVERTIME
USE SCHEDULES
```

(b) In the seed block, right after `IF RECCOUNT() == 0` (line 54) and before `DROP TABLE EMPLOYEES`, seed the schedule catalog (the lookup source):

```
  SELECT SCD
  DROP TABLE SCHEDULES
  CREATE TABLE SCHEDULES (SCHEDID CHAR(4), DESCR CHAR(30))
  APPEND RECORD
  REPLACE SCHEDID WITH "S001", DESCR WITH "Standard 40h (08:00-16:30)"
  APPEND RECORD
  REPLACE SCHEDID WITH "S002", DESCR WITH "Short 31.25h (09:00-16:00)"

  SELECT EMP
```

(c) Change the `CREATE TABLE EMPLOYEES` line (56) to declare the lookup:

```
  CREATE TABLE EMPLOYEES (EMPID CHAR(4), NAME CHAR(30), SCHEDID CHAR(4) LOOKUP SCHEDULES.SCHEDID DISPLAY DESCR)
```

(d) Replace the whole `CASE UPPER(TRIM(choice)) == "1"` arm (lines 139-160) with the check-first, two-form flow. The id stays a memory variable (it is a search term until the record exists); the create runs in natural order so writing the key cannot move the new record; NAME and SCHEDID are field-bound, and SCHEDID's picker comes from the column's lookup:

```
    CASE UPPER(TRIM(choice)) == "1"
      CLEAR
      @ 2, 5 SAY "--- ADD EMPLOYEE ---"
      SELECT EMP
      SET INDEX TO BYEMP
      STORE SPACE(4) TO m_emp
      @ 4, 5 SAY "Employee ID (4): " GET m_emp
      READ
      SEEK TRIM(m_emp)
      IF FOUND()
        @ 8, 5 SAY "Employee already exists: " + TRIM(m_emp)
      ELSE
        * Create in natural order: writing the key under an active index
        * would move the record out from under the form.
        SET INDEX TO
        APPEND RECORD
        REPLACE EMPID WITH TRIM(m_emp)
        @ 5, 5 SAY "Name     (30): " GET NAME
        @ 6, 5 SAY "Schedule     : " GET SCHEDID
        READ
        SET INDEX TO BYEMP
        @ 8, 5 SAY "Employee added: " + TRIM(m_emp)
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT EMP
```

- [ ] **Step 11.3: Update `tests/overtime.spec.ts`.**

(a) In the `beforeEach` clean-slate loop (~line 83), add `'SCHEDULES'` to the dropped-tables list:

```ts
    for (const t of ['EMPLOYEES', 'SCHEDULES', 'SCHEDULEDAYS', 'TIMESHEET', 'WEEKSUMMARY', 'LEAVETAKEN']) {
```

(b) Add a new test (after the seeding test):

```ts
  test('Add Employee: the schedule is picked from a lookup dropdown, not typed', async ({ page }) => {
    await menuChoice(page, '1');                 // Add Employee → form 1 (id)
    await expect(page.locator('#form-view')).toContainText('ADD EMPLOYEE', { timeout: 6000 });
    const idInput = page.locator('#form-view input.f-get').last();
    await idInput.fill('E003');
    await idInput.press('Enter');

    // Form 2: NAME is a text field, SCHEDID is a <select> fed by SCHEDULES.
    const sched = page.locator('#form-view select.f-get');
    await expect(sched).toBeVisible({ timeout: 6000 });
    await expect(sched).toBeInViewport();
    // DISPLAY label + code are both shown in the option text.
    await expect(sched.locator('option', { hasText: 'Standard 40h' })).toHaveCount(1);

    const name = page.locator('#form-view input.f-get').first();
    await name.fill('Alan Turing');
    await sched.selectOption('S001');
    await sched.press('Enter');                  // last control → submit

    await expect(page.locator('#form-view')).toContainText('Employee added: E003', { timeout: 6000 });
    await ack(page);

    // Verify through the table tour that the record landed with the code.
    await menuChoice(page, '9');
    await expect(page.locator('#terminal-output')).toContainText('Alan Turing');
    await expect(page.locator('#terminal-output')).toContainText('S001');
    await ack(page);
  });
```

Note: form 2's NAME input prefills empty (new record) and the flow ends on the select, so `Enter` on it submits. If the existing `fillForm` helper is used anywhere for this menu path, it only handles `input.f-get` — do not reuse it here.

- [ ] **Step 11.4: Run to verify**

Run: `npx vitest run tests/DemoSchemas.test.ts` → PASS.
Run: `npm test` → green.
Run (dev server running or config-managed): `npx playwright test tests/overtime.spec.ts` → all overtime tests PASS, including the new one. The seeding/menu tests must still pass — the menu text did not change.

- [ ] **Step 11.5: Commit**

```bash
git add demos/overtime.prg tests/DemoSchemas.test.ts tests/overtime.spec.ts
git commit -m "feat(#61): overtime demo — SCHEDULES lookup table, field-bound two-form Add Employee"
```

---

### Task 12: crm.prg — STAGE literal lookup

**Files:**
- Modify: `demos/crm.prg:48`
- Test: covered by `tests/DemoSchemas.test.ts` (names unchanged) + Task 14's REPLACE-rejection e2e

- [ ] **Step 12.1: Edit `demos/crm.prg` line 48** — the `CREATE TABLE DEALS` statement gains the lookup, using the exact strings the demo already seeds and compares (`SUM VALUE FOR STAGE == "Won"` at line 223 — membership is case-sensitive):

```
  CREATE TABLE DEALS (DEALID CHAR(6), COMPID CHAR(5), TITLE CHAR(40), STAGE CHAR(12) LOOKUP ("Lead","Qualified","Proposal","Won","Lost"), VALUE NUM(12,2), CLOSEMONTH NUM(6))
```

The seed REPLACEs (lines 52-60) write `"Proposal"`, `"Won"`, `"Qualified"`, `"Lead"`, `"Lost"` — all on-list, so the seed passes enforcement. The Add-Deal form (line 176) keeps its `m_stage` memory variable; its `REPLACE STAGE WITH TRIM(m_stage)` (line 185) is now membership-checked — a typo'd stage errors instead of writing garbage. That is the intended behavior change; the demo's menu flow is otherwise untouched.

- [ ] **Step 12.2: Verify**

Run: `npx vitest run tests/DemoSchemas.test.ts` → PASS (DEALS column names unchanged — the qualifier is metadata).
Run: `npx playwright test tests/crm.spec.ts` → all 6 still PASS (the demo only ever writes legal stages).

- [ ] **Step 12.3: Commit**

```bash
git add demos/crm.prg
git commit -m "feat(#61): CRM deal stage constrained by a literal LOOKUP list"
```

---

### Task 13: Assistant wizards — Lookup control

**Files:**
- Modify: `src/ui/wizards/TableWizard.ts`
- Modify: `src/ui/wizards/ModStructWizard.ts`
- Test: `tests/assistant.spec.ts` (new case)

- [ ] **Step 13.1: TableWizard.** In `src/ui/wizards/TableWizard.ts`:

Extend `ColRow` (line 8):
```ts
interface ColRow { name: HTMLInputElement; type: HTMLSelectElement; len: HTMLInputElement; lookup: HTMLInputElement; }
```

Add a shared helper above `openTableWizard` (exported so ModStructWizard reuses it):

```ts
/** Turn the wizard's lookup text into a LOOKUP clause, or an error.
    Accepts `TABLE.COL`, `TABLE.COL DISPLAY COL`, or a quoted list `"a","b"`. */
export function lookupClause(raw: string, colName: string): { clause: string; err: string } {
  const v = raw.trim();
  if (!v) return { clause: '', err: '' };
  if (v.includes('"')) {
    if (!/^"[^"]+"(\s*,\s*"[^"]+")*$/.test(v)) {
      return { clause: '', err: `Lookup list for ${colName}: use quoted values, e.g. "Lead","Won"` };
    }
    return { clause: ` LOOKUP (${v})`, err: '' };   // values keep their case
  }
  const m = v.match(/^([A-Za-z_]\w*)\.([A-Za-z_]\w*)(\s+DISPLAY\s+[A-Za-z_]\w*)?$/i);
  if (!m) return { clause: '', err: `Lookup for ${colName}: use TABLE.COLUMN [DISPLAY COLUMN] or "a","b"` };
  return { clause: ` LOOKUP ${v.toUpperCase()}`, err: '' };
}
```

In `buildCommand`, every `cols.push(...)` currently pushes `\`${n} ${t}...\``. Compute the clause once per row at the top of the loop and append it to each push:

```ts
      const lk = lookupClause(r.lookup.value, n);
      if (lk.err) return { cmd: null, err: lk.err };
```
…and change each `cols.push(\`…\`)` to append `${lk.clause}`, e.g. `cols.push(\`${n} NUM(${p},${s})${lk.clause}\`)`, `cols.push(\`${n} ${t}(${len})${lk.clause}\`)`, `cols.push(\`${n} ${t}${lk.clause}\`)` (all five push sites).

In `addRow`, create the input and register it:

```ts
    const lookup = document.createElement('input');
    lookup.type = 'text'; lookup.className = 'wz-col-lookup';
    lookup.placeholder = 'lookup (optional)';
    lookup.title = 'Legal values: TABLE.COLUMN [DISPLAY COLUMN] — or a literal list: "Lead","Won"';
    lookup.style.minWidth = '180px';
    row.append(name, type, len, lookup);
    ...
    rows.push({ name, type, len, lookup });
    for (const el of [name, type, len, lookup]) el.addEventListener('input', update);
```
(replacing the existing `row.append(name, type, len)` / `rows.push({ name, type, len })` / listener lines.)

Update the shell description string to mention it:
```
'Define columns; blank rows are ignored. CHAR needs a length, NUM a width or precision,scale (8 or 8,2); TIME takes an optional minute-granularity (e.g. 15). Lookup constrains a column to legal values: TABLE.COLUMN [DISPLAY COLUMN] or "a","b".'
```

- [ ] **Step 13.2: ModStructWizard.** In `src/ui/wizards/ModStructWizard.ts`:

```ts
import { lookupClause } from './TableWizard';
```

Extend `Row` (line 15) with `lookup: HTMLInputElement;`. In `addRow`, create the same input as TableWizard (placeholder `'lookup (optional)'`, class `wz-col-lookup`), append it to `wrap` before `dropLabel`, push it into the row object, and add it to the `input`-listener loop.

In `buildCommands`, replace the block from `const newType = r.type.value;` (line 49) through the retype check (line 59) with:

```ts
      const newType = r.type.value;
      const lk = lookupClause(r.lookup.value, newName);
      if (lk.err) return { cmds: [], err: lk.err };
      if (!r.origName) {                              // brand new column
        cmds.push(`ALTER TABLE ${table} ADD ${newName} ${newType}${lk.clause}`);
        continue;
      }
      if (newName.toUpperCase() !== r.origName.toUpperCase()) {
        cmds.push(`ALTER TABLE ${table} RENAME ${r.origName} TO ${newName}`);
      }
      // A retype OR a newly-typed lookup both go through ALTER … ALTER; the
      // clause rides along either way. A blank lookup input never emits or
      // removes anything (no lookup-removal path — YAGNI, noted in the PR).
      if (newType !== r.origType || lk.clause) {
        cmds.push(`ALTER TABLE ${table} ALTER ${newName} ${newType}${lk.clause}`);
      }
```

- [ ] **Step 13.3: e2e** — append inside the `Assistant sidebar` describe block of `tests/assistant.spec.ts` (it already defines `boot` and `clickAction`):

```ts
  test('New table wizard emits a LOOKUP clause and BROWSE honours it', async ({ page }) => {
    await boot(page);
    await page.locator('#terminal-input').fill('USE DATABASE ASSISTDEMO');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(400);
    await page.locator('#terminal-input').fill('DROP TABLE wiz_lookup');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(400);

    await clickAction(page, 'New table…');
    await expect(page.locator('#wizard-view')).toBeVisible({ timeout: 5000 });

    await page.locator('#wz-table-name').fill('wiz_lookup');
    await page.locator('.wz-col-name').first().fill('STAGE');
    await page.locator('.wz-col-type').first().selectOption('CHAR');
    await page.locator('.wz-col-len').first().fill('12');
    await page.locator('.wz-col-lookup').first().fill('"Lead","Won"');

    // live preview shows the exact clause
    await expect(page.locator('.wz-preview'))
      .toContainText('CREATE TABLE wiz_lookup (STAGE CHAR(12) LOOKUP ("Lead","Won"))');

    await page.locator('#wizard-view button', { hasText: 'Create table' }).click();
    await expect(page.locator('#terminal-output')).toContainText('Table created: WIZ_LOOKUP', { timeout: 5000 });

    // The created table's grid editor is a dropdown with exactly the list.
    await page.locator('#terminal-input').fill('APPEND RECORD');
    await page.locator('#terminal-input').press('Enter');
    await page.waitForTimeout(400);
    await clickAction(page, 'Browse');
    await expect(page.locator('#grid-view')).toBeVisible({ timeout: 5000 });
    const td = page.locator('#grid-tbody td[data-ri="0"][data-ci="0"]');
    await td.dblclick();
    const sel = td.locator('select.cell-ed');
    await expect(sel).toBeVisible();
    await expect(sel).toBeInViewport();
    await expect(sel.locator('option')).toHaveText(['', 'Lead', 'Won']);
    await page.keyboard.press('Escape');   // leave edit
    await page.keyboard.press('Escape');   // leave grid
  });
```

One check to make before trusting the preview assertion: the wizard echoes commands into the terminal prefixed with `. ` — the existing New-table test asserts `'. CREATE TABLE wiz_products (NAME CHAR(30))'`. If `Table created: WIZ_LOOKUP` renders lowercase (`wiz_lookup`) in your run, match the actual casing the terminal shows (the CREATE echo is the stronger assertion; use it as the existing test does).

- [ ] **Step 13.4: Verify**

Run: `npx playwright test tests/assistant.spec.ts` → all PASS including the new case.

- [ ] **Step 13.5: Commit**

```bash
git add src/ui/wizards/TableWizard.ts src/ui/wizards/ModStructWizard.ts tests/assistant.spec.ts
git commit -m "feat(#62): Lookup control in Table and Modify-structure wizards"
```

---

### Task 14: End-to-end — lookup.spec.ts

**Files:**
- Create: `tests/lookup.spec.ts`

- [ ] **Step 14.1: Write the spec:**

```ts
/** Playwright E2E for #58/#59/#60 — lookup columns end-to-end. */
import { test, expect, Page } from '@playwright/test';

async function cmd(page: Page, command: string, waitMs = 700): Promise<void> {
  const input = page.locator('#terminal-input');
  await input.fill(command);
  await input.press('Enter');
  await page.waitForTimeout(waitMs);
}
async function boot(page: Page): Promise<void> {
  await page.goto('http://localhost:5173');
  await expect(page.locator('#terminal-output')).toContainText('Connected.', { timeout: 8000 });
}

test.describe('lookup columns', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    await cmd(page, 'USE DATABASE LOOKUPE2E');
    await cmd(page, 'DROP TABLE LDEALS', 200);
    await cmd(page, 'DROP TABLE LSCHED', 200);
    await cmd(page, 'DROP TABLE LEMP', 200);
  });

  test('BROWSE edits a literal-lookup column through an in-viewport dropdown', async ({ page }) => {
    await cmd(page, 'CREATE TABLE LDEALS (TITLE CHAR(20), STAGE CHAR(12) LOOKUP ("Lead","Won","Lost"))');
    await cmd(page, 'USE LDEALS');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'BROWSE', 1200);
    await expect(page.locator('#grid-view')).toBeVisible({ timeout: 6000 });

    const td = page.locator('#grid-tbody td[data-ri="0"][data-ci="1"]');   // STAGE
    await td.dblclick();
    const sel = td.locator('select.cell-ed');
    await expect(sel).toBeVisible();
    await expect(sel).toBeInViewport();          // the #46 clipping trap — a select
                                                 // inside overflow:hidden must be readable
    await expect(sel.locator('option')).toHaveText(['', 'Lead', 'Won', 'Lost']);
    await sel.selectOption('Won');
    await sel.press('Enter');
    await expect(td).toContainText('Won');       // static cell shows the stored value

    await page.keyboard.press('Escape');
  });

  test('REPLACE rejects an off-list value in the terminal', async ({ page }) => {
    await cmd(page, 'CREATE TABLE LDEALS (STAGE CHAR(12) LOOKUP ("Lead","Won"))');
    await cmd(page, 'USE LDEALS');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE STAGE WITH "Maybe"');
    // The command echo itself contains "Maybe", so we assert the rejection
    // message here; the not-written proof is in tests/LookupEnforcement.test.ts,
    // which reads only server output.
    await expect(page.locator('#terminal-output')).toContainText('not one of the allowed values');
    await cmd(page, 'REPLACE STAGE WITH "Won"');
    await cmd(page, 'LIST');
    await expect(page.locator('#terminal-output')).toContainText('Won');
  });

  test('a table lookup feeds a form GET with display labels and stores the code', async ({ page }) => {
    await cmd(page, 'CREATE TABLE LSCHED (SCHEDID CHAR(4), DESCR CHAR(30))');
    await cmd(page, 'USE LSCHED');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE SCHEDID WITH "S001", DESCR WITH "Standard shift"');
    await cmd(page, 'CREATE TABLE LEMP (NAME CHAR(20), SCHEDID CHAR(4) LOOKUP LSCHED.SCHEDID DISPLAY DESCR)');
    await cmd(page, 'USE LEMP');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, '@ 4, 5 SAY "Sched: " GET SCHEDID\nREAD', 1200);

    const sel = page.locator('#form-view select.f-get');
    await expect(sel).toBeVisible({ timeout: 6000 });
    await expect(sel).toBeInViewport();
    await expect(sel.locator('option', { hasText: 'Standard shift' })).toHaveCount(1);
    await sel.selectOption('S001');
    await sel.press('Enter');

    await cmd(page, 'LIST');
    await expect(page.locator('#terminal-output')).toContainText('S001');
  });

  test('an unresolvable lookup degrades to free text with a warning', async ({ page }) => {
    await cmd(page, 'CREATE TABLE LEMP (SCHEDID CHAR(4) LOOKUP GHOST.NOPE)');
    await cmd(page, 'USE LEMP');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'BROWSE', 1200);
    await expect(page.locator('#terminal-output')).toContainText('lookup for SCHEDID');
    const td = page.locator('#grid-tbody td[data-ri="0"][data-ci="0"]');
    await td.dblclick();
    await expect(td.locator('input.cell-ed')).toBeVisible();   // input, not select
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
  });
});
```

Note on the multi-line `cmd`: the terminal accumulates multi-line blocks — if `fill` with `\n` doesn't submit both lines as one command, send them as two commands: `@ 4, 5 SAY "Sched: " GET SCHEDID` then `READ` (each is a complete statement at the REPL; `pendingForm` persists between them). Try the two-command form first — it matches how `tests/schema-errors.spec.ts` drives `INPUT`.

- [ ] **Step 14.2: Run** — with the dev server up: `npx playwright test tests/lookup.spec.ts` → 4/4 PASS. Take a screenshot of the open grid dropdown and *look at it* (test discipline: `toBeInViewport` + eyeballs):

```bash
npx playwright test tests/lookup.spec.ts --grep "in-viewport dropdown" --trace on
```

- [ ] **Step 14.3: Commit**

```bash
git add tests/lookup.spec.ts
git commit -m "test(#58,#59,#60): lookup e2e — grid dropdown, REPLACE rejection, form picker, degradation"
```

---

### Task 15: Docs, changelog, screenshots, full-suite gate

**Files:**
- Modify: `CHANGELOG.md`, `README.md`, `CLAUDE.md`
- Verify: `package.json` version is `1.3.0` (already set on `release/v1.3.0`)
- Screenshots: `docs/screenshots/`

- [ ] **Step 15.1: CHANGELOG.md** — add at the top:

```markdown
## [1.3.0] — unreleased

### Added
- **`LOOKUP` column qualifier** (#58): constrain a column to legal values, declared once on the column — `SCHEDID CHAR(4) LOOKUP SCHEDULES.SCHEDID DISPLAY DESCR` (live table lookup) or `STAGE CHAR(12) LOOKUP ("Lead","Won","Lost")` (literal list). A WebBase-III extension; dBASE III had no equivalent (see README → Deviations).
- **Field-bound `@ SAY GET`** (#59): a GET whose name matches a column of the active table edits the current record; `READ` writes on submit, Escape writes nothing. Fields shadow memory variables (dBASE III precedence). Lookup columns render as dropdowns in forms.
- **BROWSE lookup dropdowns** (#60): lookup columns edit via a `<select>`; membership is enforced on both client and server (`grid-edit`) and by `REPLACE`.
- **`form-error` message**: a rejected form submit keeps the form open with the offending fields outlined — writes are all-or-nothing.
- **`SCHEDULES` table in the overtime demo** (#61): Add Employee picks the schedule from a dropdown showing descriptions, storing the code. CRM deal stages are constrained to the real stage list.
- **Wizard support** (#62): Table and Modify-structure wizards take an optional per-column lookup.

### Changed
- Form GETs no longer close on submit; the server validates first (success returns to the terminal, rejection keeps the form open).
- `REPLACE` now enforces lookup membership on columns that declare one (additive — no pre-1.3.0 column does).
```

- [ ] **Step 15.2: README.md** — three edits:

(a) Column-types table: add a row / note under it:

```markdown
Any column may add `LOOKUP <table>.<column> [DISPLAY <column>]` or `LOOKUP ("a","b",…)` — see *Lookup columns*.
```

(b) New section after the column-types section:

```markdown
### Lookup columns

Declare a column's legal values **once, on the column**:

    CREATE TABLE EMPLOYEES (EMPID CHAR(4), NAME CHAR(30),
                            SCHEDID CHAR(4) LOOKUP SCHEDULES.SCHEDID DISPLAY DESCR)
    CREATE TABLE DEALS (STAGE CHAR(12) LOOKUP ("Lead","Qualified","Proposal","Won","Lost"))

Everything inherits it: BROWSE edits the column through a dropdown, a
field-bound form `GET` renders a picker (`DISPLAY` shows a label, the code is
stored), and `REPLACE`/`grid-edit` reject off-list values. A lookup that cannot
be resolved (source table dropped, empty, or over 1000 distinct values)
degrades to free text with a warning — it never locks the column and never
truncates the list.

`@ r,c SAY "…" GET <name>` binds to the active table's column when one matches
(the current record must exist — `APPEND RECORD` first); otherwise it remains a
memory-variable GET. **Fields shadow memory variables**, as in dBASE III.

#### Deviations from dBASE III

`LOOKUP`/`DISPLAY` are WebBase-III inventions — dBASE III had no table-driven
lookup at all; dBASE III+ only offered `PICTURE "@M a,b,c"`, a literal list
cycled with the spacebar, which we deliberately do not implement. Field-bound
`GET` *is* authentic dBASE III behavior. This joins the other documented
deviations: unlimited work areas and `alias.field` (not `alias->field`).
```

(c) Variables & I/O command table: change the `@ r,c SAY … GET` row description to: `Define a form field; a name matching a column of the active table binds that column (lookup columns render a picker)`.

- [ ] **Step 15.3: CLAUDE.md** — keep it truthful:
  - Architecture block: add `LookupResolver.ts` under `src/interpreter/` ("resolves a column's LOOKUP to {value,label} options; degrades, never truncates").
  - Column types section: add the `LOOKUP` clause syntax + one-paragraph summary and the deviation note.
  - Cell-validation table: add row `| lookup columns | value must be one of the resolved options (case-sensitive) |`, and update the closing sentence "REPLACE enforces only `TIME`" → "`REPLACE` enforces `TIME` and lookup membership (columns that declare a `LOOKUP`); widening beyond that would change the semantics of existing programs."
  - Roadmap: add a "Beyond parity (v1.3.0)" block listing #58–#62 as shipped.
  - Test counts in the Testing section: update after Step 15.5 with the real numbers from the runs.

- [ ] **Step 15.4: Screenshots** — the grid and form UI changed. Check what exists (`ls docs/screenshots/`) and retake any image that shows BROWSE or a form so it reflects current UI; add one new shot of the Add-Employee schedule dropdown (capture during a paused `npx playwright test tests/overtime.spec.ts --headed`, or via a `page.screenshot` line temporarily added to the new overtime test). Commit the images.

- [ ] **Step 15.5: Full gate — run serially, in this order:**

```bash
npm test                     # all vitest green
npm run build                # clean typecheck/build
npx playwright test          # all e2e green (dev server via webServer config)
npm run coverage             # eyeball: LookupResolver, new Session branches covered
```

- [ ] **Step 15.6: Commit + PR**

```bash
git add CHANGELOG.md README.md CLAUDE.md docs/screenshots
git commit -m "docs: lookup columns — README deviations section, changelog, CLAUDE.md (v1.3.0)"
git push -u origin feature/lookup-columns
gh pr create --base release/v1.3.0 --title "Lookup columns + field-bound GET (v1.3.0)" \
  --body "Implements the approved spec (docs/superpowers/specs/2026-07-10-lookup-columns-design.md).

Closes #58, closes #59, closes #60, closes #61, closes #62.

Deviation from spec: the resolver lives at src/interpreter/LookupResolver.ts (not server/) because the Executor must import it and src/ cannot depend on server/."
```

Do **not** merge until both CI jobs (`unit`, `e2e`) are green. Do **not** tag — tags happen only when `release/v1.3.0` merges to `main`.

---

## Self-review notes (already applied)

- **Spec coverage:** qualifier syntax → T2; storage/migration → T3; resolution/degradation/ceiling → T4; single-source inheritance → T5-T8; forms surface → T7-T9; grid surface → T6/T10; enforcement → T5/T6/T8; demos → T11/T12; Assistant parity → T13; deviations documented → T15. Blank-record cleanup pattern → T11 (two-form, natural-order create). All-or-nothing + retained targets + forged test → T8. `toBeInViewport` → T11/T13/T14. Two-DB tests → T3/T5.
- **Type consistency:** `Lookup`/`LookupOption` defined once in `cellValidation.ts`, re-exported from `types.ts`; `resolveLookup(db, lookup): Promise<LookupOption[] | null>` used identically in T5/T6/T7/T8; `FormField.target` field variant `{ column, table, db, rowid }` written in T7, consumed in T8.
- **Known accepted gaps** (spec-sanctioned): no lookup-removal syntax (re-declare the column via `ALTER … ALTER` without a clause — `setColumnType` with `null` clears it, which the wizard does not expose); `LIST STRUCTURE` does not print lookups; labels appear only in editors, never in static cells.
