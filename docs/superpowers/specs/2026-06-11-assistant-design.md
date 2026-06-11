> **Status: COMPLETE** — implemented in v0.6.0

# The Assistant Design — v0.6.0

**Date:** 2026-06-11
**Version target:** 0.6.0
**Scope:** Menu-driven GUI for non-programmers — roadmap sub-project 5, the last before 1.0.0.

---

## Goals

- A non-programmer can create databases and tables, edit data, filter, search, build and run reports, and run programs without typing a single command
- Every Assistant action **generates a W3Script command** and submits it exactly as if typed — the command and its output appear in the terminal history, teaching the language as a side effect
- The Assistant holds no session state of its own; the interpreter session is the single source of truth, so terminal and Assistant can never disagree
- No retro fiction: a modern sidebar workspace, not a recreation of the 1985 ASSIST screen

## Decisions made during brainstorming

| Question | Decision |
|---|---|
| Visual direction | Modern GUI (not authentic 1985 menu bar, not hybrid) |
| Scope | All four groups: core data, search & indexes, reports + guided builder, programs |
| Relation to terminal | **Split view** — Assistant permanently visible beside the terminal |
| Placement | **Permanent left sidebar**, collapsible; main area unchanged |
| Engine mechanism | **Generate W3Script** through the normal command path (no parallel execution path) |
| Guided flows | **Wizards take over the main area** like BROWSE/editor; simple actions run immediately |
| Implementation | Client-side UI + one new `catalog-request`/`catalog` WS pair for structured picker data |

---

## Architecture

```
src/ui/Assistant.ts        Sidebar: 6 categories, action dispatch, enable/disable from status
src/ui/wizards/
  WizardShell.ts           Shared chrome: title, fields, live W3Script preview, OK/Esc
  TableWizard.ts           New table… (name + column rows: name, type, length)
  FilterWizard.ts          Filter… (column, operator ==/!=/>/</>=/<=, value — handles string quoting)
  IndexWizard.ts           New index… (column or expression + tag)
  SearchWizard.ts          Find record… (index picker + value → SET INDEX TO + SEEK)
  ReportWizard.ts          3-step report designer (see below)
server/Session.ts          + 'catalog-request' handler → 'catalog' reply
src/shared/types.ts        + CatalogRequest / Catalog message shapes
index.html / main.ts       flex wrapper: sidebar + existing main area; wiring
```

### Data flow

1. User clicks a sidebar action or finishes a wizard
2. Client builds a W3Script string (`USE customers`, `SET FILTER TO age > 30`, …)
3. The string is submitted through the same code path as typed terminal input — it echoes into the terminal history followed by its output
4. The session's `status` message updates the status bar as today
5. Assistant re-sends `catalog-request`; the `catalog` reply refreshes all pickers

### The catalog message

`catalog-request` (no payload) → `catalog`:

```json
{
  "type": "catalog",
  "databases": ["INVDEMO", "crm"],
  "tables": [{ "name": "PRODUCTS", "count": 6 }],
  "columns": [{ "name": "NAME", "colType": "TEXT" }],
  "indexes": [{ "tag": "BYNAME", "expression": "UPPER(NAME)", "active": true }],
  "reports": [{ "name": "stocklist", "content": "{…}" }],
  // content rides along so Edit-report can prefill the designer without a second round-trip
  "programs": ["inventory", "crm", "report"]
}
```

Sources already exist: databases from the data dir listing, tables + counts from the bridge, `columns` for the **active table** via `getStructure` (empty when none), indexes from `indexStore`, reports from `reportStore`, programs from `programStore`. Implemented in `Session.ts` (~50 lines), no new stores.

---

## Sidebar contents

| Category | Immediate actions | Wizards |
|---|---|---|
| Database | Open (picker) | New database… (single name field) |
| Tables | Open (picker), Structure, Drop (confirm naming the table) | New table… |
| Data | Browse, Add record, Clear filter | Filter… |
| Search | Set index (picker incl. "natural order") | New index…, Find record… |
| Reports | Run (picker) | New report…, Edit report… (picker → designer) |
| Programs | Run (picker), Edit (picker → existing program editor) | — |

Actions requiring an open table (Browse, Filter…, Structure, all of Search) are disabled until the status message reports one.

Generated commands per action (representative):

| Action | W3Script emitted |
|---|---|
| Open database | `USE DATABASE <name>` |
| Open table | `USE <name>` |
| New table wizard | `CREATE TABLE <name> (<col> <TYPE>(<len>), …)` |
| Structure | `LIST STRUCTURE` |
| Drop table | `DROP TABLE <name>` |
| Browse | `BROWSE` |
| Add record | `APPEND RECORD` then `BROWSE` |
| Filter wizard | `SET FILTER TO <col> <op> <value>` |
| Clear filter | `SET FILTER TO` |
| New index wizard | `INDEX ON <expr> TO <tag>` |
| Set index | `SET INDEX TO <tag>` / `SET INDEX TO` |
| Find record wizard | `SET INDEX TO <tag>` then `SEEK <value>` |
| Run report | `REPORT FORM <name>` |
| Run program | `DO <name>` |

## Wizards

All wizards render in the main area (the existing view-swap mechanism that BROWSE, forms, and the editor use), with a shared shell: title, form fields, a **live W3Script preview** that updates per keystroke, a primary button, and Esc to cancel back to the terminal view.

**Report designer** (3 steps) produces the existing report definition JSON — same schema `ReportRunner` consumes today (`title`, `pageWidth`, `columns[{field, heading, width, total}]`, `groupBy`, `pageHeader`, `pageFooter`):

1. Name, title, page width (table must be open; fields come from `catalog.columns`)
2. Columns: checkbox per field, heading + width per checked field, `total` toggle for numeric fields
3. Grouping (optional field picker) + header/footer

Saving uses the existing `save-program` message with the `__report_` name prefix (the path `MODIFY REPORT` already uses). Final step offers **Save** and **Save & run** (emits `REPORT FORM <name>`). "Edit report…" loads the stored JSON back into the same wizard.

## Error handling

- Engine errors surface as error lines in the terminal, as for typed commands; the Assistant adds no duplicate error UI
- Client-side validation keeps wizards open: empty/invalid fields show an inline message and disable the primary button; the W3Script preview renders only when the command is well-formed
- String filter/seek values are quoted by the wizard; quotes inside values are rejected with an inline message (the language has no escape syntax)
- `catalog` with no database/table open returns empty lists for the missing parts; the sidebar disables dependent actions instead of erroring
- Drop table requires a confirm step that names the target

## Testing

- **vitest (TDD):** `catalog-request` round-trip — open db, create table + index, save report/program, request catalog, assert all sections populated; empty-session catalog returns empty lists without error
- **Playwright `tests/assistant.spec.ts`:** sidebar renders and collapses; New table wizard creates a table and the `CREATE TABLE` echo appears in terminal history; Browse opens the grid; Filter wizard filters LIST output; New index + Find record positions the pointer; report designer builds, saves, and runs a report; Run program starts `inventory` from the sidebar
- Existing suites must stay green (the sidebar must not break view-swapping for grid/forms/editor)

## Out of scope (deferred)

- Multi-work-area / relations UI — power-user feature, terminal only for now
- `LABEL FORM` (already deferred from 0.5.0)
- Query builder beyond single-condition filter (no AND/OR composition in v1)
- Authentic 1985 ASSIST skin as an alternative theme

## Definition of done

Per CLAUDE.md: tests green → version 0.6.0 → CHANGELOG → README → CLAUDE.md (commands/architecture/roadmap) → **new screenshots** (UI changes) → this spec marked COMPLETE with deviations noted.
