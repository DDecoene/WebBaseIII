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
  SessionManager.ts     Tracks all active sessions
  ServerDatabaseBridge.ts  IDatabaseBridge impl wrapping better-sqlite3
  ProgramStore.ts       .prg program storage in data/system.sqlite3
  IndexStore.ts         Index metadata + active index in data/system.sqlite3
  ReportStore.ts        Report definition storage in data/system.sqlite3 (reports table)
  ReportRunner.ts       ASCII and HTML report rendering, group breaks, subtotals, grand totals
  DemoSeeder.ts         Seeds demos/*.prg into the program store at startup (demos win)

src/
  interpreter/
    Lexer.ts            Tokenises W3Script input (case-insensitive)
    Parser.ts           Recursive-descent AST builder
    Executor.ts         Async AST runner; manages state (db/table/filter/vars/rowPtr/activeIndex)
    IndexCommands.ts    Index command handlers (extracted from Executor)
    ReportCommands.ts   Report command handlers delegating to ReportRunner

  terminal/
    Terminal.ts         REPL UI — command history, multi-line block accumulation

  ui/
    Grid.ts             BROWSE spreadsheet — inline cell editing, keyboard nav
    FormLayout.ts       @ SAY GET form engine — character-cell coordinates
    ProgramEditor.ts    .prg source editor UI
    ReportPreview.ts    iframe-based HTML report preview panel (Esc to close, Ctrl+P to print)
    Assistant.ts        Permanent left sidebar — 6 categories, catalog-driven pickers, action dispatch
    wizards/            Wizard panels (take over main area): WizardShell, DatabaseWizard, TableWizard,
                        FilterWizard, IndexWizard, SearchWizard, ReportWizard, ModStructWizard,
                        index.ts dispatcher

  ws/
    WsClient.ts         Browser WebSocket client — sends commands, receives messages

  shared/
    types.ts            Shared TS types (IDatabaseBridge, IIndexStore, WS message shapes)

  main.ts               Boot: connect WS → wire terminal/grid/form/editor

data/
  system.sqlite3        Server-side system store (programs, index metadata)
  *.sqlite3             User databases (created by USE DATABASE)

demos/
  *.prg                 Demo programs — single source of truth; seeded into the
                        program store on every server start (overwrites store copies)

.devcontainer/
  devcontainer.json     GitHub Codespaces config — auto npm install + npm run dev

scripts/
  make-demo-gif.mjs     Records README demo GIF frames (needs server on :3000)
  make-demo-gif.py      Assembles frames into docs/screenshots/demo.gif (PIL)

tests/
  Session.test.ts       Integration tests (full command round-trips, multi-work-area)
  Indexing.test.ts      Index commands (INDEX ON, SEEK, FIND, LIST INDEXES, …)
  WorkArea.test.ts      WorkAreaManager unit tests
  ServerDatabaseBridge.test.ts
  ProgramStore.test.ts
  AlterTable.test.ts    ALTER TABLE + MODIFY STRUCTURE integration tests
  assistant.spec.ts     Playwright: sidebar, wizards, report designer, program run
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
| `SUM <field> [FOR <cond>]` | Total a numeric field over the current table (honours active filter) |
| `AVERAGE <field> [FOR <cond>]` | Mean of a numeric field over the current table (honours active filter) |
| `COPY TO <file>.csv` | Export current table to a CSV the browser downloads (header CSV, honours filter + index order; max 50k rows) |
| `APPEND FROM <file>.csv` | Import a header CSV (browser file picker) into the current table; lenient ≤10 bad rows, else abort; max 5 MB |
| `MODIFY STRUCTURE` | Open the Modify-structure wizard for the active table |
| `ALTER TABLE <t> ADD <col> <type>` | Add a column to a table |
| `ALTER TABLE <t> DROP <col>` | Remove a column from a table |
| `ALTER TABLE <t> RENAME <col> TO <new>` | Rename a column |
| `ALTER TABLE <t> ALTER <col> <type>` | Change a column's type (copy-table dance; data preserved) |

> Column ops that can invalidate an index (DROP, RENAME, ALTER type) drop all of the table's indexes and warn to rebuild with `INDEX ON`.

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

## Roadmap (in progress)

1. ~~Indexing & Search~~ — `INDEX ON`, `SET INDEX TO`, `SEEK`, `FIND`, `REINDEX`, `LIST INDEXES` ✅
2. ~~Language Completeness~~ — `DO CASE/ENDCASE`, built-in functions (`EOF()`, `BOF()`, `FOUND()`, `RECNO()`, `RECCOUNT()`, `SUBSTR()`, `STR()`, `AT()`, `UPPER()`, `LOWER()`, `ROUND()`, `MOD()`, `MAX()`, `MIN()`, `TIME()`, `YEAR()`, `MONTH()`, `DAY()`, and more) ✅
   - `ROUND`/`MOD`/`MAX`/`MIN`/`TIME`/`YEAR`/`MONTH`/`DAY` contributed by [@kas2804](https://github.com/kas2804) in PR #17 (#4). 🙏
3. ~~Multi-Work-Area~~ — unlimited `SELECT <alias>`, `SET RELATION TO`, `alias.field` notation ✅
4. ~~Report & Label Engine~~ — `REPORT FORM`, group breaks, subtotals, HTML preview ✅
5. ~~The Assistant~~ — sidebar GUI, wizards, catalog protocol ✅
6. ~~Modify Structure~~ — `MODIFY STRUCTURE`, `ALTER TABLE` ADD/DROP/RENAME/ALTER, ModStructWizard, sidebar action ✅

## Boolean literals

Both styles accepted: `TRUE`/`FALSE` and `.T.`/`.TRUE.`/`.F.`/`.FALSE.` (dBASE III style). Output always uses `.T.`/`.F.`. Logical operators likewise: `NOT`/`.NOT.`, `AND`/`.AND.`, `OR`/`.OR.`.

## Testing

```bash
npm test                # Vitest unit + integration (164 tests)
npx playwright test     # E2E browser tests — requires dev server on :5173/:3000
```

Playwright suites: `tests/integration.spec.ts` (20 tests — full REPL scenario), `tests/assistant.spec.ts` (8 tests — sidebar, wizards, report designer, program run), `tests/inventory.spec.ts` (5 tests — INVENTORY.prg menu), `tests/multiarea.spec.ts` (4 tests — multi-work-area, relations, alias.field), `tests/demos.spec.ts` (3 tests — demo program seeding), `tests/splash.spec.ts` (1 test — version banner), `tests/copycsv.spec.ts` (2 tests — COPY TO download + APPEND FROM upload).

## Definition of done

Complete these steps **in order** — do not skip or reorder:

1. **Branch correctly** — work sits on a `feature/<name>` branched off the milestone's `release/vX.Y.Z`; the PR is based on that release branch, **not** `main` (see Git conventions → GitFlow). Confirm the issue is assigned to the matching milestone.
2. `npm test` passes — all tests green
   - **Every user-facing command/feature gets a Playwright e2e case, not just a vitest unit/integration test.** A REPL command needs at least one `tests/*.spec.ts` case that types it and asserts the rendered terminal/UI result; browser-only behavior (downloads, uploads, grid, wizards) must be exercised in a real browser. Unit coverage alone is not "done".
3. `package.json` version = the milestone's version (set on the `release/vX.Y.Z` branch); patch bumps for hotfixes
4. `CHANGELOG.md` — add entry (Added / Fixed / Changed sections) under the milestone version heading
5. `README.md` — command tables and feature list reflect what was built
6. `CLAUDE.md` — architecture, command tables, and roadmap updated
7. Screenshots — retake and commit if the UI changed (`docs/screenshots/`)
8. Any design doc in `docs/superpowers/` — mark completed items, note deviations
9. **Tag only on release** — `vX.Y.Z` is tagged when the `release/vX.Y.Z` branch merges to `main`, not on the feature branch.

Version scheme: 0.1.0 foundation → 0.2.0 indexing → 0.3.0 language completeness → 0.4.0 multi-work-area → 0.5.0 report engine → 0.6.0 assistant → 1.0.0 feature-complete (parity milestone) → 1.1.0+ beyond-parity. Versions are milestone-driven: each milestone ships on its own `release/vX.Y.Z` branch (see Git conventions).
