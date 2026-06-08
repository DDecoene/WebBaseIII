# Multi-Work-Area Design

**Date:** 2026-06-08  
**Status:** Approved  
**Version target:** v0.4.0

---

## Overview

Multi-Work-Area allows multiple tables to be open simultaneously in independent "work areas", each with its own record pointer, active index, and filter. Tables in different areas can be linked by key expressions using `SET RELATION TO`, enabling relational data access (e.g. orders linked to customers, customers linked to postcodes).

### Deliberate improvements over dBASE III

| dBASE III | WebBase-III | Reason |
|---|---|---|
| Maximum 10 work areas (DOS file handle limit) | Unlimited work areas | No OS-level file handle constraint on a modern web stack |
| `alias->field` arrow syntax | `alias.field` dot syntax | Conventional modern notation; less visual noise |

Both differences are intentional and should be documented prominently in the README and CLAUDE.md command reference.

---

## Data Model

The current `State` interface (one flat object on `Executor`) is refactored into a `WorkArea` type. The `Executor` holds a `Map<string, WorkArea>` keyed by alias, plus a pointer to the active alias.

```typescript
export interface WorkArea {
  alias: string;           // e.g. "customers", "orders", "1"
  db: string | null;
  table: string | null;
  filter: string | null;
  rowPtr: number;          // 1-based; 0 = no current record / no match
  cachedRecCount: number;
  activeIndex: { tag: string; expression: string } | null;
  _found: boolean;
  opfsAvailable: boolean;
  relation: {
    expression: string;    // key expr evaluated in this area's context
    intoAlias: string;     // alias of the area to seek
  } | null;
}
```

**Session-global state** (not per-area): `vars: Map<string, unknown>` and `pendingForm: FormField[]` remain flat properties on `Executor`.

**Active area**: `Executor` exposes a `get area(): WorkArea` convenience getter that returns `this.areas.get(this.activeAlias)!`.

**Default area**: On construction, a single area with alias `"1"` is created and set active. This preserves backwards compatibility — all existing single-table commands work unchanged.

---

## New Commands

### Work area management

```
SELECT <alias>
```
Activates the named work area. Creates it (empty) if it does not exist. `<alias>` is a string — both `SELECT 1` and `SELECT customers` are valid.

```
USE <table> [ALIAS <name>]
```
Opens `<table>` in the active work area. The optional `ALIAS` clause overrides the area's alias key (useful when the same table is open in two areas: `USE customers ALIAS cust2`).

```
CLOSE
```
Closes the active area's table (sets `table`, `rowPtr`, index, relation to null). Area slot remains.

```
CLOSE ALL
```
Closes all work areas and resets to a single empty area `"1"`.

### Relations

```
SET RELATION TO <expr> INTO <alias>
```
Links the active area to `<alias>`: whenever the active area's record pointer moves, the interpreter evaluates `<expr>` in the active area's row context and seeks `<alias>`'s active index for that value.

Preconditions (both checked at `SET RELATION TO` time, not lazily):
- `<alias>` must be an open work area with a table loaded.
- `<alias>` must have an active index (`SET INDEX TO` must have been called).
- Circular relations are rejected: if A→B already exists, `SET RELATION TO ... INTO A` from B is an error.

```
SET RELATION TO
```
Clears the relation on the active area.

### Listing

```
LIST [<field>, <alias>.<field>, ...]
```
Without arguments: lists all fields of the active area (existing behaviour).  
With arguments: lists the named columns only; `alias.field` pulls from the named work area's current row at the time each record is printed.

```
LIST AREAS
```
Prints a summary of all open work areas: alias, db, table, record pointer, active index, and relation.

---

## Architecture

### Files changed

**`src/interpreter/Executor.ts`**
- `state: State` → `areas: Map<string, WorkArea>`, `activeAlias: string`
- `vars` and `pendingForm` remain as flat `Executor` properties
- All existing commands updated from `this.state.xxx` to `this.area.xxx`
- After any navigation command (`GO`, `SKIP`, `SEEK`, `FIND`, `APPEND RECORD`), call `this.workAreaManager.resolveRelations(this.areas, this.activeAlias, this.db)`
- `doSelect()`, `doClose()`, `doCloseAll()`, `doSetRelation()`, `doListAreas()` added
- `doUse()` gains optional `ALIAS` clause parsing
- `doList()` gains optional column-list parsing with `alias.field` support

**`server/WorkAreaManager.ts`** *(new)*  
Pure helper class, no I/O:
- `resolveRelations(areas, movedAlias, db)` — finds all areas with `relation.intoAlias === movedAlias`, evaluates the key expression, seeks the target area
- `resolveField(alias, field, areas, db)` — fetches current row of named area, returns field value (null if rowPtr === 0)
- `detectCircular(areas, fromAlias, intoAlias)` — returns true if adding this relation would create a cycle

**`src/shared/types.ts`**
- `State` interface replaced by `WorkArea` interface (exported)
- `IIndexStore` unchanged

**`server/Session.ts`**
- No structural changes
- `sendStatus()` reports active area's db/table/record

**`server/ServerDatabaseBridge.ts`**
- No changes

### Expression evaluator — `alias.field` resolution

When the evaluator encounters a dotted identifier, it:

1. Splits on the first `.`: `alias = "customers"`, `field = "city"`
2. Calls `WorkAreaManager.resolveField(alias, field, this.areas, this.db)`
3. If the area is not found: throws `Unknown work area: 'customers'`
4. If `area.rowPtr === 0`: returns `null` (no match from relation seek)
5. Otherwise: fetches the row at `rowPtr` and returns the named field value

**Row fetch caching**: within a single `LIST` evaluation pass, the current row per area is cached keyed by `rowPtr` and invalidated on any navigation. This prevents N×M queries when listing large tables with relations.

**Ambiguity rule**: unqualified identifiers always resolve to the active area's fields first, then `vars`. The dotted form is the only way to reference other areas.

### Relation auto-seek mechanics

`resolveRelations()` runs after every navigation in the active area:

1. Find all work areas where `relation.intoAlias === activeAlias`
2. Evaluate `relation.expression` in active area's current row context
3. Seek the related area's active index for that value
4. On no match: set `rowPtr = 0`, `_found = false` — all fields return null/empty
5. **No cascading in v1**: if A→B and B→C, moving A seeks B but does not cascade to C. Cascading can be added in a future version.

---

## Command Reference (README additions)

### Work areas

| Command | What it does |
|---|---|
| `SELECT <alias>` | Activate (or create) a work area by name |
| `USE <table> [ALIAS <name>]` | Open table in active area; optional alias override |
| `SET RELATION TO <expr> INTO <alias>` | Link active area to another by key expression |
| `SET RELATION TO` | Clear relation on active area |
| `LIST [col, alias.col, ...]` | List records; optional explicit column list with cross-area fields |
| `LIST AREAS` | Show all open work areas and their relations |
| `CLOSE` | Close active area's table |
| `CLOSE ALL` | Close all work areas |

**Cross-area field access**: use `alias.field` dot notation anywhere an expression is accepted — `SET FILTER TO`, `IF`, `REPLACE`, `LIST`, `INDEX ON`.

> **Note:** dBASE III supported a maximum of 10 work areas due to DOS file handle limits. WebBase-III supports unlimited work areas. dBASE III used `alias->field` arrow syntax; WebBase-III uses modern `alias.field` dot notation.

---

## Testing Plan

### Unit tests — `tests/WorkArea.test.ts` (new)
- `SELECT` creates a new work area slot
- `SELECT` switches active area without disturbing others
- `USE` opens table in active area only
- `SET RELATION TO` wires relation metadata correctly
- `SET RELATION TO` with no index on target → error
- `SET RELATION TO` circular detection → error
- `alias.field` resolves from correct area's current row
- `alias.field` returns null/empty when `rowPtr = 0`
- `resolveRelations()` seeks related area on navigation
- `CLOSE ALL` resets all areas to single empty slot `"1"`

### Integration tests — `tests/Session.test.ts` (additions)
- Full postcodes→customers link: navigating postcodes auto-seeks customers
- Full orders→customers link: `LIST` with `customers.name` shows joined output
- Navigation (`SKIP`, `GO TOP`) triggers relation seek
- `SET RELATION TO` (clear) stops auto-seek
- `LIST AREAS` output reflects open areas

### E2E Playwright — `tests/multiarea.spec.ts` (new)
- Postcode lookup scenario: open postcodes + customers, link them, BROWSE customers shows city from postcodes
- Order browser: LIST orders.*, customers.name side by side
- BROWSE active area while relation is live — grid shows cross-area column

---

## Definition of Done

- All tests pass (`npm test` + `npx playwright test`)
- README.md command table updated (work areas section + modernisation note)
- CLAUDE.md updated (commands, architecture, roadmap item checked off)
- Version bumped to `0.4.0`
- `docs/superpowers/specs/` spec committed
