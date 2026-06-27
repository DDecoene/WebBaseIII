# WebBase-III

**dBASE III is back. In your browser. `USE customers` like it's 1984.**

![WebBase-III demo — USE, LIST, SEEK, BROWSE](docs/screenshots/demo.gif)

Remember the dot prompt? Before SQL won, before ORMs, before anyone said "full-stack" — there was dBASE III. You typed `USE customers`, then `LIST`, and your data was just *there*. WebBase-III brings that whole world back: the terminal, the language, `BROWSE`, `@ SAY GET` forms, `.prg` programs, indexes, reports — rebuilt from scratch as a modern web app with its own interpreter in TypeScript, backed by Node.js, WebSockets, and SQLite.

**Try it in one click — no install:**

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/DDecoene/WebBaseIII?quickstart=1)

The Codespace installs dependencies and starts the dev server automatically. Open the forwarded port **5173** and you're at the dot prompt.

---

## Screenshots

### Terminal REPL

The command interface — type W3Script and see results instantly.

![Terminal REPL](docs/screenshots/screenshot-terminal.png)

---

### LIST — tabular record display

`LIST` prints all records in active index order. The status bar shows the active database and table.

![LIST output](docs/screenshots/screenshot-list.png)

---

### Indexing & SEEK

`INDEX ON name TO BYNAME` creates a SQLite index and activates it — subsequent `LIST` output is sorted alphabetically. `SEEK "Delta NV"` jumps the record pointer to the first match in O(log n).

![Index and SEEK](docs/screenshots/screenshot-index.png)

---

### BROWSE — editable grid

`BROWSE` opens a spreadsheet-style grid. Records are shown in active index order. Tab/Enter to edit a cell, Ctrl+N for a new row, Delete to remove a row, Esc to return to the terminal.

![BROWSE grid](docs/screenshots/screenshot-browse.png)

---

### Program editor

`EDIT <name>` opens the built-in `.prg` source editor. Programs support the full W3Script language: `DO CASE/ENDCASE`, `DO WHILE/ENDDO`, `IF/ENDIF`, form layouts, and all data commands. Ctrl+S saves, Esc cancels.

![Program editor](docs/screenshots/screenshot-program-editor.png)

---

### Form engine — `@ SAY GET` / `READ`

`@ row,col SAY "label" GET variable` lays out character-cell form fields. `READ` renders them as a live form and waits for the user to fill in values and submit.

![Form engine](docs/screenshots/screenshot-form.png)

---

### The Assistant — sidebar

The permanent left sidebar with category pickers and action buttons.

![The Assistant sidebar](docs/screenshots/screenshot-assistant.png)

---

### The Assistant — New table wizard

Wizards open in the main area with a live W3Script preview.

![New table wizard](docs/screenshots/screenshot-assistant-wizard.png)

---

## Features

| Feature | Details |
|---|---|
| **W3Script interpreter** | dBASE III command dialect: navigation, filters, variables, loops, conditionals, forms, programs |
| **BROWSE grid** | Inline cell editing, keyboard nav, index-ordered display |
| **Form engine** | `@ ROW,COL SAY … GET` character-cell layout with `READ` |
| **Indexing** | `INDEX ON`, `SEEK`, `FIND` — active index controls all record order |
| **DO CASE** | Multi-branch conditional, `OTHERWISE` fallback |
| **Built-in functions** | `EOF()`, `BOF()`, `FOUND()`, `RECNO()`, `SUBSTR()`, `STR()`, `AT()`, `CTOD()`, `DTOC()` and more |
| **Program files** | Save, edit, and run `.prg` scripts with `DO` / `EDIT` |
| **The Assistant** | Permanent left sidebar — open databases/tables, browse, filter, index, search, design reports, run programs without typing |
| **Multi-user** | Each WebSocket connection gets its own isolated interpreter session |
| **Persistent storage** | `better-sqlite3` with WAL mode — databases survive server restart |

---

## The Assistant

The sidebar on the left drives everything without typing: open or create databases and tables,
browse and filter data, build indexes, search, design and run reports, run programs, and modify
table structure. Every click generates a real W3Script command that echoes into the terminal —
watch it to learn the language. Wizards (New table, Filter, Modify structure, report designer, …)
open in the main area and show a live preview of the command they will run.

---

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

Production:

```bash
npm run serve      # builds, then serves everything on http://localhost:3000
```

LAN / Tailscale: the server binds to `0.0.0.0`, so `http://<tailscale-ip>:3000` works out of the box.

---

## Example session

```
USE DATABASE mydb
CREATE TABLE customers (name CHAR(40), phone CHAR(20), country CHAR(30))
USE customers

APPEND RECORD
REPLACE name WITH "Acme Corp", phone WITH "555-1234", country WITH "BE"
APPEND RECORD
REPLACE name WITH "Zeta Ltd", phone WITH "555-5678", country WITH "NL"

INDEX ON name TO BYNAME
LIST                        * sorted A→Z

SEEK "Zeta Ltd"             * jump to record instantly
BROWSE                      * open editable grid
SET FILTER TO country == "BE"
LIST                        * filtered view
SET FILTER TO               * clear filter
```

---

## W3Script command reference

### Work areas

WebBase-III supports **unlimited work areas** — each independently holding a table, record pointer, filter, and index. Link areas by key field using `SET RELATION TO` for relational data access. Cross-area field access uses `alias.field` dot notation.

> **Note:** dBASE III supported a maximum of 10 work areas (DOS file handle limit). WebBase-III has no such limit. dBASE III used `alias->field` arrow syntax; WebBase-III uses modern `alias.field` dot notation.

| Command | What it does |
|---|---|
| `SELECT <alias>` | Activate (or create) a work area by name |
| `USE <table> [ALIAS <name>]` | Open table in active area; optional alias override |
| `SET RELATION TO <expr> INTO <alias>` | Link active area to another; auto-seeks on every navigation |
| `SET RELATION TO` | Clear relation on active area |
| `LIST [col, alias.col, ...]` | List records; optional column list with cross-area fields |
| `LIST AREAS` | Show all open work areas, pointers, indexes, and relations |
| `CLOSE` | Close active area's table |
| `CLOSE ALL` | Close all work areas, reset to single empty area `1` |

**Cross-area field access**: use `alias.field` dot notation anywhere an expression is accepted — `SET FILTER TO`, `IF`, `REPLACE`, `LIST`, `INDEX ON`.

### Data & navigation

| Command | What it does |
|---|---|
| `USE <table>` | Select a table; restores any saved active index |
| `USE DATABASE <name>` | Open a named SQLite database |
| `LIST` | Print records in active index order (up to 500) |
| `LIST STRUCTURE` | Show column schema |
| `LIST TABLES` | Show all tables with record counts |
| `LIST DATABASES` | Show all databases on disk (alias: `LIST DBS`) |
| `BROWSE` | Open the editable grid |
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
| `COPY TO <file>.csv` | Export current table to a CSV download (honours filter + index order) |
| `APPEND FROM <file>.csv` | Import a CSV (browser file picker) into the current table |
| `MODIFY STRUCTURE` | Open the Modify-structure wizard for the active table |
| `ALTER TABLE <t> ADD <col> <type>` | Add a column to a table |
| `ALTER TABLE <t> DROP <col>` | Remove a column from a table |
| `ALTER TABLE <t> RENAME <col> TO <new>` | Rename a column |
| `ALTER TABLE <t> ALTER <col> <type>` | Change a column's type (copy-table dance; data preserved) |

> Column ops that can invalidate an index (DROP, RENAME, ALTER type) drop all of the table's indexes and warn you to rebuild with `INDEX ON`.

> **CSV format (`COPY TO` / `APPEND FROM`):** Unlike dBASE III's headerless,
> positional `DELIMITED`/`SDF` formats, WebBase-III uses modern **header-based CSV**
> (RFC-4180, mapped by column name). Export downloads through the browser and
> honours the active filter + index order. Import opens a file picker and is
> lenient: up to 10 bad rows are skipped and reported (line + reason); more than 10
> aborts with nothing appended. Limits: 5 MB import, 50,000-row export.

### Indexing & search

| Command | What it does |
|---|---|
| `INDEX ON <expr> TO <tag>` | Create index on expression; sets it active immediately |
| `SET INDEX TO <tag>` | Activate a previously created index |
| `SET INDEX TO` | Clear active index — restores natural insert order |
| `REINDEX` | Rebuild SQLite indexes for current table |
| `LIST INDEXES` | Print all indexes for current table with `*` active marker |
| `SEEK <expr>` | Position record pointer at first index match |
| `FIND <string>` | Alias for SEEK (unquoted string — dBASE III legacy form) |
| `SORT ON <field>[/D] TO <newtable>` | Write a sorted copy of the table to a new table; `/D` = descending; honours the active filter |

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
| `DO <name>` | Run a saved `.prg` program |
| `EDIT <name>` | Open `.prg` source editor |
| `LIST PROGRAMS` | Show all saved programs |

> Demo programs live in `demos/*.prg` and are the single source of truth: they are
> seeded into the program store on every server start, overwriting any store copy.
> Try `DO inventory` for a full interactive showcase (work areas, relations, indexes, forms).

### Variables & I/O

| Command | What it does |
|---|---|
| `? <expr>[, <expr>...]` | Evaluate expression(s) and print the result (numbers right-justified; bare `?` prints a blank line; `??` also accepted) |
| `STORE <val> TO <var>` | Assign a variable |
| `INPUT "prompt" TO <var>` | Collect keyboard input |
| `@ r,c SAY "text" GET <var>` | Define a form field |
| `READ` | Display the form and wait for submit |

### Control flow

| Command | What it does |
|---|---|
| `IF <cond> … ENDIF` | Conditional block |
| `DO WHILE <cond> … ENDDO` | Loop |
| `DO CASE … ENDCASE` | Multi-branch conditional (`CASE`, `OTHERWISE`) |
| `HELP` | Print command reference |
| `QUIT` | Exit |

### Built-in functions

Functions work anywhere an expression is accepted — `IF`, `DO WHILE`, `STORE`, `REPLACE`, `INDEX ON`, `SET FILTER TO`, etc.

| Function | Returns |
|---|---|
| `EOF()` | True if record pointer is past last record |
| `BOF()` | True if record pointer is before first record |
| `FOUND()` | True if last `SEEK` / `FIND` matched |
| `RECNO()` | Current record number |
| `RECCOUNT()` | Total records in current table |
| `UPPER(str)` | Uppercase |
| `LOWER(str)` | Lowercase |
| `TRIM(str)` | Strip leading and trailing spaces |
| `LTRIM(str)` | Strip leading spaces only |
| `SUBSTR(str, start, len)` | Substring — 1-based; `len` optional (to end) |
| `LEN(str)` | String length |
| `AT(needle, haystack)` | 1-based position; 0 if not found (case-sensitive) |
| `STR(num, len, dec)` | Number to right-justified string; default len=10, dec=0 |
| `VAL(str)` | String to number; non-numeric → 0 |
| `INT(n)` | Truncate toward zero |
| `ABS(n)` | Absolute value |
| `SPACE(n)` | String of n spaces |
| `REPLICATE(str, n)` | Repeat string n times |
| `DATE()` | Today as `MM/DD/YY` |
| `DTOC(date)` | Date to display string `MM/DD/YY` |
| `CTOD(str)` | Display string `MM/DD/YY` to ISO date |
| `ROUND(num, dec)` | Rounds number to `dec` decimal places (default 0) |
| `MOD(a, b)` | Remainder of `a` divided by `b` |
| `MAX(a, b)` | Maximum of `a` and `b` |
| `MIN(a, b)` | Minimum of `a` and `b` |
| `TIME()` | Current time as `HH:MM:SS` |
| `YEAR(date)` | Numeric year from ISO date string |
| `MONTH(date)` | Numeric month from ISO date string |
| `DAY(date)` | Numeric day from ISO date string |

### Boolean literals

W3Script supports both styles:

| Syntax | Value |
|---|---|
| `TRUE` / `FALSE` | Boolean true/false |
| `.T.` / `.TRUE.` | Boolean true (dBASE III style) |
| `.F.` / `.FALSE.` | Boolean false (dBASE III style) |

Boolean values display as `.T.` / `.F.` in output to match dBASE conventions.

Logical operators are accepted in both styles too: `NOT` / `.NOT.`, `AND` / `.AND.`, `OR` / `.OR.` (e.g. `DO WHILE .NOT. EOF()`).

---

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

---

## Architecture

```
server/
  index.ts              Node.js HTTP + WebSocket server (port 3000)
  Session.ts            Per-connection session: parses commands, drives Executor
  SessionManager.ts     Tracks all active sessions
  ServerDatabaseBridge.ts  IDatabaseBridge impl wrapping better-sqlite3
  ProgramStore.ts       .prg program storage in data/system.sqlite3
  IndexStore.ts         Index metadata + active index in data/system.sqlite3

src/
  interpreter/
    Lexer.ts            Tokenises W3Script input (case-insensitive)
    Parser.ts           Recursive-descent AST builder
    Executor.ts         Async AST runner; manages db/table/filter/vars/rowPtr/activeIndex
    Builtins.ts         Stateless built-in function implementations

  terminal/
    Terminal.ts         REPL UI — command history, multi-line block accumulation

  ui/
    Grid.ts             BROWSE spreadsheet — inline cell editing, keyboard nav
    FormLayout.ts       @ SAY GET form engine — character-cell coordinates
    ProgramEditor.ts    .prg source editor UI

  ws/
    WsClient.ts         Browser WebSocket client
```

---

## Running tests

```bash
npm test                    # unit + integration tests (Vitest)
npx playwright test         # end-to-end browser tests (requires dev server running)
```

The Playwright suite (`tests/integration.spec.ts`, `tests/crm.spec.ts`) drives a real browser against the running app and covers navigation, filters, indexing, programs, forms, and BROWSE.

---

## Contributors

Huge thanks to everyone who has helped extend WebBase-III:

- **[@kas2804](https://github.com/kas2804) (Kasturi Rajarampatil)** — added the
  `ROUND`, `MOD`, `MAX`, `MIN`, `TIME`, `YEAR`, `MONTH`, and `DAY` built-in
  functions ([#4](https://github.com/DDecoene/WebBaseIII/issues/4), PR
  [#17](https://github.com/DDecoene/WebBaseIII/pull/17)) — clean, well-tested
  work that brought the W3Script expression engine closer to full dBASE III
  parity. 🙌

---

## License

AGPL-3.0 — see [LICENSE.md](LICENSE.md).

Why AGPL? WebBase-III is a toy, and the license keeps it that way: anyone can use it, fork it, and learn from it, but nobody can take it closed and sell it as a hosted service without giving their changes back. If you want to run it, hack it, or ship features from your dBASE memories — that's exactly what it's for.
