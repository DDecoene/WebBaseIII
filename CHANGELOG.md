# Changelog

All notable changes to WebBase-III are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/) — minor bump per sub-project, patch for fixes, 1.0.0 when feature-complete.

---

## [0.5.3] — 2026-06-10

### Fixed
- **`DO CASE` branches now resume after `READ`/`INPUT`/`BROWSE`** — statements following a suspending command inside a `CASE` branch were silently dropped (the branch runner didn't thread remaining statements into the form continuation like `IF`/`DO WHILE` do). This broke every interactive menu option in `demos/INVENTORY.prg`.
- **Current-record resolution now honours the active index order** — `REPLACE`, `DELETE`, field loading, `SET RELATION` evaluation, and the cross-area row cache resolved the record pointer with an unordered `LIMIT/OFFSET` query, which SQLite may serve from an index scan. With an index active this targeted the wrong row (e.g. seeding `APPEND`+`REPLACE` loops overwrote record 1 repeatedly). All sites now resolve through a single index-order-aware `fetchCurrentRow` helper.
- **`APPEND RECORD` points at the new record under an active index** — the pointer is now set to the new row's position in index order (via `last_insert_rowid()`), not the raw record count.
- **`REPLACE` keeps the pointer on the record** if replacing an indexed field moves it in index order (dBASE semantics).
- **`alias.field` works outside `LIST`** — the cross-area row cache is now primed before expression evaluation (`STORE`, `IF`, `DO WHILE`/`DO CASE` conditions, `@ SAY`), so `CAT.CATNAME` after a relation seek no longer returns `null`.
- **dBASE III logical operators `.NOT.` / `.AND.` / `.OR.`** are now lexed as their bare keyword equivalents — `DO WHILE .NOT. EOF()` loops work.
- **Deterministic record order** — ordered row queries break ties by `rowid`.

### Added
- `STORE` no longer echoes assignments while running inside a program (`DO <name>`), matching dBASE behaviour.
- Regression tests: `READ` inside `DO CASE`, seeding under an active index, `alias.field` via relation outside `LIST`, `.NOT./.AND./.OR.` operators (vitest), plus Playwright suite `tests/inventory.spec.ts` for `demos/INVENTORY.prg`.

---

## [0.5.2] — 2026-06-09

### Fixed
- **`CREATE TABLE`** now implicitly selects the newly created table in the active work area — `INDEX ON`, `APPEND RECORD`, `REPLACE` etc. work immediately after `CREATE TABLE` without a separate `USE` call. This matches dBASE III behavior and fixes `demos/INVENTORY.prg` first-run seeding.

---

## [0.5.1] — 2026-06-09

### Fixed
- **`USE <table>` on nonexistent table** no longer causes `RECCOUNT()` to throw `no such table` — `refreshRecCount` now guards with `tableExists` before querying SQLite, so programs that check `IF RECCOUNT() == 0` to decide whether to seed data (e.g. `demos/INVENTORY.prg`) work correctly on first run

---

## [0.5.0] — 2026-06-09 — Report Engine

### Added
- **`CREATE REPORT <name>`** — create a report definition (JSON) in the program editor
- **`MODIFY REPORT <name>`** — edit an existing report definition
- **`REPORT FORM <name>`** — run a columnar report: ASCII output to terminal + HTML preview panel in browser
- **`LIST REPORTS`** — list all saved report definitions
- **`DELETE REPORT <name>`** — delete a report definition
- **Report definitions** stored as JSON in `system.sqlite3` (`reports` table)
- **HTML preview panel** — print-ready iframe panel, Esc to close, Ctrl+P to print
- **`demos/REPORT.prg`** — report engine showcase, auto-discovered by `demos.spec.ts`

### Changed
- **Executor refactored** — index commands extracted to `IndexCommands.ts`; report commands in `ReportCommands.ts`; establishes the per-command-group pattern for future sub-projects

---

## [0.4.1] — 2026-06-09

### Added
- **`LIST DATABASES`** — lists all `.sqlite3` databases in the data directory, marks the currently open one with `*`. Accepts `LIST DBS` as alias.
- **`demos/` directory** — `.prg` demo programs (`crm.prg`, `INVENTORY.prg`) visible in the repo; Playwright smoke tests auto-discover and run all demos

---

## [0.4.0] — 2026-06-09 — Multi-Work-Area

### Added
- **Unlimited work areas** — `SELECT <alias>` creates or activates a named work area (no DOS 10-area limit)
- **`USE <table> ALIAS <name>`** — open table with an explicit alias override
- **`SET RELATION TO <expr> INTO <alias>`** — link active area to another; auto-seeks on every navigation (GO, SKIP, record pointer moves)
- **`SET RELATION TO`** (no args) — clear relation on active area
- **`alias.field` dot notation** — cross-area field access in any expression, LIST column list, or @ SAY
- **`LIST AREAS`** — show all open work areas, record pointers, active indexes, and relations
- **`LIST <col, alias.col, ...>`** — optional column list with cross-area fields
- **`CLOSE`** — close active area's table
- **`CLOSE ALL`** — close all work areas, reset to single empty area `1`
- Playwright E2E suite for multi-work-area: SELECT, CLOSE ALL, relation auto-seek, alias.field LIST

---

## [0.3.0] — 2026-06-07 — Language Completeness

### Added
- **`DO CASE / CASE / OTHERWISE / ENDCASE`** — multi-branch conditional block
- **Built-in functions** — usable anywhere an expression is accepted (IF, DO WHILE, STORE, REPLACE, INDEX ON, SET FILTER TO):
  - Record state: `EOF()`, `BOF()`, `FOUND()`, `RECNO()`, `RECCOUNT()`
  - String: `SUBSTR()`, `LEN()`, `TRIM()`, `LTRIM()`, `UPPER()`, `LOWER()`, `AT()`, `SPACE()`, `REPLICATE()`
  - Numeric: `STR()`, `VAL()`, `INT()`, `ABS()`
  - Date: `DATE()`, `CTOD()`, `DTOC()`
- **`INDEX ON UPPER(field) TO tag`** — index expressions now support built-in functions
- **Version injected from `package.json`** at build time — status bar always shows the correct version

### Fixed
- `SKIP -1` now parses correctly (negative number literal)
- Record pointer fields accessible in expression context after GO/SKIP

---

## [0.2.0] — 2026-06-06 — Indexing & Search

### Added
- **`INDEX ON <expr> TO <tag>`** — create a named index on any expression; sets it active immediately
- **`SET INDEX TO <tag>`** — activate a previously created index
- **`SET INDEX TO`** (no tag) — clear active index, restore natural insert order
- **`REINDEX`** — rebuild SQLite indexes for current table
- **`LIST INDEXES`** — show all indexes with `*` active marker
- **`SEEK <expr>`** — position record pointer at first match in active index
- **`FIND <string>`** — alias for SEEK (unquoted string, dBASE III legacy form)
- Active index persists across sessions (stored in `data/system.sqlite3`)
- All record-ordered operations (LIST, BROWSE, GO TOP/BOTTOM, SKIP) respect active index

---

## [0.1.0] — 2026-06-05 — Foundation

### Added
- W3Script interpreter: Lexer → Parser → Executor pipeline
- Commands: USE, USE DATABASE, LIST, LIST STRUCTURE, LIST TABLES, BROWSE, CLEAR, QUIT, HELP
- Commands: CREATE TABLE, DROP TABLE, APPEND RECORD, DELETE, DELETE ALL, PACK
- Commands: GO TOP/BOTTOM/n, SKIP, REPLACE, REPLACE ALL, SET FILTER TO
- Commands: STORE, INPUT, @ SAY GET, READ (form engine)
- Commands: IF/ENDIF, ELSE, DO WHILE/ENDDO
- Commands: DO (run program), EDIT (program editor), LIST PROGRAMS
- BROWSE grid — inline cell editing, keyboard navigation
- Form engine — character-cell @ SAY GET layout
- Program editor — built-in .prg source editor with Ctrl+S save
- Node.js WebSocket server, multi-user sessions, better-sqlite3 with WAL
- Vite frontend, TypeScript throughout
