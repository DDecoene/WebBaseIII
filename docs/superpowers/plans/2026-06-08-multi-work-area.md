# Multi-Work-Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add unlimited named work areas with `SELECT`, `SET RELATION TO`, and `alias.field` cross-area field access, enabling relational data patterns (orders→customers, customers→postcodes, etc.)

**Architecture:** Refactor `Executor.state: State` into `Executor.areas: Map<string, WorkArea>` + `activeAlias: string`. A new pure helper `server/WorkAreaManager.ts` owns relation auto-seek and `alias.field` resolution. `Session.ts` and `ServerDatabaseBridge.ts` are untouched structurally.

**Tech Stack:** TypeScript, better-sqlite3, Vitest (unit+integration), Playwright (E2E)

---

## File Map

| File | Change |
|---|---|
| `src/shared/types.ts` | Replace `State` with `WorkArea` interface; export it |
| `src/interpreter/Executor.ts` | Replace `state: State` with `areas` map + `activeAlias`; add new commands; update all `this.state.xxx` refs |
| `src/interpreter/Parser.ts` | Add AST nodes + parse methods for `SELECT`, `USE … ALIAS`, `SET RELATION TO`, `LIST AREAS`, `CLOSE`, `CLOSE ALL`, `LIST [cols]` |
| `src/interpreter/Lexer.ts` | Add keywords: `SELECT`, `RELATION`, `ALIAS`, `AREAS`, `RELATION` |
| `server/WorkAreaManager.ts` | New: `resolveRelations()`, `resolveField()`, `detectCircular()`, row fetch cache |
| `server/Session.ts` | Update `sendStatus()` and `sendGridData()` to use `executor.area` (active area) |
| `tests/WorkArea.test.ts` | New: unit tests for work area slot mechanics |
| `tests/Session.test.ts` | Add integration test block for multi-area commands |
| `tests/multiarea.spec.ts` | New: Playwright E2E for postcode→customer and order→customer scenarios |
| `README.md` | Add Work Areas command table; modernisation note |
| `CLAUDE.md` | Update commands, architecture, roadmap |
| `package.json` | Bump version to `0.4.0` |

---

## Task 1: Add `WorkArea` type to `src/shared/types.ts`

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add `WorkArea` interface alongside (not replacing) `State` for now**

Open `src/shared/types.ts` and add after the existing `State`-related exports (or wherever `IDatabaseBridge` is defined — check the file for context). Add:

```typescript
export interface WorkArea {
  alias: string;
  db: string | null;
  table: string | null;
  filter: string | null;
  rowPtr: number;
  cachedRecCount: number;
  activeIndex: { tag: string; expression: string } | null;
  _found: boolean;
  opfsAvailable: boolean;
  relation: {
    expression: string;
    intoAlias: string;
  } | null;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```
Expected: no errors (the old `State` interface is still in `Executor.ts` — that's fine for now).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add WorkArea interface to shared types"
```

---

## Task 2: Create `server/WorkAreaManager.ts`

**Files:**
- Create: `server/WorkAreaManager.ts`
- Test: `tests/WorkArea.test.ts`

- [ ] **Step 1: Write failing unit tests**

Create `tests/WorkArea.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { WorkAreaManager } from '../server/WorkAreaManager';
import type { WorkArea } from '../src/shared/types';

function makeArea(alias: string, overrides: Partial<WorkArea> = {}): WorkArea {
  return {
    alias,
    db: null, table: null, filter: null,
    rowPtr: 1, cachedRecCount: 0,
    activeIndex: null, _found: false,
    opfsAvailable: false, relation: null,
    ...overrides,
  };
}

describe('WorkAreaManager.detectCircular', () => {
  it('returns false when no existing relations', () => {
    const areas = new Map([
      ['orders', makeArea('orders')],
      ['customers', makeArea('customers')],
    ]);
    expect(WorkAreaManager.detectCircular(areas, 'orders', 'customers')).toBe(false);
  });

  it('returns true for direct cycle: A→B then B→A', () => {
    const areas = new Map([
      ['orders', makeArea('orders', { relation: { expression: 'custid', intoAlias: 'customers' } })],
      ['customers', makeArea('customers')],
    ]);
    // adding B→A would create cycle
    expect(WorkAreaManager.detectCircular(areas, 'customers', 'orders')).toBe(true);
  });

  it('returns false for non-cyclic chain A→B, B→C, adding C→D', () => {
    const areas = new Map([
      ['a', makeArea('a', { relation: { expression: 'x', intoAlias: 'b' } })],
      ['b', makeArea('b', { relation: { expression: 'y', intoAlias: 'c' } })],
      ['c', makeArea('c')],
      ['d', makeArea('d')],
    ]);
    expect(WorkAreaManager.detectCircular(areas, 'c', 'd')).toBe(false);
  });
});

describe('WorkAreaManager.resolveField', () => {
  it('returns null when area rowPtr is 0', () => {
    const areas = new Map([
      ['customers', makeArea('customers', { rowPtr: 0, table: 'customers', db: 'test' })],
    ]);
    const result = WorkAreaManager.resolveField('customers', 'name', areas);
    expect(result).toBeNull();
  });

  it('returns null when area not found', () => {
    const areas = new Map<string, WorkArea>();
    expect(WorkAreaManager.resolveField('unknown', 'name', areas)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A5 'WorkArea'
```
Expected: `Cannot find module '../server/WorkAreaManager'`

- [ ] **Step 3: Create `server/WorkAreaManager.ts`**

```typescript
import type { WorkArea } from '../src/shared/types.js';

export class WorkAreaManager {
  /**
   * Returns true if adding a relation from `fromAlias` INTO `intoAlias`
   * would create a cycle in the existing relation graph.
   */
  static detectCircular(
    areas: Map<string, WorkArea>,
    fromAlias: string,
    intoAlias: string,
  ): boolean {
    // Follow the chain from intoAlias; if we reach fromAlias, it's a cycle
    let cursor = intoAlias;
    const visited = new Set<string>();
    while (cursor) {
      if (cursor === fromAlias) return true;
      if (visited.has(cursor)) break;
      visited.add(cursor);
      const area = areas.get(cursor);
      if (!area?.relation) break;
      cursor = area.relation.intoAlias;
    }
    return false;
  }

  /**
   * Returns the value of `field` in the named work area's current row.
   * Returns null if the area doesn't exist, has no table, or rowPtr === 0.
   * Callers must populate rowCache themselves (keyed by `alias:rowPtr`).
   */
  static resolveField(
    alias: string,
    field: string,
    areas: Map<string, WorkArea>,
    rowCache?: Map<string, Record<string, unknown>>,
  ): unknown {
    const area = areas.get(alias);
    if (!area || !area.table || area.rowPtr === 0) return null;
    if (rowCache) {
      const cacheKey = `${alias}:${area.rowPtr}`;
      const cached = rowCache.get(cacheKey);
      if (cached) return cached[field.toUpperCase()] ?? cached[field] ?? null;
    }
    return null; // caller must pre-populate cache for DB lookups
  }

  /**
   * Given the alias of an area that just moved, find all areas that
   * relate INTO it and return them with their key expressions.
   */
  static getDependents(
    areas: Map<string, WorkArea>,
    movedAlias: string,
  ): Array<{ area: WorkArea; keyExpression: string }> {
    const result: Array<{ area: WorkArea; keyExpression: string }> = [];
    for (const area of areas.values()) {
      if (area.relation?.intoAlias === movedAlias) {
        result.push({ area, keyExpression: area.relation.expression });
      }
    }
    return result;
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A5 'WorkArea'
```
Expected: all WorkAreaManager tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/WorkAreaManager.ts tests/WorkArea.test.ts
git commit -m "feat: WorkAreaManager — detectCircular, resolveField, getDependents"
```

---

## Task 3: Add new keywords to Lexer and AST nodes to Parser

**Files:**
- Modify: `src/interpreter/Lexer.ts`
- Modify: `src/interpreter/Parser.ts`

- [ ] **Step 1: Write failing parser tests**

Add to `tests/Session.test.ts` (find the end of the existing describe block, add a new one):

```typescript
describe('Parser: multi-work-area nodes', () => {
  function parse(src: string) {
    return new Parser(new Lexer(src).tokenize()).parse();
  }

  it('parses SELECT alias', () => {
    const nodes = parse('SELECT customers');
    expect(nodes[0]).toMatchObject({ type: 'SELECT', alias: 'customers' });
  });

  it('parses SELECT numeric alias', () => {
    const nodes = parse('SELECT 2');
    expect(nodes[0]).toMatchObject({ type: 'SELECT', alias: '2' });
  });

  it('parses USE table ALIAS name', () => {
    const nodes = parse('USE orders ALIAS ord');
    expect(nodes[0]).toMatchObject({ type: 'USE', name: 'orders', alias: 'ord' });
  });

  it('parses USE table without ALIAS (alias is null)', () => {
    const nodes = parse('USE customers');
    expect(nodes[0]).toMatchObject({ type: 'USE', name: 'customers', alias: null });
  });

  it('parses SET RELATION TO expr INTO alias', () => {
    const nodes = parse('SET RELATION TO custid INTO customers');
    expect(nodes[0]).toMatchObject({ type: 'SET_RELATION', expression: 'custid', intoAlias: 'customers' });
  });

  it('parses SET RELATION TO (clear)', () => {
    const nodes = parse('SET RELATION TO');
    expect(nodes[0]).toMatchObject({ type: 'SET_RELATION', expression: null, intoAlias: null });
  });

  it('parses LIST AREAS', () => {
    const nodes = parse('LIST AREAS');
    expect(nodes[0]).toMatchObject({ type: 'LIST_AREAS' });
  });

  it('parses LIST with column list', () => {
    const nodes = parse('LIST name, customers.city');
    expect(nodes[0]).toMatchObject({ type: 'LIST_COLS', cols: ['name', 'customers.city'] });
  });

  it('parses CLOSE', () => {
    expect(parse('CLOSE')[0]).toMatchObject({ type: 'CLOSE' });
  });

  it('parses CLOSE ALL', () => {
    expect(parse('CLOSE ALL')[0]).toMatchObject({ type: 'CLOSE_ALL' });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

```bash
npm test -- --reporter=verbose 2>&1 | grep 'Parser: multi'
```
Expected: import errors or parse failures.

- [ ] **Step 3: Add keywords to `src/interpreter/Lexer.ts`**

Find the `KWS` set and add to it:

```typescript
  // Multi-work-area
  'SELECT', 'RELATION', 'ALIAS', 'AREAS', 'INTO',
```

(Note: `INTO` may already be implicitly an ID — add it explicitly as a keyword so `SET RELATION TO expr INTO alias` parses cleanly.)

- [ ] **Step 4: Add AST node types to `src/interpreter/Parser.ts`**

Find the `ASTNode` type union and add these variants:

```typescript
  | { type: 'SELECT';       alias: string }
  | { type: 'USE';          name: string; alias: string | null }   // replace existing USE (add alias field)
  | { type: 'SET_RELATION'; expression: string | null; intoAlias: string | null }
  | { type: 'LIST_AREAS' }
  | { type: 'LIST_COLS';    cols: string[] }
  | { type: 'CLOSE' }
  | { type: 'CLOSE_ALL' }
```

**Note:** The existing `{ type: 'USE'; name: string }` node needs the `alias` field added. Change that union member.

- [ ] **Step 5: Add parse methods to `src/interpreter/Parser.ts`**

Add `parseSelect()`, update `parseUse()`, update `parseList()`, update `parseSet()`, add `parseClose()`.

In `stmt()` switch, add:
```typescript
case 'SELECT': return this.parseSelect();
case 'CLOSE':  return this.parseClose();
```

Add the methods:

```typescript
private parseSelect(): ASTNode {
  this.adv(); // SELECT
  // alias may be a number or identifier
  const t = this.peek();
  let alias: string;
  if (t.type === 'NUM') { alias = String(t.val); this.adv(); }
  else alias = this.ident();
  return { type: 'SELECT', alias };
}

private parseClose(): ASTNode {
  this.adv(); // CLOSE
  if (this.peekKw('ALL')) { this.adv(); return { type: 'CLOSE_ALL' }; }
  return { type: 'CLOSE' };
}
```

Update `parseUse()`:
```typescript
private parseUse(): ASTNode {
  this.adv();
  if (this.peekKw('DATABASE') || this.peekKw('DB')) {
    this.adv();
    return { type: 'USE_DB', name: this.ident() };
  }
  const name = this.ident();
  let alias: string | null = null;
  if (this.peekKw('ALIAS')) { this.adv(); alias = this.ident(); }
  return { type: 'USE', name, alias };
}
```

Update `parseList()` — add AREAS and column list:
```typescript
private parseList(): ASTNode {
  this.adv();
  if (this.peekKw('STRUCTURE') || this.peekKw('STRUCT')) { this.adv(); return { type: 'LIST_STRUCT' }; }
  if (this.peekKw('TABLES'))   { this.adv(); return { type: 'LIST_TABLES' }; }
  if (this.peekKw('PROGRAMS') || this.peekKw('PROGS')) { this.adv(); return { type: 'LIST_PROGRAMS' }; }
  if (this.peekKw('INDEXES'))  { this.adv(); return { type: 'LIST_INDEXES' }; }
  if (this.peekKw('AREAS'))    { this.adv(); return { type: 'LIST_AREAS' }; }
  // Check for column list: LIST name, alias.field, ...
  if (!this.end() && this.peek().type !== 'NL' && this.peek().type !== 'EOF' && this.peek().type !== 'SEMI') {
    const cols: string[] = [];
    do {
      // collect dotted or plain identifier
      let col = this.peek().val; this.adv();
      if (!this.end() && this.peek().type === 'DOT') {
        this.adv();
        col += '.' + this.peek().val; this.adv();
      }
      cols.push(col);
    } while (!this.end() && this.peek().type === 'COMMA' && (this.adv(), true));
    if (cols.length) return { type: 'LIST_COLS', cols };
  }
  return { type: 'LIST' };
}
```

Update `parseSet()` — add RELATION branch before FILTER:
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
  if (this.peekKw('RELATION')) {
    this.adv(); // RELATION
    this.expectKw('TO');
    // If next token is NL/EOF/SEMI → clear relation
    if (this.end() || this.peek().type === 'NL' || this.peek().type === 'EOF' || this.peek().type === 'SEMI') {
      return { type: 'SET_RELATION', expression: null, intoAlias: null };
    }
    // Collect expression tokens until INTO keyword
    const parts: string[] = [];
    while (!this.end() && !this.peekKw('INTO') && this.peek().type !== 'NL' && this.peek().type !== 'EOF') {
      parts.push(this.peek().val); this.adv();
    }
    this.expectKw('INTO');
    const intoAlias = this.ident();
    return { type: 'SET_RELATION', expression: parts.join(''), intoAlias };
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

Also check Lexer for `DOT` token type — the `.` character. The Lexer currently handles `.T.`/`.F.` detection. Add a `DOT` token for plain `.` that isn't part of a boolean literal:

In `src/interpreter/Lexer.ts`, find the `.` handling block. After the `.T.`/`.F.` checks fail, emit:
```typescript
this.toks.push({ type: 'DOT', val: '.', line: this.ln, col: this.col });
this.p++; this.col++;
```

And add `'DOT'` to the `TType` union at the top of the file.

- [ ] **Step 6: Run the new parser tests**

```bash
npm test -- --reporter=verbose 2>&1 | grep -A3 'Parser: multi'
```
Expected: all 10 parser tests PASS.

- [ ] **Step 7: Run full test suite to check no regressions**

```bash
npm test
```
Expected: 103+ tests pass, 0 fail.

- [ ] **Step 8: Commit**

```bash
git add src/interpreter/Lexer.ts src/interpreter/Parser.ts tests/Session.test.ts
git commit -m "feat: parser — SELECT, USE ALIAS, SET RELATION TO, LIST AREAS/COLS, CLOSE/CLOSE ALL"
```

---

## Task 4: Refactor `Executor` — replace `state` with `areas` map

**Files:**
- Modify: `src/interpreter/Executor.ts`

This is the biggest task. We replace `this.state: State` with `this.areas: Map<string, WorkArea>` + `this.activeAlias: string` and update every reference.

- [ ] **Step 1: Replace the `State` interface and constructor**

At the top of `Executor.ts`, remove the `State` interface export and add imports:

```typescript
import { IDatabaseBridge, IIndexStore, OutputLine, FormField, WorkArea } from '../shared/types';
```

Replace the constructor and field declarations:

```typescript
export class Executor {
  public areas: Map<string, WorkArea>;
  public activeAlias: string;
  public vars: Map<string, unknown>;
  public pendingForm: FormField[];

  constructor(
    private db: IDatabaseBridge,
    private indexStore: IIndexStore | null = null,
  ) {
    this.vars = new Map();
    this.pendingForm = [];
    this.activeAlias = '1';
    this.areas = new Map([['1', this.makeArea('1')]]);
  }

  private makeArea(alias: string): WorkArea {
    return {
      alias,
      db: null, table: null, filter: null,
      rowPtr: 1, cachedRecCount: 0,
      activeIndex: null, _found: false,
      opfsAvailable: false, relation: null,
    };
  }

  get area(): WorkArea {
    return this.areas.get(this.activeAlias)!;
  }
```

- [ ] **Step 2: Replace all `this.state.` references**

Run a find-replace across `Executor.ts`:
- `this.state.db` → `this.area.db`
- `this.state.table` → `this.area.table`
- `this.state.filter` → `this.area.filter`
- `this.state.rowPtr` → `this.area.rowPtr`
- `this.state.cachedRecCount` → `this.area.cachedRecCount`
- `this.state.activeIndex` → `this.area.activeIndex`
- `this.state._found` → `this.area._found`
- `this.state.opfsAvailable` → `this.area.opfsAvailable`
- `this.state.vars` → `this.vars`
- `this.state.pendingForm` → `this.pendingForm`

Also update the `setVar` method:
```typescript
setVar(name: string, value: unknown) { this.vars.set(name, value); }
```

And `refreshRecCount` which references `this.state.vars`:
```typescript
private async refreshRecCount(loadFields = false): Promise<void> {
  if (this.area.table) {
    this.area.cachedRecCount = await this.db.getRowCount(this.area.table, this.area.filter ?? undefined);
    if (loadFields && this.area.rowPtr >= 1) {
      const filter = this.area.filter;
      const where = filter ? ` WHERE ${filter}` : '';
      const rows = await this.db.query(
        `SELECT * FROM ${q(this.area.table)} ${where} LIMIT 1 OFFSET ${this.area.rowPtr - 1}`
      );
      if (rows[0]) {
        for (const [k, v] of Object.entries(rows[0])) {
          this.vars.set(k.toUpperCase(), v);
        }
      }
    }
  } else {
    this.area.cachedRecCount = 0;
  }
}
```

Update `evalExpr` — the `'var'` case currently reads `this.state.vars`:
```typescript
case 'var': return this.vars.get(e.name) ?? e.name;
```

Update `callBuiltin` — reads `this.state.table`, `this.state.rowPtr`, etc — replace with `this.area.*`.

Update `doRead`:
```typescript
private doRead(): ExecResult {
  const fields = [...this.pendingForm];
  this.pendingForm = [];
  if (!fields.length) return { output: [{ text: 'READ: no GET fields defined', cls: 'warn' }] };
  return { output: [], action: 'FORM_READY', formFields: fields };
}
```

Update `doInput`:
```typescript
private doInput(prompt: string, varName: string): ExecResult {
  this.vars.set(varName, this.vars.get(varName) ?? '');
  const pending = [...this.pendingForm];
  this.pendingForm = [];
  const inputRow = pending.length ? Math.max(...pending.map(f => f.row)) + 2 : 10;
  const form: FormField[] = [...pending, { row: inputRow, col: 5, label: prompt || `Enter ${varName}:`, varName }];
  return { output: [], action: 'FORM_READY', formFields: form };
}
```

Update `doAtSay` and `doAtSayGet` to use `this.pendingForm`.

Update `doStore`:
```typescript
private async doStore(valueExpr: Expr, varName: string): Promise<ExecResult> {
  await this.refreshRecCount();
  const v = this.evalExpr(valueExpr);
  this.vars.set(varName, v);
  return { output: [{ text: `${varName} = ${fmtVal(v)}`, cls: 'info' }] };
}
```

Update `requireTable`:
```typescript
private requireTable() {
  if (!this.area.table) throw new Error('No table selected — run: USE <tablename>');
}
```

- [ ] **Step 3: Add new command dispatch cases in `exec()`**

```typescript
case 'SELECT':       return this.doSelect(node.alias);
case 'SET_RELATION': return this.doSetRelation(node.expression, node.intoAlias);
case 'LIST_AREAS':   return this.doListAreas();
case 'LIST_COLS':    return this.doListCols(node.cols);
case 'CLOSE':        return this.doClose();
case 'CLOSE_ALL':    return this.doCloseAll();
```

Also update the `USE` case to pass the alias: `return this.doUse(node.name, node.alias);`

- [ ] **Step 4: Implement the new command methods**

Add these methods to `Executor`:

```typescript
private doSelect(alias: string): ExecResult {
  this.activeAlias = alias;
  if (!this.areas.has(alias)) {
    this.areas.set(alias, this.makeArea(alias));
  }
  return { output: [{ text: `Work area: ${alias}`, cls: 'info' }] };
}

private doClose(): ExecResult {
  const area = this.area;
  area.table = null; area.filter = null; area.rowPtr = 1;
  area.cachedRecCount = 0; area.activeIndex = null; area.relation = null;
  return { output: [{ text: `Work area '${this.activeAlias}' closed`, cls: 'ok' }] };
}

private doCloseAll(): ExecResult {
  this.areas.clear();
  this.activeAlias = '1';
  this.areas.set('1', this.makeArea('1'));
  return { output: [{ text: 'All work areas closed', cls: 'ok' }] };
}

private doSetRelation(expression: string | null, intoAlias: string | null): ExecResult {
  if (!expression || !intoAlias) {
    this.area.relation = null;
    return { output: [{ text: 'Relation cleared', cls: 'ok' }] };
  }
  const target = this.areas.get(intoAlias);
  if (!target) return { output: [{ text: `Work area '${intoAlias}' not open`, cls: 'warn' }] };
  if (!target.table) return { output: [{ text: `Work area '${intoAlias}' has no table open`, cls: 'warn' }] };
  if (!target.activeIndex) return { output: [{ text: `Work area '${intoAlias}' has no active index — SET INDEX TO first`, cls: 'warn' }] };
  if (WorkAreaManager.detectCircular(this.areas, this.activeAlias, intoAlias)) {
    return { output: [{ text: `Circular relation detected: '${this.activeAlias}' → '${intoAlias}' would create a cycle`, cls: 'error' }] };
  }
  this.area.relation = { expression, intoAlias };
  return { output: [{ text: `Relation set: ${expression} → ${intoAlias}`, cls: 'ok' }] };
}

private doListAreas(): ExecResult {
  const out: OutputLine[] = [
    { text: 'Open work areas:', cls: 'hdr' },
    { text: `${'Alias'.padEnd(15)}  ${'Table'.padEnd(20)}  ${'Records'.padEnd(8)}  ${'Index'.padEnd(15)}  Relation`, cls: 'hdr' },
    { text: '─'.repeat(80), cls: 'sep' },
  ];
  for (const [alias, area] of this.areas) {
    const active = alias === this.activeAlias ? '* ' : '  ';
    const rec = area.table ? `${area.rowPtr}/${area.cachedRecCount}` : '-';
    const idx = area.activeIndex?.tag ?? '-';
    const rel = area.relation ? `${area.relation.expression} → ${area.relation.intoAlias}` : '-';
    out.push({ text: `${active}${alias.padEnd(13)}  ${(area.table ?? '-').padEnd(20)}  ${rec.padEnd(8)}  ${idx.padEnd(15)}  ${rel}` });
  }
  return { output: out };
}

private async doListCols(cols: string[]): Promise<ExecResult> {
  this.requireTable();
  await this.refreshRecCount();
  const rows = await this.getOrderedRows(500);
  if (!rows.length) return { output: [{ text: '(No records)', cls: 'info' }] };

  const widths = cols.map(c => Math.max(c.length, ...rows.map(() => 0)));
  // Pre-fetch current rows for each referenced alias
  const aliasRefs = new Set(cols.filter(c => c.includes('.')).map(c => c.split('.')[0]));
  const rowCache = new Map<string, Record<string, unknown>>();
  // We'll populate cache per-row during iteration

  const out: OutputLine[] = [];
  out.push({ text: cols.map((c, i) => c.padEnd(widths[i])).join('  '), cls: 'hdr' });
  out.push({ text: cols.map((_, i) => '-'.repeat(widths[i])).join('  '), cls: 'sep' });

  for (const row of rows) {
    // Refresh related area rows for this iteration
    for (const alias of aliasRefs) {
      const area = this.areas.get(alias);
      if (area?.table && area.rowPtr > 0) {
        const cacheKey = `${alias}:${area.rowPtr}`;
        if (!rowCache.has(cacheKey)) {
          const r = await this.db.query(
            `SELECT * FROM ${q(area.table)} LIMIT 1 OFFSET ${area.rowPtr - 1}`
          );
          if (r[0]) rowCache.set(cacheKey, r[0]);
        }
      }
    }
    const values = cols.map((col, i) => {
      let val: unknown;
      if (col.includes('.')) {
        const [alias, field] = col.split('.');
        val = WorkAreaManager.resolveField(alias, field, this.areas, rowCache);
      } else {
        val = row[col] ?? row[col.toUpperCase()] ?? '';
      }
      const s = String(val ?? '');
      widths[i] = Math.max(widths[i], s.length);
      return s;
    });
    out.push({ text: values.map((v, i) => v.padEnd(widths[i])).join('  ') });
  }
  out.push({ text: `${rows.length} record(s)`, cls: 'info' });
  return { output: out };
}
```

Also update `doUse` to accept and apply the alias:
```typescript
private async doUse(name: string, alias: string | null): Promise<ExecResult> {
  // If alias provided, switch/create that work area
  if (alias) {
    this.activeAlias = alias;
    if (!this.areas.has(alias)) this.areas.set(alias, this.makeArea(alias));
  }
  const area = this.area;
  const dbName = area.db ?? 'webbaseiii';
  if (!area.db) {
    const r = await this.db.openDatabase(dbName);
    area.db = dbName;
    area.opfsAvailable = r.opfsAvailable;
  }
  area.table = name;
  area.filter = null;
  area.rowPtr = 1;
  area.activeIndex = this.indexStore?.getActive(name) ?? null;
  const exists = await this.db.tableExists(name);
  const storage = area.opfsAvailable ? 'OPFS (persistent)' : 'server-side persistent';
  const lines: OutputLine[] = [
    { text: `Database : ${dbName}  [${storage}]`, cls: 'info' },
  ];
  if (exists) {
    const cnt = await this.db.getRowCount(name);
    lines.push({ text: `Table    : ${name}  (${cnt} records)`, cls: 'ok' });
  } else {
    lines.push({ text: `Table    : ${name}  (table not found — use CREATE TABLE to create it)`, cls: 'warn' });
  }
  if (area.activeIndex) {
    lines.push({ text: `Index    : ${area.activeIndex.tag}  (${area.activeIndex.expression})`, cls: 'info' });
  }
  return { output: lines };
}
```

- [ ] **Step 5: Add import for WorkAreaManager at top of Executor.ts**

```typescript
import { WorkAreaManager } from '../../server/WorkAreaManager.js';
```

Wait — Executor is in `src/`, WorkAreaManager is in `server/`. The Executor must not import from `server/` (browser code can't use server modules). Extract `WorkAreaManager` to `src/interpreter/WorkAreaManager.ts` instead, and update the server re-export.

**Move the file:**
```bash
mv server/WorkAreaManager.ts src/interpreter/WorkAreaManager.ts
```

Update import in `src/interpreter/Executor.ts`:
```typescript
import { WorkAreaManager } from './WorkAreaManager';
```

Create `server/WorkAreaManager.ts` as a re-export:
```typescript
export { WorkAreaManager } from '../src/interpreter/WorkAreaManager.js';
```

Update `tests/WorkArea.test.ts` import:
```typescript
import { WorkAreaManager } from '../src/interpreter/WorkAreaManager';
```

- [ ] **Step 6: Update `evalExprOnRowParsed` to not clobber `this.vars`**

The method temporarily sets vars from a row. With `vars` now flat on Executor, the pattern is unchanged — but verify the implementation still refers to `this.vars`:

```typescript
evalExprOnRowParsed(exprNode: Expr, row: Record<string, unknown>): unknown {
  const saved = new Map<string, unknown>();
  for (const [k, v] of Object.entries(row)) {
    saved.set(k, this.vars.get(k));
    this.vars.set(k, v);
  }
  let result: unknown = '';
  try { result = this.evalExpr(exprNode); } catch { result = ''; }
  for (const [k, v] of saved) {
    if (v === undefined) this.vars.delete(k);
    else this.vars.set(k, v);
  }
  return result;
}
```

- [ ] **Step 7: Run full test suite**

```bash
npm test
```
Expected: 103+ tests pass, 0 fail. If Session.ts has compile errors from `executor.state`, fix in the next task.

- [ ] **Step 8: Commit**

```bash
git add src/interpreter/Executor.ts src/interpreter/WorkAreaManager.ts server/WorkAreaManager.ts
git commit -m "feat: Executor — refactor state→WorkArea map, add SELECT/CLOSE/SET RELATION/LIST AREAS"
```

---

## Task 5: Update `Session.ts` to use `executor.area`

**Files:**
- Modify: `server/Session.ts`

- [ ] **Step 1: Fix all `executor.state` references**

`Session.ts` directly reads `this.executor.state` in `sendStatus()`, `sendGridData()`, and the grid edit/delete/new-row handlers. Replace with `this.executor.area`:

```typescript
private sendStatus(): void {
  const a = this.executor.area;
  this.send({
    type: 'status',
    db: a.db,
    table: a.table,
    record: a.rowPtr,
    total: a.cachedRecCount,
  });
}

private async sendGridData(): Promise<void> {
  const a = this.executor.area;
  if (!a.table) {
    this.send({ type: 'output', lines: [{ text: 'No table selected', cls: 'error' }] });
    return;
  }
  const columns = await this.bridge.getStructure(a.table);
  const rows = await this.executor.getOrderedRowsWithIds(2000);
  this.send({ type: 'grid-open', table: a.table, filter: a.filter, columns, rows });
}
```

Also update the inline grid handlers that read `this.executor.state.table` and `this.executor.state.filter`:

```typescript
case 'grid-edit': {
  const { rowid, col, value } = msg;
  const table = this.executor.area.table;
  // ... rest unchanged
}
case 'grid-delete': {
  const table = this.executor.area.table;
  // ...
}
case 'grid-new-row': {
  const table = this.executor.area.table;
  // ...
}
case 'grid-refresh': {
  // uses sendGridData() — no direct state access
}
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```
Expected: 103+ pass, 0 fail.

- [ ] **Step 3: Commit**

```bash
git add server/Session.ts
git commit -m "feat: Session — use executor.area for status and grid data"
```

---

## Task 6: `alias.field` resolution in `evalExpr`

**Files:**
- Modify: `src/interpreter/Executor.ts`

The `evalExpr` `'var'` case must detect `alias.field` patterns and delegate to `WorkAreaManager.resolveField`. But the AST's `'var'` node carries just a name string — the dot would have been tokenised as a `DOT` token and the parser would have emitted two separate `'var'` nodes. We need the Parser to emit a special `'field_ref'` Expr for `alias.field`.

- [ ] **Step 1: Add `field_ref` Expr variant to Parser**

In `src/interpreter/Parser.ts`, add to the `Expr` type:

```typescript
  | { k: 'field_ref'; alias: string; field: string }
```

In the expression parser's atom/primary handler, after recognising an identifier, check if the next token is `DOT`:

```typescript
// In the primary/atom parse method, after reading an ID/KW as a variable:
const name = t.val; this.adv();
if (!this.end() && this.peek().type === 'DOT') {
  this.adv(); // consume DOT
  const field = this.peek().val; this.adv();
  return { k: 'field_ref', alias: name, field };
}
// Check if it's a builtin call
if (BUILTIN_FUNCTIONS.has(name) && !this.end() && this.peek().type === 'LPAREN') {
  // ... existing call parsing
}
return { k: 'var', name };
```

- [ ] **Step 2: Write failing test for `alias.field` expression**

Add to the Session integration tests block:

```typescript
it('alias.field resolves cross-area field in STORE', async () => {
  const { session, sent } = makeSession();
  const db = uniqueDb();
  await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
  await session.handleMessage({ type: 'command', text: 'CREATE TABLE postcodes (zip CHAR(10), city CHAR(40))' });
  await session.handleMessage({ type: 'command', text: 'USE postcodes' });
  await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
  await session.handleMessage({ type: 'command', text: 'REPLACE zip WITH "1000", city WITH "Brussels"' });
  await session.handleMessage({ type: 'command', text: 'INDEX ON UPPER(zip) TO BYZIP' });

  await session.handleMessage({ type: 'command', text: 'SELECT customers' });
  await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
  await session.handleMessage({ type: 'command', text: 'CREATE TABLE customers (name CHAR(40), zip CHAR(10))' });
  await session.handleMessage({ type: 'command', text: 'USE customers' });
  await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
  await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Alice", zip WITH "1000"' });
  await session.handleMessage({ type: 'command', text: 'SET RELATION TO UPPER(zip) INTO postcodes' });
  await session.handleMessage({ type: 'command', text: 'GO TOP' });

  sent.length = 0;
  await session.handleMessage({ type: 'command', text: 'STORE postcodes.city TO v_city' });
  const output = sent.filter(m => m.type === 'output').flatMap((m: any) => m.lines.map((l: any) => l.text));
  expect(output.join('\n')).toContain('Brussels');
});
```

- [ ] **Step 3: Run to confirm failure**

```bash
npm test -- --reporter=verbose 2>&1 | grep 'alias.field'
```

- [ ] **Step 4: Handle `field_ref` in `evalExpr`**

Add to the `evalExpr` switch:

```typescript
case 'field_ref': {
  const area = this.areas.get(e.alias);
  if (!area || !area.table || area.rowPtr === 0) return null;
  // fetch current row of that area
  const rows = await this.db.query(
    `SELECT * FROM ${q(area.table)} LIMIT 1 OFFSET ${area.rowPtr - 1}`
  );
  return rows[0]?.[e.field] ?? rows[0]?.[e.field.toUpperCase()] ?? null;
}
```

**Problem:** `evalExpr` is currently synchronous. Adding an async DB call breaks this. Instead, pre-fetch related area rows into a per-eval cache before expression evaluation. Add a method `fetchAreaRow(alias)` that populates an `evalCache: Map<string, Record<string, unknown>>` on the Executor, cleared before each statement that evaluates expressions.

Replace the above with a synchronous lookup:

```typescript
case 'field_ref': {
  const row = this.evalCache.get(e.alias);
  if (!row) return null;
  return row[e.field] ?? row[e.field.toUpperCase()] ?? null;
}
```

Add `evalCache: Map<string, Record<string, unknown>> = new Map()` to Executor.

Add `async primeEvalCache()` which fetches current row for every open area with a table and rowPtr > 0:

```typescript
private async primeEvalCache(): Promise<void> {
  this.evalCache.clear();
  for (const [alias, area] of this.areas) {
    if (area.table && area.rowPtr > 0) {
      const rows = await this.db.query(
        `SELECT * FROM ${q(area.table)} LIMIT 1 OFFSET ${area.rowPtr - 1}`
      );
      if (rows[0]) this.evalCache.set(alias, rows[0]);
    }
  }
}
```

Call `await this.primeEvalCache()` at the start of `refreshRecCount()`, `doIf()`, `doWhile()`, `doStore()`, and `doReplaceAll()`.

- [ ] **Step 5: Implement relation auto-seek after navigation**

Add `resolveRelations()` private method:

```typescript
private async resolveRelations(): Promise<void> {
  const dependents = WorkAreaManager.getDependents(this.areas, this.activeAlias);
  for (const { area, keyExpression } of dependents) {
    if (!area.activeIndex) continue;
    // Evaluate key expression in active area's context
    await this.primeEvalCache();
    const exprNode = new Parser(new Lexer(keyExpression).tokenize()).parseExprPublic();
    const keyVal = String(this.evalExpr(exprNode)).toLowerCase();
    // Seek in the related area
    const savedAlias = this.activeAlias;
    this.activeAlias = area.alias;
    const rows = await this.getOrderedRows(100000);
    const idxExpr = area.activeIndex.expression.trim();
    const idxNode = new Parser(new Lexer(idxExpr).tokenize()).parseExprPublic();
    const pos = rows.findIndex(row => {
      const v = String(this.evalExprOnRowParsed(idxNode, row)).toLowerCase();
      return v === keyVal;
    });
    if (pos === -1) {
      area.rowPtr = 0;
      area._found = false;
    } else {
      area.rowPtr = pos + 1;
      area._found = true;
    }
    this.activeAlias = savedAlias;
  }
}
```

Call `await this.resolveRelations()` at the end of `doGo()`, `doSkip()`, `doSeek()`, and `doAppend()`.

- [ ] **Step 6: Run tests**

```bash
npm test
```
Expected: 103+ pass including the new `alias.field` test.

- [ ] **Step 7: Commit**

```bash
git add src/interpreter/Executor.ts src/interpreter/Parser.ts
git commit -m "feat: alias.field expression resolution and relation auto-seek on navigation"
```

---

## Task 7: Integration tests — multi-area command round-trips

**Files:**
- Modify: `tests/Session.test.ts`

- [ ] **Step 1: Add integration test block**

Add a new `describe('Session: Multi-Work-Area')` block to `tests/Session.test.ts`:

```typescript
describe('Session: Multi-Work-Area', () => {
  it('SELECT creates a new work area', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'command', text: 'SELECT orders' });
    const output = sent.filter(m => m.type === 'output').flatMap((m: any) => m.lines.map((l: any) => l.text));
    expect(output.join('\n')).toContain('orders');
  });

  it('LIST AREAS shows all open areas', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE products (name CHAR(40))' });
    await session.handleMessage({ type: 'command', text: 'USE products' });
    await session.handleMessage({ type: 'command', text: 'SELECT 2' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'LIST AREAS' });
    const out = sent.filter(m => m.type === 'output').flatMap((m: any) => m.lines.map((l: any) => l.text)).join('\n');
    expect(out).toContain('products');
    expect(out).toContain('2');
  });

  it('SET RELATION TO errors when target has no index', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE a (id INTEGER)' });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE b (id INTEGER)' });
    await session.handleMessage({ type: 'command', text: 'USE a' });
    await session.handleMessage({ type: 'command', text: 'SELECT b' });
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'USE b' });
    await session.handleMessage({ type: 'command', text: 'SELECT a' });
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'USE a' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'SET RELATION TO id INTO b' });
    const out = sent.filter(m => m.type === 'output').flatMap((m: any) => m.lines.map((l: any) => l.text)).join('\n');
    expect(out).toMatch(/no active index|SET INDEX TO/i);
  });

  it('SET RELATION TO rejects circular relations', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE aa (id INTEGER)' });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE bb (id INTEGER)' });
    await session.handleMessage({ type: 'command', text: 'USE aa' });
    await session.handleMessage({ type: 'command', text: 'INDEX ON id TO BYID' });
    await session.handleMessage({ type: 'command', text: 'SELECT bb' });
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'USE bb' });
    await session.handleMessage({ type: 'command', text: 'INDEX ON id TO BYID' });
    // aa → bb
    await session.handleMessage({ type: 'command', text: 'SELECT aa' });
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'USE aa' });
    await session.handleMessage({ type: 'command', text: 'SET RELATION TO id INTO bb' });
    // Now try bb → aa (circular)
    await session.handleMessage({ type: 'command', text: 'SELECT bb' });
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'USE bb' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'SET RELATION TO id INTO aa' });
    const out = sent.filter(m => m.type === 'output').flatMap((m: any) => m.lines.map((l: any) => l.text)).join('\n');
    expect(out).toMatch(/circular/i);
  });

  it('CLOSE clears active area table', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE things (name CHAR(20))' });
    await session.handleMessage({ type: 'command', text: 'USE things' });
    await session.handleMessage({ type: 'command', text: 'CLOSE' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'LIST AREAS' });
    const out = sent.filter(m => m.type === 'output').flatMap((m: any) => m.lines.map((l: any) => l.text)).join('\n');
    expect(out).not.toContain('things');
  });

  it('navigation triggers relation seek', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    // Set up postcodes table
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE pcs (zip CHAR(10), city CHAR(40))' });
    await session.handleMessage({ type: 'command', text: 'USE pcs' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE zip WITH "1000", city WITH "Brussels"' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE zip WITH "2000", city WITH "Antwerp"' });
    await session.handleMessage({ type: 'command', text: 'INDEX ON UPPER(zip) TO BYZIP' });
    // Set up customers table in area 'cust'
    await session.handleMessage({ type: 'command', text: 'SELECT cust' });
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE custs (name CHAR(40), zip CHAR(10))' });
    await session.handleMessage({ type: 'command', text: 'USE custs' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Alice", zip WITH "1000"' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Bob", zip WITH "2000"' });
    await session.handleMessage({ type: 'command', text: 'SET RELATION TO UPPER(zip) INTO pcs' });
    // Navigate to first record → postcodes area should seek 1000 → Brussels
    await session.handleMessage({ type: 'command', text: 'GO TOP' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'STORE pcs.city TO v' });
    const out = sent.filter(m => m.type === 'output').flatMap((m: any) => m.lines.map((l: any) => l.text)).join('\n');
    expect(out).toContain('Brussels');
    // Navigate to second record → should seek 2000 → Antwerp
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'GO 2' });
    await session.handleMessage({ type: 'command', text: 'STORE pcs.city TO v' });
    const out2 = sent.filter(m => m.type === 'output').flatMap((m: any) => m.lines.map((l: any) => l.text)).join('\n');
    expect(out2).toContain('Antwerp');
  });

  it('LIST with cross-area columns shows joined output', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE pcs2 (zip CHAR(10), city CHAR(40))' });
    await session.handleMessage({ type: 'command', text: 'USE pcs2' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE zip WITH "1000", city WITH "Brussels"' });
    await session.handleMessage({ type: 'command', text: 'INDEX ON UPPER(zip) TO BYZIP' });
    await session.handleMessage({ type: 'command', text: 'SELECT main' });
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE custs2 (name CHAR(40), zip CHAR(10))' });
    await session.handleMessage({ type: 'command', text: 'USE custs2' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Alice", zip WITH "1000"' });
    await session.handleMessage({ type: 'command', text: 'SET RELATION TO UPPER(zip) INTO pcs2' });
    await session.handleMessage({ type: 'command', text: 'GO TOP' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'LIST name, pcs2.city' });
    const out = sent.filter(m => m.type === 'output').flatMap((m: any) => m.lines.map((l: any) => l.text)).join('\n');
    expect(out).toContain('Alice');
    expect(out).toContain('Brussels');
  });
});
```

- [ ] **Step 2: Run tests**

```bash
npm test
```
Expected: all new integration tests pass (103+ total), 0 fail.

- [ ] **Step 3: Commit**

```bash
git add tests/Session.test.ts
git commit -m "test: multi-work-area integration tests — SELECT, RELATION, LIST cols, navigation seek"
```

---

## Task 8: Playwright E2E — `tests/multiarea.spec.ts`

**Files:**
- Create: `tests/multiarea.spec.ts`

- [ ] **Step 1: Create the E2E test file**

```typescript
/**
 * Multi-Work-Area E2E — exercises SELECT, SET RELATION TO, alias.field,
 * and LIST with cross-area columns through the real browser REPL.
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page): Promise<void> {
  await page.goto('http://localhost:5173');
  await expect(page.locator('#terminal-output')).toContainText('Connected.', { timeout: 8000 });
}

async function cmd(page: Page, command: string, waitMs = 600): Promise<void> {
  const input = page.locator('#terminal-input');
  await input.fill(command);
  await input.press('Enter');
  await page.waitForTimeout(waitMs);
}

async function outputAfter(page: Page, fn: () => Promise<void>): Promise<string> {
  const before = (await page.locator('#terminal-output').textContent()) ?? '';
  await fn();
  await page.waitForTimeout(800);
  return ((await page.locator('#terminal-output').textContent()) ?? '').slice(before.length);
}

test.describe('Multi-Work-Area', () => {

  test('01. SELECT and LIST AREAS', async ({ page }) => {
    await boot(page);
    await cmd(page, 'USE DATABASE mwa_test');
    await cmd(page, 'CREATE TABLE products (name CHAR(40), price REAL)');
    await cmd(page, 'USE products');
    await cmd(page, 'SELECT 2');
    const out = await outputAfter(page, () => cmd(page, 'LIST AREAS'));
    expect(out).toContain('products');
    expect(out).toContain('2');
  });

  test('02. postcode→customer relation — city resolves via alias.field', async ({ page }) => {
    await boot(page);
    // Setup postcodes
    await cmd(page, 'USE DATABASE mwa_test');
    await cmd(page, 'CREATE TABLE pcs (zip CHAR(10), city CHAR(40))');
    await cmd(page, 'USE pcs');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE zip WITH "1000", city WITH "Brussels"');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE zip WITH "2000", city WITH "Antwerp"');
    await cmd(page, 'INDEX ON UPPER(zip) TO BYZIP');
    // Setup customers in area 'cust'
    await cmd(page, 'SELECT cust');
    await cmd(page, 'USE DATABASE mwa_test');
    await cmd(page, 'CREATE TABLE custs (name CHAR(40), zip CHAR(10))');
    await cmd(page, 'USE custs');
    await cmd(page, 'APPEND RECORD');
    await cmd(page, 'REPLACE name WITH "Alice", zip WITH "2000"');
    await cmd(page, 'SET RELATION TO UPPER(zip) INTO pcs');
    await cmd(page, 'GO TOP');
    const out = await outputAfter(page, () => cmd(page, 'STORE pcs.city TO city'));
    expect(out).toContain('Antwerp');
  });

  test('03. LIST with cross-area columns shows joined output', async ({ page }) => {
    await boot(page);
    await cmd(page, 'USE DATABASE mwa_test');
    await cmd(page, 'SELECT cust');
    await cmd(page, 'USE DATABASE mwa_test');
    await cmd(page, 'USE custs', 500);
    await cmd(page, 'GO TOP');
    const out = await outputAfter(page, () => cmd(page, 'LIST name, pcs.city'));
    expect(out).toContain('Alice');
    expect(out).toContain('Antwerp');
  });

  test('04. CLOSE ALL resets to single area', async ({ page }) => {
    await boot(page);
    await cmd(page, 'SELECT foo');
    await cmd(page, 'SELECT bar');
    await cmd(page, 'CLOSE ALL');
    const out = await outputAfter(page, () => cmd(page, 'LIST AREAS'));
    expect(out).toContain('1');
    expect(out).not.toContain('foo');
    expect(out).not.toContain('bar');
  });

});
```

- [ ] **Step 2: Run E2E tests (requires dev server running)**

```bash
npx playwright test tests/multiarea.spec.ts --headed
```
Expected: 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/multiarea.spec.ts
git commit -m "test: multi-work-area Playwright E2E suite"
```

---

## Task 9: Update HELP, README, CLAUDE.md, version

**Files:**
- Modify: `src/interpreter/Executor.ts` (doHelp)
- Modify: `README.md`
- Modify: `CLAUDE.md`
- Modify: `package.json`

- [ ] **Step 1: Update `doHelp()` in Executor**

Add the new commands to the help text output array:

```typescript
{ text: '─'.repeat(50), cls: 'sep' },
{ text: 'WORK AREAS', cls: 'hdr' },
{ text: 'SELECT <alias>               — activate/create a work area' },
{ text: 'USE <table> [ALIAS <name>]   — open table; optional alias override' },
{ text: 'SET RELATION TO <e> INTO <a> — link area to another by key expr' },
{ text: 'SET RELATION TO             — clear relation' },
{ text: 'LIST AREAS                  — show all open work areas' },
{ text: 'LIST <col, alias.col, ...>  — list with cross-area columns' },
{ text: 'CLOSE                       — close active area table' },
{ text: 'CLOSE ALL                   — close all work areas' },
```

- [ ] **Step 2: Update `README.md`**

Add a new `### Work areas` section to the W3Script command reference. Insert before the BROWSE keyboard shortcuts table:

```markdown
### Work areas

WebBase-III supports **unlimited** named work areas (compared to dBASE III's DOS-era limit of 10).
Cross-area fields use `alias.field` dot notation (dBASE III used `alias->field`).

| Command | What it does |
|---|---|
| `SELECT <alias>` | Activate (or create) a work area by name or number |
| `USE <table> [ALIAS <name>]` | Open table in active area; optional alias override |
| `SET RELATION TO <expr> INTO <alias>` | Link active area to another by key expression — moving the record pointer auto-seeks the related area |
| `SET RELATION TO` | Clear relation on active area |
| `LIST [col, alias.col, ...]` | List records; optional column list with cross-area `alias.field` references |
| `LIST AREAS` | Show all open work areas, tables, record pointers, and relations |
| `CLOSE` | Close active area's table |
| `CLOSE ALL` | Close all work areas; reset to single empty area `"1"` |

**Example — customers linked to postcodes:**
\`\`\`
SELECT pcs
USE DATABASE mydb
USE postcodes
INDEX ON UPPER(zip) TO BYZIP

SELECT cust
USE DATABASE mydb
USE customers
SET RELATION TO UPPER(zip) INTO pcs

GO TOP
LIST name, pcs.city      * shows customer name + city from postcodes
\`\`\`
```

- [ ] **Step 3: Update `CLAUDE.md`**

In the commands section, add the Work areas table (same content as README). In the architecture section, add `src/interpreter/WorkAreaManager.ts`. Update the Roadmap to mark item 5 as ✅.

- [ ] **Step 4: Bump version to `0.4.0` in `package.json`**

Change `"version": "0.3.1"` → `"version": "0.4.0"`.

- [ ] **Step 5: Run full test suite one final time**

```bash
npm test
```
Expected: all tests pass.

- [ ] **Step 6: Final commit**

```bash
git add src/interpreter/Executor.ts README.md CLAUDE.md package.json
git commit -m "release: v0.4.0 — multi-work-area, unlimited SELECT, SET RELATION TO, alias.field"
```

---

## Self-Review Checklist

- [x] `WorkArea` interface defined in Task 1, used consistently throughout
- [x] `WorkAreaManager` in `src/interpreter/` (not `server/`) so it can be imported by Executor without browser/server coupling issues
- [x] `detectCircular`, `resolveField`, `getDependents` all covered by unit tests in Task 2
- [x] Every new AST node has a parser test in Task 3 and an executor handler in Task 4
- [x] `evalCache` pattern resolves the sync/async problem for `alias.field` in expressions
- [x] `resolveRelations()` called after all navigation commands (GO, SKIP, SEEK, APPEND)
- [x] Session.ts updated to use `executor.area` (Task 5)
- [x] Integration tests cover: SELECT, LIST AREAS, SET RELATION TO error cases, circular detection, CLOSE, navigation seek, LIST with cross-area cols
- [x] E2E tests cover: SELECT, postcode→customer relation, LIST joined output, CLOSE ALL
- [x] README and CLAUDE.md include modernisation note (unlimited areas, dot notation)
- [x] Version bumped to 0.4.0
