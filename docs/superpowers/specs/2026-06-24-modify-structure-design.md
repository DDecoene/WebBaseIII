# MODIFY STRUCTURE — alter an existing table

**Issue:** #6 (milestone v1.0.0)
**Date:** 2026-06-24

## Problem

There is no way to add, rename, drop, or retype a column on an existing table
short of `DROP TABLE` + `CREATE TABLE` (which destroys all data). dBASE III had
`MODIFY STRUCTURE` — a full-screen schema editor. WebBase-III needs an
equivalent: both a scriptable command family and an Assistant wizard.

## Scope

- Operations: **ADD**, **DROP**, **RENAME**, and **type change** of a column.
- Two layers: a plain-command fallback (`ALTER TABLE …`) and an Assistant
  wizard (`MODIFY STRUCTURE` / sidebar action).

## Command grammar

dBASE III's `MODIFY STRUCTURE` was purely interactive, so the scriptable layer
borrows SQL-flavoured syntax:

| Command | Effect |
|---|---|
| `MODIFY STRUCTURE` | Open the structure wizard for the table currently in `USE` |
| `ALTER TABLE <name> ADD <col> <type>` | Add a column |
| `ALTER TABLE <name> DROP <col>` | Drop a column |
| `ALTER TABLE <name> RENAME <old> TO <new>` | Rename a column |
| `ALTER TABLE <name> ALTER <col> <type>` | Change a column's type (copy-table dance) |

`<type>` reuses the existing `CREATE TABLE` type grammar (`CHAR(n)`, `NUM(n)`,
`INT`, `DATE`, `LOGICAL`, `MEMO`) and `mapType()`. The parser reuses the
existing `ColDef` machinery for the single-column type clause.

## Parser

- New AST nodes: `MODIFY_STRUCTURE` (no args) and `ALTER_TABLE` with a
  discriminated `op` field: `{ op: 'ADD'|'ALTER', name, col, colType }`,
  `{ op: 'DROP', name, col }`, `{ op: 'RENAME', name, col, newName }`.
- `MODIFY` already branches on the next keyword (`REPORT`); add a `STRUCTURE`
  branch.
- `ALTER` is a new top-level keyword → expects `TABLE <name>` then one of
  `ADD | DROP | RENAME | ALTER`.

## Executor

`doAlterTable(node)` dispatches on `op`:

- **ADD** → `ALTER TABLE q(name) ADD COLUMN q(col) mapType(type)` (native).
- **DROP** → `ALTER TABLE q(name) DROP COLUMN q(col)` (native, SQLite 3.35+;
  our better-sqlite3 is 12.x → SQLite well past 3.35).
- **RENAME** → `ALTER TABLE q(name) RENAME COLUMN q(old) TO q(new)` (native).
- **ALTER (type change)** → copy-table dance in a transaction:
  1. `ALTER TABLE t RENAME TO __t_old`
  2. `CREATE TABLE t (… full new schema, changed col retyped …)`
  3. `INSERT INTO t SELECT … (CAST changed col) … FROM __t_old`
  4. `DROP TABLE __t_old`

Cross-cutting:
- Validate the table exists; validate the column exists (DROP/RENAME/ALTER) or
  does **not** already exist (ADD / RENAME target).
- DROP, RENAME, and type-change can invalidate index expressions. Safest
  behaviour: drop affected indexes (via `indexStore` metadata + SQLite) and emit
  a warning line listing what was dropped, instructing the user to re-`INDEX ON`.
  - "Affected" = any index whose expression text references the column name
    (case-insensitive substring match on the column identifier). For the
    type-change dance, all indexes on the table are dropped (the table is
    recreated).
- Refresh the active area's cached structure / record count if the altered
  table is the one in `USE`.
- `MODIFY STRUCTURE` with no table in `USE` → error line.

## Wizard — `src/ui/wizards/ModStructWizard.ts`

Mirrors `TableWizard`'s grid UI.

- Opened by the `MODIFY STRUCTURE` command (server tells client to open it — or,
  simpler, the command is terminal-only and the wizard is reached via the
  sidebar; see Open paths) and by a new Assistant action.
- New `WizardName` member `'modstruct'`; dispatcher case in `wizards/index.ts`.
- Reads the chosen table's current columns from `getCatalog().columns`.
- Pre-fills one editable row per existing column (name / type / len), each
  tagged with its original name so renames and type changes can be detected.
- A row can be: edited in place (rename / retype), marked for deletion, or
  appended (new column).
- On OK, **diff** original vs. edited rows and emit the minimal sequence of
  `ALTER TABLE` commands (one per change), run in order.
- Live preview pane shows the generated command list (reuses `WizardShell`
  preview).

### Open paths

- **Sidebar:** new action under the table category —
  `{ label: 'Modify structure…', needs: 'table', picker: 'tables',
  onPick: (n, h) => { h.run('USE ' + n); h.openWizard('modstruct', n); } }`.
  Running `USE` first makes the picked table active so the catalog carries its
  columns.
- **Command:** `MODIFY STRUCTURE` from the terminal opens the wizard for the
  active table. Implemented by the server emitting an `open-wizard` directive
  for the client (same mechanism other wizard-opening flows use), or — if no
  such mechanism exists — `MODIFY STRUCTURE` prints guidance to use the sidebar
  and the wizard ships sidebar-only. **Decision: prefer the command opening the
  wizard;** verify the client open-wizard channel during implementation and fall
  back to sidebar-only if none exists, recorded as a deviation.

## Testing

- `tests/AlterTable.test.ts` (Vitest): ADD / DROP / RENAME / type-change
  round-trips; data preserved across type change; index-drop warnings; error
  cases (no such table, no such column, duplicate column, no table in USE).
- `tests/assistant.spec.ts` (Playwright): open the modify-structure wizard,
  rename a column, add a column, drop a column, confirm emitted commands and
  resulting structure.

## Definition of done

1. `npm test` green.
2. Version bump — minor (roadmap 1.0.0-track feature); tag `vX.Y.Z`.
3. CHANGELOG entry (Added).
4. README command tables (Data & navigation / indexing notes / wizard list).
5. CLAUDE.md command tables + wizard list + roadmap note.
6. Screenshot of the wizard if UI is committed to `docs/screenshots/`.

## Non-goals

- Reordering columns (SQLite has no native column reorder; out of scope).
- Multi-operation single `ALTER TABLE` statements (one op per command; the
  wizard emits a sequence).
