# WebBase-III

A feature-complete dBASE III revival for the modern web. Write W3Script commands in a terminal REPL, browse and edit data in a spreadsheet grid, build data-entry forms, run programs, and use indexes — all backed by a Node.js WebSocket server and SQLite.

## Features

- **W3Script interpreter** — dBASE III command dialect: navigation, filters, indexes, loops, forms, programs
- **BROWSE grid** — inline cell editing, keyboard navigation, index-ordered display
- **Form engine** — `@ ROW,COL SAY … GET` layout with `READ`
- **Indexing** — `INDEX ON`, `SEEK`, `FIND`, active index controls all record order
- **Program files** — save, edit, and run `.prg` scripts with `DO` / `EDIT`
- **Multi-user** — each WebSocket connection gets its own isolated interpreter session
- **Persistent storage** — `better-sqlite3` with WAL mode; databases survive server restart

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
```

For production:

```bash
npm run serve      # builds, then serves on http://localhost:3000
```

## LAN / Tailscale access

The server binds to all interfaces:

```
http://<tailscale-ip>:3000
```

## W3Script command reference

### Data & navigation

| Command | What it does |
|---|---|
| `USE <table>` | Select a table; restores any saved active index |
| `USE DATABASE <name>` | Open a named SQLite database |
| `LIST` | Print records in active index order (up to 500) |
| `LIST STRUCTURE` | Show column schema |
| `LIST TABLES` | Show all tables with record counts |
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

### Programs

| Command | What it does |
|---|---|
| `DO <name>` | Run a saved `.prg` program |
| `EDIT <name>` | Open `.prg` source editor |
| `LIST PROGRAMS` | Show all saved programs |

### Variables & I/O

| Command | What it does |
|---|---|
| `STORE <val> TO <var>` | Assign a variable |
| `INPUT "prompt" TO <var>` | Collect keyboard input |
| `@ r,c SAY "text" GET <var>` | Define a form field |
| `READ` | Display the form and wait for submit |

### Control flow

| Command | What it does |
|---|---|
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

## Example session

```
CREATE TABLE customers (name CHAR(40), phone CHAR(20), country CHAR(30))
USE customers
APPEND RECORD
REPLACE name WITH "Acme Corp", phone WITH "555-1234", country WITH "BE"
APPEND RECORD
REPLACE name WITH "Zeta Ltd", phone WITH "555-5678", country WITH "NL"
INDEX ON name TO BYNAME
LIST
SEEK "Zeta Ltd"
BROWSE
SET FILTER TO country == "BE"
LIST
SET FILTER TO
```

## Running tests

```bash
npm test
```

## License

AGPL-3.0 — see [LICENSE.md](LICENSE.md).
