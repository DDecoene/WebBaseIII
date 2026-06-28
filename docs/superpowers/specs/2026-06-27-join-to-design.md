# JOIN ... TO &lt;file&gt; — materialize a combined table (#10)

**Status:** design approved
**Milestone:** v1.1.0 — beyond parity
**Date:** 2026-06-27

## Problem

`SET RELATION` already covers the **live** combine case: as the active area's
pointer moves, the related record auto-seeks and `alias.field` displays the
linked values. What's missing is the **materialize** half — writing a combined,
named dataset to disk that you can then `BROWSE`, `INDEX ON`, `REPORT FORM`, or
`COPY TO`. Classic dBASE III did this with `JOIN WITH ... TO <file>`.

## Decisions

- **Modern engine, legacy syntax.** The join is computed by SQLite's query
  planner (a real SQL `JOIN`), not the historical O(n×m) nested loop. Behaviour
  is the same snapshot result; the engine is faster.
- **Result is a snapshot table**, not a view. `CREATE TABLE <file> AS SELECT …`.
  A frozen, named, **editable / indexable / reportable** artifact — the thing
  `SET RELATION` (live, read-only link) cannot give you. Staleness is the point:
  point-in-time reporting snapshots, archives, exports, pipeline work files.
- **`FOR` is required.** A SQL predicate over both areas. Prevents accidental
  giant cross products. (dBASE allowed omitting `FOR` → cross product; we don't.)
- **`FOR` / `FIELDS` use `alias.field` dot syntax** (our convention, consistent
  with cross-area display and `SET FILTER` passthrough), not dBASE's
  `alias->field` arrow.
- **Default projection (FIELDS omitted): active wins.** All active-area columns,
  then all alias columns; on a name clash the alias's duplicate is dropped and a
  **visible warning** is printed. (dBASE dropped it silently.)
- **Same-database only (v1).** Both areas must resolve to the same SQLite file;
  cross-database joins error clearly rather than attempting attach gymnastics.

## Syntax

```
JOIN WITH <alias> TO <file> FOR <condition> [FIELDS <field-list>]
```

- `<alias>` — an open work area that has a table (else error).
- `<file>` — target table name; **error if it already exists** (mirrors `SORT`).
- `FOR <condition>` — **required** SQL predicate, e.g. `custno = orders.custno`.
- `FIELDS <list>` — optional projection, e.g. `name, city, orders.amount`.

Example:

```
SELECT ORD
USE orders
SELECT 1
USE customers
JOIN WITH ORD TO custordr FOR custno = ORD.custno FIELDS name, city, ORD.amount
USE custordr
LIST
```

## Architecture (follows the `SORT` precedent — Executor.ts:745)

- **Parser** (`src/interpreter/Parser.ts`): new AST node
  `{ type: 'JOIN'; withAlias: string; target: string; forCond: string; fields: string[] | null }`,
  parsed in the command `switch` (alongside `SORT`/`COPY`). `FOR` clause text is
  captured raw (passthrough), `FIELDS` as a list of `alias.field` / `field` tokens.
- **Executor** `doJoin(...)`:
  1. Validate: active area has a table; `withAlias` area exists and has a table;
     target table does not already exist; both tables in the same database.
  2. Build the projection. Default = active columns + non-clashing alias columns;
     warn for each dropped duplicate. Explicit `FIELDS` = translate each token,
     mapping `alias.field` → `<sqlAlias>.<field>`.
  3. Register SQL table aliases matching the work-area aliases so `alias.field`
     in `FOR`/`FIELDS` translates directly. Active area gets its own alias.
  4. Run `CREATE TABLE <target> AS SELECT <projection> FROM <active> a JOIN
     <aliasTable> b ON (<for>)`, honouring the active area's filter (as `SORT` does).
  5. Report `Joined N record(s) into <file>.`

## Deviations from dBASE III (must be surfaced to users)

Ship this list in user-facing docs (README note + `HELP` line + CHANGELOG),
not just a code comment:

1. **`FOR` is required** — dBASE allowed omitting it (which produced a cross
   product); we error instead.
2. **`alias.field` dot syntax**, not `alias->field` arrow.
3. **`FOR` is SQL-predicate semantics** (passed through like `SET FILTER`), not
   the dBASE expression dialect.
4. **Join computed by SQLite's planner**, not the O(n×m) nested loop.
5. **Collisions: active wins + a visible warning** — dBASE dropped the duplicate
   silently.
6. **No dBASE structural limits** (no 128-field cap, no 10-char field names).

## Errors / edges

- No active table → error.
- `withAlias` not open / has no table → error.
- Target table already exists → error (no overwrite).
- Cross-database areas → error.
- Empty result set → table still created, reports `0 record(s)`.

## Testing (Definition of Done)

- **Vitest** `tests/Join.test.ts`: equi-join two seeded tables → row count and
  combined columns; default-projection collision drop + warning; explicit
  `FIELDS`; `FOR` filtering correctness; target-exists error; missing-`FOR`
  parse/exec error; cross-database error.
- **Playwright** `tests/join.spec.ts` (mirrors `tests/multiarea.spec.ts`): open
  two areas, run `JOIN`, then `USE`/`LIST` the new table and assert a combined
  column renders in the terminal.

## Docs to update

- `README.md` — command table row + Deviations note.
- `CLAUDE.md` — Indexing & search / data command table + roadmap.
- `CHANGELOG.md` — Added entry under v1.1.0.
- `HELP` output — one line.

## Out of scope

- Cross-database joins (attach).
- Live/view variant (covered by `SET RELATION`).

> Note: `alias->field` arrow syntax does not exist anywhere in the codebase
> today and is **not** being added — WebBase-III uses `alias.field` dot syntax
> exclusively (see Deviation #2).
