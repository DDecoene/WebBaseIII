# Changelog

All notable changes to WebBase-III are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/) — minor bump per sub-project, patch for fixes, 1.0.0 when feature-complete.

---

## [0.4.1] — 2026-06-09

### Added
- **`LIST DATABASES`** — lists all `.sqlite3` databases in the data directory, marks the currently open one with `*`. Accepts `LIST DBS` as alias.
- **`demos/` directory** — `.prg` demo programs (`crm.prg`, `INVENTORY.prg`) visible in the repo; Playwright smoke tests auto-discover and run all demos

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
