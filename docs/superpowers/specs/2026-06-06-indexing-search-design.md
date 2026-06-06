# Indexing & Search — Design Spec
**Date:** 2026-06-06  
**Project:** WebBaseIII  
**Sub-project:** 2 of 5 (Indexing & Search)

---

## Overview

Add dBASE III–style indexing and record search to WebBaseIII. The active index controls record order everywhere (LIST, BROWSE, GO TOP/BOTTOM, SKIP) and enables SEEK/FIND for positioned lookup. Backed by SQLite indexes and metadata — no `.NDX` files.

---

## Data Model

Two new tables in `system.sqlite3`:

```sql
CREATE TABLE indexes (
  id         INTEGER PRIMARY KEY,
  table_name TEXT NOT NULL,
  tag        TEXT NOT NULL,       -- the "TO <tag>" name
  expression TEXT NOT NULL,       -- raw W3Script expression
  created_at INTEGER,
  UNIQUE(table_name, tag)
);

CREATE TABLE active_indexes (
  table_name TEXT PRIMARY KEY,
  tag        TEXT NOT NULL
);
```

- `indexes` stores every defined index (tag + W3Script expression) per table.
- `active_indexes` stores at most one active index per table.
- On `USE <table>`, the Executor queries `active_indexes` and restores the active index automatically — index state persists across sessions.
- The Executor gains one new runtime field: `activeIndex: { tag: string, expression: string } | null`.

---

## Query Layer

`DatabaseBridge` / the SQLite worker gains a `queryOrdered` method. All row-fetching operations (`LIST`, `BROWSE`, `GO TOP`, `GO BOTTOM`, `SKIP`) route through it when an active index is set.

**Simple field reference** (`lastname`, `salary`):  
→ Append `ORDER BY <field>` to SQL. Fast path — SQLite handles sorting.

**Compound / expression index** (`lastname+firstname`, `STR(salary,10)`):  
→ Fetch all rows unordered, sort in JavaScript using the W3Script Executor to evaluate the expression per row.

`SEEK <value>` / `FIND <string>`:
1. Evaluate the index expression for all rows (same JS sort path as above).
2. Binary-search the sorted result for the first row where the evaluated value matches.
3. Set `rowPtr` to that record.
4. If no match: position at EOF.
5. Set internal `_found` flag (`true` on match, `false` on miss) — consumed by `FOUND()` in sub-project 1 (Language Completeness).

---

## Commands

| Command | Behavior |
|---|---|
| `INDEX ON <expr> TO <tag>` | Stores expression + tag in `indexes`. For simple field references, also creates a real SQLite index on the table. Sets this as the active index. Requires an active table. |
| `SET INDEX TO <tag>` | Activates a previously created index. Writes to `active_indexes`. Updates Executor state. |
| `SET INDEX TO` | Clears active index. Removes row from `active_indexes`. Restores natural row order. |
| `REINDEX` | Rebuilds SQLite indexes for the current table. Useful after bulk changes. |
| `LIST INDEXES` | Prints all indexes for the current table with expressions and active marker. |
| `SEEK <expr>` | Positions record pointer to first match in active index. Prints "Record not found" if no match. Requires active table and active index. |
| `FIND <string>` | Alias for `SEEK`. Accepts an unquoted string — dBASE III legacy form. |

**Error handling:**
- `INDEX ON` / `SEEK` / `FIND` without an active table → "No table in use."
- `SEEK` / `FIND` without an active index → "No index active. Use SET INDEX TO <tag>."
- `SET INDEX TO <tag>` where tag doesn't exist → "Index '<tag>' not found."

---

## Affected Existing Commands

No logic changes — only their data source changes to route through `queryOrdered`:

- `LIST` — records appear in active index order
- `BROWSE` — grid displays rows in active index order
- `GO TOP` — first record in active index order
- `GO BOTTOM` — last record in active index order
- `SKIP <n>` — moves through records in active index order

---

## Testing

| Test case | Expected |
|---|---|
| `INDEX ON field TO tag` | Index stored in metadata, becomes active |
| `INDEX ON expr TO tag` | Compound expression stored correctly |
| `SET INDEX TO tag` | Activates index, persists in `active_indexes` |
| `SET INDEX TO` | Clears active index |
| `LIST` after index | Records in index order |
| `GO TOP` / `GO BOTTOM` | Respect index order |
| `SKIP` | Moves through records in index order |
| `SEEK <value>` (match) | `rowPtr` set to correct record, `_found = true` |
| `SEEK <value>` (no match) | Positioned at EOF, `_found = false` |
| `FIND <string>` | Identical behavior to `SEEK` |
| `USE` after index created | Active index restored from `active_indexes` |
| `LIST INDEXES` | Correct output with active marker |
| `REINDEX` | No error, SQLite index rebuilt |
| `SEEK` without active index | Clear error message |
| `INDEX ON` without active table | Clear error message |

---

## Out of Scope

- `.NDX` file import/export (DBF compatibility is off the table)
- Multiple simultaneous active indexes (one active index per table, matching dBASE III behavior)
- Index expressions involving built-in functions not yet implemented (`STR`, `SUBSTR`, etc.) — these will work once sub-project 1 (Language Completeness) is done; the infrastructure is ready
