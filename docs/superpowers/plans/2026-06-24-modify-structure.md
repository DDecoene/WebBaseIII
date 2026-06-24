# MODIFY STRUCTURE / ALTER TABLE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to alter an existing table's columns (add / drop / rename / retype) via a scriptable `ALTER TABLE` command family and a `MODIFY STRUCTURE` Assistant wizard.

**Architecture:** A new parser branch produces `ALTER_TABLE` (with an `op` discriminator) and `MODIFY_STRUCTURE` AST nodes. The Executor's `doAlterTable` runs native SQLite `ALTER TABLE … ADD/DROP/RENAME COLUMN` for add/drop/rename and a rename-copy-drop transaction for type changes; any column op that can invalidate an index drops all of the table's indexes (SQLite + metadata) and warns. `MODIFY STRUCTURE` returns an `action: 'MODIFY_STRUCTURE'`; the Session translates it into a new `modstruct-open` WS message carrying the table + columns; the browser opens `ModStructWizard`, which diffs the edited schema against the original and emits a sequence of `ALTER TABLE` commands. Both the terminal command and the sidebar action funnel through the same server path so the wizard always receives authoritative column data.

**Tech Stack:** TypeScript, Vitest (unit/integration), Playwright (E2E), better-sqlite3 (SQLite 12.x — native DROP/RENAME COLUMN available).

---

## File structure

- `src/interpreter/Parser.ts` — add `ALTER_TABLE` + `MODIFY_STRUCTURE` AST nodes and parsing.
- `src/interpreter/Executor.ts` — add `doAlterTable`, `dropAllIndexes` helper, `MODIFY_STRUCTURE` action; wire dispatch cases; update HELP.
- `src/shared/types.ts` — add `modstruct-open` to `ServerMessage`; add `MODIFY_STRUCTURE` to the action union (in Executor's `ExecResult`, not types.ts).
- `server/Session.ts` — handle the `MODIFY_STRUCTURE` action → send `modstruct-open`.
- `src/ui/wizards/ModStructWizard.ts` — **new** wizard (diff editor).
- `src/main.ts` — listen for `modstruct-open`, open the wizard.
- `src/ui/Assistant.ts` — add "Modify structure…" sidebar action.
- `tests/AlterTable.test.ts` — **new** parser + integration tests.
- `tests/assistant.spec.ts` — add wizard E2E test.

---

## Task 1: Parser — AST node types

**Files:**
- Modify: `src/interpreter/Parser.ts:51` (ASTNode union, near `CREATE_TABLE`)

- [ ] **Step 1: Add the AST node type declarations**

In the `ASTNode` union in `src/interpreter/Parser.ts` (after the `CREATE_TABLE` line at ~51), add:

```typescript
  | { type: 'MODIFY_STRUCTURE' }
  | { type: 'ALTER_TABLE'; name: string; op: 'ADD'; col: string; colType: string }
  | { type: 'ALTER_TABLE'; name: string; op: 'ALTER'; col: string; colType: string }
  | { type: 'ALTER_TABLE'; name: string; op: 'DROP'; col: string }
  | { type: 'ALTER_TABLE'; name: string; op: 'RENAME'; col: string; newName: string }
```

- [ ] **Step 2: Commit**

```bash
git add src/interpreter/Parser.ts
git commit -m "feat(parser): add ALTER_TABLE and MODIFY_STRUCTURE AST node types (#6)"
```

---

## Task 2: Parser — parse MODIFY STRUCTURE and ALTER TABLE

**Files:**
- Modify: `src/interpreter/Parser.ts:136` (MODIFY branch) and `:120`-area (top-level dispatch)
- Test: `tests/AlterTable.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/AlterTable.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { Lexer } from '../src/interpreter/Lexer';
import { Parser } from '../src/interpreter/Parser';

function parse(src: string) {
  return new Parser(new Lexer(src).tokenize()).parse();
}

describe('Parser: MODIFY STRUCTURE / ALTER TABLE', () => {
  it('parses MODIFY STRUCTURE', () => {
    expect(parse('MODIFY STRUCTURE')[0]).toEqual({ type: 'MODIFY_STRUCTURE' });
  });

  it('parses ALTER TABLE ADD', () => {
    expect(parse('ALTER TABLE customers ADD phone CHAR(20)')[0]).toEqual({
      type: 'ALTER_TABLE', name: 'CUSTOMERS', op: 'ADD', col: 'PHONE', colType: 'CHAR',
    });
  });

  it('parses ALTER TABLE DROP', () => {
    expect(parse('ALTER TABLE customers DROP phone')[0]).toEqual({
      type: 'ALTER_TABLE', name: 'CUSTOMERS', op: 'DROP', col: 'PHONE',
    });
  });

  it('parses ALTER TABLE RENAME', () => {
    expect(parse('ALTER TABLE customers RENAME phone TO mobile')[0]).toEqual({
      type: 'ALTER_TABLE', name: 'CUSTOMERS', op: 'RENAME', col: 'PHONE', newName: 'MOBILE',
    });
  });

  it('parses ALTER TABLE ALTER (type change)', () => {
    expect(parse('ALTER TABLE customers ALTER age INT')[0]).toEqual({
      type: 'ALTER_TABLE', name: 'CUSTOMERS', op: 'ALTER', col: 'AGE', colType: 'INT',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/AlterTable.test.ts`
Expected: FAIL — `MODIFY STRUCTURE` throws "Expected REPORT after MODIFY"; `ALTER` parses as `UNKNOWN`.

- [ ] **Step 3: Extend the MODIFY branch**

In `src/interpreter/Parser.ts`, replace the `MODIFY` case body (at ~136) so it also accepts `STRUCTURE`:

```typescript
      case 'MODIFY': {
        this.adv();
        if (this.peekKw('REPORT')) { this.adv(); return { type: 'MODIFY_REPORT', name: this.ident() }; }
        if (this.peekKw('STRUCTURE') || this.peekKw('STRUCT')) { this.adv(); return { type: 'MODIFY_STRUCTURE' }; }
        throw new Error('Expected REPORT or STRUCTURE after MODIFY');
      }
```

- [ ] **Step 4: Add the ALTER top-level case + parser method**

Add a case to the top-level dispatch (alongside `case 'CREATE': return this.parseCreate();` at ~133):

```typescript
      case 'ALTER':    return this.parseAlter();
```

Then add this method near `parseCreate` (after the `parseCreate` method, ~417):

```typescript
  private parseAlter(): ASTNode {
    this.adv();                       // ALTER
    this.skipKw('TABLE');
    const name = this.ident();
    if (this.peekKw('ADD'))    { this.adv(); this.skipKw('COLUMN'); const col = this.ident(); const colType = this.ident(); this.skipTypeSize(); return { type: 'ALTER_TABLE', name, op: 'ADD', col, colType }; }
    if (this.peekKw('ALTER'))  { this.adv(); this.skipKw('COLUMN'); const col = this.ident(); const colType = this.ident(); this.skipTypeSize(); return { type: 'ALTER_TABLE', name, op: 'ALTER', col, colType }; }
    if (this.peekKw('DROP'))   { this.adv(); this.skipKw('COLUMN'); const col = this.ident(); return { type: 'ALTER_TABLE', name, op: 'DROP', col }; }
    if (this.peekKw('RENAME')) { this.adv(); this.skipKw('COLUMN'); const col = this.ident(); this.skipKw('TO'); const newName = this.ident(); return { type: 'ALTER_TABLE', name, op: 'RENAME', col, newName }; }
    throw new Error('Expected ADD, DROP, RENAME, or ALTER after ALTER TABLE <name>');
  }

  // Consume an optional "(n)" length suffix on a type (e.g. CHAR(20)); the
  // length is ignored — SQLite types are not length-bound (matches CREATE TABLE).
  private skipTypeSize(): void {
    if (this.peek().type === 'LPAREN') {
      this.adv();
      this.tryNum();
      if (this.peek().type === 'RPAREN') this.adv();
    }
  }
```

> Note: `skipKw('COLUMN')` makes the `COLUMN` keyword optional so both `ADD phone …` and `ADD COLUMN phone …` parse. Verify `skipKw` exists (it is used elsewhere, e.g. `this.skipKw('TABLE')`); it advances only if the keyword matches.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/AlterTable.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/interpreter/Parser.ts tests/AlterTable.test.ts
git commit -m "feat(parser): parse MODIFY STRUCTURE and ALTER TABLE (#6)"
```

---

## Task 3: Executor — ADD column

**Files:**
- Modify: `src/interpreter/Executor.ts` (dispatch ~172, new `doAlterTable` method near `doDropTable` ~632)
- Test: `tests/AlterTable.test.ts`

- [ ] **Step 1: Write the failing integration test**

Append to `tests/AlterTable.test.ts` (add imports + helpers at the top of the file if not present):

```typescript
import { Session } from '../server/Session';
import type { ServerMessage } from '../src/shared/types';
import fs from 'fs';
import path from 'path';

let dbCounter = 0;
function makeSession() {
  const sent: ServerMessage[] = [];
  const send = (msg: ServerMessage) => { sent.push(msg); };
  return { session: new Session(send), sent };
}
function uniqueDb() { return `test_alter_${Date.now()}_${++dbCounter}`; }

afterEach(() => {
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.toLowerCase().startsWith('test_alter_'))
      .forEach(f => fs.unlinkSync(path.join(dataDir, f)));
  }
});

async function structure(session: Session, sent: ServerMessage[], table: string): Promise<string[]> {
  sent.length = 0;
  await session.handleMessage({ type: 'command', text: 'LIST STRUCTURE' });
  const out = sent.find(m => m.type === 'output') as any;
  return (out?.lines ?? []).map((l: any) => l.text);
}

describe('Executor: ALTER TABLE ADD', () => {
  it('adds a new column', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t (name CHAR(10))' });
    await session.handleMessage({ type: 'command', text: 'USE t' });
    await session.handleMessage({ type: 'command', text: 'ALTER TABLE t ADD age INT' });
    const lines = await structure(session, sent, 't');
    expect(lines.join(' ').toLowerCase()).toContain('age');
  });

  it('errors when the table does not exist', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'ALTER TABLE ghost ADD age INT' });
    const out = sent.find(m => m.type === 'output') as any;
    expect((out?.lines ?? []).some((l: any) => l.cls === 'error')).toBe(true);
  });

  it('errors when the column already exists', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t (name CHAR(10))' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'ALTER TABLE t ADD name CHAR(20)' });
    const out = sent.find(m => m.type === 'output') as any;
    expect((out?.lines ?? []).some((l: any) => l.cls === 'error')).toBe(true);
  });
});
```

Add `afterEach` to the vitest import at the top: `import { describe, it, expect, afterEach } from 'vitest';`

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/AlterTable.test.ts -t "ALTER TABLE ADD"`
Expected: FAIL — "Unknown command" (no dispatch case yet).

- [ ] **Step 3: Add the dispatch case and `doAlterTable` ADD path**

Add the dispatch case in the Executor switch (after `case 'DROP_TABLE':` at ~173):

```typescript
        case 'ALTER_TABLE': return this.doAlterTable(node);
        case 'MODIFY_STRUCTURE': return this.doModifyStructure();
```

Import note: the method receives the union node; type it as `Extract<ASTNode, { type: 'ALTER_TABLE' }>`. Add `doAlterTable` and a stub `doModifyStructure` near `doDropTable` (~632):

```typescript
  private async doModifyStructure(): Promise<ExecResult> {
    if (!this.area.table) {
      return { output: [{ text: 'MODIFY STRUCTURE: no table in use', cls: 'error' }] };
    }
    return { output: [], action: 'MODIFY_STRUCTURE' };
  }

  private async doAlterTable(node: Extract<ASTNode, { type: 'ALTER_TABLE' }>): Promise<ExecResult> {
    const { name } = node;
    if (!(await this.db.tableExists(name))) {
      return { output: [{ text: `ALTER TABLE: no such table: ${name}`, cls: 'error' }] };
    }
    const cols = await this.db.getStructure(name);
    const has = (c: string) => cols.some(col => col.name.toUpperCase() === c.toUpperCase());

    if (node.op === 'ADD') {
      if (has(node.col)) return { output: [{ text: `ALTER TABLE: column already exists: ${node.col}`, cls: 'error' }] };
      await this.db.exec(`ALTER TABLE ${q(name)} ADD COLUMN ${q(node.col)} ${mapType(node.colType)}`);
      await this.refreshIfActive(name);
      return { output: [{ text: `Added column ${node.col} to ${name}.`, cls: 'ok' }] };
    }
    // DROP / RENAME / ALTER handled in later tasks
    return { output: [{ text: 'ALTER TABLE: operation not implemented', cls: 'error' }] };
  }

  // Refresh cached structure/record count if the altered table is the one in USE.
  private async refreshIfActive(name: string): Promise<void> {
    if (this.area.table === name) {
      this.area.cachedRecCount = await this.db.getRowCount(name, this.area.filter ?? undefined);
    }
  }
```

> Confirm `ASTNode` is imported in Executor.ts (it is: `import { ASTNode, Expr, ColDef, Parser } from './Parser';`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/AlterTable.test.ts -t "ALTER TABLE ADD"`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/interpreter/Executor.ts tests/AlterTable.test.ts
git commit -m "feat(executor): ALTER TABLE ADD COLUMN (#6)"
```

---

## Task 4: Executor — index-drop helper

**Files:**
- Modify: `src/interpreter/Executor.ts` (new `dropAllIndexes` helper near `doAlterTable`)
- Test: `tests/AlterTable.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/AlterTable.test.ts`:

```typescript
describe('Executor: ALTER TABLE drops affected indexes', () => {
  it('drops indexes and warns when a column is dropped', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t (name CHAR(10), age INT)' });
    await session.handleMessage({ type: 'command', text: 'USE t' });
    await session.handleMessage({ type: 'command', text: 'INDEX ON name TO byname' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'ALTER TABLE t DROP age' });
    const out = sent.find(m => m.type === 'output') as any;
    const text = (out?.lines ?? []).map((l: any) => l.text).join(' ').toLowerCase();
    expect(text).toContain('byname');   // warning lists the dropped index
    // index metadata is gone
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'LIST INDEXES' });
    const out2 = sent.find(m => m.type === 'output') as any;
    expect((out2?.lines ?? []).map((l: any) => l.text).join(' ').toLowerCase()).not.toContain('byname');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/AlterTable.test.ts -t "drops affected indexes"`
Expected: FAIL — DROP not implemented (returns the "not implemented" error).

- [ ] **Step 3: Add the `dropAllIndexes` helper**

Add near `doAlterTable` in `src/interpreter/Executor.ts`:

```typescript
  // Drop every index on a table — both the SQLite index objects and the
  // IndexStore metadata. Returns the tags dropped (for a warning line).
  // Used by column ops that can invalidate an index expression.
  private async dropAllIndexes(table: string): Promise<string[]> {
    if (!this.indexStore) return [];
    const tags = this.indexStore.listIndexes(table).map(i => i.tag);
    for (const tag of tags) {
      const sqlName = `idx_${table}_${tag}`.replace(/"/g, '""');
      await this.db.exec(`DROP INDEX IF EXISTS "${sqlName}"`);
    }
    this.indexStore.dropTable(table);          // clears metadata + active marker
    if (this.area.table === table) this.area.activeIndex = null;
    return tags;
  }
```

> The SQLite index name format `idx_${table}_${tag}` mirrors `IndexCommands.ts:30`.

- [ ] **Step 4: Run test to verify it still fails on DROP**

Run: `npx vitest run tests/AlterTable.test.ts -t "drops affected indexes"`
Expected: FAIL — DROP path still returns "not implemented" (helper added but unused). This is implemented in Task 5.

- [ ] **Step 5: Commit**

```bash
git add src/interpreter/Executor.ts tests/AlterTable.test.ts
git commit -m "feat(executor): add dropAllIndexes helper for ALTER TABLE (#6)"
```

---

## Task 5: Executor — DROP and RENAME column

**Files:**
- Modify: `src/interpreter/Executor.ts` (`doAlterTable` DROP/RENAME branches)
- Test: `tests/AlterTable.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/AlterTable.test.ts`:

```typescript
describe('Executor: ALTER TABLE DROP / RENAME', () => {
  async function setup() {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t (name CHAR(10), age INT)' });
    await session.handleMessage({ type: 'command', text: 'USE t' });
    return { session, sent };
  }

  it('drops a column', async () => {
    const { session, sent } = await setup();
    await session.handleMessage({ type: 'command', text: 'ALTER TABLE t DROP age' });
    const lines = await structure(session, sent, 't');
    expect(lines.join(' ').toLowerCase()).not.toContain('age');
  });

  it('errors dropping a non-existent column', async () => {
    const { session, sent } = await setup();
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'ALTER TABLE t DROP ghost' });
    const out = sent.find(m => m.type === 'output') as any;
    expect((out?.lines ?? []).some((l: any) => l.cls === 'error')).toBe(true);
  });

  it('renames a column', async () => {
    const { session, sent } = await setup();
    await session.handleMessage({ type: 'command', text: 'ALTER TABLE t RENAME age TO years' });
    const lines = await structure(session, sent, 't');
    const joined = lines.join(' ').toLowerCase();
    expect(joined).toContain('years');
    expect(joined).not.toContain('age');
  });

  it('errors renaming to an existing column name', async () => {
    const { session, sent } = await setup();
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'ALTER TABLE t RENAME age TO name' });
    const out = sent.find(m => m.type === 'output') as any;
    expect((out?.lines ?? []).some((l: any) => l.cls === 'error')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/AlterTable.test.ts -t "DROP / RENAME"`
Expected: FAIL — "operation not implemented".

- [ ] **Step 3: Implement DROP and RENAME**

Replace the `// DROP / RENAME / ALTER handled in later tasks` line and the trailing not-implemented return in `doAlterTable` with:

```typescript
    if (node.op === 'DROP') {
      if (!has(node.col)) return { output: [{ text: `ALTER TABLE: no such column: ${node.col}`, cls: 'error' }] };
      if (cols.length <= 1) return { output: [{ text: 'ALTER TABLE: cannot drop the only column', cls: 'error' }] };
      const dropped = await this.dropAllIndexes(name);
      await this.db.exec(`ALTER TABLE ${q(name)} DROP COLUMN ${q(node.col)}`);
      await this.refreshIfActive(name);
      return { output: [
        { text: `Dropped column ${node.col} from ${name}.`, cls: 'ok' },
        ...(dropped.length ? [{ text: `Dropped index(es) (rebuild with INDEX ON): ${dropped.join(', ')}`, cls: 'warn' }] : []),
      ] };
    }

    if (node.op === 'RENAME') {
      if (!has(node.col)) return { output: [{ text: `ALTER TABLE: no such column: ${node.col}`, cls: 'error' }] };
      if (has(node.newName)) return { output: [{ text: `ALTER TABLE: column already exists: ${node.newName}`, cls: 'error' }] };
      const dropped = await this.dropAllIndexes(name);
      await this.db.exec(`ALTER TABLE ${q(name)} RENAME COLUMN ${q(node.col)} TO ${q(node.newName)}`);
      await this.refreshIfActive(name);
      return { output: [
        { text: `Renamed ${node.col} to ${node.newName} in ${name}.`, cls: 'ok' },
        ...(dropped.length ? [{ text: `Dropped index(es) (rebuild with INDEX ON): ${dropped.join(', ')}`, cls: 'warn' }] : []),
      ] };
    }

    // ALTER (type change) handled in Task 6
    return { output: [{ text: 'ALTER TABLE: operation not implemented', cls: 'error' }] };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/AlterTable.test.ts -t "DROP / RENAME"` then `npx vitest run tests/AlterTable.test.ts -t "drops affected indexes"`
Expected: PASS (5 tests total across both).

- [ ] **Step 5: Commit**

```bash
git add src/interpreter/Executor.ts tests/AlterTable.test.ts
git commit -m "feat(executor): ALTER TABLE DROP and RENAME COLUMN (#6)"
```

---

## Task 6: Executor — type change (copy-table dance)

**Files:**
- Modify: `src/interpreter/Executor.ts` (`doAlterTable` ALTER branch)
- Test: `tests/AlterTable.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/AlterTable.test.ts`:

```typescript
describe('Executor: ALTER TABLE ALTER (type change)', () => {
  it('changes a column type and preserves data', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t (name CHAR(10), age CHAR(5))' });
    await session.handleMessage({ type: 'command', text: 'USE t' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Bob", age WITH "42"' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'ALTER TABLE t ALTER age INT' });
    const ok = sent.find(m => m.type === 'output') as any;
    expect((ok?.lines ?? []).some((l: any) => l.cls === 'error')).toBe(false);
    // data survived
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'GO TOP' });
    await session.handleMessage({ type: 'command', text: 'LIST' });
    const out = sent.find(m => m.type === 'output') as any;
    expect((out?.lines ?? []).map((l: any) => l.text).join(' ')).toContain('Bob');
    expect((out?.lines ?? []).map((l: any) => l.text).join(' ')).toContain('42');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/AlterTable.test.ts -t "type change"`
Expected: FAIL — "operation not implemented".

- [ ] **Step 3: Implement the type-change dance**

Replace the `// ALTER (type change) handled in Task 6` block / not-implemented return with:

```typescript
    if (node.op === 'ALTER') {
      if (!has(node.col)) return { output: [{ text: `ALTER TABLE: no such column: ${node.col}`, cls: 'error' }] };
      const dropped = await this.dropAllIndexes(name);
      const tmp = `__alttmp_${name}`;
      // Build the new schema: same columns, but the target column retyped.
      const newType = mapType(node.colType);
      const colDefs = cols.map(c =>
        c.name.toUpperCase() === node.col.toUpperCase()
          ? `${q(c.name)} ${newType}`
          : `${q(c.name)} ${c.type || 'TEXT'}`
      ).join(', ');
      const colList = cols.map(c =>
        c.name.toUpperCase() === node.col.toUpperCase()
          ? `CAST(${q(c.name)} AS ${newType}) AS ${q(c.name)}`
          : q(c.name)
      ).join(', ');
      await this.db.exec(`DROP TABLE IF EXISTS ${q(tmp)}`);
      await this.db.exec(`ALTER TABLE ${q(name)} RENAME TO ${q(tmp)}`);
      await this.db.exec(`CREATE TABLE ${q(name)} (${colDefs})`);
      await this.db.exec(`INSERT INTO ${q(name)} SELECT ${colList} FROM ${q(tmp)}`);
      await this.db.exec(`DROP TABLE ${q(tmp)}`);
      await this.refreshIfActive(name);
      return { output: [
        { text: `Changed type of ${node.col} to ${node.colType} in ${name}.`, cls: 'ok' },
        ...(dropped.length ? [{ text: `Dropped index(es) (rebuild with INDEX ON): ${dropped.join(', ')}`, cls: 'warn' }] : []),
      ] };
    }

    return { output: [{ text: 'ALTER TABLE: operation not implemented', cls: 'error' }] };
```

> `c.type` is the existing SQLite type string from `ColInfo` (e.g. `TEXT`, `INTEGER`); fall back to `TEXT` if empty. `better-sqlite3` runs each `exec` immediately; the rename→create→insert→drop sequence is the standard SQLite type-change recipe.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/AlterTable.test.ts -t "type change"`
Expected: PASS (1 test).

- [ ] **Step 5: Run the whole AlterTable suite**

Run: `npx vitest run tests/AlterTable.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Commit**

```bash
git add src/interpreter/Executor.ts tests/AlterTable.test.ts
git commit -m "feat(executor): ALTER TABLE type change via copy-table dance (#6)"
```

---

## Task 7: MODIFY STRUCTURE action → WS message

**Files:**
- Modify: `src/shared/types.ts` (ServerMessage union ~119), `server/Session.ts` (action handling ~296), `src/interpreter/Executor.ts` (action union ~12)
- Test: `tests/AlterTable.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/AlterTable.test.ts`:

```typescript
describe('Session: MODIFY STRUCTURE', () => {
  it('sends modstruct-open with table and columns', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t (name CHAR(10), age INT)' });
    await session.handleMessage({ type: 'command', text: 'USE t' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'MODIFY STRUCTURE' });
    const msg = sent.find(m => m.type === 'modstruct-open') as any;
    expect(msg).toBeDefined();
    expect(msg.table).toBe('t');
    expect(msg.columns.map((c: any) => c.name.toLowerCase())).toEqual(['name', 'age']);
  });

  it('errors MODIFY STRUCTURE with no table', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'MODIFY STRUCTURE' });
    const out = sent.find(m => m.type === 'output') as any;
    expect((out?.lines ?? []).some((l: any) => l.cls === 'error')).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/AlterTable.test.ts -t "MODIFY STRUCTURE"`
Expected: FAIL — no `modstruct-open` message (Session doesn't handle the action).

- [ ] **Step 3: Add the action to the Executor action union**

In `src/interpreter/Executor.ts` at ~12, extend the `action?:` union to include `'MODIFY_STRUCTURE'`:

```typescript
  action?: 'BROWSE' | 'QUIT' | 'FORM_READY' | 'FORM_SUBMIT' | 'DO_PRG' | 'EDIT_PRG' | 'LIST_PROGRAMS' | 'REPORT_PREVIEW' | 'MODIFY_STRUCTURE';
```

- [ ] **Step 4: Add the WS message type**

In `src/shared/types.ts`, add to the `ServerMessage` union (after the `grid-open` line at ~119):

```typescript
  | { type: 'modstruct-open'; table: string; columns: ColInfo[] }
```

- [ ] **Step 5: Handle the action in Session**

In `server/Session.ts`, before the final `return false;` at ~300 (alongside the other `if (result.action === …)` blocks), add:

```typescript
    if (result.action === 'MODIFY_STRUCTURE') {
      const area = this.executor.area;
      if (area.table) {
        const columns = await this.bridge.getStructure(area.table);
        this.send({ type: 'modstruct-open', table: area.table, columns });
      }
      return true;
    }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run tests/AlterTable.test.ts -t "MODIFY STRUCTURE"`
Expected: PASS (2 tests).

- [ ] **Step 7: Run full vitest + typecheck**

Run: `npm test`
Expected: PASS (all existing + new tests). If a build/typecheck step exists (`npm run build`), run it to confirm the union changes typecheck.

- [ ] **Step 8: Commit**

```bash
git add src/shared/types.ts server/Session.ts src/interpreter/Executor.ts tests/AlterTable.test.ts
git commit -m "feat: MODIFY STRUCTURE emits modstruct-open WS message (#6)"
```

---

## Task 8: ModStructWizard (browser UI)

**Files:**
- Create: `src/ui/wizards/ModStructWizard.ts`
- Modify: `src/ui/wizards/index.ts` (export the opener)
- Modify: `src/main.ts` (listen for `modstruct-open`)

- [ ] **Step 1: Create the wizard**

Create `src/ui/wizards/ModStructWizard.ts`:

```typescript
import { WizardShell } from './WizardShell';
import type { ColInfo } from '../../shared/types';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TYPES = ['CHAR', 'NUM', 'INT', 'DATE', 'LOGICAL', 'MEMO'] as const;

// Map an existing SQLite storage type back to a W3Script type for the picker.
function w3type(sqlType: string): string {
  const t = (sqlType || '').toUpperCase();
  if (t.includes('INT')) return 'INT';
  if (t.includes('REAL') || t.includes('NUM') || t.includes('FLOA') || t.includes('DOUB') || t.includes('DEC')) return 'NUM';
  return 'CHAR';
}

interface Row {
  origName: string;        // '' for newly-added rows
  origType: string;        // W3Script type at load time
  name: HTMLInputElement;
  type: HTMLSelectElement;
  drop: HTMLInputElement;  // checkbox: mark for deletion
}

export function openModStructWizard(
  table: string,
  columns: ColInfo[],
  run: (cmd: string) => void,
  onClose: () => void,
): void {
  let shell: WizardShell;
  const rows: Row[] = [];
  const colsWrap = document.createElement('div');

  const buildCommands = (): { cmds: string[]; err: string } => {
    const cmds: string[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const newName = r.name.value.trim();
      if (r.origName && r.drop.checked) {            // existing row marked dropped
        cmds.push(`ALTER TABLE ${table} DROP ${r.origName}`);
        continue;
      }
      if (!newName) {
        if (r.origName) return { cmds: [], err: `Column name required for ${r.origName}` };
        continue;                                     // blank new row → ignore
      }
      if (!NAME_RE.test(newName)) return { cmds: [], err: `Invalid column name: ${newName}` };
      if (seen.has(newName.toUpperCase())) return { cmds: [], err: `Duplicate column: ${newName}` };
      seen.add(newName.toUpperCase());
      const newType = r.type.value;
      if (!r.origName) {                              // brand new column
        cmds.push(`ALTER TABLE ${table} ADD ${newName} ${newType}`);
        continue;
      }
      if (newName.toUpperCase() !== r.origName.toUpperCase()) {
        cmds.push(`ALTER TABLE ${table} RENAME ${r.origName} TO ${newName}`);
      }
      if (newType !== r.origType) {
        cmds.push(`ALTER TABLE ${table} ALTER ${newName} ${newType}`);
      }
    }
    return { cmds, err: '' };
  };

  const update = () => {
    const { cmds, err } = buildCommands();
    shell.setPreview(cmds.length ? cmds.join('\n') : null, err);
  };

  const addRow = (col?: ColInfo) => {
    const wrap = document.createElement('div');
    wrap.className = 'wz-row';
    const name = document.createElement('input');
    name.type = 'text'; name.className = 'wz-col-name'; name.placeholder = 'column';
    name.style.minWidth = '140px';
    name.value = col?.name ?? '';
    const type = document.createElement('select');
    type.className = 'wz-col-type';
    const startType = col ? w3type(col.type) : 'CHAR';
    for (const t of TYPES) {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      if (t === startType) o.selected = true;
      type.appendChild(o);
    }
    const drop = document.createElement('input');
    drop.type = 'checkbox'; drop.title = 'drop this column';
    const dropLabel = document.createElement('label');
    dropLabel.append(drop, document.createTextNode(' drop'));
    if (!col) dropLabel.style.visibility = 'hidden';   // new rows can't be "dropped"
    wrap.append(name, type, dropLabel);
    colsWrap.appendChild(wrap);
    rows.push({ origName: col?.name ?? '', origType: startType, name, type, drop });
    for (const el of [name, type, drop]) el.addEventListener('input', update);
    drop.addEventListener('change', update);
  };

  shell = new WizardShell(
    `Modify structure — ${table}`,
    'Rename or retype columns in place, tick "drop" to remove one, or add new columns. Changes that touch a column drop the table\'s indexes (rebuild with INDEX ON).',
    { okLabel: 'Apply changes', onOk: () => {
        const { cmds } = buildCommands();
        for (const c of cmds) run(c);
        shell.close();
      } },
    onClose,
  );
  shell.field('Columns', colsWrap);
  for (const c of columns) addRow(c);
  const addBtn = document.createElement('button');
  addBtn.className = 'secondary';
  addBtn.textContent = '+ add column';
  addBtn.addEventListener('click', () => { addRow(); });
  shell.field('', addBtn);
  update();
}
```

> Verify `WizardShell`'s constructor signature and `field`/`setPreview`/`close` methods match `TableWizard.ts` usage (they are used identically there). If `setPreview` expects a single-line string, multi-line preview still renders; otherwise join with `'; '`.

- [ ] **Step 2: Export the opener from the wizards barrel**

In `src/ui/wizards/index.ts`, add an export at the top level (it does NOT go through `openWizard`, since it needs columns directly):

```typescript
export { openModStructWizard } from './ModStructWizard';
```

- [ ] **Step 3: Wire the WS listener in main.ts**

In `src/main.ts`, update the wizards import and add a listener after the existing wiring (near the `openWizard` wiring at ~28):

```typescript
import { openWizard, openModStructWizard } from './ui/wizards';
```

```typescript
ws.on('modstruct-open', (msg) => {
  const m = msg as any;
  terminal.closeActiveView();
  document.getElementById('terminal-view')!.classList.add('hidden');
  document.getElementById('wizard-view')!.classList.remove('hidden');
  openModStructWizard(
    m.table,
    m.columns,
    (cmd: string) => { terminal.runCommand(cmd); assistant.refresh(); },
    () => terminal.showTerminal(),
  );
});
```

> Confirm the names `terminal`, `assistant`, and `ws` are in scope in `main.ts` (they are — used by the existing `openWizard` wiring). Match the exact view-show logic used in `wizards/index.ts:showWizardView`.

- [ ] **Step 4: Build / typecheck**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add src/ui/wizards/ModStructWizard.ts src/ui/wizards/index.ts src/main.ts
git commit -m "feat(ui): MODIFY STRUCTURE wizard (#6)"
```

---

## Task 9: Assistant sidebar action

**Files:**
- Modify: `src/ui/Assistant.ts` (table category actions ~31-34)

- [ ] **Step 1: Add the sidebar action**

In `src/ui/Assistant.ts`, in the table category action list (near `{ label: 'Drop table…' …}` at ~34), add:

```typescript
    { label: 'Modify structure…', needs: 'db', picker: 'tables',
      onPick: (n, h) => { h.run(`USE ${n}`); h.run('MODIFY STRUCTURE'); } },
```

> Both `h.run` calls go through the server; `USE` makes the table active, then `MODIFY STRUCTURE` triggers `modstruct-open` with authoritative columns. Confirm the `onPick` handler signature `(name, helpers)` matches the existing "Drop table…" / "Open table…" actions.

- [ ] **Step 2: Build / typecheck**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/ui/Assistant.ts
git commit -m "feat(ui): add Modify structure… sidebar action (#6)"
```

---

## Task 10: Playwright E2E

**Files:**
- Modify: `tests/assistant.spec.ts`

- [ ] **Step 1: Write the E2E test**

Add a test to `tests/assistant.spec.ts` following the existing patterns in that file (selectors, server setup). The test should:

1. Open a database and create a table with two columns via the terminal (reuse the helpers already in the spec for issuing commands).
2. Issue `MODIFY STRUCTURE` (or trigger the sidebar "Modify structure…" action and pick the table).
3. Assert the wizard view (`#wizard-view`) is visible and shows a row per column (`.wz-col-name` inputs pre-filled).
4. Change the second column's name input, click "Apply changes".
5. Assert the terminal received an `ALTER TABLE … RENAME …` round-trip — e.g. run `LIST STRUCTURE` and assert the new column name appears in the output.

Match the exact selector and command-issue helpers already used by neighbouring tests in `tests/assistant.spec.ts` (read the top of that file first for the harness).

- [ ] **Step 2: Run the E2E suite**

Ensure the dev server is running (`npm run dev`), then:
Run: `npx playwright test tests/assistant.spec.ts`
Expected: PASS, including the new test.

- [ ] **Step 3: Commit**

```bash
git add tests/assistant.spec.ts
git commit -m "test(e2e): MODIFY STRUCTURE wizard round-trip (#6)"
```

---

## Task 11: Definition of done — version, changelog, docs

**Files:**
- Modify: `package.json`, `CHANGELOG.md`, `README.md`, `CLAUDE.md`

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all green.

- [ ] **Step 2: Bump the version**

Edit `package.json`: bump `0.6.3` → `0.7.0` (minor — a roadmap 1.0.0-track feature).

- [ ] **Step 3: CHANGELOG entry**

Add to `CHANGELOG.md` under a new `## [0.7.0]` heading, **Added** section:

```markdown
### Added
- `MODIFY STRUCTURE` — alter an existing table's columns without losing data (#6).
  - Scriptable command family: `ALTER TABLE <t> ADD/DROP/RENAME/ALTER <col> …`.
  - `MODIFY STRUCTURE` opens an Assistant wizard (diff editor) for the active table; also reachable via the sidebar "Modify structure…" action.
  - Column ops that can invalidate an index drop the table's indexes and warn to rebuild with `INDEX ON`.
```

- [ ] **Step 4: README command tables**

In `README.md`, add the `ALTER TABLE` / `MODIFY STRUCTURE` rows to the data/structure command table and mention the wizard in the Assistant/wizard list. Mirror the wording in CLAUDE.md (next step).

- [ ] **Step 5: CLAUDE.md updates**

In `CLAUDE.md`:
- Add to the **Data & navigation** table: `MODIFY STRUCTURE`, and a small `ALTER TABLE` sub-table or rows for ADD/DROP/RENAME/ALTER.
- Add `ModStructWizard.ts` to the `src/ui/wizards/` architecture list.
- Update the roadmap / 1.0.0 scope note to mark `MODIFY STRUCTURE` done.

- [ ] **Step 6: Screenshot (if UI committed)**

If the project commits wizard screenshots to `docs/screenshots/`, capture the Modify-structure wizard and add it. Otherwise skip and note it.

- [ ] **Step 7: Commit and tag**

```bash
git add package.json CHANGELOG.md README.md CLAUDE.md docs/screenshots/ 2>/dev/null
git commit -m "release: v0.7.0 — MODIFY STRUCTURE / ALTER TABLE (#6)"
git tag v0.7.0
```

> Per project convention, tag `vX.Y.Z` on the version-bump commit (tag the merge commit on `main` if this lands via PR).

---

## Self-review notes

- **Spec coverage:** ADD/DROP/RENAME/type-change (Tasks 3,5,6); command grammar (Task 2); wizard + both open paths (Tasks 7-9); index-drop warning (Tasks 4-6); tests (Tasks 3-7,10); DoD (Task 11). All spec sections covered.
- **Open path decision resolved:** the spec flagged uncertainty about a server→client open-wizard channel. Investigation found the `action → WS message → client listener` pattern (used by BROWSE/FORM); Task 7-8 implement a dedicated `modstruct-open` message accordingly. No sidebar-only fallback needed.
- **Type consistency:** action string `'MODIFY_STRUCTURE'`, WS type `'modstruct-open'`, wizard opener `openModStructWizard`, helper `dropAllIndexes`, `refreshIfActive` used consistently across tasks.
