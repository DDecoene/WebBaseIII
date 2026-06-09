> **Status: COMPLETE** — implemented in v0.5.0

# Report Engine Design — v0.5.0

**Date:** 2026-06-09  
**Version target:** 0.5.0  
**Scope:** `REPORT FORM` command — stored report definitions, ASCII terminal rendering, in-browser HTML preview. `LABEL FORM` deferred to a later milestone.

---

## Goals

- Users can define, save, and run columnar reports against the active table
- Reports respect the current `SET FILTER` and active index order
- Output renders to the terminal (ASCII) and opens an in-browser HTML preview panel
- No files written to disk — all output via WebSocket to the browser
- Executor stays maintainable: report logic extracted into a dedicated `ReportRunner` class; start of a per-command-group file pattern used for all future sub-projects

---

## Commands

| Command | What it does |
|---|---|
| `CREATE REPORT <name>` | Create blank report definition JSON, open in program editor |
| `MODIFY REPORT <name>` | Open existing report definition in program editor |
| `REPORT FORM <name>` | Run the report — ASCII to terminal + HTML preview panel |
| `LIST REPORTS` | List all saved report definitions |
| `DELETE REPORT <name>` | Remove a report definition |

---

## Report Definition Format

Stored as JSON in `system.sqlite3` (`reports` table). Edited directly in the existing program editor.

```json
{
  "title": "Employee Report",
  "pageWidth": 80,
  "columns": [
    { "field": "name",   "heading": "Name",   "width": 25 },
    { "field": "dept",   "heading": "Dept",   "width": 15 },
    { "field": "salary", "heading": "Salary", "width": 10, "total": true }
  ],
  "groupBy": "dept",
  "pageHeader": "Confidential",
  "pageFooter": "Page {PAGE}"
}
```

**Fields:**
- `title` — printed at top of report
- `pageWidth` — total character width (default 80)
- `columns` — array of column definitions:
  - `field` — table field name (case-insensitive)
  - `heading` — column header text
  - `width` — column character width
  - `total` — if `true`, subtotal on group break + grand total at end
- `groupBy` — field name to group on; prints subtotal row on value change. Grouping relies on the active index order — user should `SET INDEX TO` a matching index before `REPORT FORM`
- `pageHeader` — printed above title on each page (optional)
- `pageFooter` — printed at bottom; `{PAGE}` replaced with page number (optional)

---

## Rendering

### ASCII (terminal)

```
Confidential
Employee Report

Name                      Dept             Salary
-------------------------  ---------------  ----------
Alice Moreau               Engineering       92000.00
Carol Smith                Engineering      105000.00
Eve Laurent                Engineering       98500.00
                                            ----------
** Engineering **                           295500.00

Bob Tanaka                 Marketing         74000.00
                                            ----------
** Marketing **                              74000.00

** Total **                                 369500.00
```

### HTML preview

- Sent as `{ type: 'report-preview', html: string }` WebSocket message
- Browser opens `#report-preview-view` panel (alongside terminal/grid/editor/form views)
- Clean monospace styling, print-ready via `Ctrl+P`
- Escape closes the preview and returns to terminal
- No HTML written to disk

---

## Architecture

### New files

**`server/ReportStore.ts`**  
Mirrors `ProgramStore`. Manages a `reports` table in `system.sqlite3`.
```typescript
class ReportStore {
  save(name: string, json: string): void
  load(name: string): string | null
  list(): string[]
  delete(name: string): void
}
```

**`server/ReportRunner.ts`**  
Pure rendering logic — no Express/WS dependencies. Takes a parsed `ReportDef` and row data, returns `{ ascii: string; html: string }`.
```typescript
class ReportRunner {
  run(def: ReportDef, rows: Record<string, unknown>[]): { ascii: string; html: string }
}
```

**`src/ui/ReportPreview.ts`**  
Browser-side panel manager. Shows/hides `#report-preview-view`, injects HTML, wires Escape.

### Changed files

| File | Change |
|---|---|
| `src/shared/types.ts` | Add `ReportDef` type; add `{ type: 'report-preview', html: string }` to `ServerMessage` union |
| `src/interpreter/Parser.ts` | Add AST nodes: `CREATE_REPORT`, `MODIFY_REPORT`, `REPORT_FORM`, `LIST_REPORTS`, `DELETE_REPORT` |
| `src/interpreter/Executor.ts` | Delegate report commands to `ReportRunner`; reuse existing `EDIT_PRG` action for `CREATE/MODIFY REPORT` |
| `server/Session.ts` | Instantiate `ReportStore` and `ReportRunner`; pass to Executor |
| `src/main.ts` | Wire `report-preview` WS message to `ReportPreview.show(html)` |
| `index.html` | Add `#report-preview-view` div |

### Executor refactor (start of command-group pattern)

Extract index-related methods from `Executor.ts` into `src/interpreter/IndexCommands.ts` and report methods into `src/interpreter/ReportCommands.ts`. Executor delegates via:
```typescript
private indexCmds = new IndexCommands(this)
private reportCmds = new ReportCommands(this)
```
This pattern is used for all future sub-projects (AssistantCommands, etc.).

---

## Error Handling

| Situation | Output |
|---|---|
| `REPORT FORM unknown` | `** Report 'unknown' not found` |
| Missing field in definition | Skip column, emit warning line |
| No table open | `** No table open` |
| Invalid JSON in definition | `** Invalid report definition: <parse error>` |
| Empty result set | Render headers + `(No records)` |

---

## Testing

**`tests/ReportStore.test.ts`** — unit: save, load, list, delete, overwrite, missing name  
**`tests/ReportRunner.test.ts`** — unit: column widths, group breaks, subtotals, grand totals, empty results, missing fields, HTML structure  
**`tests/Session.test.ts`** additions — integration: `CREATE REPORT`, `REPORT FORM`, `LIST REPORTS`, `DELETE REPORT` round-trips  
**`demos/REPORT.prg`** — demo program that sets up a table, creates a report definition, and runs `REPORT FORM`; picked up automatically by `tests/demos.spec.ts`

---

## Out of Scope (deferred)

- `LABEL FORM` — mailing label layouts
- `TO FILE` / export to disk — no files written outside SQLite
- Interactive report designer UI — belongs in "The Assistant" (v0.6.0)
- Pagination beyond page header/footer tokens

---

## Definition of Done

1. `npm test` passes
2. `package.json` bumped to `0.5.0`
3. `CHANGELOG.md` entry added
4. `README.md` command table updated
5. `CLAUDE.md` updated
6. Screenshots refreshed if UI changed
7. This spec marked complete
