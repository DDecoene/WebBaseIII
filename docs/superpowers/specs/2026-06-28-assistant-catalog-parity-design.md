# Assistant catalog parity (post-v0.6 commands) + DoD process fix

**Issue:** #33 — Bring the Assistant catalog up to date with post-v0.6 commands.
**Milestone:** v1.1.0 — beyond parity.
**Date:** 2026-06-28.

## Problem

The Assistant sidebar (`src/ui/Assistant.ts`) shipped as the v0.6.0 milestone. Every
user-facing command added **after** it — the v1.0.0 parity close-out and the v1.1.0
work — landed in the REPL but never appeared in the Assistant catalog, so the sidebar
drifted out of parity with the language. The Definition of Done never required updating
the Assistant when adding a command, which kept the drift invisible.

## Scope

**This PR (high-value items that map onto existing catalog data):**

- CSV import/export — `COPY TO <file>.csv` / `APPEND FROM <file>.csv` (#5)
- `SORT ON <field>[/D] TO <newtable>` (#8)
- `SUM` / `AVERAGE` over a numeric field (#3)
- `REINDEX`, `PACK` maintenance
- Process fix: amend the Definition of Done (CLAUDE.md + `feedback_definition_of_done`
  memory)

**Deferred to a follow-up issue** (need work-area state the catalog does not expose):

- `JOIN WITH <alias> TO <file> FOR <cond> [FIELDS <list>]` (#10)
- Work areas / `SET RELATION` (`SELECT <alias>`, `SET RELATION TO … INTO …`, clear)

The catalog message currently carries `databases`, `tables`, `columns`, `indexes`,
`reports`, `programs` — no list of *open* work areas / aliases. JOIN and SET RELATION
both need to offer the user another open area, so they require new catalog plumbing.
Splitting them out keeps this PR focused; a follow-up issue will add an `areas` list to
the Catalog and the JOIN/relation wizards.

## Design

### Catalog additions (`src/ui/Assistant.ts`)

The catalog is data-driven (`CATEGORIES: { name, actions: ActionDef[] }[]`). Most
additions are new `ActionDef` entries; SORT and aggregate get wizards.

**Data category** (append):

- `Export to CSV` — `needs: 'table'`, immediate `COPY TO <table>.csv`. Filename derived
  from the active table; the browser downloads the file.
- `Import from CSV` — `needs: 'table'`, immediate `APPEND FROM <table>.csv`. The browser
  opens a file picker; the filename arg only labels the round-trip.
- `Sort to new table…` — `needs: 'table'`, opens **SortWizard**.
- `Sum / Average…` — `needs: 'table'`, opens **AggregateWizard**.

**Search category** (append):

- `Reindex` — `needs: 'table'`, immediate `REINDEX`.

**Tables category** (append):

- `Pack database` — `needs: 'table'`, immediate `PACK` guarded by `confirm()`
  ("VACUUM rewrites the database file…").

### Active-table tracking

The CSV/REINDEX/PACK actions need the active table name to build their commands. The
Assistant already receives `status` messages carrying `table`. Store the table name in a
new `this.activeTable: string | null` field (set in the existing `status` handler
alongside `hasTable`) and use it to build `COPY TO <table>.csv` /
`APPEND FROM <table>.csv`.

### New wizards (`src/ui/wizards/`)

Both follow the existing `SearchWizard` / `FilterWizard` pattern: `WizardShell`, live
W3Script preview, OK disabled until well-formed, Esc to cancel. Each registers a new
`WizardName` in `Assistant.ts` and a `case` in `wizards/index.ts`.

- **SortWizard** (`'sort'`) — field dropdown (`catalog.columns`), "Descending" checkbox
  (`/D` suffix), target-table text input. Preview: `SORT ON <field>[/D] TO <newtable>`.
  OK disabled until a target name is given.
- **AggregateWizard** (`'aggregate'`) — operation select (SUM / AVERAGE), numeric-field
  dropdown (filter `catalog.columns` by type `/INT|REAL|NUM|DEC|FLOAT|DOUB/i`). Preview:
  `SUM <field>` / `AVERAGE <field>`. OK disabled when the table has no numeric columns.

### Process fix

- **CLAUDE.md** "Definition of done" — add a step: *every new user-facing
  command/feature is surfaced in the Assistant (catalog action and/or wizard) AND ships
  with a Playwright e2e case that clicks the Assistant action (or drives its wizard) and
  asserts the rendered REPL/UI result — OR the PR explains why the command does not
  belong in the Assistant. A vitest unit/integration test does not satisfy this; the
  Assistant path must be exercised in a real browser.*
- Update the `feedback_definition_of_done` memory to match.

## Testing

Every new Assistant action **must** have a Playwright e2e case in the same PR (per the
amended DoD) — a vitest unit/integration test does not count. Extend
`tests/assistant.spec.ts` (Playwright) with one case per new action — clicking the
action (or driving the wizard) must drive the REPL and assert the rendered result:

- Export to CSV — asserts a download is triggered.
- Import from CSV — asserts the file picker / upload round-trip (reuse the
  `copycsv.spec.ts` upload helper if cleaner).
- Sort to new table — asserts the new table exists with sorted rows.
- Sum / Average — asserts the printed total in the terminal.
- Reindex / Pack — assert the terminal confirmation line.

Standard DoD: `npm test` + `npx playwright test` green; `package.json` already at
`1.1.0` on the release branch; CHANGELOG + README + CLAUDE.md updated.

## Out of scope

Record `DELETE`/`RECALL`, `REPLACE`, `?`/`STORE`, `GO`/`SKIP` — BROWSE already covers
these or they are not GUI-shaped (per the issue's "lower priority / out of scope" list).
JOIN and Work areas/SET RELATION — deferred to a follow-up issue as noted above.
