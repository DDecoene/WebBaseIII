# Richer Inventory & CRM demos — design

**Issue:** #29 — Richer inventory & CRM demos showcasing v1.0.0 + v1.1.0 features.
**Milestone:** v1.1.0 — beyond parity.
**Date:** 2026-06-28.

## Goal

Rebuild `demos/crm.prg` and `demos/INVENTORY.prg` into two **genuinely usable** mini
applications — a small CRM and a small warehouse/inventory manager you could actually
run — that, as a natural consequence of being useful, exercise the v1.0.0 parity
close-out and v1.1.0 beyond-parity feature set. Each demo ships a seeded **report
definition** with group breaks and subtotals.

The demos are the first thing a visitor runs (`DO crm`, `DO inventory`), so the bar is
"could I keep my contacts / stock in this?", not "does it call every built-in".

## Shared mechanism — report-definition seeding (new)

`CREATE REPORT` / `MODIFY REPORT` open the interactive JSON editor (action `EDIT_PRG`
with a `__report_` prefix; the def is persisted only when the editor content is
submitted). There is **no W3Script command to define a report non-interactively**, so a
`.prg` cannot seed its own report. We mirror the existing program seeding:

- New directory `demos/reports/*.json` — single source of truth, like `demos/*.prg`.
- `server/DemoSeeder.ts` gains `seedDemoReports(reportsDir?)`: for each `*.json`, load
  it and call `reportStore.save(name, content)` (name = lowercased basename),
  overwriting any store copy — demos win on every server start.
- `server/index.ts` calls `seedDemoReports()` next to the existing
  `seedDemoPrograms()`.
- Each JSON validates against `ReportDef`:
  `{ title, pageWidth?, columns: [{field, heading, width, total?}], groupBy?,
  pageHeader?, pageFooter? }`.

A demo runs a report by `USE <table>` then `REPORT FORM <name>` (the runner reports over
the active area's table, honouring its filter).

## CRM demo (`crm.prg`)

Database `CRM`. Three work areas linked by `COMPID`.

### Schema
- **COMPANIES** — `COMPID CHAR(5)`, `NAME CHAR(40)`, `INDUSTRY CHAR(20)`, `CITY CHAR(20)`
- **CONTACTS** — `CONTID CHAR(6)`, `COMPID CHAR(5)`, `NAME CHAR(40)`, `EMAIL CHAR(40)`,
  `PHONE CHAR(20)`; relation → COMPANIES on `COMPID`
- **DEALS** — `DEALID CHAR(6)`, `COMPID CHAR(5)`, `TITLE CHAR(40)`, `STAGE CHAR(12)`,
  `VALUE NUM(12,2)`, `CLOSEMONTH NUM(6)`; relation → COMPANIES on `COMPID`.
  Stages: `Lead`, `Qualified`, `Proposal`, `Won`, `Lost`.

Seed a handful of companies, contacts, and deals across stages on first run (guarded by
`RECCOUNT() == 0`, matching the current INVENTORY pattern).

### Menu
1. **Add Company** — CRUD; SEEK guards duplicate `COMPID`.
2. **Add Contact** — validates `COMPID` exists (SEEK into COMPANIES); shows company name.
3. **Add Deal** — validates `COMPID`; captures stage + value.
4. **Search company** — SEEK; shows the company plus its contacts and deals via
   `alias.field` cross-area display.
5. **Pipeline summary** — `SUM VALUE FOR STAGE != "Won" .AND. STAGE != "Lost"` (open
   pipeline), `SUM VALUE FOR STAGE == "Won"` (won), `AVERAGE VALUE`, deal count via
   `RECCOUNT()`. Printed with `?` and `STR()`.
6. **Top deals** — `SORT ON VALUE/D TO TOPDEALS`, then `LIST`.
7. **Deals report** — `USE DEALS` then `REPORT FORM dealsbystage` (grouped by STAGE,
   VALUE subtotaled) → HTML preview.
8. **Export deals** — `COPY TO deals.csv` (browser download).
9. **Combined pipeline table** — `JOIN WITH COMP TO PIPELINE FOR DEALS.COMPID ==
   COMP.COMPID` materializes a companies+deals snapshot; LIST it.
10. **Browse deals** — opens the grid; prints a propagation invitation note first
    (see below).
Q. Quit.

## Inventory demo (`INVENTORY.prg`)

Database `INVDEMO`. Work areas CAT / INV / MOV. Keeps the existing Categories + Products,
adds a reorder level and a movements ledger.

### Schema
- **CATEGORIES** — `CATID CHAR(4)`, `CATNAME CHAR(30)`, `NOTES CHAR(60)` (unchanged)
- **PRODUCTS** — existing fields + `REORDER NUM(6)` (reorder level)
- **MOVEMENTS** — `MOVID CHAR(6)`, `PRODID CHAR(6)`, `KIND CHAR(3)` (IN/OUT),
  `QTY NUM(6)`, `MMONTH NUM(6)`, `REASON CHAR(30)`; relation → PRODUCTS on `PRODID`.

### Menu
1. **Add Category** / 2. **Add Product** (now captures reorder level).
3. **Receive stock** — append an IN movement and `REPLACE STOCK WITH STOCK + qty`.
4. **Issue stock** — append an OUT movement and `REPLACE STOCK WITH STOCK - qty`
   (guard against negative).
5. **Search product** — SEEK; shows category via relation + recent movements.
6. **Valuation & stock summary** — `SUM STOCK FOR ACTIVE`, `AVERAGE PRICE`, plus a
   value loop (stock × price); `?`/`STR()` formatted.
7. **Low-stock report** — `SET FILTER TO STOCK <= REORDER`, `REPORT FORM lowstock`,
   then clear filter.
8. **Movement history** — MOV area related to PRODUCTS, `alias.field` display.
9. **Top products by value** — `SORT ON PRICE/D TO TOPPROD`, LIST.
10. **Export products** — `COPY TO products.csv`.
11. **Catalog + products combined** — `JOIN WITH CAT TO CATALOG FOR PRODUCTS.CATID ==
    CAT.CATID`; LIST.
12. **Browse active products** — grid; propagation invitation note first.
Q. Quit.

## Report definitions (`demos/reports/`)

- `dealsbystage.json` — title "Sales Pipeline by Stage", `groupBy: "STAGE"`, columns
  `TITLE`, `COMPID`, `VALUE` (total: true).
- `lowstock.json` — title "Low Stock Report", `groupBy: "CATID"`, columns `NAME`,
  `STOCK`, `REORDER`, `PRICE`.

## Live propagation (#11) — invitation note

Single-session demos can't *demonstrate* multi-session propagation, so before opening the
grid (CRM option 10, Inventory option 12) the demo prints guidance, e.g.:

```
TIP: open a second browser window, DO this demo, and BROWSE the same table.
     Edit a record in one window — watch it refresh live in the other.
```

No automated step and no propagation assertion in the demo specs; the behavior itself is
already covered by `tests/propagation.spec.ts`.

## Decisions locked in

- Stock movements adjust product stock immediately via `REPLACE` (no separate posting).
- CSV filenames are fixed (`deals.csv`, `products.csv`).
- Menus are longer than today, but every option is a real, useful feature.
- First-run seeding guarded by `RECCOUNT() == 0`, re-runs don't reseed (regression guard
  already in `tests/inventory.spec.ts`).

## Discoverability — making the demos visible as usable starters

A user must be able to tell, without reading the repo, that `crm` and `inventory` are
complete, editable example apps they can build off. Four surfaces:

1. **Splash "Try a demo" block** (`src/terminal/Terminal.ts` `printWelcome`). Highest
   visibility — shown on every connect. Add after Quick start, e.g.:
   ```
   Try a full example app:
     DO crm         — a working mini-CRM (companies, contacts, deals)
     DO inventory   — a working stock manager (categories, products, movements)
   These are complete, editable programs — EDIT crm to copy and build your own.
   ```
2. **Assistant demo launchers** (`src/ui/Assistant.ts`). Add explicit friendly entries to
   the Programs category that run the demos on click — labels make intent obvious:
   `Run CRM demo (example app)` → `DO crm`, `Run Inventory demo (example app)` →
   `DO inventory`, plus the existing generic `Run program…` / `Edit program…` pickers
   (which already list `crm`/`inventory`). Ships with a Playwright case (satisfies the
   DoD Assistant-parity step explicitly rather than by the "run via DO" note).
3. **HELP demos section** (the HELP command output in `src/interpreter/Executor.ts`). Add
   a short "Demos / examples" block listing `DO crm` / `DO inventory` and "EDIT <name> to
   customize".
4. **Header comment in each `.prg`**. A clear comment block at the top of `crm.prg` and
   `INVENTORY.prg` (seen on `EDIT`) explaining it's a usable starter — what it does, how
   the tables relate, and "copy this file / EDIT it to adapt".

These surfaces are additive and small; each gets coverage (splash + HELP asserted in a
terminal e2e; the Assistant launchers in `tests/assistant.spec.ts`).

## Testing (Definition of Done)

- **`tests/inventory.spec.ts`** (extend) — receive stock changes stock; valuation totals;
  low-stock report renders; movement history; CSV export download; JOIN table created.
- **`tests/crm.spec.ts`** (new) — add company/contact/deal; pipeline summary numbers;
  top-deals sort; deals report renders (HTML preview); CSV export; JOIN table.
- **`tests/demos.spec.ts`** (extend) — assert the two report defs seed (visible via
  `LIST REPORTS` / catalog).
- **`tests/DemoSeeder` vitest** — `seedDemoReports()` writes the JSON defs to the store.
- **`tests/assistant.spec.ts`** (extend) — the two demo launcher actions
  (`Run CRM demo`, `Run Inventory demo`) run the demo and open its menu form (satisfies
  the DoD Assistant-parity step).
- **Splash + HELP** — a terminal e2e asserts the splash "Try a demo" block on connect and
  the HELP demos section (extend `tests/splash.spec.ts` / an integration case).

## Docs

- README + CLAUDE.md demo descriptions updated.
- CHANGELOG entry under 1.1.0.
- Retake demo screenshots if the demo UI changes materially.

## Implementation outcome (2026-06-28)

Shipped on `feature/29-richer-demos` (PR into `release/v1.1.0`). All six plan tasks
landed; full suites green (vitest 262, Playwright 73).

Notable events and deviations:

- **Surfaced a v1.0.0 bug mid-implementation.** Running `REPORT FORM` / `COPY TO` from
  inside the demo menu loops did nothing in the browser — the per-command client action
  was swallowed by the block executor. Latent bug (CSV since v1.0.0, report since
  v0.5.0). Fixed as **hotfix v1.0.1** off `main` (new `Executor.onSideEffect` sink),
  tagged + released, then merged forward into `release/v1.1.0` and this branch. The
  demos depend on that fix.
- **Inventory menu renumbered.** The rewrite reorganised the menu (added receive/issue
  stock, valuation, low-stock report; removed the old activate/deactivate flow), so the
  existing `tests/inventory.spec.ts` option-number cases were updated and the seed set
  changed (5 products, no "Stapler Heavy").
- **`REPORT FORM` needs a pause.** Both demos add an `INPUT "Press Enter"` after
  `REPORT FORM` so the preview is seen before the menu loop redraws.
- **CRM test isolation.** The `CRM` database persists server-side and is shared across
  suites; a stale `CONTACTS`/`BYNAME(LASTNAME)` index from another suite broke seeding in
  the full run. `tests/crm.spec.ts` `beforeEach` now drops the demo tables for a clean
  first-run seed. (Per-test DB teardown is tracked as issue #36.)
- **Discoverability:** all four surfaces shipped; `screenshot-assistant.png` retaken.
- **Added `SUM`/`AVERAGE … TO <var>` (issue #39).** Manual testing showed the summary
  screens rendered labels with no values: `SUM`/`AVERAGE` print to the terminal while
  `@ SAY` renders in the form overlay, so "(above: …)" captions were stranded. Added the
  dBASE `TO <var>` clause so a program can store a total and `@ SAY` it inline. Folded
  into this branch (the demos depend on it); 3 new vitest cases.
- **Demos start with `CLOSE ALL` (session-state hygiene).** Running one demo then another
  in the same REPL session leaked work areas/relations (e.g. `DO crm` then `DO inventory`
  → `** Error: no such table: COMPANIES`). Each demo now resets with `CLOSE ALL` first.

## Out of scope

- No new W3Script command for report definition (seeding covers the need).
- No schema migration tooling — demos drop/recreate their own tables on first run.
