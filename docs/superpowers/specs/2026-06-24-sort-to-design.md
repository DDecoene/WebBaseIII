# SORT TO — design (thin alias)

Issue: #8 — `SORT TO` — physically sorted copy of a table.

## Decision

`SORT` is authentic dBASE III but largely redundant in WebBase-III's SQLite model
(live indexes + `ORDER BY` already cover ordering). We implement it for dialect
fidelity / nostalgia, but **thinly** — leaning on SQLite's `CREATE TABLE … AS
SELECT … ORDER BY` rather than a faithful schema clone.

## Syntax

```
SORT ON <field>[/D] TO <newtable>
```

- Single sort key (matches the issue spec; multi-key left for later if anyone asks).
- `/D` → descending. Default ascending.

## Parser

- New `parseSort()`.
- AST node: `{ type: 'SORT'; field: string; descending: boolean; target: string }`.

## Executor — `doSort()`

1. No active table → error.
2. `<field>` not in the table's structure (`getStructure`) → error.
   (Also guards the column name against injection.)
3. `<newtable>` already exists → error (refuse to clobber; safer than dBASE's
   silent overwrite and consistent with our other commands).
4. Execute:
   `CREATE TABLE <target> AS SELECT * FROM <source> [WHERE <area.filter>] ORDER BY <field> [DESC]`
   - Honors the active `SET FILTER`.
   - Ignores any active index — SORT defines its own order (matches dBASE III).
5. Output: `Sorted N record(s) into <target>.`

## Accepted trade-off

`CREATE TABLE AS SELECT` produces a plain table: column affinities are inferred
and PK/constraints are **not** carried over. Acceptable for a sorted snapshot;
this is the explicit cost of the thin-alias approach. Noted in CHANGELOG.

## Tests (`tests/Session.test.ts`)

- Ascending order into new table.
- `/D` descending.
- Active filter honored.
- Error on missing field.
- Error on pre-existing target.

## Definition of done

- Tests pass.
- Version `0.6.2 → 0.6.3` (patch — small command addition).
- CHANGELOG entry.
- README + CLAUDE.md command tables gain a `SORT ON … TO …` row.
- Tag `v0.6.3` after the PR merges to `main`.
