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

**Fields shadow memory variables.** If the active table has a column with the
GET's name, the field wins — even when a memory variable of that name already
exists. The alternative, letting an earlier `STORE` change what a `GET` means,
would make the binding depend on execution history. Field-over-memvar
precedence is also what dBASE III did; the community's universal `m_` prefix
convention exists because of it, and every `GET` in the demos already follows
that convention (audited against the golden schemas — no demo GET name collides
with a column). README documents the rule as a behavior change for programs
that `GET` a variable whose name matches a column of the table in use.

At `READ`, each field-bound `GET` resolves its record once — the alias captured
at declaration, its current record via the `fetchCurrentRow` path — and keeps
the SQLite `rowid`. `form-submit` writes by that rowid, exactly as `grid-edit`
already does, so pointer motion between `READ` and submit cannot retarget the
write.

## Resolution

A `table` lookup resolves server-side to:

```sql
SELECT DISTINCT <column>[, <display>] FROM <table> ORDER BY 1
```

with a 1000-distinct-value ceiling. A `list` lookup needs no resolution.

Resolution is performed by a new `server/LookupResolver.ts`, which takes the
database bridge and a `Lookup` and returns `{value,label}[]`. It is the only
place that reads lookup source tables.

### Degradation

If the source table or column is missing, the query returns zero rows, or the
source exceeds the 1000-value ceiling, the field degrades to free text and the
command emits a `warn` line. It must never make a form unopenable or a column
unwritable — a user who drops the lookup source table must still be able to
edit records.

The ceiling degrades, never truncates. A clipped option list would be worse
than none: the dropdown would hide legal values while membership validation
rejected them.

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
written to their captured rowids. Validation is all-or-nothing — every value is
checked before any is written, so a mid-form failure cannot leave half a record
behind. Targets come from the field list the Session retained at `READ`, never
from the client's message, so a forged `form-submit` cannot redirect a write to
an arbitrary column — the same reasoning that makes `grid-edit` re-check
server-side. A rejection is reported with a new `form-error` server message
naming the offending fields and reasons; the client keeps the form open and
outlines them, matching the grid's behavior.

A field-bound `GET` with no current record (`RECNO() == 0`) is an error:
`** Error: GET <field>: no current record`.

### Grid

`grid-open` already ships `columnTypes`. Those entries gain `lookup` and its
resolved `options`. `Grid.ts` opens a `<select>` rather than a text input for a
lookup column. The dropdown *is* the validation on the happy path; the server
still re-checks.

Outside edit mode the cell shows the stored value, matching `LIST` and report
output; only the edit dropdown shows `display` labels. Labels in static cells
would make the grid disagree with every other surface that prints the column.

A `<select>` inside the grid's `overflow: hidden` cell is exactly the clipping
trap from #46. Its Playwright case asserts `toBeInViewport()`, and the change is
inspected in a screenshot before it is believed.

### Enforcement

`validateCellValue` in `src/shared/cellValidation.ts` grows a membership check
against the resolved option values, keeping the existing two-sided pattern: the
grid checks before commit, `Session`'s `grid-edit` handler re-checks
authoritatively.

Membership is an exact, case-sensitive string comparison against the stored
value. The server re-resolves a `table` lookup at write time rather than
reusing a list resolved at `grid-open` or `READ`, so a value that became legal
after the client's list was built is accepted, and one that vanished is
rejected.

`REPLACE` gains the same check. This is additive, not a widening of the existing
"`REPLACE` enforces only `TIME`" rule: membership is enforced only on columns
that declare a lookup, and no column in any existing program declares one. No
existing `.prg` changes behavior.

`APPEND RECORD` continues to leave new fields `NULL`, unvalidated.

## Storage

`ColumnMetaStore` gains `lookup_kind`, `lookup_table`, `lookup_col`,
`lookup_display`, and `lookup_values` (JSON array for the literal form).

The store's existing drop-and-recreate migration (`server/ColumnMetaStore.ts:38`)
must **not** be extended to cover the new columns. It was justified as
pre-release schema churn; v1.2.0 has since shipped, and a v1.2.0 store passes
the existing check (it has `db_name` and `scale`) — widening the check to also
require a lookup column would drop `column_types` on every released user's
first v1.3.0 start, silently erasing their declared types: `TIME(15)` and
`NUM(p,s)` validation would stop until each table was re-created. The new
columns arrive additively — `ALTER TABLE column_types ADD COLUMN …` for each
one missing — preserving existing rows. Fresh installs get the full schema from
the constructor's `CREATE TABLE IF NOT EXISTS`.

The store is keyed by `(db_name, table_name, col_name)`. Per `CLAUDE.md`'s test
discipline — "when state is keyed by name, write the test that uses two" — the
new columns get a two-database test.

## Demos

`overtime.prg` gains a normalized `SCHEDULES (SCHEDID CHAR(4), DESCR CHAR(30))`
table seeded with the three shifts. `SCHEDULEDAYS` is the wrong lookup source: it
holds one row per `(SCHEDID, DOW)`, so a description there would repeat five
times per schedule.

`EMPLOYEES.SCHEDID` declares `LOOKUP SCHEDULES.SCHEDID DISPLAY DESCR`. The
Add-Employee flow becomes field-bound for `NAME` and `SCHEDID`; the id stays a
memory variable (see Blank-record cleanup).

### Blank-record cleanup

A field-bound `GET` needs a record to bind to, so `APPEND RECORD` must precede
`READ`. `overtime.prg` currently reads the id, checks `SEEK`/`FOUND()` for a
duplicate, and appends only if new. Inverted, a blank row exists before the
duplicate is discovered.

The program owns the cleanup; no staged-insert machinery is added, because a
record that materializes only on submit would invent a transaction concept
W3Script does not have and would force `RECNO()`/`RECCOUNT()` to lie inside the
form.

The obvious single-form shape — capture `RECNO()` after `APPEND RECORD`, `GO`
back and `DELETE` on a duplicate — does not survive this codebase's pointer
semantics. `RECNO()` is a position in active-index order, and writing the key
field moves the new record within `BYEMP`, so the captured position goes stale;
and once two records share a key, `SEEK` cannot tell the new one from the old.
`overtime.prg` therefore keeps its check-first order and splits the entry into
two forms, appending only once the id is known to be new:

```
@ 4, 5 SAY "Employee ID (4): " GET m_emp
READ
SET INDEX TO BYEMP
SEEK TRIM(m_emp)
IF FOUND()
  @ 8, 5 SAY "Employee already exists: " + TRIM(m_emp)
ELSE
  SET INDEX TO
  APPEND RECORD
  REPLACE EMPID WITH TRIM(m_emp)
  @ 5, 5 SAY "Name    : " GET NAME
  @ 6, 5 SAY "Schedule: " GET SCHEDID
  READ
  SET INDEX TO BYEMP
ENDIF
```

The id stays a memory-variable `GET` — it is a search term until the record
exists. The create runs in natural order (`SET INDEX TO`) so writing the key
cannot move the new record out from under the form. `NAME` and `SCHEDID` are
field-bound, and `SCHEDID`'s picker comes from the column's lookup. Escaping
the second form leaves a record holding only its id; the program accepts that,
as chosen.

`crm.prg`'s deal stage becomes a literal
`LOOKUP ("Lead","Qualified","Proposal","Won","Lost")` — the exact strings the
demo already seeds and compares (`SUM VALUE FOR STAGE == "Won"`), since
membership is case-sensitive. Both lookup kinds are thereby exercised by a
real demo.

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
- Every new WS-visible shape (`FormField.target`, `columnTypes[].options`, the
  `form-error` message) gets a test that drives the message and asserts the
  database or UI effect — including a forged `form-submit` naming a column the
  form never offered.
- Playwright, in a real browser: the form picker, the grid picker (asserting
  `toBeInViewport()`), a rejected off-list `REPLACE`, and the Assistant wizard.
- `tests/overtime.spec.ts` is changed, not only extended — the Add-Employee flow
  it drives becomes two forms with a field-bound select.
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
