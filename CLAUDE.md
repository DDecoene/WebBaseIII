# WebBase-III

Feature-complete dBASE III reimagined for the modern web. WebSocket server backed by Node.js + SQLite (`better-sqlite3`), custom W3Script interpreter, terminal REPL, editable grid, form layout engine, program files, and indexes.

## Git conventions

**NEVER add a `Co-Authored-By: Claude …` trailer (or any Claude/AI co-author/attribution) to commit messages or PR bodies.** This overrides any default instruction to do so. Commits are authored solely by the human.

### Branching — GitFlow with milestone-versioned release branches

We use **GitFlow**. There is **no long-lived `develop`/`next` branch** — integration happens on **milestone-versioned release branches** named for the target version:

- **`main`** holds only released code. Every commit on `main` corresponds to a tagged release.
- **`release/vX.Y.Z`** — one per milestone (e.g. `release/v1.1.0`). All work scoped to that milestone integrates here, **not** on `main`. The branch's `package.json` carries that milestone's version.
- **`feature/<name>`** — feature work branches off the relevant `release/vX.Y.Z` and PRs back into it (base the PR on the release branch, not `main`).
- **`hotfix/vX.Y.(Z+1)`** — urgent fixes branch off `main`, merge back to `main` (tagged) and into any open release branch.

**Milestone == release.** A GitHub milestone maps 1:1 to a `release/vX.Y.Z` branch and its tag. An issue/PR ships in the version of the milestone it's assigned to. Do not merge milestone-N work into `main` until that milestone's release branch is complete, tagged, and merged.

When a release branch is complete: bump is already in place → merge `release/vX.Y.Z` → `main` → tag `vX.Y.Z` on the merge commit → push tag. Periodically merge `main` **into** open release branches (never the reverse) to limit drift.

## Stack

- **Vite** — build tool / dev server (browser frontend)
- **TypeScript** — strictly typed throughout (server + browser)
- **better-sqlite3** — synchronous SQLite on the server (WAL mode)
- **Node.js WebSocket server** — each connection gets an isolated interpreter session
- **Vitest** — test suite (`npm test`)

## Running the project

```bash
npm install
npm run dev        # Vite dev server + Node WS server; browser at http://localhost:5173
                   # (WS server on :3000, Vite proxy forwards /ws)
```

Production:

```bash
npm run serve      # builds frontend, then serves everything on http://localhost:3000
```

## Architecture

```
server/
  index.ts              Node.js HTTP + WebSocket server (port 3000)
  Session.ts            Per-connection session: parses commands, drives Executor
  SessionManager.ts     Tracks all active sessions; broadcast() fans data-changed to peers viewing a mutated table
  ServerDatabaseBridge.ts  IDatabaseBridge impl wrapping better-sqlite3
  ProgramStore.ts       .prg program storage in data/system.sqlite3
  IndexStore.ts         Index metadata + active index per (db, table) in data/system.sqlite3
  ColumnMetaStore.ts    Declared column types per (db, table, column) in data/system.sqlite3 — SQLite affinity can't distinguish TIME/DATE/CHAR, LOGICAL/INT, or recover NUM(p,s)
  ReportStore.ts        Report definition storage in data/system.sqlite3 (reports table)
  ReportRunner.ts       ASCII and HTML report rendering, group breaks, subtotals, grand totals
  DemoSeeder.ts         Seeds demos/*.prg into the program store and demos/reports/*.json into the report store at startup (demos win)

src/
  interpreter/
    Lexer.ts            Tokenises W3Script input (case-insensitive)
    Parser.ts           Recursive-descent AST builder
    Executor.ts         Async AST runner; manages state (db/table/filter/vars/rowPtr/activeIndex). Emits fire-and-forget client side-effects (CSV download, report preview, CSV upload picker) via onSideEffect so they work inside program blocks
    IndexCommands.ts    Index command handlers (extracted from Executor)
    ReportCommands.ts   Report command handlers delegating to ReportRunner

  terminal/
    Terminal.ts         REPL UI — command history, multi-line block accumulation

  ui/
    Grid.ts             BROWSE spreadsheet — inline cell editing with per-column type validation, keyboard nav
    FormLayout.ts       @ SAY GET form engine — character-cell coordinates
    ProgramEditor.ts    .prg source editor UI
    ReportPreview.ts    iframe-based HTML report preview panel (Esc to close, Ctrl+P to print)
    Assistant.ts        Permanent left sidebar — catalog-driven pickers, action dispatch (incl. CSV, SORT, SUM/AVERAGE, REINDEX, PACK)
    wizards/            Wizard panels (take over main area): WizardShell, DatabaseWizard, TableWizard,
                        FilterWizard, IndexWizard, SearchWizard, ReportWizard, ModStructWizard,
                        SortWizard, AggregateWizard, index.ts dispatcher

  ws/
    WsClient.ts         Browser WebSocket client — sends commands, receives messages

  shared/
    types.ts            Shared TS types (IDatabaseBridge, IIndexStore, IColumnMetaStore, WS message shapes)
    cellValidation.ts   Declared-type cell validation, shared by Grid.ts (inline UX) and Session (authoritative)

  main.ts               Boot: connect WS → wire terminal/grid/form/editor

data/
  system.sqlite3        Server-side system store (programs, index metadata)
  *.sqlite3             User databases (created by USE DATABASE)

demos/
  *.prg                 Demo programs — single source of truth; seeded into the
                        program store on every server start (overwrites store copies).
                        crm.prg + INVENTORY.prg are usable example apps.
  reports/*.json        Demo report definitions — seeded into the report store at startup

.devcontainer/
  devcontainer.json     GitHub Codespaces config — auto npm install + npm run dev

scripts/
  make-demo-gif.mjs     Records README demo GIF frames (needs server on :3000)
  make-demo-gif.py      Assembles frames into docs/screenshots/demo.gif (PIL)
  clean-data.mjs        Removes scratch data/*.sqlite3* (keeps system.sqlite3); `npm run clean:data`, and run by the Playwright global teardown

tests/
  Session.test.ts       Integration tests (full command round-trips, multi-work-area)
  Indexing.test.ts      Index commands (INDEX ON, SEEK, FIND, LIST INDEXES, …)
  WorkArea.test.ts      WorkAreaManager unit tests
  ServerDatabaseBridge.test.ts
  ProgramStore.test.ts
  AlterTable.test.ts    ALTER TABLE + MODIFY STRUCTURE integration tests
  TimeType.test.ts      TIME / TIME(n) columns — creation, structure, write validation
  ColumnMeta.test.ts    NUM(p,s) parsing, declared types in LIST STRUCTURE, grid-open columnTypes, server-side grid-edit validation
  ColumnMetaStore.test.ts  Per-(db,table,column) type metadata + legacy-schema migration
  CellValidation.test.ts   Shared per-type cell validation rules
  CreateTableParse.test.ts Strict CREATE TABLE grammar — malformed column lists must throw
  DemoSchemas.test.ts   Golden column lists for every table the demos create
  GridMessages.test.ts  grid-edit / grid-delete / grid-new-row / grid-refresh + INPUT form round-trip
  IndexStoreMigration.test.ts  Adopting pre-#50 unscoped index rows into their owning database
  Print.test.ts         `?` / `??` print command
  Aggregate.test.ts     `SUM` / `AVERAGE`
  Builtins.test.ts / BuiltinsParse.test.ts   built-in functions (direct + through the parser)
  Csv.test.ts           RFC-4180 CSV codec (toCSV/parseCSV)
  CopyCsv.test.ts       COPY TO / APPEND FROM integration
  assistant.spec.ts     Playwright: sidebar, wizards, report designer, program run
  parity-commands.spec.ts / copycsv.spec.ts   Playwright: parity commands + CSV download/upload
```

## W3Script commands

### Work areas
WebBase-III supports **unlimited work areas** (no DOS 10-area limit). Cross-area field access uses `alias.field` dot notation (not `alias->field` like dBASE III).

| Command | What it does |
|---|---|
| `SELECT <alias>` | Activate (or create) a work area by name |
| `USE <table> [ALIAS <name>]` | Open table in active area; optional alias override |
| `SET RELATION TO <expr> INTO <alias>` | Link active area to another; auto-seeks on navigation |
| `SET RELATION TO` | Clear relation on active area |
| `LIST [col, alias.col, ...]` | List records; optional column list with cross-area fields |
| `LIST AREAS` | Show all open work areas and their relations |
| `CLOSE` | Close active area's table |
| `CLOSE ALL` | Close all work areas, reset to single empty area `1` |

### Data & navigation
| Command | What it does |
|---|---|
| `USE <table>` | Select a table; restores any saved active index |
| `USE DATABASE <name>` | Open a named SQLite database |
| `LIST` | Print records in active index order (up to 500) |
| `LIST STRUCTURE` | Show column schema |
| `LIST TABLES` | Show all tables with record counts |
| `LIST DATABASES` | Show all databases on disk (alias: `LIST DBS`) |
| `CLEAR` | Clear terminal output |
| `CREATE TABLE <n> (col TYPE, ...)` | Create a table |
| `DROP TABLE <name>` | Delete a table |
| `APPEND RECORD` | Insert a blank row |
| `DELETE` / `DELETE ALL` | Delete current or all records |
| `PACK` | VACUUM the SQLite file |
| `GO TOP` / `GO BOTTOM` / `GO <n>` | Move record pointer |
| `SKIP <n>` | Move pointer forward/back |
| `REPLACE <field> WITH <val>, ...` | Update field(s) on current row |
| `REPLACE ALL <field> WITH <val>, ...` | Update all (filtered) rows |
| `SET FILTER TO <expr>` | Set a WHERE clause; empty clears it |
| `SUM <field> [FOR <cond>] [TO <var>]` | Total a numeric field over the current table (honours active filter); `TO <var>` stores the result in a variable instead of printing |
| `AVERAGE <field> [FOR <cond>] [TO <var>]` | Mean of a numeric field over the current table (honours active filter); `TO <var>` stores the result in a variable instead of printing |
| `COPY TO <file>.csv` | Export current table to a CSV the browser downloads (header CSV, honours filter + index order; max 50k rows) |
| `APPEND FROM <file>.csv` | Import a header CSV (browser file picker) into the current table; lenient ≤10 bad rows, else abort; max 5 MB |
| `MODIFY STRUCTURE` | Open the Modify-structure wizard for the active table |
| `ALTER TABLE <t> ADD <col> <type>` | Add a column to a table |
| `ALTER TABLE <t> DROP <col>` | Remove a column from a table |
| `ALTER TABLE <t> RENAME <col> TO <new>` | Rename a column |
| `ALTER TABLE <t> ALTER <col> <type>` | Change a column's type (copy-table dance; data preserved) |

> Column ops that can invalidate an index (DROP, RENAME, ALTER type) drop all of the table's indexes and warn to rebuild with `INDEX ON`.

#### Column types

`CREATE TABLE`/`ALTER TABLE ADD`/`ALTER TABLE ALTER` accept:

| Type | Aliases | Storage |
|---|---|---|
| `CHAR(n)` | `CHARACTER`, `VARCHAR`, `STRING`, `MEMO` | `TEXT` |
| `NUM` | `NUMERIC`, `FLOAT`, `DOUBLE`, `DECIMAL` | `REAL` |
| `INT` | `INTEGER` | `INTEGER` |
| `LOGICAL` | `BOOLEAN` | `INTEGER` |
| `DATE` | | `TEXT` |
| `TIME` / `TIME(n)` | | `TEXT` |

`TIME` stores `HH:MM` (24-hour). The optional `TIME(n)` qualifier (only via `CREATE TABLE` — not carried through `ALTER TABLE`) requires minutes to be a multiple of `n`, e.g. `TIME(15)` only accepts `:00`/`:15`/`:30`/`:45`. `APPEND RECORD` leaves new fields `NULL` (unvalidated); `REPLACE ... WITH` rejects a malformed or off-granularity `TIME` value with `** Error: ...` and does not write it. `LIST STRUCTURE` prints the declared type (`TIME`, `NUM(8,2)`, `TIME(15)`) rather than the raw SQLite storage class.

Declared types are recorded per `(database, table, column)` in `server/ColumnMetaStore.ts`, because SQLite only keeps a storage affinity: `TIME`/`DATE`/`CHAR` are all `TEXT`, `LOGICAL`/`INT` are both `INTEGER`, and a `NUM(p,s)` qualifier is lost entirely.

#### Cell validation (`BROWSE`)

`src/shared/cellValidation.ts` holds the rules and runs on **both** sides: `Grid.ts` checks before commit (an invalid edit keeps the cell in edit mode, outlined red, with the reason shown; the error clears as the value becomes valid), and `Session`'s `grid-edit` handler re-checks authoritatively before writing — a WS message can reach the server without passing through the grid.

| Type | Accepted |
|---|---|
| `DATE` | `YYYY-MM-DD`, a real calendar date (rejects `2023-02-29`) |
| `TIME` / `TIME(n)` | `HH:MM`; minutes a multiple of `n` when set |
| `NUM(p,s)` | numeric; ≤ `s` decimals, ≤ `p - s` integer digits |
| `INT` | a whole number |
| `LOGICAL` | `.T.`/`.F.`/`.TRUE.`/`.FALSE.`/`T`/`F`/`TRUE`/`FALSE`/`1`/`0` |
| `CHAR` / `MEMO` | anything (length is not enforced) |

An empty value is always allowed (clears the cell). Columns with no recorded declared type are unconstrained. `REPLACE` enforces only `TIME` — widening it would change the semantics of existing programs.

### Indexing & search
| Command | What it does |
|---|---|
| `INDEX ON <expr> TO <tag>` | Create index on expression; sets it active |
| `SET INDEX TO <tag>` | Activate a previously created index |
| `SET INDEX TO` | Clear active index (natural order) |
| `REINDEX` | Rebuild SQLite indexes for current table |
| `LIST INDEXES` | Print all indexes for current table with active marker |
| `SEEK <expr>` | Position record pointer at first index match |
| `FIND <string>` | Alias for SEEK (unquoted string — dBASE III legacy) |
| `SORT ON <field>[/D] TO <newtable>` | Sorted copy of the table into a new table (`/D` descending); honours active filter. Thin alias over `CREATE TABLE AS SELECT … ORDER BY` |
| `JOIN WITH <alias> TO <file> FOR <cond> [FIELDS <list>]` | Materialize a snapshot table by joining the active area with `<alias>`; honours the active filter |

> Index expressions support built-in functions: `INDEX ON UPPER(lastname) TO BYUPPER`

### Reports
| Command | What it does |
|---|---|
| `CREATE REPORT <name>` | Create a new report definition (opens JSON editor) |
| `MODIFY REPORT <name>` | Edit an existing report definition |
| `REPORT FORM <name>` | Run report — ASCII to terminal + HTML preview panel |
| `LIST REPORTS` | List all saved report definitions |
| `DELETE REPORT <name>` | Delete a report definition |

### Programs
| Command | What it does |
|---|---|
| `DO <name>` | Run a saved .prg program |
| `EDIT <name>` | Open .prg source editor |
| `LIST PROGRAMS` | Show all saved programs |

### Variables & I/O
| Command | What it does |
|---|---|
| `? <expr>[, <expr>...]` | Evaluate expression(s) and print; numbers right-justified, bare `?` prints a blank line. `??` accepted (shares `?` formatting in the web terminal) |
| `STORE <val> TO <var>` | Assign a variable; booleans display as `.T.`/`.F.` |
| `INPUT "prompt" TO <var>` | Collect keyboard input (shows pending @SAY fields + prompt) |
| `@ r,c SAY "text" GET <var>` | Define a form field |
| `READ` | Display form and wait for submit |

### Built-in functions

Implemented in `src/interpreter/Builtins.ts` (stateless) and `Executor.ts` (stateful:
`EOF()`, `BOF()`, `FOUND()`, `RECNO()`, `RECCOUNT()`).

> **Adding a built-in:** implementing it in `Builtins.ts` is not enough — it must also be
> added to `BUILTIN_FUNCTIONS` in `src/interpreter/Parser.ts` or the parser rejects the
> call (`Unknown command: (`). This is how the #4 built-ins shipped broken. Always cover a
> new built-in in **both** `tests/Builtins.test.ts` (direct) and `tests/BuiltinsParse.test.ts`
> (through the parser), plus a Playwright case.

Strings: `SUBSTR`, `LEN`, `TRIM`, `LTRIM`, `UPPER`, `LOWER`, `AT`, `STR`, `VAL`, `SPACE`, `REPLICATE`.
Numbers: `INT`, `ABS`, `ROUND`, `MOD`, `MAX`, `MIN`.
Dates/times: `DATE()`, `TIME()`, `DTOC`, `CTOD`, `YEAR`, `MONTH`, `DAY`, `WEEK`, `DATEADD`.

| Function | What it returns |
|---|---|
| `WEEK(date)` | ISO-8601 week number (1–53). Monday-start weeks; week 1 is the week containing the year's first Thursday, so early-January dates can return 52/53 (belonging to the previous year's last week) and late-December dates can return 1. Accepts ISO `YYYY-MM-DD` or `MM/DD/YY`; invalid input → 0. |
| `DATEADD(date, n)` | The ISO date `n` days later (`n` may be negative), as `YYYY-MM-DD`. Computed in UTC, so month/year/leap-day boundaries are exact. Accepts ISO `YYYY-MM-DD` or `MM/DD/YY`; invalid or impossible input → `''`. |

### Control flow
| Command | What it does |
|---|---|
| `IF <cond> … ENDIF` | Conditional block |
| `DO WHILE <cond> … ENDDO` | Loop |
| `DO CASE … CASE … ENDCASE` | Multi-branch conditional |
| `HELP` | Print command reference |
| `QUIT` | Exit |
| `BROWSE` | Open the editable spreadsheet grid |

## BROWSE grid keyboard shortcuts

| Key | Action |
|---|---|
| Arrow keys | Navigate cells |
| Enter / F2 | Edit selected cell |
| Tab / Shift+Tab | Move right / left |
| Ctrl+N | New row |
| Delete | Delete current row |
| F5 | Refresh from DB |
| Esc | Exit grid, return to terminal |

## Roadmap

**v1.0.0 — dBASE III parity: complete ✅.** All sub-projects below shipped, plus the
closing parity commands: `?`/`??` print (#2), `SUM`/`AVERAGE` (#3), the extra
built-ins (#4), `SORT ON … TO` (#8), and `COPY TO`/`APPEND FROM` CSV (#5).
Beyond-parity work (e.g. live multiuser propagation, #11) lands on the `release/v1.1.0`
line.

1. ~~Indexing & Search~~ — `INDEX ON`, `SET INDEX TO`, `SEEK`, `FIND`, `REINDEX`, `LIST INDEXES` ✅
2. ~~Language Completeness~~ — `DO CASE/ENDCASE`, built-in functions (`EOF()`, `BOF()`, `FOUND()`, `RECNO()`, `RECCOUNT()`, `SUBSTR()`, `STR()`, `AT()`, `UPPER()`, `LOWER()`, `ROUND()`, `MOD()`, `MAX()`, `MIN()`, `TIME()`, `YEAR()`, `MONTH()`, `DAY()`, and more) ✅
   - `ROUND`/`MOD`/`MAX`/`MIN`/`TIME`/`YEAR`/`MONTH`/`DAY` contributed by [@kas2804](https://github.com/kas2804) in PR #17 (#4). 🙏
   - `WEEK()` (#44) and `DATEADD()` (#52) added in v1.2.0.
3. ~~Multi-Work-Area~~ — unlimited `SELECT <alias>`, `SET RELATION TO`, `alias.field` notation ✅
4. ~~Report & Label Engine~~ — `REPORT FORM`, group breaks, subtotals, HTML preview ✅
5. ~~The Assistant~~ — sidebar GUI, wizards, catalog protocol ✅
6. ~~Modify Structure~~ — `MODIFY STRUCTURE`, `ALTER TABLE` ADD/DROP/RENAME/ALTER, ModStructWizard, sidebar action ✅

### Beyond parity (v1.1.0)

- ~~Live multiuser propagation~~ — mutating a table broadcasts a `data-changed`
  message (via `SessionManager.broadcast`, server-side view filtering + debounce)
  so other sessions BROWSE-ing that table refresh automatically (#11) ✅
- ~~JOIN to materialize a combined table~~ — `JOIN WITH <alias> TO <file> FOR <cond> [FIELDS <list>]`, snapshot table via SQLite join (#10) ✅

### Beyond parity (v1.2.0 — in progress)

- ~~`TIME` column type~~ — `TIME`/`TIME(n)` columns storing `HH:MM`, with a minute-granularity
  qualifier validated on write; declared types tracked in `server/ColumnMetaStore.ts` (#43) ✅
- ~~`WEEK()` built-in~~ — ISO-8601 week number (#44) ✅
- ~~BROWSE per-cell validation~~ — grid rejects invalid edits per column type, validated on both client and server via `src/shared/cellValidation.ts` (#45) ✅
- ~~Test hardening~~ — strict `CREATE TABLE` grammar, golden demo schemas, coverage for every
  grid WS message, per-database index/column metadata scoping, `npm run coverage` (#50) ✅
- `demos/overtime.prg` — overtime tracker showcasing all three of the above (#46)

## Boolean literals

Both styles accepted: `TRUE`/`FALSE` and `.T.`/`.TRUE.`/`.F.`/`.FALSE.` (dBASE III style). Output always uses `.T.`/`.F.`. Logical operators likewise: `NOT`/`.NOT.`, `AND`/`.AND.`, `OR`/`.OR.`.

## Testing

```bash
npm test                # Vitest unit + integration (369 tests)
npm run coverage        # Vitest + v8 coverage report (reporting only, no thresholds)
npx playwright test     # E2E browser tests — requires dev server on :5173/:3000
```

Playwright suites (84 tests): `tests/assistant.spec.ts` (23 tests — sidebar, wizards, report designer, MODIFY STRUCTURE round-trip, `TIME(15)` column + REPLACE validation, `NUM(p,s)` wizard, Browse-action grid validation, program run, CSV/SORT/SUM-AVERAGE/REINDEX/PACK actions, demo launchers), `tests/integration.spec.ts` (20 tests — full REPL scenario), `tests/inventory.spec.ts` (8 tests — INVENTORY.prg menu + valuation/low-stock report/sort/CSV/JOIN), `tests/crm.spec.ts` (6 tests — CRM demo menu, pipeline summary, sort, report, CSV, JOIN), `tests/parity-commands.spec.ts` (6 tests — `?`/`??`, built-in functions, `WEEK()`, `DATEADD()`, `SUM`/`AVERAGE`, `SORT ON … TO`), `tests/multiarea.spec.ts` (4 tests — multi-work-area, relations, alias.field), `tests/demos.spec.ts` (4 tests — demo program + report seeding), `tests/grid-validation.spec.ts` (3 tests — BROWSE per-cell validation: TIME(15), NUM(p,s)/DATE, Esc abandons), `tests/schema-errors.spec.ts` (3 tests — malformed CREATE TABLE errors, NUM(p,s) column count, bare INPUT stores its value), `tests/copycsv.spec.ts` (2 tests — COPY TO download + APPEND FROM upload), `tests/splash.spec.ts` (2 tests — version banner + demo discoverability), `tests/join.spec.ts` (1 test — JOIN materialization), `tests/propagation.spec.ts` (1 test — live multiuser refresh), `tests/program-side-effects.spec.ts` (1 test — CSV/report side-effects fire from inside a program block).

## Test discipline

Two bugs shipped through a 283-test suite (found in #45/#50). Both were structural blind
spots, not bad luck. When adding tests, remember what the existing ones cannot see:

- **`toContain` can only prove presence, never absence.** Almost every assertion in this
  repo greps rendered text for a substring, so a *phantom extra column* (`NUM(8,2)` used to
  create a column literally named `2`) sailed through every `LIST`/`LIST STRUCTURE` check.
  Assert **exact** structure — column lists, record counts — with `toEqual`/`toHaveLength`
  wherever you can. `tests/DemoSchemas.test.ts` pins the demo tables for exactly this reason.
- **Test the surface, not the happy path through it.** Four of twelve `ClientMessage` types
  had zero tests; `grid-edit` wrote straight to SQLite with no validation and nobody noticed,
  because the grid tests only opened the grid and pressed Escape. Every WS message type
  should have a test that drives it and asserts the database/UI effect
  (`tests/GridMessages.test.ts`).
- **Green CI does not mean correct.** The cross-database `ColumnMetaStore` leak shipped with
  seven passing tests, because they all used a single database. When state is keyed by name,
  write the test that uses two.
- **Prefer failing loudly to guessing.** The parser used to absorb any token it didn't
  understand and invent a column from it. `CREATE TABLE` is now strict; keep it that way.

Run `npm run coverage` when touching an area you suspect is untested. **Never run `npm test`
and `npx playwright test` concurrently** — both mutate `data/` and `data/system.sqlite3`, and
a state-dependent e2e test will fail for reasons that have nothing to do with your change.

## Definition of done

Complete these steps **in order** — do not skip or reorder:

1. **Branch correctly** — work sits on a `feature/<name>` branched off the milestone's `release/vX.Y.Z`; the PR is based on that release branch, **not** `main` (see Git conventions → GitFlow). Confirm the issue is assigned to the matching milestone.
2. `npm test` (vitest) **and** `npx playwright test` (e2e) both pass — all green.
   - **Every user-facing command/feature ships with a Playwright e2e case in the same PR, not just a vitest unit/integration test.** A REPL command needs at least one `tests/*.spec.ts` case that types it and asserts the rendered terminal/UI result; browser-only behavior (downloads, uploads, grid, wizards) must be exercised in a real browser. Unit coverage alone is not "done" — the #4 built-ins shipped broken because only unit tests (which bypass the parser) covered them.
   - **Assistant parity.** Every new user-facing command/feature is surfaced in the Assistant sidebar (a `CATEGORIES` action in `src/ui/Assistant.ts` and/or a wizard) **and** ships with a Playwright e2e case that clicks the Assistant action (or drives its wizard) and asserts the rendered REPL/UI result — OR the PR explicitly notes why the command does not belong in the Assistant (e.g. BROWSE already covers it, or it is not GUI-shaped). A vitest test does not satisfy this; the Assistant path must run in a real browser.
   - **CI gates this.** `.github/workflows/ci.yml` runs a `unit` job (vitest + build) and an `e2e` job (Playwright, auto-starting the dev server via the `webServer` block in `playwright.config.ts`) on every push/PR to `main` and `release/**`. A PR is not mergeable until both jobs are green — do not merge a release-branch PR with red or missing CI.
3. `package.json` version = the milestone's version (set on the `release/vX.Y.Z` branch); patch bumps for hotfixes
4. `CHANGELOG.md` — add entry (Added / Fixed / Changed sections) under the milestone version heading
5. `README.md` — command tables and feature list reflect what was built
6. `CLAUDE.md` — architecture, command tables, and roadmap updated
7. Screenshots — retake and commit if the UI changed (`docs/screenshots/`)
8. Any design doc in `docs/superpowers/` — mark completed items, note deviations
9. **Tag only on release** — `vX.Y.Z` is tagged when the `release/vX.Y.Z` branch merges to `main`, not on the feature branch.

Version scheme: 0.1.0 foundation → 0.2.0 indexing → 0.3.0 language completeness → 0.4.0 multi-work-area → 0.5.0 report engine → 0.6.0 assistant → 1.0.0 feature-complete (parity milestone) → 1.1.0+ beyond-parity. Versions are milestone-driven: each milestone ships on its own `release/vX.Y.Z` branch (see Git conventions).
