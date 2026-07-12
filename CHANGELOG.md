# Changelog

All notable changes to WebBase-III are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/) — minor bump per sub-project, patch for fixes, 1.0.0 when feature-complete.

---

## [Unreleased] — v1.3.0 in progress

### Added
- `LOOKUP` column qualifier — language grammar and storage layer (#58). Any column can
  declare a constraint on its legal values: `LOOKUP <table>.<column> [DISPLAY <column>]`
  for a live table-driven lookup, or `LOOKUP ("a","b",...)` for a literal list. Parsed by
  `CREATE TABLE`/`ALTER TABLE ADD`/`ALTER TABLE ALTER`, persisted per-column in
  `ColumnMetaStore` via an additive migration (existing declared types are never touched
  or dropped), and resolvable to concrete `{value,label}` options via the new
  `src/interpreter/LookupResolver.ts` (degrades to free entry — never truncates — when the
  source is missing, empty, or exceeds 1000 distinct values). This is a WebBase-III
  extension with no dBASE III ancestor.
- `LOOKUP` enforcement + BROWSE dropdown (#60). `REPLACE` and the BROWSE grid's `grid-edit`
  now reject a value outside a column's declared `LOOKUP`, re-resolving the constraint fresh
  against the live database on every write (so a value that only just became legal, or that
  just stopped being legal, is judged correctly — never a stale cached list). An unresolvable
  lookup (source table dropped, empty, or over 1000 values) degrades to free entry with a
  warning rather than locking the column. BROWSE renders a lookup column as a dropdown —
  `DISPLAY` labels shown while editing, the stored code shown once committed, matching
  `LIST`/report output.
- **Field-bound `@ SAY GET`** (#59). `@ r,c SAY "…" GET <name>` now binds directly to the
  active table's column when one matches — dBASE III's actual behavior — instead of only
  ever collecting into a memory variable. Fields take precedence over a memory variable of
  the same name (why the `m_` prefix convention exists). A field-bound `GET` needs a current
  record and prefills from it; a lookup column renders the same picker BROWSE does. `READ`'s
  submit validates every field-bound value (declared type + lookup membership) before
  writing any of them — a rejection sends a new `form-error` message that keeps the form
  open with the bad fields outlined, rather than silently discarding the valid ones.
  Writes target the row captured at `GET` time, mirroring how `grid-edit` already writes by
  rowid. This is the PR that promotes `LOOKUP` to the README command reference in full —
  both BROWSE and forms now declare, enforce, and render it end to end.
- **Demos adopt `LOOKUP`** (#61). `demos/overtime.prg` gains a `SCHEDULES` catalog table
  (`SCHEDID`, `DESCR`) as the lookup source for `EMPLOYEES.SCHEDID` — Add Employee is now a
  check-first, two-form flow where the schedule is picked from a dropdown showing the
  description ("Standard 40h (08:00-16:30)") instead of typed from memory. `demos/crm.prg`'s
  `DEALS.STAGE` is constrained to a literal `LOOKUP` list matching its own seeded vocabulary
  exactly, exercising the other lookup kind in a real, working demo.

## [1.2.0] — 2026-07-09 — TIME columns, WEEK()/DATEADD(), BROWSE cell validation, Overtime demo

### Added
- `TIME` column type — `CREATE TABLE ... (col TIME)` / `TIME(n)` for a minute-granularity
  qualifier (e.g. `TIME(15)` for quarter-hour increments). Stores canonical `HH:MM`,
  validated on `REPLACE ... WITH` (rejects malformed or off-granularity values —
  no silent coercion), and `LIST STRUCTURE` prints the declared type instead of the
  raw SQLite storage class. (#43)
- `WEEK(date)` built-in — ISO-8601 week number (1–53): Monday-start weeks, week 1 is the
  week containing the year's first Thursday. Early-January dates correctly report the
  previous year's week 52/53, and late-December dates week 1 of the next year. Accepts
  ISO `YYYY-MM-DD` or `MM/DD/YY`; invalid input returns 0. (#44)
- `DATEADD(date, n)` built-in — the ISO date `n` days later (`n` may be negative). Computed
  in UTC so month, year and leap-day boundaries are exact (`2024-02-28` + 1 = `2024-02-29`,
  `2023-02-28` + 1 = `2023-03-01`). Accepts ISO `YYYY-MM-DD` or `MM/DD/YY` and composes with
  `CTOD()`; invalid or impossible input returns `''`. W3Script previously had no date
  arithmetic at all. (#52)
- `BROWSE` now validates each cell edit against its column's declared type before
  committing. An invalid edit keeps the cell in edit mode, outlines it in red and shows
  why (`HH:MM`, `multiple of 15`, `at most 2 decimal place(s)`, `not a real date`, …);
  the error clears as soon as the value becomes valid. `DATE`, `TIME`/`TIME(n)`,
  `NUM(p,s)`, `INT` and `LOGICAL` are checked; `CHAR`/`MEMO` stay unconstrained. The rules
  live in `src/shared/cellValidation.ts` and run on both the client (instant feedback) and
  the server (`grid-edit` is now validated authoritatively — previously it wrote straight
  to SQLite with no check at all). (#45)
- `NUM(p,s)` is now a genuinely supported qualifier — the precision and scale are parsed,
  recorded, and enforced on grid edits (`NUM(8,2)` accepts `123456.78`, rejects `1.234`).
  Previously the scale silently corrupted the schema; see Fixed. The Assistant's **New table**
  wizard accepts a width (`8`) or a precision,scale pair (`8,2`). (#45, #50)
- `LIST STRUCTURE` prints the **declared** type of every column (`CHAR(10)`, `NUM(8,2)`,
  `DATE`, `TIME(15)`, `LOGICAL`, `INT`) rather than SQLite's storage class (`TEXT`/`REAL`/
  `INTEGER`). Declared types are recorded per `(database, table, column)` in
  `server/ColumnMetaStore.ts`. (#45)
- `demos/overtime.prg` — an Overtime Tracker example app, and the showcase for this
  release's engine work: `TIME(15)` columns validated per-cell as you type in `BROWSE`,
  `WEEK()` for the ISO week number, and `DATEADD()` to walk a week's Monday through Friday.
  Employees have their own weekly schedule, so standard hours are a real per-employee sum
  rather than a flat 40; overtime is banked per week and drawn down as leave, with the
  balance computed live from the source rows (no running-total field to drift when a week
  is re-edited). Seeds a grouped report (`demos/reports/overtimebyemp.json`) and is
  reachable from the splash screen, `HELP`, and the Assistant (Programs → Run Overtime
  demo). (#46)

### Fixed
- `CREATE TABLE t (price NUM(8,2))` silently created a **phantom column named `2`** of
  type `)`: the parser read the precision, then treated the scale as the next column
  definition. The shipped `PRODUCTS`, `DEALS` and `SALES` demo tables all carried this
  stray column. `NUM(p,s)` now parses correctly. Tables created before this fix keep the
  stray column until recreated. (#45)
- Column type metadata is now scoped per database. Two databases holding same-named
  tables previously shared (and overwrote) one another's declared column types, so a
  `TIME(15)` column in one database could be validated against another database's
  `CHAR(20)` declaration of the same name. (#45)
- `CREATE TABLE` now **rejects a malformed column list** instead of silently inventing
  columns from tokens it doesn't understand. `CREATE TABLE t (a CHAR(10) b INT)` (missing
  comma), `(a)` (no type), `(a NUM(8,2,9))` and an unclosed paren all now raise a parse
  error naming the offending column, and create nothing. This permissiveness was the root
  cause of the phantom-column bug above. (#50)
- **Index metadata is now scoped per database.** `indexes`/`active_indexes` were keyed by
  table name alone, so opening `PEOPLE` in one database silently activated an index defined
  on a *different* database's `PEOPLE` — pointing the record order at a column that need not
  even exist there, and breaking `BROWSE`/`LIST`. On first run, existing index definitions
  are adopted into the one database that owns the table; definitions whose owner is ambiguous
  (same table name in two databases) or missing are dropped and must be recreated with
  `INDEX ON`. The underlying SQLite indexes are untouched. (#50)
- A bare `INPUT "prompt" TO <var>` typed at the REPL silently discarded the value: the
  submitted form was only applied when a continuation existed, which is never the case for
  a single statement. Values a form collects are now always stored. (#50)
- The `BROWSE` cell-validation message was invisible. Grid cells set `overflow: hidden`
  (for the ellipsis on long values), which clipped the absolutely-positioned error tooltip
  away entirely — an invalid edit showed a red border and no reason. The e2e tests missed
  it because `toContainText`/`toBeVisible` do not account for clipping by an ancestor's
  overflow; the assertions now use `toBeInViewport()`, which does. (#46)

### Changed
- Removed the `input-request` / `input-response` WebSocket message types. They were declared
  in the protocol but never sent or handled by anything — `INPUT` collects its value through
  `form-open` / `form-submit`. (#50)
- New `npm run coverage` (vitest + v8, reporting only, no thresholds), so modules no test ever
  executes stop hiding. (#50)
- Regenerated every `docs/screenshots/*.png` and the README `demo.gif` against v1.2.0, and
  added `screenshot-grid-validation.png` showing `BROWSE` rejecting an off-quarter
  `TIME(15)` edit. (#46)

---

## [1.1.1] — 2026-07-05 — Docs refresh

### Changed
- Regenerated all `docs/screenshots/*.png` and the README `demo.gif` against the current
  build — the imagery previously showed the stale `v1.0.0` banner. Screenshots and GIF
  now render the `v1.1.1` status bar so the README matches the shipped version.

---

## [1.1.0] — 2026-06-27 — Live multiuser data propagation

### Added
- e2e runs now clean up after themselves: a Playwright global teardown deletes the
  scratch databases tests create in `data/` (keeping `system.sqlite3`), and a new
  `npm run clean:data` does the same on demand. (#36)
- `SUM`/`AVERAGE <field> [FOR <cond>] TO <var>` — the dBASE `TO` clause stores the
  aggregate in a memory variable (and prints nothing) instead of echoing it, so programs
  can compute a total and place it inline with `@ SAY`. (#29)
- Rebuilt the `crm` and `inventory` demos into usable example apps — a mini-CRM
  (companies / contacts / deals) and a stock manager (categories / products / stock
  movements) — that double as a guided tour of the v1.0.0 + v1.1.0 feature set:
  `SUM`/`AVERAGE … FOR`, `SORT ON … TO`, `JOIN`, `REPORT FORM`, CSV export, work-area
  relations with `alias.field`, and a live-propagation tip. Each demo seeds a grouped
  report definition (`demos/reports/*.json`, seeded by `DemoSeeder.seedDemoReports`).
  The demos are now discoverable from the splash screen, `HELP`, and the Assistant
  (Programs → Run CRM demo / Run Inventory demo). (#29)
- Assistant sidebar parity for post-v0.6 commands: Export/Import CSV actions, a
  Sort-to-new-table wizard, a Sum/Average wizard, and Reindex / Pack database
  actions — closing the drift between the sidebar and the REPL language. (#33)
- Definition of Done now requires every new user-facing command to be surfaced in
  the Assistant (action and/or wizard) with a Playwright e2e case. (#33)
- `CONTRIBUTING.md` rewritten for the GitFlow model: fork → branch off the active
  `release/vX.Y.Z` → PR against that release branch (not `main`), plus a Definition of
  Done section. Added a PR template and a README "Contributing" pointer. (#31)
- `JOIN WITH <alias> TO <file> FOR <cond> [FIELDS <list>]` — materialize a combined
  snapshot table from two open work areas, computed by SQLite's join planner.
  Deviations from dBASE III (FOR required, `alias.field` dot syntax, SQL-predicate
  FOR, active-wins collision handling with a warning) are documented in README. (#10)
- Live multiuser data propagation (#11): when one session mutates a table, every
  other session currently BROWSE-ing that same table refreshes automatically — no
  manual re-query. Type in one browser window, watch another repaint.
  - New `data-changed` WebSocket message and `SessionManager.broadcast(db, table)`
    with server-side relevance filtering (only sessions viewing the affected
    table are notified) and per-table debounce (a burst coalesces into one
    refresh).
  - Mutation chokepoint: `ServerDatabaseBridge.exec()` fires an `onMutate` hook,
    so every write path (`REPLACE`, `APPEND`, `DELETE`, `PACK`, grid edits, …)
    triggers propagation with no per-command bookkeeping.

### Fixed
- `closeDatabase` no longer closes the SQLite handle shared across sessions — one
  user closing a database no longer breaks everyone else's queries.

---

## [1.0.1] — 2026-06-28 — Hotfix

### Fixed
- `COPY TO`, `APPEND FROM`, and `REPORT FORM` now work when run **inside a program**
  control-flow block (`DO WHILE` / `DO CASE` / `IF`). Previously the server performed
  the work but the browser never received the CSV download, file picker, or report
  preview — the per-command client action was swallowed by the block executor (only
  `BROWSE` and form `READ` were threaded through). These three are now delivered as
  immediate side-effects via a new `Executor.onSideEffect` sink, so they fire at any
  nesting depth. (Bug present since v1.0.0 for CSV and v0.5.0 for `REPORT FORM`;
  REPL and Assistant usage were unaffected.)

---

## [1.0.0] — 2026-06-27 — dBASE III parity complete

> The feature-complete parity milestone: `?`/`??`, `SUM`/`AVERAGE`, the extra
> built-ins (#4), `SORT ON … TO` (#8), `COPY TO`/`APPEND FROM` CSV (#5), on top of
> indexing, language completeness, multi-work-area, reports, the Assistant, and
> MODIFY STRUCTURE. Backed by 239 vitest + 49 Playwright tests, CI-gated.

### Fixed
- The #4 built-ins (`ROUND`, `MOD`, `MAX`, `MIN`, `TIME`, `YEAR`, `MONTH`, `DAY`,
  shipped in 0.8.0) were implemented in `Builtins.ts` but never registered in the
  parser's `BUILTIN_FUNCTIONS` whitelist, so calling them from the REPL failed with
  `Unknown command: (`. They are now registered and reachable. The unit tests
  passed only because they called the implementation directly — caught by adding
  Playwright e2e coverage for the parity commands.

### Added
- **`COPY TO` / `APPEND FROM` CSV import/export** (#5). `COPY TO <file>.csv` downloads
  the current table (honouring the active `SET FILTER` and index order, max 50,000
  rows); `APPEND FROM <file>.csv` opens a browser file picker and bulk-imports
  (max 5 MB). **Deliberate deviation from dBASE III:** dBASE used headerless,
  positional `DELIMITED`/`SDF` formats; WebBase-III uses modern header-based CSV
  (RFC-4180), mapped by column name. Import is lenient — up to 10 malformed rows are
  skipped and reported with line number + reason; more than 10 aborts (no rows
  appended).
- **`SUM` / `AVERAGE` commands** (#3) — `SUM <field> [FOR <cond>]` and
  `AVERAGE <field> [FOR <cond>]` aggregate a numeric field over the current table,
  honouring the active `SET FILTER` plus an optional `FOR` condition. SQLite does
  the aggregation server-side; the result prints right-justified like `?`.
- **`?` / `??` print command** (#2) — evaluate an expression (or a comma-separated
  list) and print the result. Strings print unquoted, booleans as `.T.`/`.F.`, and
  numbers right-justified in a 10-wide field (dBASE III numeric display). A bare
  `?` prints a blank line. `??` is accepted; its "no leading newline" semantics are
  not expressible in the line-based web terminal, so it shares `?`'s formatting.

---

## [0.8.0] — 2026-06-27 — More built-in functions

### Added
- New W3Script built-in functions (#4, PR #17 by @kas2804): `ROUND(n, decimals)`,
  `MOD(a, b)`, `MAX(a, b)`, `MIN(a, b)`, `TIME()` (current time as `HH:MM:SS`),
  and the date-part functions `YEAR(date)`, `MONTH(date)`, `DAY(date)`. Each has a
  matching Vitest case in `tests/Builtins.test.ts`.

---

## [0.7.0] — 2026-06-24 — MODIFY STRUCTURE / ALTER TABLE

### Added
- `MODIFY STRUCTURE` — alter an existing table's columns without losing data (#6).
  - Scriptable command family: `ALTER TABLE <t> ADD/DROP/RENAME/ALTER <col> …`.
  - `MODIFY STRUCTURE` opens an Assistant wizard (diff editor) for the active table; also reachable via the sidebar "Modify structure…" action.
  - Column ops that can invalidate an index drop the table's indexes and warn to rebuild with `INDEX ON`.

---

## [0.6.3] — 2026-06-24 — `SORT TO`

### Added
- **`SORT ON <field>[/D] TO <newtable>`** (#8) — writes a sorted copy of the active table to a new table. `/D` sorts descending (default ascending), and the active `SET FILTER` is honoured. Errors if no table is in use, the field doesn't exist, or the target table already exists.

### Notes
- Implemented as a thin alias over SQLite's `CREATE TABLE … AS SELECT … ORDER BY`. The new table is therefore a plain snapshot — column affinities are inferred and the source PK/constraints are **not** carried over. `SORT` is largely redundant given live indexes + `ORDER BY`; it exists for dBASE III dialect fidelity.

---

## [0.6.2] — 2026-06-24 — Suspended-program fix

### Fixed
- **Opening a wizard while a `DO` program is suspended no longer silently abandons it** (#7). The wizard tore down the suspended form/grid client-side, but the server kept the orphaned continuation — which could also misfire on a later unrelated `form-submit`. Opening a wizard now sends an `abort-suspended` message; the server drops the pending continuation, resets program depth, and prints `** Program aborted (a wizard was opened).` so the abandonment is explicit rather than silent.

---

## [0.6.1] — 2026-06-12 — Launch readiness

### Added
- **GitHub Codespaces support** — `.devcontainer/devcontainer.json` (Node 22, auto `npm install` + `npm run dev`, ports 5173/3000 forwarded) and an "Open in GitHub Codespaces" badge in the README: one-click try-it-now path, no hosting needed.
- **`CONTRIBUTING.md`** — setup, project layout, test requirements, PR guidelines, faithfulness-vs-modernity policy.
- **Demo GIF** (`docs/screenshots/demo.gif`) — recorded `USE` → `LIST` → `SEEK` → `BROWSE` session at the top of the README; generated by `scripts/make-demo-gif.mjs` + `scripts/make-demo-gif.py`.
- **Social preview card** (`docs/social-preview.png`, source `docs/social-preview.html`) — 1280×640 image for link unfurls on HN/Reddit/X.
- **Launch & visibility plan** — `docs/superpowers/specs/2026-06-12-launch-visibility-design.md`.

### Changed
- **Positioning** — new slogan "dBASE III is back. In your browser. `USE customers` like it's 1984." applied to the GitHub repo description, `package.json`, and a rewritten nostalgia-first README opening. GitHub topics added for discoverability.

---

## [0.6.0] — 2026-06-11 — The Assistant

### Added
- **The Assistant** — permanent left-sidebar GUI (roadmap sub-project 5): Database / Tables / Data / Search / Reports / Programs categories. Every action generates a W3Script command and submits it through the normal terminal path — commands echo into the terminal history, teaching the language as a side effect.
- **Wizards** in the main area (like BROWSE/editor): New database, New table, Filter, New index, Find record, and a 3-step report designer producing the existing `ReportDef` JSON. Each shows a live W3Script preview while you type.
- **`catalog-request` → `catalog` WS pair** — structured lists (databases, tables+counts, active-table columns, indexes, report definitions, programs) for sidebar pickers.
- **Report-store test cleanup** — vitest assistant tests clean up their `__report_` entries after each run.

### Changed
- App layout is now sidebar + main area (`#assistant-sidebar` / `#main-area`); all existing view IDs unchanged.
- Opening a wizard tears down any active main-area view (grid, form, editor, report preview) so views never double-stack.

### Known limitations
- Opening a wizard while a `DO` program is suspended at `READ` or `BROWSE` silently dismisses the form/grid without resuming or aborting the program; the suspended program is abandoned for the session. Finish or quit a running program before using Assistant wizards. _(Resolved in 0.6.2 — the abort is now explicit and announced.)_

---

## [0.5.5] — 2026-06-11

### Added
- **SessionStart hook for Claude Code on the web** (`.claude/hooks/session-start.sh`) — runs `npm install` and installs Playwright Chromium. Tries `npx playwright install chromium --with-deps` first; if that fails (blocked Playwright CDN, broken apt PPA), falls back to downloading the matching Chrome for Testing build (revision and version read from `playwright-core/browsers.json`) from Google's `chrome-for-testing-public` bucket into `PLAYWRIGHT_BROWSERS_PATH`.

### Fixed
- **`REPORT FORM` Session test no longer depends on leftover state** — two tests saved their report via a `save-report` message type that `Session.handleMessage` never handled (silently ignored), so they only passed when a stale report row already existed in `data/system.sqlite3`. They now save through the real `save-program` message with the `__report_` name prefix.

---

## [0.5.4] — 2026-06-10

### Added
- **Demo program seeding** — `demos/*.prg` are now the single source of truth: `server/DemoSeeder.ts` seeds them into the program store on every server start, overwriting any drifted store copy (`seedDemoPrograms()`).
- **`ProgramStore.delete(name)`** — removes a stored program.

### Fixed
- **INVENTORY.prg menu** — the bottom `===` separator overlapped `Q. Quit` (both on row 13); separator moved to row 14.
- **Program store pollution** — vitest Session tests now delete the `test_*` programs they save into the shared store.

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
