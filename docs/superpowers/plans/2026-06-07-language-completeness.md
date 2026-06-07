# Language Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `DO CASE` control flow and a full set of dBASE III built-in functions to the W3Script interpreter so programs can express real application logic and index expressions like `INDEX ON UPPER(lastname) TO BYUPPER` work correctly.

**Architecture:** Add a `call` node to the `Expr` union; parse function calls in `exprAtom`; dispatch in `evalExpr` to stateless functions in a new `Builtins.ts` file and stateful functions inline in `Executor`. Add `DO_CASE` AST node and executor handler. Cache async row-count on state to keep `evalExpr` synchronous.

**Tech Stack:** TypeScript, Vitest, Node.js, better-sqlite3 (via existing `ServerDatabaseBridge`)

---

## File Map

| File | Change |
|---|---|
| `src/interpreter/Lexer.ts` | Add function-name keywords + `CASE`, `OTHERWISE`, `ENDCASE` to KWS set |
| `src/interpreter/Parser.ts` | Add `call` to `Expr`; add `DO_CASE` to `ASTNode`; extend `exprAtom`; add `parseDoCaseOrPrg` |
| `src/interpreter/Builtins.ts` | **New** — all stateless built-in functions |
| `src/interpreter/Executor.ts` | Add `cachedRecCount` to `State`; add `case 'call'` + `callBuiltin`; add `doCase`; update HELP |
| `tests/Builtins.test.ts` | **New** — unit tests for every stateless function |
| `tests/Session.test.ts` | Extend — `DO CASE`, `EOF()`, `BOF()`, `FOUND()`, `RECNO()`, `RECCOUNT()`, `INDEX ON UPPER(x)` |
| `README.md` | Add Functions section to command reference |
| `CLAUDE.md` | Update commands table, mark roadmap item 2 done |

---

### Task 1: Lexer — add new keywords

**Files:**
- Modify: `src/interpreter/Lexer.ts:8-17`

- [ ] **Step 1: Add keywords to KWS set**

Replace the existing `const KWS = new Set([...])` block (lines 8–17) with:

```typescript
const KWS = new Set([
  'USE','LIST','BROWSE','CLEAR','SET','FILTER','TO','REPLACE','ALL','WITH',
  'APPEND','RECORD','BLANK','READ','IF','ENDIF','ELSE','STORE','SAY','GET',
  'DO','WHILE','ENDDO','RETURN','CLOSE','TABLES','STRUCTURE','DATABASES',
  'DELETE','RECALL','PACK','GO','GOTO','TOP','BOTTOM','SKIP',
  'COUNT','LOCATE','CONTINUE','QUIT','FIELDS','HELP',
  'AND','OR','NOT','TRUE','FALSE','CREATE','TABLE','DROP','INDEX','ON',
  'INPUT','ACCEPT','DISPLAY','DATABASE','FOR','NEXT',
  'SEEK','FIND','REINDEX','INDEXES',
  // DO CASE control flow
  'CASE','OTHERWISE','ENDCASE',
  // Built-in function names
  'SUBSTR','LEN','TRIM','LTRIM','UPPER','LOWER','AT','STR','VAL',
  'INT','ABS','SPACE','REPLICATE','DATE','DTOC','CTOD',
  'EOF','BOF','FOUND','RECNO','RECCOUNT',
]);
```

- [ ] **Step 2: Run tests to confirm nothing breaks**

```bash
npm test
```

Expected: all existing tests pass (55/55).

- [ ] **Step 3: Commit**

```bash
git add src/interpreter/Lexer.ts
git commit -m "feat: add DO CASE and built-in function keywords to Lexer"
```

---

### Task 2: Builtins.ts — stateless functions

**Files:**
- Create: `src/interpreter/Builtins.ts`
- Create: `tests/Builtins.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/Builtins.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { callStateless } from '../src/interpreter/Builtins';

describe('SUBSTR', () => {
  it('extracts mid-string', () => expect(callStateless('SUBSTR', ['Hello', 2, 3])).toBe('ell'));
  it('no len — to end', () => expect(callStateless('SUBSTR', ['Hello', 4])).toBe('lo'));
  it('start < 1 clamps to 1', () => expect(callStateless('SUBSTR', ['Hello', 0, 2])).toBe('He'));
  it('empty string', () => expect(callStateless('SUBSTR', ['', 1, 3])).toBe(''));
});

describe('LEN', () => {
  it('returns length', () => expect(callStateless('LEN', ['Hello'])).toBe(5));
  it('empty string', () => expect(callStateless('LEN', [''])).toBe(0));
});

describe('TRIM', () => {
  it('strips both ends', () => expect(callStateless('TRIM', ['  hi  '])).toBe('hi'));
  it('no-op on clean string', () => expect(callStateless('TRIM', ['hi'])).toBe('hi'));
});

describe('LTRIM', () => {
  it('strips leading only', () => expect(callStateless('LTRIM', ['  hi  '])).toBe('hi  '));
});

describe('UPPER / LOWER', () => {
  it('UPPER', () => expect(callStateless('UPPER', ['hello'])).toBe('HELLO'));
  it('LOWER', () => expect(callStateless('LOWER', ['HELLO'])).toBe('hello'));
});

describe('AT', () => {
  it('finds needle', () => expect(callStateless('AT', ['lo', 'Hello'])).toBe(4));
  it('not found returns 0', () => expect(callStateless('AT', ['xyz', 'Hello'])).toBe(0));
  it('case-sensitive', () => expect(callStateless('AT', ['LO', 'Hello'])).toBe(0));
});

describe('STR', () => {
  it('integer, no args', () => expect(callStateless('STR', [42])).toBe('        42'));
  it('with len', () => expect(callStateless('STR', [42, 5])).toBe('   42'));
  it('with len and dec', () => expect(callStateless('STR', [3.14159, 8, 2])).toBe('    3.14'));
  it('overflow fills with stars', () => expect(callStateless('STR', [12345, 3])).toBe('***'));
});

describe('VAL', () => {
  it('parses number', () => expect(callStateless('VAL', ['42'])).toBe(42));
  it('parses float', () => expect(callStateless('VAL', ['3.14'])).toBe(3.14));
  it('non-numeric returns 0', () => expect(callStateless('VAL', ['abc'])).toBe(0));
  it('leading number', () => expect(callStateless('VAL', ['42abc'])).toBe(42));
});

describe('INT', () => {
  it('truncates positive', () => expect(callStateless('INT', [3.9])).toBe(3));
  it('truncates negative', () => expect(callStateless('INT', [-3.9])).toBe(-3));
});

describe('ABS', () => {
  it('positive stays positive', () => expect(callStateless('ABS', [5])).toBe(5));
  it('negative becomes positive', () => expect(callStateless('ABS', [-5])).toBe(5));
});

describe('SPACE', () => {
  it('produces n spaces', () => expect(callStateless('SPACE', [3])).toBe('   '));
  it('zero returns empty', () => expect(callStateless('SPACE', [0])).toBe(''));
});

describe('REPLICATE', () => {
  it('repeats string', () => expect(callStateless('REPLICATE', ['ab', 3])).toBe('ababab'));
  it('zero times', () => expect(callStateless('REPLICATE', ['ab', 0])).toBe(''));
});

describe('DATE', () => {
  it('returns MM/DD/YY format', () => {
    const result = callStateless('DATE', []) as string;
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{2}$/);
  });
});

describe('DTOC', () => {
  it('ISO to MM/DD/YY', () => expect(callStateless('DTOC', ['2026-06-07'])).toBe('06/07/26'));
  it('already MM/DD/YY passthrough', () => expect(callStateless('DTOC', ['06/07/26'])).toBe('06/07/26'));
});

describe('CTOD', () => {
  it('MM/DD/YY to ISO', () => expect(callStateless('CTOD', ['06/07/26'])).toBe('2026-06-07'));
});

describe('unknown function', () => {
  it('throws', () => expect(() => callStateless('FOOBAR', [])).toThrow('Unknown function: FOOBAR'));
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm test tests/Builtins.test.ts
```

Expected: FAIL — `Cannot find module '../src/interpreter/Builtins'`

- [ ] **Step 3: Create Builtins.ts**

Create `src/interpreter/Builtins.ts`:

```typescript
/**
 * Stateless dBASE III built-in functions.
 * All args are already-evaluated values (string | number | boolean).
 * Throws on unknown function name so Executor can distinguish from stateful functions.
 */
export function callStateless(fn: string, args: unknown[]): unknown {
  const s = (i: number) => String(args[i] ?? '');
  const n = (i: number) => Number(args[i] ?? 0);

  switch (fn) {
    case 'SUBSTR': {
      const str = s(0);
      const start = Math.max(1, n(1));
      const len = args[2] !== undefined ? n(2) : undefined;
      return len !== undefined ? str.slice(start - 1, start - 1 + len) : str.slice(start - 1);
    }
    case 'LEN':       return s(0).length;
    case 'TRIM':      return s(0).trim();
    case 'LTRIM':     return s(0).trimStart();
    case 'UPPER':     return s(0).toUpperCase();
    case 'LOWER':     return s(0).toLowerCase();
    case 'AT': {
      const idx = s(1).indexOf(s(0));
      return idx === -1 ? 0 : idx + 1;
    }
    case 'STR': {
      const num = n(0);
      const len = args[1] !== undefined ? n(1) : 10;
      const dec = args[2] !== undefined ? n(2) : 0;
      const formatted = num.toFixed(dec);
      if (formatted.length > len) return '*'.repeat(len);
      return formatted.padStart(len);
    }
    case 'VAL': {
      const parsed = parseFloat(s(0));
      return isNaN(parsed) ? 0 : parsed;
    }
    case 'INT':       return Math.trunc(n(0));
    case 'ABS':       return Math.abs(n(0));
    case 'SPACE':     return ' '.repeat(Math.max(0, n(0)));
    case 'REPLICATE': return s(0).repeat(Math.max(0, n(1)));
    case 'DATE': {
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      const yy = String(d.getFullYear()).slice(-2);
      return `${mm}/${dd}/${yy}`;
    }
    case 'DTOC': {
      // Accept ISO (YYYY-MM-DD) or already MM/DD/YY
      const raw = s(0);
      const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (isoMatch) return `${isoMatch[2]}/${isoMatch[3]}/${isoMatch[1].slice(-2)}`;
      return raw; // already display format
    }
    case 'CTOD': {
      // MM/DD/YY → YYYY-MM-DD
      const raw = s(0);
      const m = raw.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
      if (!m) return raw;
      const century = parseInt(m[3]) >= 70 ? '19' : '20';
      return `${century}${m[3]}-${m[1]}-${m[2]}`;
    }
    default:
      throw new Error(`Unknown function: ${fn}`);
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm test tests/Builtins.test.ts
```

Expected: all 30 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/interpreter/Builtins.ts tests/Builtins.test.ts
git commit -m "feat: add stateless built-in functions (Builtins.ts) with full test coverage"
```

---

### Task 3: Parser — `call` Expr node and `DO CASE`

**Files:**
- Modify: `src/interpreter/Parser.ts:45-49` (Expr union)
- Modify: `src/interpreter/Parser.ts:5-41` (ASTNode union)
- Modify: `src/interpreter/Parser.ts:107` (parseDo dispatch)
- Modify: `src/interpreter/Parser.ts:359-374` (exprAtom)

- [ ] **Step 1: Write parser tests (add to existing Session tests for now — parser is tested indirectly)**

Add to `tests/Session.test.ts` inside the `describe('Session', ...)` block. These will fail until Task 3 + 4 are complete — mark them `it.todo` now and activate in Task 4:

```typescript
it.todo('DO CASE — first matching branch executes');
it.todo('DO CASE — OTHERWISE executes when no case matches');
it.todo('DO CASE — no branch matches and no OTHERWISE is a no-op');
it.todo('UPPER() in expression evaluates correctly');
it.todo('SUBSTR() via STORE evaluates correctly');
it.todo('LEN() in IF condition');
```

- [ ] **Step 2: Extend Expr union — add `call` variant**

In `src/interpreter/Parser.ts`, replace lines 45–49:

```typescript
export type Expr =
  | { k: 'lit';  v: string | number | boolean }
  | { k: 'var';  name: string }
  | { k: 'bin';  op: string; l: Expr; r: Expr }
  | { k: 'not';  e: Expr }
  | { k: 'call'; fn: string; args: Expr[] };
```

- [ ] **Step 3: Add `DO_CASE` to ASTNode union**

In `src/interpreter/Parser.ts`, add after line 29 (`DO_WHILE` line):

```typescript
  | { type: 'DO_CASE'; cases: Array<{ cond: Expr; body: ASTNode[] }>; otherwise: ASTNode[] }
```

- [ ] **Step 4: Update `parseDo` to handle `DO CASE`**

Replace the existing `parseDo` method (lines 231–247) with:

```typescript
private parseDo(): ASTNode {
  this.adv();
  if (this.peekKw('CASE')) {
    return this.parseDoCase();
  }
  if (!this.peekKw('WHILE')) {
    return { type: 'DO_PRG', name: this.ident() };
  }
  this.expectKw('WHILE');
  const cond = this.expr();
  this.skipNlSemi();
  const body: ASTNode[] = [];
  while (!this.end()) {
    this.skipNlSemi();
    if (this.peekKw('ENDDO')) { this.adv(); break; }
    const n = this.stmt();
    if (n) body.push(n);
  }
  return { type: 'DO_WHILE', cond, body };
}

private parseDoCase(): ASTNode {
  this.adv(); // consume CASE
  this.skipNlSemi();
  const cases: Array<{ cond: Expr; body: ASTNode[] }> = [];
  const otherwise: ASTNode[] = [];

  while (!this.end()) {
    this.skipNlSemi();
    if (this.peekKw('ENDCASE')) { this.adv(); break; }
    if (this.peekKw('OTHERWISE')) {
      this.adv();
      this.skipNlSemi();
      while (!this.end()) {
        this.skipNlSemi();
        if (this.peekKw('ENDCASE')) { this.adv(); break; }
        const n = this.stmt();
        if (n) otherwise.push(n);
      }
      break;
    }
    if (this.peekKw('CASE')) {
      this.adv();
      const cond = this.expr();
      this.skipNlSemi();
      const body: ASTNode[] = [];
      while (!this.end()) {
        this.skipNlSemi();
        if (this.peekKw('CASE') || this.peekKw('OTHERWISE') || this.peekKw('ENDCASE')) break;
        const n = this.stmt();
        if (n) body.push(n);
      }
      cases.push({ cond, body });
      continue;
    }
    // unexpected token inside DO CASE — skip
    this.adv();
  }
  return { type: 'DO_CASE', cases, otherwise };
}
```

- [ ] **Step 5: Extend `exprAtom` to parse function calls**

Replace the `exprAtom` method (lines 359–374) with:

```typescript
private exprAtom(): Expr {
  const t = this.peek();
  if (t.type === 'STR')  { this.adv(); return { k: 'lit', v: t.val }; }
  if (t.type === 'NUM')  { this.adv(); return { k: 'lit', v: parseFloat(t.val) }; }
  if (t.val === 'TRUE')  { this.adv(); return { k: 'lit', v: true }; }
  if (t.val === 'FALSE') { this.adv(); return { k: 'lit', v: false }; }
  if (t.type === 'LPAREN') {
    this.adv(); const e = this.expr();
    if (this.peek().type === 'RPAREN') this.adv();
    return e;
  }
  if (t.type === 'ID' || t.type === 'KW') {
    this.adv();
    // Function call: identifier immediately followed by (
    if (this.peek().type === 'LPAREN') {
      this.adv(); // consume (
      const args: Expr[] = [];
      while (!this.end() && this.peek().type !== 'RPAREN') {
        args.push(this.expr());
        if (this.peek().type === 'COMMA') this.adv();
      }
      if (this.peek().type === 'RPAREN') this.adv(); // consume )
      return { k: 'call', fn: t.val.toUpperCase(), args };
    }
    return { k: 'var', name: t.val };
  }
  this.adv(); return { k: 'lit', v: '' };
}
```

- [ ] **Step 6: Run full test suite to confirm nothing broke**

```bash
npm test
```

Expected: all existing tests pass (parser changes are additive; no existing behavior removed).

- [ ] **Step 7: Commit**

```bash
git add src/interpreter/Parser.ts tests/Session.test.ts
git commit -m "feat: add call Expr node, DO_CASE AST node, function call parsing in exprAtom"
```

---

### Task 4: Executor — wire functions and DO CASE

**Files:**
- Modify: `src/interpreter/Executor.ts`

- [ ] **Step 1: Add `cachedRecCount` to State interface**

In `src/interpreter/Executor.ts`, replace the `State` interface (lines 16–26):

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
  cachedRecCount: number;
}
```

- [ ] **Step 2: Initialize `cachedRecCount` in constructor**

In the `Executor` constructor (around line 46), add `cachedRecCount: 0` to the state initializer:

```typescript
this.state = {
  db: null, table: null, filter: null,
  vars: new Map(), rowPtr: 1,
  pendingForm: [], opfsAvailable: false,
  activeIndex: null,
  _found: false,
  cachedRecCount: 0,
};
```

- [ ] **Step 3: Add import for Builtins and wire `callBuiltin` + stateful functions**

At the top of `Executor.ts`, add the import after existing imports (line 3):

```typescript
import { callStateless } from './Builtins';
```

Add this method to the `Executor` class, just before `evalExpr`:

```typescript
private callBuiltin(fn: string, args: unknown[]): unknown {
  // Stateful functions that need this.state
  switch (fn) {
    case 'EOF':      return this.state.table ? this.state.rowPtr > this.state.cachedRecCount : true;
    case 'BOF':      return this.state.rowPtr < 1;
    case 'FOUND':    return this.state._found;
    case 'RECNO':    return this.state.rowPtr;
    case 'RECCOUNT': return this.state.cachedRecCount;
  }
  // Delegate stateless functions — throws on unknown name
  return callStateless(fn, args);
}
```

- [ ] **Step 4: Add `case 'call'` to `evalExpr`**

In `evalExpr` (around line 522), add a new case before the closing brace of the switch:

```typescript
case 'call': {
  const args = e.args.map(a => this.evalExpr(a));
  return this.callBuiltin(e.fn, args);
}
```

The full `evalExpr` switch should now be:

```typescript
evalExpr(e: Expr): unknown {
  switch (e.k) {
    case 'lit':  return e.v;
    case 'var':  return this.state.vars.get(e.name) ?? e.name;
    case 'not':  return !this.evalExpr(e.e);
    case 'bin': {
      const l = this.evalExpr(e.l);
      const r = this.evalExpr(e.r);
      switch (e.op) {
        case '+':  return typeof l === 'number' && typeof r === 'number' ? l + r : String(l) + String(r);
        case '-':  return Number(l) - Number(r);
        case '*':  return Number(l) * Number(r);
        case '/':  return Number(r) !== 0 ? Number(l) / Number(r) : 0;
        case '==': case '=': return String(l).toLowerCase() === String(r).toLowerCase();
        case '!=': return String(l).toLowerCase() !== String(r).toLowerCase();
        case '<':  return Number(l) < Number(r);
        case '>':  return Number(l) > Number(r);
        case '<=': return Number(l) <= Number(r);
        case '>=': return Number(l) >= Number(r);
        case 'AND': return Boolean(l) && Boolean(r);
        case 'OR':  return Boolean(l) || Boolean(r);
      }
      return null;
    }
    case 'call': {
      const args = e.args.map(a => this.evalExpr(a));
      return this.callBuiltin(e.fn, args);
    }
  }
}
```

- [ ] **Step 5: Add `doCase` handler and wire it into `exec`**

Add the `doCase` method to the `Executor` class (place it near `doIf` and `doWhile`):

```typescript
private async doCase(
  cases: Array<{ cond: Expr; body: ASTNode[] }>,
  otherwise: ASTNode[]
): Promise<ExecResult> {
  await this.refreshRecCount();
  for (const { cond, body } of cases) {
    if (this.evalExpr(cond)) {
      return this.runBlock(body);
    }
  }
  if (otherwise.length) {
    return this.runBlock(otherwise);
  }
  return { output: [] };
}

private async runBlock(nodes: ASTNode[]): Promise<ExecResult> {
  const out: OutputLine[] = [];
  for (const node of nodes) {
    const r = await this.exec(node);
    out.push(...r.output);
    if (r.action) return { output: out, action: r.action, formFields: r.formFields, continuation: r.continuation };
  }
  return { output: out };
}

private async refreshRecCount(): Promise<void> {
  if (this.state.table) {
    this.state.cachedRecCount = await this.db.getRowCount(this.state.table, this.state.filter ?? undefined);
  } else {
    this.state.cachedRecCount = 0;
  }
}
```

In `exec`'s switch statement (around line 126), add the `DO_CASE` case before `UNKNOWN`:

```typescript
case 'DO_CASE': return this.doCase(node.cases, node.otherwise);
```

- [ ] **Step 6: Refresh `cachedRecCount` in the right places**

`EOF()` and `RECCOUNT()` must be fresh before any expression evaluation that might use them. Add `await this.refreshRecCount()` at the start of `doIf`, `doWhile`, and `doList`. Find `doIf` (it starts with `if (this.evalExpr(node.cond))`) and wrap it:

In `doIf` (search for `private async doIf`), add at the top of the method body:

```typescript
await this.refreshRecCount();
```

In `doWhile` (search for `private async doWhile`), add at the top of the loop — inside the `while(true)` loop, before evaluating the condition:

```typescript
await this.refreshRecCount();
```

In `doList` (search for `private async doList`), add at the top:

```typescript
await this.refreshRecCount();
```

- [ ] **Step 7: Update HELP output**

In `doHelp`, add to the lines array (after the existing `DO WHILE` line):

```typescript
{ text: 'DO CASE … CASE … ENDCASE  — multi-branch conditional' },
{ text: 'EOF() BOF() FOUND()       — record position / seek state functions' },
{ text: 'RECNO() RECCOUNT()        — record number / count functions' },
{ text: 'UPPER() LOWER() TRIM()    — string functions' },
{ text: 'SUBSTR(s,n,l) LEN() AT()  — string extraction functions' },
{ text: 'STR(n,l,d) VAL() INT()    — type conversion functions' },
{ text: 'DATE() CTOD() DTOC()      — date functions' },
```

- [ ] **Step 8: Activate the todo tests and add integration tests**

In `tests/Session.test.ts`, replace the `.todo` tests from Task 3 with full implementations, and add them inside `describe('Session', ...)`:

```typescript
it('DO CASE — first matching branch executes', async () => {
  const { session, sent } = makeSession();
  const db = uniqueDb();
  await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
  await session.handleMessage({ type: 'command', text: 'CREATE TABLE t (score INTEGER)' });
  await session.handleMessage({ type: 'command', text: 'USE t' });
  await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
  await session.handleMessage({ type: 'command', text: 'REPLACE score WITH 4' });
  sent.length = 0;
  await session.handleMessage({ type: 'command', text: `DO CASE\n  CASE score > 3\n    STORE "high" TO level\n  CASE score > 1\n    STORE "mid" TO level\n  OTHERWISE\n    STORE "low" TO level\nENDCASE` });
  await session.handleMessage({ type: 'command', text: 'STORE level TO _out' });
  // Access the executor state directly to verify variable
  const exec = (session as any).executor;
  expect(exec.state.vars.get('LEVEL')).toBe('high');
});

it('DO CASE — OTHERWISE executes when no case matches', async () => {
  const { session } = makeSession();
  const db = uniqueDb();
  await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
  await session.handleMessage({ type: 'command', text: 'CREATE TABLE t2 (score INTEGER)' });
  await session.handleMessage({ type: 'command', text: 'USE t2' });
  await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
  await session.handleMessage({ type: 'command', text: 'REPLACE score WITH 0' });
  await session.handleMessage({ type: 'command', text: `DO CASE\n  CASE score > 3\n    STORE "high" TO level\n  CASE score > 1\n    STORE "mid" TO level\n  OTHERWISE\n    STORE "low" TO level\nENDCASE` });
  const exec = (session as any).executor;
  expect(exec.state.vars.get('LEVEL')).toBe('low');
});

it('DO CASE — no branch matches and no OTHERWISE is a no-op', async () => {
  const { session } = makeSession();
  const db = uniqueDb();
  await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
  await session.handleMessage({ type: 'command', text: 'CREATE TABLE t3 (score INTEGER)' });
  await session.handleMessage({ type: 'command', text: 'USE t3' });
  await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
  await session.handleMessage({ type: 'command', text: 'REPLACE score WITH 0' });
  await session.handleMessage({ type: 'command', text: 'STORE "init" TO level' });
  await session.handleMessage({ type: 'command', text: `DO CASE\n  CASE score > 3\n    STORE "high" TO level\nENDCASE` });
  const exec = (session as any).executor;
  expect(exec.state.vars.get('LEVEL')).toBe('init');
});

it('UPPER() in STORE expression', async () => {
  const { session } = makeSession();
  await session.handleMessage({ type: 'command', text: 'STORE UPPER("hello") TO result' });
  const exec = (session as any).executor;
  expect(exec.state.vars.get('RESULT')).toBe('HELLO');
});

it('SUBSTR() in STORE expression', async () => {
  const { session } = makeSession();
  await session.handleMessage({ type: 'command', text: 'STORE SUBSTR("Hello World", 7, 5) TO result' });
  const exec = (session as any).executor;
  expect(exec.state.vars.get('RESULT')).toBe('World');
});

it('LEN() in IF condition', async () => {
  const { session } = makeSession();
  await session.handleMessage({ type: 'command', text: 'STORE "hi" TO x' });
  await session.handleMessage({ type: 'command', text: 'IF LEN(x) == 2\n  STORE "yes" TO result\nENDIF' });
  const exec = (session as any).executor;
  expect(exec.state.vars.get('RESULT')).toBe('yes');
});

it('EOF() is true after SKIP past end', async () => {
  const { session } = makeSession();
  const db = uniqueDb();
  await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
  await session.handleMessage({ type: 'command', text: 'CREATE TABLE eof_t (name CHAR(10))' });
  await session.handleMessage({ type: 'command', text: 'USE eof_t' });
  await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
  await session.handleMessage({ type: 'command', text: 'GO BOTTOM' });
  await session.handleMessage({ type: 'command', text: 'SKIP 1' });
  await session.handleMessage({ type: 'command', text: 'STORE EOF() TO ateof' });
  const exec = (session as any).executor;
  expect(exec.state.vars.get('ATEOF')).toBe(true);
});

it('BOF() is true after SKIP before beginning', async () => {
  const { session } = makeSession();
  const db = uniqueDb();
  await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
  await session.handleMessage({ type: 'command', text: 'CREATE TABLE bof_t (name CHAR(10))' });
  await session.handleMessage({ type: 'command', text: 'USE bof_t' });
  await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
  await session.handleMessage({ type: 'command', text: 'GO TOP' });
  await session.handleMessage({ type: 'command', text: 'SKIP -1' });
  await session.handleMessage({ type: 'command', text: 'STORE BOF() TO atbof' });
  const exec = (session as any).executor;
  expect(exec.state.vars.get('ATBOF')).toBe(true);
});

it('FOUND() is true after successful SEEK', async () => {
  const { session } = makeSession();
  const db = uniqueDb();
  await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
  await session.handleMessage({ type: 'command', text: 'CREATE TABLE found_t (name CHAR(20))' });
  await session.handleMessage({ type: 'command', text: 'USE found_t' });
  await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
  await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Alice"' });
  await session.handleMessage({ type: 'command', text: 'INDEX ON NAME TO BYNAME' });
  await session.handleMessage({ type: 'command', text: 'SEEK "Alice"' });
  await session.handleMessage({ type: 'command', text: 'STORE FOUND() TO f' });
  const exec = (session as any).executor;
  expect(exec.state.vars.get('F')).toBe(true);
});

it('RECNO() returns current row pointer', async () => {
  const { session } = makeSession();
  const db = uniqueDb();
  await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
  await session.handleMessage({ type: 'command', text: 'CREATE TABLE recno_t (name CHAR(10))' });
  await session.handleMessage({ type: 'command', text: 'USE recno_t' });
  await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
  await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
  await session.handleMessage({ type: 'command', text: 'GO TOP' });
  await session.handleMessage({ type: 'command', text: 'STORE RECNO() TO r' });
  const exec = (session as any).executor;
  expect(exec.state.vars.get('R')).toBe(1);
});

it('RECCOUNT() returns total records', async () => {
  const { session } = makeSession();
  const db = uniqueDb();
  await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
  await session.handleMessage({ type: 'command', text: 'CREATE TABLE rc_t (name CHAR(10))' });
  await session.handleMessage({ type: 'command', text: 'USE rc_t' });
  await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
  await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
  await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
  await session.handleMessage({ type: 'command', text: 'STORE RECCOUNT() TO rc' });
  const exec = (session as any).executor;
  expect(exec.state.vars.get('RC')).toBe(3);
});

it('INDEX ON UPPER(name) sorts case-insensitively', async () => {
  const { session, sent } = makeSession();
  const db = uniqueDb();
  await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
  await session.handleMessage({ type: 'command', text: 'CREATE TABLE ci_t (name CHAR(20))' });
  await session.handleMessage({ type: 'command', text: 'USE ci_t' });
  await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
  await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "zara"' });
  await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
  await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Alice"' });
  await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
  await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "bob"' });
  await session.handleMessage({ type: 'command', text: 'INDEX ON UPPER(NAME) TO BYUPPER' });
  sent.length = 0;
  await session.handleMessage({ type: 'command', text: 'LIST' });
  const output = sent.find(m => m.type === 'output') as any;
  const lines: string[] = output.lines.map((l: any) => l.text);
  const dataLines = lines.filter(l => /alice|bob|zara/i.test(l));
  expect(dataLines[0]).toMatch(/alice/i);
  expect(dataLines[1]).toMatch(/bob/i);
  expect(dataLines[2]).toMatch(/zara/i);
});
```

- [ ] **Step 9: Run full test suite**

```bash
npm test
```

Expected: all tests pass (existing 55 + new integration tests).

- [ ] **Step 10: Commit**

```bash
git add src/interpreter/Executor.ts tests/Session.test.ts
git commit -m "feat: wire built-in functions and DO CASE into Executor with integration tests"
```

---

### Task 5: Update docs and README

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add Functions section to README command reference**

In `README.md`, add a new section after `### Control flow`:

```markdown
### Built-in functions

Functions are usable anywhere an expression is accepted — in `IF`, `DO WHILE`, `STORE`, `REPLACE`, `INDEX ON`, `SET FILTER TO`, etc.

| Function | What it does |
|---|---|
| `EOF()` | True if record pointer is past the last record |
| `BOF()` | True if record pointer is before the first record |
| `FOUND()` | True if last `SEEK` / `FIND` matched |
| `RECNO()` | Current record number |
| `RECCOUNT()` | Total records in current table |
| `UPPER(str)` | Uppercase |
| `LOWER(str)` | Lowercase |
| `TRIM(str)` | Strip leading and trailing spaces |
| `LTRIM(str)` | Strip leading spaces |
| `SUBSTR(str, start, len)` | Substring (1-based; len optional) |
| `LEN(str)` | String length |
| `AT(needle, haystack)` | 1-based position of needle; 0 if not found |
| `STR(num, len, dec)` | Number to right-justified string |
| `VAL(str)` | String to number |
| `INT(n)` | Truncate to integer |
| `ABS(n)` | Absolute value |
| `SPACE(n)` | String of n spaces |
| `REPLICATE(str, n)` | Repeat string n times |
| `DATE()` | Today as `MM/DD/YY` |
| `DTOC(date)` | Date to display string `MM/DD/YY` |
| `CTOD(str)` | Display string `MM/DD/YY` to internal ISO date |
```

Also add `DO CASE` to the Control flow table:

```markdown
| `DO CASE … CASE … ENDCASE` | Multi-branch conditional |
```

- [ ] **Step 2: Update CLAUDE.md**

In `CLAUDE.md`:

1. Under `### Control flow`, add:
```markdown
| `DO CASE … CASE … ENDCASE` | Multi-branch conditional |
```

2. Under `### Indexing & search`, add a note:
```markdown
Index expressions support built-in functions: `INDEX ON UPPER(lastname) TO BYUPPER`
```

3. Under `## Roadmap`, change item 2 from:
```markdown
2. **Language Completeness** — ...
```
to:
```markdown
2. ~~Language Completeness~~ — `DO CASE/ENDCASE`, built-in functions (`EOF()`, `BOF()`, `FOUND()`, `RECNO()`, `RECCOUNT()`, `SUBSTR()`, `STR()`, `AT()`, `CTOD()`, `DTOC()`, and more) ✅
```

- [ ] **Step 3: Run tests one final time**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: update README and CLAUDE.md for language completeness (sub-project 2)"
```
