# Language Completeness — Design Spec
**Date:** 2026-06-07
**Project:** WebBaseIII
**Sub-project:** 2 of 5 (Language Completeness)

---

## Overview

Add `DO CASE` control flow and a full set of dBASE III built-in functions to the W3Script interpreter. After this sub-project, `.prg` programs can express real application logic, and index expressions like `INDEX ON UPPER(lastname) TO BYUPPER` work correctly.

`APPEND FROM` / `COPY TO` are deliberately out of scope — DBF compatibility is off the table and SQLite-to-SQLite bulk copy belongs in its own sub-project.

---

## Expression Layer

The `Expr` union in `Parser.ts` gains one new variant:

```typescript
{ k: 'call'; fn: string; args: Expr[] }
```

### Parsing

`exprAtom` in `Parser.ts` already handles bare identifiers. The change: when the current token is an identifier (or keyword that is also a function name) **and** the next token is `(`, parse a function call:

1. Consume the identifier and `(`
2. Collect comma-separated `expr()` calls until `)`
3. Return `{ k: 'call', fn: name.toUpperCase(), args }`

Identifiers not followed by `(` remain `{ k: 'var', name }` as today.

Function names are already uppercased by the Lexer, so `substr` and `SUBSTR` are the same token.

### Evaluation

`evalExpr` in `Executor.ts` gets a new branch:

```typescript
case 'call': {
  const args = e.args.map(a => this.evalExpr(a));
  return this.callBuiltin(e.fn, args);
}
```

`callBuiltin` dispatches on `fn`. Stateless functions delegate to `Builtins.ts`. Stateful functions are handled inline. Unknown name → throws `"Unknown function: ${fn}"`.

---

## Built-in Functions

### Stateless — `src/interpreter/Builtins.ts`

Pure functions. No interpreter state needed. Exported as a single `callStateless(fn, args)` function that throws on unknown name so the caller can distinguish stateless-unknown from stateful.

| Function | Signature | Behavior |
|---|---|---|
| `SUBSTR` | `(str, start, len?)` | 1-based substring; len omitted → to end of string |
| `LEN` | `(str)` | character count |
| `TRIM` | `(str)` | strip leading + trailing whitespace |
| `LTRIM` | `(str)` | strip leading whitespace only |
| `UPPER` | `(str)` | uppercase |
| `LOWER` | `(str)` | lowercase |
| `AT` | `(needle, haystack)` | 1-based position of first occurrence; 0 if not found |
| `STR` | `(num, len?, dec?)` | number → right-justified string; len default 10, dec default 0 |
| `VAL` | `(str)` | string → number (parseFloat; NaN → 0) |
| `INT` | `(n)` | truncate toward zero |
| `ABS` | `(n)` | absolute value |
| `SPACE` | `(n)` | string of n spaces |
| `REPLICATE` | `(str, n)` | repeat str n times |
| `DATE` | `()` | today as `"MM/DD/YY"` |
| `DTOC` | `(date)` | date string (any format) → `"MM/DD/YY"` |
| `CTOD` | `(str)` | `"MM/DD/YY"` → ISO date string `"YYYY-MM-DD"` (internal storage format) |

### Stateful — inline in `Executor.callBuiltin`

These require `this.state` and are evaluated directly in the Executor.

| Function | Behavior |
|---|---|
| `EOF()` | `true` if `rowPtr` > total record count (or no table open → `true`) |
| `BOF()` | `true` if `rowPtr` < 1 |
| `FOUND()` | `true` if last `SEEK` / `FIND` matched (`this.state._found`) |
| `RECNO()` | current `rowPtr` value |
| `RECCOUNT()` | total records in current table (0 if no table open) |

`EOF()` and `RECCOUNT()` require an async DB call. `evalExpr` is currently synchronous. These two functions must be pre-resolved before expression evaluation — see **Async Consideration** below.

---

## Async Consideration

`evalExpr` is synchronous. `EOF()` and `RECCOUNT()` need the row count from the DB, which is async.

**Solution:** For any statement that may evaluate an expression containing `EOF()` or `RECCOUNT()` (i.e. `IF`, `DO WHILE`, `STORE`, `REPLACE`, filter expressions), resolve the row count once before evaluating and cache it on `this.state.cachedRecCount`. Update the cache at the start of `doIf`, `doWhile`, and `doReplaceAll`. This is acceptable because record count changes only on `APPEND`, `DELETE`, and `PACK` — all of which already update state.

`RECNO()`, `BOF()`, and `FOUND()` are synchronous (they read `this.state` fields only).

---

## DO CASE

### Syntax

```
DO CASE
  CASE <expr>
    <statements>
  CASE <expr>
    <statements>
  [OTHERWISE
    <statements>]
ENDCASE
```

### AST Node

```typescript
{
  type: 'DO_CASE';
  cases: Array<{ cond: Expr; body: ASTNode[] }>;
  otherwise: ASTNode[];   // empty array if no OTHERWISE clause
}
```

### Parsing

Added to `stmt()` switch on keyword `DO` with next token `CASE`. The parser:

1. Consumes `DO CASE`
2. Loops collecting `CASE <expr> <body>` blocks until `OTHERWISE` or `ENDCASE`
3. If `OTHERWISE` found, collects body until `ENDCASE`
4. Returns the `DO_CASE` node

### Execution

`doCase` evaluates `cond` for each case in order. On the first truthy result, executes that body and returns — no fall-through. If no case matches and `otherwise` is non-empty, executes the otherwise body.

---

## Lexer Changes

Add to keyword set:
```
'CASE', 'OTHERWISE', 'ENDCASE',
'SUBSTR', 'LEN', 'TRIM', 'LTRIM', 'UPPER', 'LOWER', 'AT',
'STR', 'VAL', 'INT', 'ABS', 'SPACE', 'REPLICATE',
'DATE', 'DTOC', 'CTOD',
'EOF', 'BOF', 'FOUND', 'RECNO', 'RECCOUNT'
```

Function names are keywords so the Lexer uppercases them correctly and they don't collide with field/variable names.

---

## Files Changed

| File | Change |
|---|---|
| `src/interpreter/Lexer.ts` | Add function names + `CASE`, `OTHERWISE`, `ENDCASE` to keyword set |
| `src/interpreter/Parser.ts` | Add `call` to `Expr` union; extend `exprAtom` for function calls; add `DO_CASE` to `ASTNode`; parse `DO CASE` block |
| `src/interpreter/Executor.ts` | Add `cachedRecCount` to state; add `callBuiltin`; add stateful function handling; add `doCase`; update `HELP` |
| `src/interpreter/Builtins.ts` | **New file** — stateless built-in function implementations |
| `tests/Builtins.test.ts` | **New file** — unit tests for every stateless function |
| `tests/Session.test.ts` | Extend — `DO CASE` branching, `EOF()`/`BOF()`/`FOUND()`/`RECNO()`/`RECCOUNT()` integration tests, `INDEX ON UPPER(x) TO tag` |

---

## Testing

### Builtins.test.ts (unit, no DB)

Every stateless function tested with:
- Normal input
- Edge cases: empty string, zero, negative, out-of-range start/len for SUBSTR

Examples:
```typescript
SUBSTR("Hello", 2, 3)  → "ell"
SUBSTR("Hello", 4)     → "lo"
AT("lo", "Hello")      → 4
STR(3.14159, 8, 2)     → "    3.14"
VAL("42abc")           → 42
VAL("abc")             → 0
DATE()                 → matches /^\d\d\/\d\d\/\d\d$/
```

### Session.test.ts (integration)

```
DO CASE
  CASE score > 3
    STORE "high" TO level
  CASE score > 1
    STORE "mid" TO level
  OTHERWISE
    STORE "low" TO level
ENDCASE
```
→ correct branch taken for score = 4, 2, 0

```
GO BOTTOM
SKIP
EOF()  → true
BOF()  → false

GO TOP
SKIP -1
BOF()  → true
EOF()  → false

SEEK "Alice"
FOUND()  → true
RECNO()  → 3   (Alice is 3rd in index order)

INDEX ON UPPER(lastname) TO BYUPPER
LIST  → case-insensitive alphabetical order
```

---

## Error Handling

| Situation | Error |
|---|---|
| Unknown function name | `"Unknown function: FOO"` |
| Wrong argument count | `"FOO() requires N argument(s)"` |
| Wrong argument type | `"FOO() argument 1 must be a string"` |
| `SUBSTR` start < 1 | Clamp to 1 (dBASE III behavior) |
| `STR` num too wide for len | Fill with `*` characters (dBASE III behavior) |

---

## Out of Scope

- `APPEND FROM` / `COPY TO` — deferred to a later sub-project
- User-defined functions (`FUNCTION` / `RETURN`) — sub-project 2 language only, not UDFs
- `ISNULL()`, `TYPE()`, `IIF()` — not in dBASE III core; can be added later
