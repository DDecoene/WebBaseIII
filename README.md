# WebBase-III

A dBASE III revival for the browser era. Write W3Script commands in a terminal REPL, browse and edit tables in a spreadsheet grid, and build data-entry forms — all over a WebSocket connection to a Node.js server backed by SQLite.

## Features

- **W3Script interpreter** — a dialect of classic dBASE III commands
- **BROWSE grid** — inline cell editing, keyboard navigation
- **Form engine** — `@ ROW,COL SAY … GET` layout with `READ`
- **Multi-user** — each WebSocket connection gets its own interpreter session; all sessions share the same SQLite file(s)
- **Persistent storage** — `better-sqlite3` with WAL mode on the server

## Quick start

```bash
npm install
npm run dev        # Vite + Node server, http://localhost:5173
```

For production:

```bash
npm run serve      # builds, then serves on http://localhost:3000
```

## Tailscale / LAN access

The server binds to all interfaces. From another machine on your Tailscale network:

```
http://<tailscale-ip>:3000
```

## W3Script command reference

| Command | What it does |
|---|---|
| `USE <table>` | Select a table |
| `USE DATABASE <name>` | Open a named SQLite database |
| `LIST` | Print all records (up to 500) |
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
| `REPLACE ALL <field> WITH <val>, ...` | Update field(s) on all (filtered) rows |
| `SET FILTER TO <expr>` | Set a WHERE clause; empty clears it |
| `STORE <val> TO <var>` | Assign a variable |
| `INPUT "prompt" TO <var>` | Collect keyboard input |
| `@ r,c SAY "text" GET <var>` | Define a form field |
| `READ` | Display the form and wait for submit |
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
LIST
BROWSE
SET FILTER TO country == "BE"
LIST
SET FILTER TO
```

## License

AGPL-3.0 — see [LICENSE.md](LICENSE.md).
