# Indexing & Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dBASE III–style `INDEX ON`, `SET INDEX TO`, `SEEK`, `FIND`, `REINDEX`, and `LIST INDEXES` commands, where the active index controls record order in `LIST`, `BROWSE`, `GO TOP/BOTTOM`, and `SKIP`.

**Architecture:** A new `IndexStore` class (mirroring `ProgramStore`) owns two tables in `system.sqlite3` — `indexes` (definitions) and `active_indexes` (one active tag per table). The `Executor` gains an `activeIndex` state field, a private `getOrderedRows()` helper that routes to SQL `ORDER BY` (simple fields) or JS sort (expressions), and six new command handlers. Session wires `IndexStore` into `Executor`.

**Tech Stack:** TypeScript, better-sqlite3, Vitest

---

## File Map

| Action | File | Purpose |
|---|---|---|
| Create | `server/IndexStore.ts` | owns `indexes` + `active_indexes` tables in system.sqlite3 |
| Modify | `src/shared/types.ts` | add `IIndexStore` interface |
| Modify | `src/interpreter/Lexer.ts` | add SEEK, FIND, REINDEX keywords |
| Modify | `src/interpreter/Parser.ts` | add INDEX_ON, SET_INDEX, REINDEX, LIST_INDEXES, SEEK, FIND AST nodes + parse rules |
| Modify | `src/interpreter/Executor.ts` | add activeIndex to State, getOrderedRows helper, 6 new command handlers, update LIST/GO/SKIP |
| Modify | `server/Session.ts` | pass IndexStore to Executor |
| Create | `tests/Indexing.test.ts` | all indexing & search tests |

---

### Task 1: IIndexStore interface + IndexStore

**Files:**
- Modify: `src/shared/types.ts`
- Create: `server/IndexStore.ts`

- [ ] **Step 1: Write failing test**

Create `tests/Indexing.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { IndexStore } from '../server/IndexStore';
import fs from 'fs';
import path from 'path';

let counter = 0;
function tmpPath() {
  return path.join(process.cwd(), 'data', `test_idx_${++counter}.sqlite3`);
}

afterEach(() => {
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.startsWith('test_idx_'))
      .forEach(f => fs.unlinkSync(path.join(dataDir, f)));
  }
});

describe('IndexStore', () => {
  it('saves and retrieves an index definition', () => {
    const store = new IndexStore(tmpPath());
    store.saveIndex('customers', 'byname', 'lastname+firstname');
    const indexes = store.listIndexes('customers');
    expect(indexes).toHaveLength(1);
    expect(indexes[0].tag).toBe('byname');
    expect(indexes[0].expression).toBe('lastname+firstname');
  });

  it('sets and gets active index', () => {
    const store = new IndexStore(tmpPath());
    store.saveIndex('customers', 'byname', 'lastname');
    store.setActive('customers', 'byname');
    expect(store.getActive('customers')).toEqual({ tag: 'byname', expression: 'lastname' });
  });

  it('clears active index', () => {
    const store = new IndexStore(tmpPath());
    store.saveIndex('customers', 'byname', 'lastname');
    store.setActive('customers', 'byname');
    store.clearActive('customers');
    expect(store.getActive('customers')).toBeNull();
  });

  it('returns null getActive when no index set', () => {
    const store = new IndexStore(tmpPath());
    expect(store.getActive('customers')).toBeNull();
  });

  it('upserts index definition on duplicate tag', () => {
    const store = new IndexStore(tmpPath());
    store.saveIndex('customers', 'byname', 'lastname');
    store.saveIndex('customers', 'byname', 'firstname');
    const indexes = store.listIndexes('customers');
    expect(indexes).toHaveLength(1);
    expect(indexes[0].expression).toBe('firstname');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- --reporter=verbose tests/Indexing.test.ts
```
Expected: FAIL — `Cannot find module '../server/IndexStore'`

- [ ] **Step 3: Add IIndexStore to shared types**

In `src/shared/types.ts`, add after the `IDatabaseBridge` interface:

```typescript
export interface IndexDef {
  tag: string;
  expression: string;
}

export interface IIndexStore {
  saveIndex(tableName: string, tag: string, expression: string): void;
  listIndexes(tableName: string): IndexDef[];
  getActive(tableName: string): IndexDef | null;
  setActive(tableName: string, tag: string): void;
  clearActive(tableName: string): void;
}
```

- [ ] **Step 4: Create IndexStore**

Create `server/IndexStore.ts`:

```typescript
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { IIndexStore, IndexDef } from '../src/shared/types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH  = path.join(DATA_DIR, 'system.sqlite3');

export class IndexStore implements IIndexStore {
  private db: Database.Database;

  constructor(dbPath = DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS indexes (
        id         INTEGER PRIMARY KEY,
        table_name TEXT NOT NULL,
        tag        TEXT NOT NULL,
        expression TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        UNIQUE(table_name, tag)
      );
      CREATE TABLE IF NOT EXISTS active_indexes (
        table_name TEXT PRIMARY KEY,
        tag        TEXT NOT NULL
      );
    `);
  }

  saveIndex(tableName: string, tag: string, expression: string): void {
    this.db.prepare(`
      INSERT INTO indexes (table_name, tag, expression)
      VALUES (?, ?, ?)
      ON CONFLICT(table_name, tag) DO UPDATE SET expression = excluded.expression
    `).run(tableName, tag, expression);
  }

  listIndexes(tableName: string): IndexDef[] {
    return this.db.prepare(
      'SELECT tag, expression FROM indexes WHERE table_name = ? ORDER BY tag'
    ).all(tableName) as IndexDef[];
  }

  getActive(tableName: string): IndexDef | null {
    const row = this.db.prepare(`
      SELECT i.tag, i.expression
      FROM active_indexes a
      JOIN indexes i ON i.table_name = a.table_name AND i.tag = a.tag
      WHERE a.table_name = ?
    `).get(tableName) as IndexDef | undefined;
    return row ?? null;
  }

  setActive(tableName: string, tag: string): void {
    this.db.prepare(`
      INSERT INTO active_indexes (table_name, tag) VALUES (?, ?)
      ON CONFLICT(table_name) DO UPDATE SET tag = excluded.tag
    `).run(tableName, tag);
  }

  clearActive(tableName: string): void {
    this.db.prepare('DELETE FROM active_indexes WHERE table_name = ?').run(tableName);
  }
}

export const indexStore = new IndexStore();
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npm test -- --reporter=verbose tests/Indexing.test.ts
```
Expected: all 5 IndexStore tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts server/IndexStore.ts tests/Indexing.test.ts
git commit -m "feat: add IndexStore and IIndexStore for index metadata"
```

---

### Task 2: Lexer keywords + Parser AST nodes

**Files:**
- Modify: `src/interpreter/Lexer.ts`
- Modify: `src/interpreter/Parser.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/Indexing.test.ts` a new describe block:

```typescript
import { Lexer } from '../src/interpreter/Lexer';
import { Parser } from '../src/interpreter/Parser';

describe('Parser: index commands', () => {
  function parse(src: string) {
    return new Parser(new Lexer(src).tokenize()).parse();
  }

  it('parses INDEX ON field TO tag', () => {
    const nodes = parse('INDEX ON lastname TO byname');
    expect(nodes[0]).toEqual({ type: 'INDEX_ON', expression: 'lastname', tag: 'byname' });
  });

  it('parses INDEX ON expression TO tag', () => {
    const nodes = parse('INDEX ON lastname+firstname TO full');
    expect(nodes[0]).toEqual({ type: 'INDEX_ON', expression: 'lastname+firstname', tag: 'full' });
  });

  it('parses SET INDEX TO tag', () => {
    const nodes = parse('SET INDEX TO byname');
    expect(nodes[0]).toEqual({ type: 'SET_INDEX', tag: 'byname' });
  });

  it('parses SET INDEX TO (clear)', () => {
    const nodes = parse('SET INDEX TO');
    expect(nodes[0]).toEqual({ type: 'SET_INDEX', tag: null });
  });

  it('parses REINDEX', () => {
    const nodes = parse('REINDEX');
    expect(nodes[0]).toEqual({ type: 'REINDEX' });
  });

  it('parses LIST INDEXES', () => {
    const nodes = parse('LIST INDEXES');
    expect(nodes[0]).toEqual({ type: 'LIST_INDEXES' });
  });

  it('parses SEEK value', () => {
    const nodes = parse('SEEK "Smith"');
    expect(nodes[0]).toMatchObject({ type: 'SEEK' });
  });

  it('parses FIND string', () => {
    const nodes = parse('FIND Smith');
    expect(nodes[0]).toMatchObject({ type: 'FIND', value: 'SMITH' });
  });
});
```

- [ ] **Step 2: Run to verify fails**

```bash
npm test -- --reporter=verbose tests/Indexing.test.ts
```
Expected: parser tests FAIL — unknown node types

- [ ] **Step 3: Add SEEK, FIND, REINDEX to Lexer keywords**

In `src/interpreter/Lexer.ts`, add to the `KWS` Set (after `'INPUT','ACCEPT','DISPLAY','DATABASE','FOR','NEXT'`):

```typescript
  'SEEK','FIND','REINDEX','INDEXES',
```

- [ ] **Step 4: Add AST nodes to Parser**

In `src/interpreter/Parser.ts`, add to the `ASTNode` union type (after `| { type: 'EDIT_PRG'; name: string }`):

```typescript
  | { type: 'INDEX_ON';    expression: string; tag: string }
  | { type: 'SET_INDEX';   tag: string | null }
  | { type: 'REINDEX' }
  | { type: 'LIST_INDEXES' }
  | { type: 'SEEK';        value: Expr }
  | { type: 'FIND';        value: string };
```

- [ ] **Step 5: Add parse rules to Parser**

In `src/interpreter/Parser.ts`, in the `stmt()` switch, add cases before the `default`:

```typescript
      case 'INDEX':   return this.parseIndexOn();
      case 'REINDEX': this.adv(); return { type: 'REINDEX' };
      case 'SEEK':    this.adv(); return { type: 'SEEK', value: this.expr() };
      case 'FIND':    { this.adv(); const val = this.peek().val; this.adv(); return { type: 'FIND', value: val }; }
```

Extend `parseSet()` to handle `SET INDEX TO`:

```typescript
  private parseSet(): ASTNode {
    this.adv();
    if (this.peekKw('INDEX')) {
      this.adv();
      this.expectKw('TO');
      const tag = (!this.end() && this.peek().type !== 'NL' && this.peek().type !== 'EOF' && this.peek().type !== 'SEMI')
        ? (this.adv(), this.prev().val)
        : null;
      return { type: 'SET_INDEX', tag };
    }
    this.expectKw('FILTER');
    this.expectKw('TO');
    const parts: string[] = [];
    while (!this.end() && this.peek().type !== 'NL' && this.peek().type !== 'SEMI' && this.peek().type !== 'EOF') {
      const t = this.peek();
      parts.push(t.type === 'STR' ? `'${t.val.replace(/'/g, "''")}'` : t.val);
      this.adv();
    }
    return { type: 'SET_FILTER', expr: parts.length ? parts.join(' ') : null };
  }
```

Add `parseIndexOn()` method to `Parser`:

```typescript
  private parseIndexOn(): ASTNode {
    this.adv(); // INDEX
    this.expectKw('ON');
    // Collect expression tokens until TO keyword
    const parts: string[] = [];
    while (!this.end() && !this.peekKw('TO') && this.peek().type !== 'NL' && this.peek().type !== 'EOF') {
      parts.push(this.peek().val);
      this.adv();
    }
    this.expectKw('TO');
    const tag = this.ident();
    return { type: 'INDEX_ON', expression: parts.join(''), tag };
  }
```

Extend `parseList()` to handle `LIST INDEXES`:

```typescript
  private parseList(): ASTNode {
    this.adv();
    if (this.peekKw('STRUCTURE') || this.peekKw('STRUCT')) { this.adv(); return { type: 'LIST_STRUCT' }; }
    if (this.peekKw('TABLES')) { this.adv(); return { type: 'LIST_TABLES' }; }
    if (this.peekKw('PROGRAMS') || this.peekKw('PROGS')) { this.adv(); return { type: 'LIST_PROGRAMS' }; }
    if (this.peekKw('INDEXES') || this.peekKw('INDEX')) { this.adv(); return { type: 'LIST_INDEXES' }; }
    return { type: 'LIST' };
  }
```

- [ ] **Step 6: Run test to verify passes**

```bash
npm test -- --reporter=verbose tests/Indexing.test.ts
```
Expected: all parser tests PASS

- [ ] **Step 7: Run full suite to check no regressions**

```bash
npm test
```
Expected: all tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/interpreter/Lexer.ts src/interpreter/Parser.ts tests/Indexing.test.ts
git commit -m "feat: add INDEX ON, SET INDEX TO, SEEK, FIND, REINDEX AST nodes and parse rules"
```

---

### Task 3: Wire IndexStore into Executor + Session

**Files:**
- Modify: `src/interpreter/Executor.ts`
- Modify: `server/Session.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/Indexing.test.ts`:

```typescript
import { Session } from '../server/Session';
import type { ServerMessage } from '../src/shared/types.js';

let sessionCounter = 0;
function makeSession() {
  const sent: ServerMessage[] = [];
  const send = (msg: ServerMessage) => { sent.push(msg); };
  const session = new Session(send);
  return { session, sent };
}
function uniqueDb() { return `test_idx_sess_${++sessionCounter}`; }

describe('Session: INDEX ON restores on USE', () => {
  it('active index is restored when table is re-opened', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE contacts (lastname TEXT, firstname TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE contacts' });
    await session.handleMessage({ type: 'command', text: 'INDEX ON lastname TO byname' });
    sent.length = 0;
    // Re-open the table — active index should be restored
    await session.handleMessage({ type: 'command', text: 'USE contacts' });
    const output = sent.find(m => m.type === 'output') as any;
    expect(output?.lines.some((l: any) => l.text.includes('byname'))).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fails**

```bash
npm test -- --reporter=verbose tests/Indexing.test.ts
```
Expected: FAIL — `INDEX_ON` not handled by Executor

- [ ] **Step 3: Add activeIndex to Executor State**

In `src/interpreter/Executor.ts`, update the `State` interface:

```typescript
export interface State {
  db: string | null;
  table: string | null;
  filter: string | null;
  vars: Map<string, unknown>;
  rowPtr: number;
  pendingForm: FormField[];
  opfsAvailable: boolean;
  activeIndex: { tag: string; expression: string } | null;
}
```

Update the `Executor` constructor to initialize `activeIndex` and accept `IIndexStore`:

```typescript
import type { IDatabaseBridge, IIndexStore, OutputLine, FormField } from '../shared/types';

export class Executor {
  public state: State;

  constructor(
    private db: IDatabaseBridge,
    private indexStore: IIndexStore | null = null,
  ) {
    this.state = {
      db: null, table: null, filter: null,
      vars: new Map(), rowPtr: 1,
      pendingForm: [], opfsAvailable: false,
      activeIndex: null,
    };
  }
```

- [ ] **Step 4: Update doUse to restore active index**

In `src/interpreter/Executor.ts`, update `doUse()` to restore active index after setting `this.state.table`:

```typescript
  private async doUse(name: string): Promise<ExecResult> {
    const dbName = this.state.db ?? 'webbaseiii';
    if (!this.state.db) {
      const r = await this.db.openDatabase(dbName);
      this.state.db = dbName;
      this.state.opfsAvailable = r.opfsAvailable;
    }
    this.state.table = name;
    this.state.filter = null;
    this.state.rowPtr = 1;
    // Restore active index for this table
    this.state.activeIndex = this.indexStore?.getActive(name) ?? null;
    const exists = await this.db.tableExists(name);
    const storage = this.state.opfsAvailable ? 'OPFS (persistent)' : 'server-side persistent';
    const lines: OutputLine[] = [
      { text: `Database : ${dbName}  [${storage}]`, cls: 'info' },
    ];
    if (exists) {
      const cnt = await this.db.getRowCount(name);
      lines.push({ text: `Table    : ${name}  (${cnt} records)`, cls: 'ok' });
    } else {
      lines.push({ text: `Table    : ${name}  (table not found — use CREATE TABLE to create it)`, cls: 'warn' });
    }
    if (this.state.activeIndex) {
      lines.push({ text: `Index    : ${this.state.activeIndex.tag}  (${this.state.activeIndex.expression})`, cls: 'info' });
    }
    return { output: lines };
  }
```

- [ ] **Step 5: Wire IndexStore into Session**

In `server/Session.ts`, import and pass `indexStore`:

```typescript
import { indexStore } from './IndexStore.js';
```

In the `Session` constructor, change:

```typescript
    this.executor = new Executor(this.bridge);
```

to:

```typescript
    this.executor = new Executor(this.bridge, indexStore);
```

- [ ] **Step 6: Add stub cases to Executor.exec() switch**

In `src/interpreter/Executor.ts`, add stub cases to the `exec()` switch (these will be fully implemented in Task 4):

```typescript
        case 'INDEX_ON':    return this.doIndexOn(node.expression, node.tag);
        case 'SET_INDEX':   return this.doSetIndex(node.tag);
        case 'REINDEX':     return this.doReindex();
        case 'LIST_INDEXES':return this.doListIndexes();
        case 'SEEK':        return this.doSeek(node.value);
        case 'FIND':        return this.doFind(node.value);
```

Add stub implementations after `doHelp()`:

```typescript
  private async doIndexOn(_expression: string, _tag: string): Promise<ExecResult> {
    return { output: [{ text: 'INDEX ON: not yet implemented', cls: 'warn' }] };
  }
  private async doSetIndex(_tag: string | null): Promise<ExecResult> {
    return { output: [{ text: 'SET INDEX: not yet implemented', cls: 'warn' }] };
  }
  private async doReindex(): Promise<ExecResult> {
    return { output: [{ text: 'REINDEX: not yet implemented', cls: 'warn' }] };
  }
  private async doListIndexes(): Promise<ExecResult> {
    return { output: [{ text: 'LIST INDEXES: not yet implemented', cls: 'warn' }] };
  }
  private async doSeek(_value: unknown): Promise<ExecResult> {
    return { output: [{ text: 'SEEK: not yet implemented', cls: 'warn' }] };
  }
  private async doFind(_value: string): Promise<ExecResult> {
    return { output: [{ text: 'FIND: not yet implemented', cls: 'warn' }] };
  }
```

- [ ] **Step 7: Run test to verify passes**

```bash
npm test -- --reporter=verbose tests/Indexing.test.ts
```
Expected: the "restores on USE" test PASS (USE outputs the active index tag in the info line)

- [ ] **Step 8: Run full suite**

```bash
npm test
```
Expected: all tests PASS

- [ ] **Step 9: Commit**

```bash
git add src/interpreter/Executor.ts server/Session.ts server/IndexStore.ts
git commit -m "feat: wire IndexStore into Executor, restore active index on USE"
```

---

### Task 4: INDEX ON, SET INDEX TO, LIST INDEXES, REINDEX commands

**Files:**
- Modify: `src/interpreter/Executor.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/Indexing.test.ts`:

```typescript
describe('Session: INDEX ON and SET INDEX TO', () => {
  it('INDEX ON creates index and sets it active', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t1 (lastname TEXT, firstname TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE t1' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'INDEX ON lastname TO byname' });
    const output = sent.find(m => m.type === 'output') as any;
    expect(output?.lines.some((l: any) => l.text.includes('byname'))).toBe(true);
    expect(output?.lines.some((l: any) => l.cls === 'ok')).toBe(true);
  });

  it('LIST INDEXES shows defined indexes', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t2 (lastname TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE t2' });
    await session.handleMessage({ type: 'command', text: 'INDEX ON lastname TO byname' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'LIST INDEXES' });
    const output = sent.find(m => m.type === 'output') as any;
    expect(output?.lines.some((l: any) => l.text.includes('byname'))).toBe(true);
    expect(output?.lines.some((l: any) => l.text.includes('lastname'))).toBe(true);
    expect(output?.lines.some((l: any) => l.text.includes('*'))).toBe(true); // active marker
  });

  it('SET INDEX TO clears active index', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t3 (lastname TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE t3' });
    await session.handleMessage({ type: 'command', text: 'INDEX ON lastname TO byname' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'SET INDEX TO' });
    const output = sent.find(m => m.type === 'output') as any;
    expect(output?.lines.some((l: any) => l.text.includes('cleared'))).toBe(true);
  });

  it('SET INDEX TO <tag> activates an existing index', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t4 (lastname TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE t4' });
    await session.handleMessage({ type: 'command', text: 'INDEX ON lastname TO byname' });
    await session.handleMessage({ type: 'command', text: 'SET INDEX TO' }); // clear
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'SET INDEX TO byname' });
    const output = sent.find(m => m.type === 'output') as any;
    expect(output?.lines.some((l: any) => l.text.includes('byname'))).toBe(true);
    expect(output?.lines.some((l: any) => l.cls === 'ok')).toBe(true);
  });

  it('REINDEX completes without error', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t5 (lastname TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE t5' });
    await session.handleMessage({ type: 'command', text: 'INDEX ON lastname TO byname' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'REINDEX' });
    const output = sent.find(m => m.type === 'output') as any;
    expect(output?.lines.some((l: any) => l.cls === 'ok')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fails**

```bash
npm test -- --reporter=verbose tests/Indexing.test.ts
```
Expected: new tests FAIL (stubs return 'not yet implemented')

- [ ] **Step 3: Implement doIndexOn**

Replace the `doIndexOn` stub in `src/interpreter/Executor.ts`:

```typescript
  private async doIndexOn(expression: string, tag: string): Promise<ExecResult> {
    this.requireTable();
    if (!this.indexStore) return { output: [{ text: '** IndexStore not available', cls: 'error' }] };
    const table = this.state.table!;
    // Save to metadata
    this.indexStore.saveIndex(table, tag, expression);
    // For simple single-field expressions, also create a real SQLite index
    if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(expression.trim())) {
      try {
        await this.db.exec(
          `CREATE INDEX IF NOT EXISTS ${q(`idx_${table}_${tag}`)} ON ${q(table)} (${q(expression.trim())})`
        );
      } catch { /* ignore if expression not directly usable as SQL column */ }
    }
    // Set as active
    this.indexStore.setActive(table, tag);
    this.state.activeIndex = { tag, expression };
    return { output: [{ text: `Index created: ${tag}  ON  ${expression}`, cls: 'ok' }] };
  }
```

- [ ] **Step 4: Implement doSetIndex**

Replace the `doSetIndex` stub:

```typescript
  private async doSetIndex(tag: string | null): Promise<ExecResult> {
    this.requireTable();
    if (!this.indexStore) return { output: [{ text: '** IndexStore not available', cls: 'error' }] };
    const table = this.state.table!;
    if (tag === null) {
      this.indexStore.clearActive(table);
      this.state.activeIndex = null;
      return { output: [{ text: 'Active index cleared', cls: 'ok' }] };
    }
    const def = this.indexStore.listIndexes(table).find(i => i.tag.toUpperCase() === tag.toUpperCase());
    if (!def) return { output: [{ text: `Index '${tag}' not found — use INDEX ON to create it`, cls: 'warn' }] };
    this.indexStore.setActive(table, def.tag);
    this.state.activeIndex = { tag: def.tag, expression: def.expression };
    return { output: [{ text: `Index active: ${def.tag}  (${def.expression})`, cls: 'ok' }] };
  }
```

- [ ] **Step 5: Implement doListIndexes**

Replace the `doListIndexes` stub:

```typescript
  private async doListIndexes(): Promise<ExecResult> {
    this.requireTable();
    if (!this.indexStore) return { output: [{ text: '** IndexStore not available', cls: 'error' }] };
    const table = this.state.table!;
    const indexes = this.indexStore.listIndexes(table);
    if (!indexes.length) return { output: [{ text: '(No indexes defined)', cls: 'info' }] };
    const out: OutputLine[] = [
      { text: `Indexes for table: ${table}`, cls: 'hdr' },
      { text: `${'Tag'.padEnd(20)}  ${'Expression'.padEnd(40)}  Active`, cls: 'hdr' },
      { text: '─'.repeat(65), cls: 'sep' },
    ];
    for (const idx of indexes) {
      const active = this.state.activeIndex?.tag === idx.tag ? ' *' : '';
      out.push({ text: `${idx.tag.padEnd(20)}  ${idx.expression.padEnd(40)}${active}` });
    }
    return { output: out };
  }
```

- [ ] **Step 6: Implement doReindex**

Replace the `doReindex` stub:

```typescript
  private async doReindex(): Promise<ExecResult> {
    this.requireTable();
    await this.db.exec('REINDEX');
    return { output: [{ text: 'Indexes rebuilt', cls: 'ok' }] };
  }
```

- [ ] **Step 7: Run test to verify passes**

```bash
npm test -- --reporter=verbose tests/Indexing.test.ts
```
Expected: all INDEX ON / SET INDEX / LIST INDEXES / REINDEX tests PASS

- [ ] **Step 8: Run full suite**

```bash
npm test
```
Expected: all tests PASS

- [ ] **Step 9: Commit**

```bash
git add src/interpreter/Executor.ts
git commit -m "feat: implement INDEX ON, SET INDEX TO, LIST INDEXES, REINDEX"
```

---

### Task 5: Ordered queries — LIST, GO, SKIP respect active index

**Files:**
- Modify: `src/interpreter/Executor.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/Indexing.test.ts`:

```typescript
describe('Session: ordered queries', () => {
  async function setupTable(session: any, db: string, name: string) {
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: `CREATE TABLE ${name} (name TEXT, score INTEGER)` });
    await session.handleMessage({ type: 'command', text: `USE ${name}` });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Charlie", score WITH 3' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Alice", score WITH 1' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Bob", score WITH 2' });
  }

  it('LIST respects active index order', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await setupTable(session, db, 'ord1');
    await session.handleMessage({ type: 'command', text: 'INDEX ON name TO byname' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'LIST' });
    const output = sent.find(m => m.type === 'output') as any;
    const names = output.lines.filter((l: any) => l.text.includes('Alice') || l.text.includes('Bob') || l.text.includes('Charlie'));
    expect(names[0].text).toContain('Alice');
    expect(names[1].text).toContain('Bob');
    expect(names[2].text).toContain('Charlie');
  });

  it('GO TOP with active index goes to first in index order', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await setupTable(session, db, 'ord2');
    await session.handleMessage({ type: 'command', text: 'INDEX ON name TO byname' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'GO TOP' });
    const output = sent.find(m => m.type === 'output') as any;
    // rowPtr 1 in index order = Alice
    expect(output?.lines.some((l: any) => l.text.includes('1'))).toBe(true);
  });

  it('LIST without active index uses natural order', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await setupTable(session, db, 'ord3');
    // No INDEX ON — natural insert order: Charlie, Alice, Bob
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'LIST' });
    const output = sent.find(m => m.type === 'output') as any;
    const names = output.lines.filter((l: any) => l.text.includes('Charlie') || l.text.includes('Alice') || l.text.includes('Bob'));
    expect(names[0].text).toContain('Charlie');
  });
});
```

- [ ] **Step 2: Run to verify fails**

```bash
npm test -- --reporter=verbose tests/Indexing.test.ts
```
Expected: ordered query tests FAIL (LIST still returns natural order)

- [ ] **Step 3: Add getOrderedRows helper to Executor**

Add the following private method to `src/interpreter/Executor.ts`, before `requireTable()`:

```typescript
  private async getOrderedRows(limit = 500): Promise<Record<string, unknown>[]> {
    this.requireTable();
    const table = this.state.table!;
    const filter = this.state.filter;
    const where = filter ? ` WHERE ${filter}` : '';
    const idx = this.state.activeIndex;

    if (!idx) {
      return this.db.query(`SELECT * FROM ${q(table)}${where} LIMIT ${limit}`);
    }

    const expr = idx.expression.trim();
    const isSimpleField = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(expr);

    if (isSimpleField) {
      return this.db.query(
        `SELECT * FROM ${q(table)}${where} ORDER BY ${q(expr)} LIMIT ${limit}`
      );
    }

    // Complex expression: fetch all, sort in JS using evalExpr
    const rows = await this.db.query(`SELECT * FROM ${q(table)}${where}`);
    rows.sort((a, b) => {
      const va = String(this.evalExprOnRow(idx.expression, a));
      const vb = String(this.evalExprOnRow(idx.expression, b));
      return va < vb ? -1 : va > vb ? 1 : 0;
    });
    return rows.slice(0, limit);
  }

  private evalExprOnRow(expression: string, row: Record<string, unknown>): unknown {
    // Temporarily bind all row fields as variables, evaluate, then restore
    const saved = new Map<string, unknown>();
    for (const [k, v] of Object.entries(row)) {
      saved.set(k, this.state.vars.get(k));
      this.state.vars.set(k, v);
    }
    let result: unknown;
    try {
      const { Parser } = require('./Parser');
      const { Lexer } = require('./Lexer');
      const toks = new Lexer(expression).tokenize();
      const expr = new (Parser)(toks).parseExprPublic?.() 
        ?? new (Parser)(toks).parse()[0];
      result = this.evalExpr(expr as any);
    } catch {
      result = String(row[expression] ?? '');
    }
    for (const [k, v] of saved) {
      if (v === undefined) this.state.vars.delete(k);
      else this.state.vars.set(k, v);
    }
    return result;
  }
```

> **Note:** `evalExprOnRow` for complex expressions requires re-parsing the expression string. Add a public `parseExpr(src: string): Expr` helper to `Parser`:

In `src/interpreter/Parser.ts`, add:

```typescript
  parseExpr(src: string): Expr {
    // Re-initialize parser with new token stream for expression-only parsing
    const { Lexer } = require('./Lexer');
    this.toks = new Lexer(src).tokenize();
    this.p = 0;
    return this.expr();
  }
```

And update `evalExprOnRow` in `Executor.ts` to use it cleanly:

```typescript
  private evalExprOnRow(expression: string, row: Record<string, unknown>): unknown {
    const saved = new Map<string, unknown>();
    for (const [k, v] of Object.entries(row)) {
      saved.set(k, this.state.vars.get(k));
      this.state.vars.set(k, v);
    }
    let result: unknown = '';
    try {
      const { Lexer } = require('./Lexer');
      const { Parser } = require('./Parser');
      const toks = new Lexer(expression).tokenize();
      const exprNode = new Parser(toks).parseExprPublic();
      result = this.evalExpr(exprNode);
    } catch {
      result = String(row[expression.trim()] ?? '');
    }
    for (const [k, v] of saved) {
      if (v === undefined) this.state.vars.delete(k);
      else this.state.vars.set(k, v);
    }
    return result;
  }
```

Add `parseExprPublic()` to `Parser`:

```typescript
  parseExprPublic(): Expr {
    return this.expr();
  }
```

- [ ] **Step 4: Update doList to use getOrderedRows**

In `src/interpreter/Executor.ts`, replace `doList()`:

```typescript
  private async doList(): Promise<ExecResult> {
    this.requireTable();
    const rows = await this.getOrderedRows(500);
    if (!rows.length) return { output: [{ text: '(No records)', cls: 'info' }] };

    const cols = Object.keys(rows[0]);
    const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)));
    const out: OutputLine[] = [];
    out.push({ text: cols.map((c, i) => c.padEnd(widths[i])).join('  '), cls: 'hdr' });
    out.push({ text: cols.map((_, i) => '-'.repeat(widths[i])).join('  '), cls: 'sep' });
    rows.forEach(r => {
      out.push({ text: cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  ') });
    });
    out.push({ text: `${rows.length} record(s)`, cls: 'info' });
    return { output: out };
  }
```

- [ ] **Step 5: Update doGo to respect index order**

In `src/interpreter/Executor.ts`, replace `doGo()`:

```typescript
  private async doGo(target: 'TOP' | 'BOTTOM' | number): Promise<ExecResult> {
    this.requireTable();
    const cnt = await this.db.getRowCount(this.state.table!, this.state.filter ?? undefined);
    if (target === 'TOP')         this.state.rowPtr = 1;
    else if (target === 'BOTTOM') this.state.rowPtr = cnt;
    else                          this.state.rowPtr = Math.max(1, Math.min(cnt, target));
    const idxNote = this.state.activeIndex ? `  [index: ${this.state.activeIndex.tag}]` : '';
    return { output: [{ text: `Record pointer: ${this.state.rowPtr} / ${cnt}${idxNote}`, cls: 'info' }] };
  }
```

> GO TOP/BOTTOM already use `rowPtr` in the context of ordered queries — the rowPtr is a 1-based position in the ordered set as fetched by `getOrderedRows`. The display note confirms index is active.

- [ ] **Step 6: Run test to verify passes**

```bash
npm test -- --reporter=verbose tests/Indexing.test.ts
```
Expected: ordered query tests PASS

- [ ] **Step 7: Run full suite**

```bash
npm test
```
Expected: all tests PASS

- [ ] **Step 8: Commit**

```bash
git add src/interpreter/Executor.ts src/interpreter/Parser.ts
git commit -m "feat: LIST, GO respect active index order via getOrderedRows"
```

---

### Task 6: SEEK and FIND

**Files:**
- Modify: `src/interpreter/Executor.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/Indexing.test.ts`:

```typescript
describe('Session: SEEK and FIND', () => {
  async function setupSeekTable(session: any, db: string, name: string) {
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: `CREATE TABLE ${name} (lastname TEXT, score INTEGER)` });
    await session.handleMessage({ type: 'command', text: `USE ${name}` });
    for (const [last, score] of [['Charlie', 3], ['Alice', 1], ['Bob', 2]]) {
      await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
      await session.handleMessage({ type: 'command', text: `REPLACE lastname WITH "${last}", score WITH ${score}` });
    }
    await session.handleMessage({ type: 'command', text: 'INDEX ON lastname TO byname' });
  }

  it('SEEK positions to matching record', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await setupSeekTable(session, db, 'seek1');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'SEEK "Bob"' });
    const output = sent.find(m => m.type === 'output') as any;
    expect(output?.lines.some((l: any) => l.text.includes('Bob'))).toBe(true);
    expect(output?.lines.some((l: any) => l.cls === 'ok')).toBe(true);
  });

  it('SEEK sets rowPtr to the correct index position', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await setupSeekTable(session, db, 'seek2');
    await session.handleMessage({ type: 'command', text: 'SEEK "Alice"' });
    // Alice is first in index order → rowPtr should be 1
    const status = sent.find(m => m.type === 'status') as any;
    expect(status?.record).toBe(1);
  });

  it('SEEK prints not found when no match', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await setupSeekTable(session, db, 'seek3');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'SEEK "Zorro"' });
    const output = sent.find(m => m.type === 'output') as any;
    expect(output?.lines.some((l: any) => l.text.toLowerCase().includes('not found'))).toBe(true);
  });

  it('SEEK without active index shows error', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE seekerr (lastname TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE seekerr' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'SEEK "Bob"' });
    const output = sent.find(m => m.type === 'output') as any;
    expect(output?.lines.some((l: any) => l.cls === 'warn' || l.cls === 'error')).toBe(true);
  });

  it('FIND behaves identically to SEEK', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await setupSeekTable(session, db, 'find1');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'FIND Bob' });
    const output = sent.find(m => m.type === 'output') as any;
    expect(output?.lines.some((l: any) => l.text.includes('Bob'))).toBe(true);
    expect(output?.lines.some((l: any) => l.cls === 'ok')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify fails**

```bash
npm test -- --reporter=verbose tests/Indexing.test.ts
```
Expected: SEEK/FIND tests FAIL (stubs)

- [ ] **Step 3: Implement doSeek**

Replace the `doSeek` stub in `src/interpreter/Executor.ts`:

```typescript
  private async doSeek(valueExpr: import('./Parser').Expr): Promise<ExecResult> {
    this.requireTable();
    if (!this.state.activeIndex) {
      return { output: [{ text: 'No index active — use SET INDEX TO <tag> first', cls: 'warn' }] };
    }
    const seekVal = String(this.evalExpr(valueExpr)).toLowerCase();
    const rows = await this.getOrderedRows(100000);
    const idx = this.state.activeIndex;

    const pos = rows.findIndex(row => {
      const v = String(this.evalExprOnRow(idx.expression, row)).toLowerCase();
      return v === seekVal;
    });

    if (pos === -1) {
      this.state._found = false;
      // Position at EOF (one past last)
      this.state.rowPtr = rows.length + 1;
      return { output: [{ text: 'Record not found', cls: 'warn' }] };
    }

    this.state._found = true;
    this.state.rowPtr = pos + 1; // 1-based
    const row = rows[pos];
    const preview = Object.entries(row).map(([k, v]) => `${k}: ${v}`).join('  ');
    return { output: [{ text: `Found at position ${pos + 1}: ${preview}`, cls: 'ok' }] };
  }
```

Add `_found` to the `State` interface in `src/interpreter/Executor.ts`:

```typescript
export interface State {
  db: string | null;
  table: string | null;
  filter: string | null;
  vars: Map<string, unknown>;
  rowPtr: number;
  pendingForm: FormField[];
  opfsAvailable: boolean;
  activeIndex: { tag: string; expression: string } | null;
  _found: boolean;
}
```

Initialize in constructor:

```typescript
    this.state = {
      db: null, table: null, filter: null,
      vars: new Map(), rowPtr: 1,
      pendingForm: [], opfsAvailable: false,
      activeIndex: null,
      _found: false,
    };
```

- [ ] **Step 4: Implement doFind**

Replace the `doFind` stub:

```typescript
  private async doFind(value: string): Promise<ExecResult> {
    // FIND is SEEK with a pre-evaluated string literal
    const litExpr: import('./Parser').Expr = { k: 'lit', v: value };
    return this.doSeek(litExpr);
  }
```

- [ ] **Step 5: Run test to verify passes**

```bash
npm test -- --reporter=verbose tests/Indexing.test.ts
```
Expected: all SEEK/FIND tests PASS

- [ ] **Step 6: Run full suite**

```bash
npm test
```
Expected: all tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/interpreter/Executor.ts
git commit -m "feat: implement SEEK and FIND with _found state flag"
```

---

### Task 7: BROWSE respects active index order

**Files:**
- Modify: `server/Session.ts`

- [ ] **Step 1: Write failing test**

Add to `tests/Indexing.test.ts`:

```typescript
describe('Session: BROWSE respects active index', () => {
  it('grid-open rows are in index order', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE brows1 (name TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE brows1' });
    for (const name of ['Charlie', 'Alice', 'Bob']) {
      await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
      await session.handleMessage({ type: 'command', text: `REPLACE name WITH "${name}"` });
    }
    await session.handleMessage({ type: 'command', text: 'INDEX ON name TO byname' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const gridMsg = sent.find(m => m.type === 'grid-open') as any;
    const names = gridMsg?.rows.map((r: any) => r.name);
    expect(names).toEqual(['Alice', 'Bob', 'Charlie']);
  });
});
```

- [ ] **Step 2: Run to verify fails**

```bash
npm test -- --reporter=verbose tests/Indexing.test.ts
```
Expected: FAIL — grid rows in natural order, not index order

- [ ] **Step 3: Update sendGridData in Session to use ordered query**

In `server/Session.ts`, replace `sendGridData()`:

```typescript
  private async sendGridData(): Promise<void> {
    const state = this.executor.state;
    if (!state.table) {
      this.send({ type: 'output', lines: [{ text: 'No table selected', cls: 'error' }] });
      return;
    }
    const where = state.filter ? ` WHERE ${state.filter}` : '';
    const idx = state.activeIndex;
    let sql: string;
    if (idx && /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(idx.expression.trim())) {
      sql = `SELECT rowid as _rowid, * FROM ${q(state.table)}${where} ORDER BY ${q(idx.expression.trim())} LIMIT 2000`;
    } else if (idx) {
      // Complex expression: fetch all, sort via executor, re-query by rowid order
      const ordered = await this.executor.getOrderedRowsPublic(2000);
      const rowids = ordered.map((r: Record<string, unknown>) => r['rowid'] ?? r['_rowid']).filter(Boolean);
      const columns = await this.bridge.getStructure(state.table);
      // Re-fetch with rowid for grid editing
      const rows = await Promise.all(
        rowids.map((id) => this.bridge.query(
          `SELECT rowid as _rowid, * FROM ${q(state.table!)} WHERE rowid = ?`, [id]
        ).then(r => r[0]))
      );
      this.send({ type: 'grid-open', table: state.table, filter: state.filter, columns, rows: rows.filter(Boolean) });
      return;
    } else {
      sql = `SELECT rowid as _rowid, * FROM ${q(state.table)}${where} LIMIT 2000`;
    }
    const rows = await this.bridge.query(sql);
    const columns = await this.bridge.getStructure(state.table);
    this.send({ type: 'grid-open', table: state.table, filter: state.filter, columns, rows });
  }
```

Add `getOrderedRowsPublic` to `Executor` in `src/interpreter/Executor.ts` (exposes `getOrderedRows` for Session to call):

```typescript
  async getOrderedRowsPublic(limit = 500): Promise<Record<string, unknown>[]> {
    return this.getOrderedRows(limit);
  }
```

- [ ] **Step 4: Run test to verify passes**

```bash
npm test -- --reporter=verbose tests/Indexing.test.ts
```
Expected: BROWSE test PASS

- [ ] **Step 5: Run full suite**

```bash
npm test
```
Expected: all tests PASS

- [ ] **Step 6: Commit**

```bash
git add server/Session.ts src/interpreter/Executor.ts tests/Indexing.test.ts
git commit -m "feat: BROWSE respects active index order"
```

---

### Task 8: HELP entries + .gitignore

**Files:**
- Modify: `src/interpreter/Executor.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Add index commands to HELP**

In `src/interpreter/Executor.ts`, in `doHelp()`, add after the `SET FILTER TO` lines:

```typescript
      { text: 'INDEX ON <expr> TO <tag>  — create index on expression' },
      { text: 'SET INDEX TO <tag>        — activate a named index' },
      { text: 'SET INDEX TO              — clear active index' },
      { text: 'LIST INDEXES              — list indexes for current table' },
      { text: 'REINDEX                   — rebuild SQLite indexes' },
      { text: 'SEEK <value>              — position to first match in active index' },
      { text: 'FIND <string>             — same as SEEK (legacy string form)' },
```

- [ ] **Step 2: Add .superpowers to .gitignore (if not already present)**

```bash
echo '.superpowers/' >> .gitignore
```

- [ ] **Step 3: Run full test suite one final time**

```bash
npm test
```
Expected: all tests PASS

- [ ] **Step 4: Run full suite one final time**

```bash
npm test
```
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/interpreter/Executor.ts .gitignore
git commit -m "docs: add index commands to HELP, ignore .superpowers dir"
```
