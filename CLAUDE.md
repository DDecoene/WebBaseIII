# WebBase-III

Browser-native dBASE III revival. Runs entirely in a single browser tab — no server, no dependencies at runtime. SQLite Wasm + OPFS for persistent storage, custom W3Script interpreter, terminal REPL, editable grid, and form layout engine.

## Stack

- **Vite** — build tool / dev server
- **TypeScript** — strictly typed throughout
- **@sqlite.org/sqlite-wasm** — official SQLite compiled to WebAssembly, running in a DedicatedWorker with the OPFS VFS for persistent local storage

## Running the project

```bash
npm install   # also copies public/sqlite3.wasm via postinstall
npm run dev   # http://localhost:5173
```

> **Important:** the dev server must send COOP/COEP headers (already configured in `vite.config.ts`) for SharedArrayBuffer and OPFS to work. Do not serve the files with a plain static server.

## Architecture

```
src/
  db/
    db.worker.ts        SQLite Wasm runs here (DedicatedWorker)
                        Handles: openDb, exec, query, tables, structure, rowCount
                        Falls back to in-memory if OPFS is unavailable
    DatabaseBridge.ts   Main-thread interface — promisified postMessage to the worker

  interpreter/
    Lexer.ts            Tokenises W3Script input (case-insensitive)
    Parser.ts           Recursive-descent AST builder
    Executor.ts         Async AST runner; manages state (db/table/filter/vars/rowPtr)

  terminal/
    Terminal.ts         REPL UI — command history, multi-line block accumulation

  ui/
    Grid.ts             BROWSE spreadsheet — inline cell editing, keyboard nav
    FormLayout.ts       @ SAY GET form engine — character-cell coordinates

  main.ts               Boot: init bridge → executor → terminal
  vite-env.d.ts         Vite client types (needed for ?worker imports)
  styles/main.css       Classic green-on-black terminal + grid + form styles

public/
  sqlite3.wasm          Copied from node_modules by postinstall script

scripts/
  copy-wasm.cjs         postinstall helper — copies the WASM binary to public/
```

## W3Script commands implemented (Phase 1)

| Command | What it does |
|---|---|
| `USE <table>` | Open/select a table (opens `webbaseiii.sqlite3` if no DB is active) |
| `USE DATABASE <name>` | Open a named SQLite database |
| `LIST` | Print all records (up to 500) |
| `LIST STRUCTURE` | Show column schema |
| `LIST TABLES` | Show all tables with record counts |
| `BROWSE` | Open the editable spreadsheet grid |
| `CLEAR` | Clear terminal output |
| `CREATE TABLE <n> (col TYPE, ...)` | Create a new table |
| `DROP TABLE <name>` | Delete a table |
| `APPEND RECORD` | Insert a blank row |
| `DELETE` / `DELETE ALL` | Delete current or all records |
| `PACK` | VACUUM the SQLite file |
| `GO TOP` / `GO BOTTOM` / `GO <n>` | Move record pointer |
| `SKIP <n>` | Move pointer forward/back |
| `REPLACE ALL <field> WITH <val>` | UPDATE field on all (or filtered) rows |
| `SET FILTER TO <expr>` | Set a WHERE clause; empty = clear |
| `STORE <val> TO <var>` | Assign a variable |
| `INPUT "prompt" TO <var>` | Collect input via a form |
| `@ r,c SAY "text" GET <var>` | Build a form field |
| `READ` | Show the form, pause execution, resume after submit |
| `IF <cond> … ENDIF` | Conditional block |
| `DO WHILE <cond> … ENDDO` | Loop |
| `HELP` | Print command reference |
| `QUIT` | Exit |

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

## Known issues / next steps (Phase 2)

- **Blank screen on load**: the COOP/COEP headers are required — use `npm run dev`, not a plain file open or static server.
- **OPFS availability**: Chrome/Edge support OPFS in workers; Firefox requires a flag; Safari 16.4+. If unavailable, data is in-memory (lost on refresh).
- **Planned**: `.prg` program files, REPORT FORM, INDEX ON, multi-work-area support, PWA service worker, syntax highlighting in the REPL.

## Example session

```
CREATE TABLE customers (name CHAR(40), phone CHAR(20), country CHAR(30))
USE customers
APPEND RECORD
REPLACE name WITH "Acme Corp", phone WITH "555-1234", country WITH "BE"
LIST
BROWSE
SET FILTER TO country == "BE"
LIST
SET FILTER TO
```
