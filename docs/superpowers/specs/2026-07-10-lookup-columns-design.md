# Lookup columns and field-bound GET — v1.3.0 design

Status: approved, not yet implemented
Milestone: v1.3.0
Supersedes nothing. Defers #34 (Assistant Join / Work-areas wizards) to v1.4.0.

## Problem

`demos/overtime.prg` asks the user to type a schedule id from memory:

```
@ 6, 5 SAY "Schedule ID (4): " GET m_sch
```

`SCHEDID` is a foreign key into `SCHEDULEDAYS`, but W3Script has no way to know
that. `FormLayout.ts` renders every `GET` as `input type="text"`. The BROWSE grid
validates a cell against its declared *type* (`TIME(15)`, `NUM(8,2)`) and never
against a set of legal values. The user must remember `EARL`/`LATE`/`NIGHT`, and
nothing stops them writing `EARLY`.

Three surfaces need to constrain a value to a list: form `GET` fields, BROWSE
grid cells, and the `REPLACE` / `grid-edit` write paths behind them.

## Deviations from dBASE III

This feature has no dBASE III ancestor and does not pretend to one.

dBASE III+ offered `@ ... GET var PICTURE "@M red,green,blue"`: a literal,
comma-separated list cycled with the spacebar. It had no table-driven lookup, no
display column, and no column-level declaration. `PICTURE` is a formatting
mini-language (`@!`, `@R`, `999.99`) that WebBase-III does not implement, so
borrowing its syntax would imply semantics we do not have.

`LOOKUP` as a column qualifier, `DISPLAY` for a label column, and lookup
inheritance by field-bound `GET` are all WebBase-III inventions. This is a
deliberate deviation, in the same spirit as unlimited work areas (dBASE III
capped at 10) and `alias.field` dot notation (dBASE III used `alias->field`).
It must be documented as such in `README.md` and `CLAUDE.md`, not left for a
user to infer lineage from familiar-looking keywords.

Field-bound `GET` (`GET SCHEDID` editing the current record, written back by
`READ`) *is* authentic dBASE III behavior, and replaces the memory-variable
round-trip the demos use today.

## Data model

One shape, in `src/shared/types.ts`, shared by both declaration sites:

```ts
export type Lookup =
  | { kind: 'list';  values: string[] }
  | { kind: 'table'; table: string; column: string; display?: string };
```

`ColumnTypeInfo` gains `lookup?: Lookup`.

### Single source of truth

The lookup is declared **once, on the column**. Nothing else may redeclare it.
A form `GET` bound to that column inherits it; a grid cell editing that column
inherits it; `REPLACE` into that column enforces it. There is no per-`GET`
lookup syntax, because a second declaration site is a second thing to keep in
sync, and it would drift.

A `GET` on a genuine scratch variable (a menu choice, a search term) has no
column and therefore no lookup. That is accepted: such variables are not
constrained values, they are free input.

## Syntax

```
CREATE TABLE EMPLOYEES (EMPID CHAR(4), NAME CHAR(30),
                        SCHEDID CHAR(4) LOOKUP SCHEDULES.SCHEDID DISPLAY DESCR)

CREATE TABLE DEALS (STAGE CHAR(10) LOOKUP ("lead","demo","won","lost"))
```

The `LOOKUP` clause follows the type. Two right-hand forms:

- `LOOKUP <table>.<column> [DISPLAY <column>]` — live table lookup.
- `LOOKUP ("a","b","c")` — literal list.

Both forms are parsed by one function, reused by `ALTER TABLE ADD` and
`ALTER TABLE ALTER`. `CREATE TABLE` is strict (see Test discipline in
`CLAUDE.md`): a malformed `LOOKUP` clause throws rather than being absorbed.

### Field-bound GET

```
APPEND RECORD
@ 4, 5 SAY "Employee ID: " GET EMPID
@ 5, 5 SAY "Name       : " GET NAME
@ 6, 5 SAY "Schedule   : " GET SCHEDID
READ
```

`doAtSayGet` (`Executor.ts:542`) resolves the name against the active table's
columns. A match binds the field: the form prefills from the current record and,
if the column declares a lookup, carries its resolved options. No match falls
back to a memory variable, exactly as today. This mirrors how `@ SAY` already
resolves field names inside expressions.

`READ` writes field-bound values on submit. Escape writes nothing.

## Resolution

A `table` lookup resolves server-side to:

```sql
SELECT DISTINCT <column>[, <display>] FROM <table> ORDER BY 1
```

capped at 1000 rows. A `list` lookup needs no resolution.

Resolution is performed by a new `server/LookupResolver.ts`, which takes the
database bridge and a `Lookup` and returns `{value,label}[]`. It is the only
place that reads lookup source tables.

### Degradation

If the source table or column is missing, or the query returns zero rows, the
field degrades to free text and the command emits a `warn` line. It must never
make a form unopenable or a column unwritable — a user who drops the lookup
source table must still be able to edit records.

Membership validation is skipped for a lookup that cannot be resolved, for the
same reason. An unresolvable lookup is a warning, not a lock.

## Surfaces

### Forms

`FormField` grows:

```ts
target: { kind: 'var'; name: string } | { kind: 'field'; column: string };
value: string;                              // prefill
options?: { value: string; label: string }[];
```

`FormLayout.ts:46` renders `<select>` when `options` is present, `input
type="text"` otherwise.

`Session`'s `form-submit` handler (`server/Session.ts:49`) currently calls
`executor.setVar(k, v)` for every field. It must branch on `target`: variables
still `setVar`; fields are validated (declared type *and* lookup membership) and
then written to the current record. A validation failure keeps the form open with
the offending field outlined, matching the grid's behavior.

A field-bound `GET` with no current record (`RECNO() == 0`) is an error:
`** Error: GET <field>: no current record`.

### Grid

`grid-open` already ships `columnTypes`. Those entries gain `lookup` and its
resolved `options`. `Grid.ts` opens a `<select>` rather than a text input for a
lookup column. The dropdown *is* the validation on the happy path; the server
still re-checks.

A `<select>` inside the grid's `overflow: hidden` cell is exactly the clipping
trap from #46. Its Playwright case asserts `toBeInViewport()`, and the change is
inspected in a screenshot before it is believed.

### Enforcement

`validateCellValue` in `src/shared/cellValidation.ts` grows a membership check
against the resolved option values, keeping the existing two-sided pattern: the
grid checks before commit, `Session`'s `grid-edit` handler re-checks
authoritatively.

`REPLACE` gains the same check. This is additive, not a widening of the existing
"`REPLACE` enforces only `TIME`" rule: membership is enforced only on columns
that declare a lookup, and no column in any existing program declares one. No
existing `.prg` changes behavior.

`APPEND RECORD` continues to leave new fields `NULL`, unvalidated.

## Storage

`ColumnMetaStore` gains `lookup_kind`, `lookup_table`, `lookup_col`,
`lookup_display`, and `lookup_values` (JSON array for the literal form).

The store already carries a drop-and-recreate dev migration
(`server/ColumnMetaStore.ts:38`), justified because its rows only cache what
`CREATE TABLE` re-records. The same applies here: extend that migration's column
check rather than back-filling.

The store is keyed by `(db_name, table_name, col_name)`. Per `CLAUDE.md`'s test
discipline — "when state is keyed by name, write the test that uses two" — the
new columns get a two-database test.

## Demos

`overtime.prg` gains a normalized `SCHEDULES (SCHEDID CHAR(4), DESCR CHAR(30))`
table seeded with the three shifts. `SCHEDULEDAYS` is the wrong lookup source: it
holds one row per `(SCHEDID, DOW)`, so a description there would repeat five
times per schedule.

`EMPLOYEES.SCHEDID` declares `LOOKUP SCHEDULES.SCHEDID DISPLAY DESCR`. The
Add-Employee form becomes field-bound.

### Blank-record cleanup

A field-bound `GET` needs a record to bind to, so `APPEND RECORD` must precede
`READ`. `overtime.prg` currently reads the id, checks `SEEK`/`FOUND()` for a
duplicate, and appends only if new. Inverted, a blank row exists before the
duplicate is discovered.

The program cleans up explicitly. `RECNO()` after `APPEND RECORD` gives it the
handle:

```
APPEND RECORD
STORE RECNO() TO m_new
@ 4, 5 SAY "Employee ID: " GET EMPID
@ 6, 5 SAY "Schedule   : " GET SCHEDID
READ
SEEK TRIM(EMPID)
IF FOUND() .AND. RECNO() <> m_new
  GO m_new
  DELETE
  @ 8, 5 SAY "Employee already exists"
ENDIF
```

Escape leaves the blank row untouched; the program is responsible for it. This is
accepted rather than solved — a staged insert that materializes only on submit
would invent a transaction concept W3Script does not have, and would force
`RECNO()`/`RECCOUNT()` to lie inside the form.

`crm.prg`'s deal stage becomes a literal `LOOKUP ("lead","demo","won","lost")`,
so both lookup kinds are exercised by a real demo.

`tests/DemoSchemas.test.ts:28` pins the demo column lists; `SCHEDULES` is added
and `EMPLOYEES` is unchanged (the qualifier is metadata, not a column).

## Assistant parity

Required by the Definition of Done. `TableWizard` and `ModStructWizard` gain a
per-column "Lookup…" control: pick a source table, a value column, an optional
display column, or type a literal list. A Playwright case drives the wizard and
asserts the emitted `CREATE TABLE` text.

## Testing

Per `CLAUDE.md` test discipline:

- Membership validation asserts the **exact** option list with `toEqual`, never
  `toContain` — `toContain` cannot prove a phantom option is absent.
- `ColumnMetaStore`'s new columns get a two-database test.
- Every new WS-visible shape (`FormField.target`, `columnTypes[].options`) gets a
  test that drives the message and asserts the database or UI effect.
- Playwright, in a real browser: the form picker, the grid picker (asserting
  `toBeInViewport()`), a rejected off-list `REPLACE`, and the Assistant wizard.
- `npm test` and `npx playwright test` are run **serially**, never concurrently —
  both mutate `data/`.

## Out of scope

- `#34` — Assistant Join / Work-areas wizards, and `catalog.areas`. Moved to
  v1.4.0. Unrelated code, and it would double the review surface.
- Cascading updates. Changing `SCHEDULES.SCHEDID` does not rewrite referencing
  `EMPLOYEES` rows; the lookup constrains writes, it is not a foreign-key
  constraint.
- Lookups on index expressions, report columns, or `SET FILTER` conditions.
- `PICTURE` and the rest of the dBASE formatting mini-language.
