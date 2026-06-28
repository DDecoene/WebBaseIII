# Richer Inventory & CRM Demos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `crm.prg` and `INVENTORY.prg` into usable example apps that tour the v1.0.0 + v1.1.0 feature set, seed a report definition per demo, and make the demos discoverable (splash, HELP, Assistant, file headers).

**Architecture:** Demo `.prg` files are seeded from `demos/*.prg` into the program store on every server start (`server/DemoSeeder.ts`); we add a parallel `demos/reports/*.json` → report store seeding. The demos are W3Script programs using the proven idioms already in the current `INVENTORY.prg` (work areas, `SET RELATION`, `alias.field`, `SEEK`, `DO CASE`, `@ SAY/GET`, `READ`) plus the newer commands (`SUM/AVERAGE … FOR`, `SORT ON …/D TO`, `COPY TO`, `JOIN WITH … TO … FOR`, `REPORT FORM`).

**Tech Stack:** TypeScript, W3Script (the app's own language), Vitest, Playwright.

**Execution note:** Run tasks **serially in one worktree** (Tasks 5–6 touch shared specs/Assistant). Each task ends green and committed before the next.

**W3Script gotchas (apply throughout):**
- Inside `FOR`/filter conditions use SQL-compatible operators and **`AND`/`OR` barewords** (not `.AND.`), e.g. `SUM VALUE FOR STAGE != "Won" AND STAGE != "Lost"`. String literals in conditions are auto-requoted to single quotes by the parser.
- `JOIN WITH <area> TO <file> FOR <cond>` — `<cond>` references the **work-area aliases** with dot notation, e.g. `FOR DEAL.COMPID == COMP.COMPID` where `DEAL` is the active area and `COMP` the `WITH` area.
- Each work area must `USE DATABASE <db>` after `SELECT <area>` (work areas track their own db binding).
- First-run seeding is guarded by `RECCOUNT() == 0` (matches the existing INVENTORY pattern; `tests/inventory.spec.ts` guards against re-seeding).

---

## Task 1: Report-definition seeding

**Files:**
- Modify: `server/DemoSeeder.ts`
- Modify: `server/index.ts`
- Test: `tests/DemoSeeder.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/DemoSeeder.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { seedDemoReports } from '../server/DemoSeeder';
import { reportStore } from '../server/ReportStore';

describe('seedDemoReports', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb3-reports-'));
  });

  it('seeds each *.json into the report store under its lowercased basename', () => {
    const def = JSON.stringify({ title: 'X', columns: [{ field: 'A', heading: 'A', width: 5 }] });
    fs.writeFileSync(path.join(dir, 'MyReport.json'), def);
    const seeded = seedDemoReports(dir);
    expect(seeded).toContain('myreport');
    expect(reportStore.load('myreport')).toBe(def);
  });

  it('ignores non-json files and returns [] for a missing dir', () => {
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'hi');
    expect(seedDemoReports(dir)).toEqual([]);
    expect(seedDemoReports(path.join(dir, 'nope'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/DemoSeeder.test.ts`
Expected: FAIL — `seedDemoReports` is not exported.

- [ ] **Step 3: Implement `seedDemoReports`**

In `server/DemoSeeder.ts`, add the import and the function (keep the existing `seedDemoPrograms`):

```typescript
import { reportStore } from './ReportStore.js';

const REPORTS_DIR = path.join(process.cwd(), 'demos', 'reports');

/**
 * Seeds every demos/reports/*.json into the report store under its lowercased
 * basename, overwriting any store copy — like seedDemoPrograms, the files win
 * on every server start. Returns the seeded report names.
 */
export function seedDemoReports(reportsDir = REPORTS_DIR): string[] {
  if (!fs.existsSync(reportsDir)) return [];
  const seeded: string[] = [];
  for (const file of fs.readdirSync(reportsDir)) {
    if (!file.toLowerCase().endsWith('.json')) continue;
    const name = path.basename(file, path.extname(file)).toLowerCase();
    reportStore.save(name, fs.readFileSync(path.join(reportsDir, file), 'utf8'));
    seeded.push(name);
  }
  return seeded;
}
```

- [ ] **Step 4: Wire it into startup**

In `server/index.ts`, next to `const seededDemos = seedDemoPrograms();`, add:

```typescript
import { seedDemoPrograms, seedDemoReports } from './DemoSeeder.js';
// ...
const seededDemos = seedDemoPrograms();
const seededReports = seedDemoReports();
```

(Adjust the existing import line rather than adding a duplicate. If there is a startup log line listing seeded demos, extend it to mention `seededReports.length` reports.)

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/DemoSeeder.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server/DemoSeeder.ts server/index.ts tests/DemoSeeder.test.ts
git commit -m "feat(demos): seed report definitions from demos/reports/*.json (#29)"
```

---

## Task 2: Report definition JSON files

**Files:**
- Create: `demos/reports/dealsbystage.json`
- Create: `demos/reports/lowstock.json`

- [ ] **Step 1: Create `demos/reports/dealsbystage.json`**

```json
{
  "title": "Sales Pipeline by Stage",
  "pageWidth": 80,
  "columns": [
    { "field": "TITLE", "heading": "Deal", "width": 30 },
    { "field": "COMPID", "heading": "Company", "width": 10 },
    { "field": "VALUE", "heading": "Value", "width": 14, "total": true }
  ],
  "groupBy": "STAGE",
  "pageHeader": "WebBase-III CRM — Pipeline",
  "pageFooter": "Page {PAGE}"
}
```

- [ ] **Step 2: Create `demos/reports/lowstock.json`**

```json
{
  "title": "Low Stock Report",
  "pageWidth": 80,
  "columns": [
    { "field": "NAME", "heading": "Product", "width": 30 },
    { "field": "STOCK", "heading": "Stock", "width": 8, "total": true },
    { "field": "REORDER", "heading": "Reorder", "width": 8 },
    { "field": "PRICE", "heading": "Price", "width": 10 }
  ],
  "groupBy": "CATID",
  "pageHeader": "WebBase-III Inventory — Low Stock",
  "pageFooter": "Page {PAGE}"
}
```

- [ ] **Step 3: Validate the JSON parses**

Run: `node -e "JSON.parse(require('fs').readFileSync('demos/reports/dealsbystage.json')); JSON.parse(require('fs').readFileSync('demos/reports/lowstock.json')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add demos/reports/dealsbystage.json demos/reports/lowstock.json
git commit -m "feat(demos): seeded report definitions for CRM + inventory (#29)"
```

---

## Task 3: Rebuild the CRM demo

**Files:**
- Modify (full rewrite): `demos/crm.prg`
- Test: `tests/crm.spec.ts` (create)

- [ ] **Step 1: Write the failing e2e test**

Create `tests/crm.spec.ts` (modelled on `tests/inventory.spec.ts` helpers):

```typescript
/** Playwright E2E for demos/crm.prg — usable mini-CRM showcase. */
import { test, expect, Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PRG_SRC = fs.readFileSync(path.join(__dirname, '..', 'demos', 'crm.prg'), 'utf8');
const PRG_NAME = 'crm';

async function cmd(page: Page, command: string, waitMs = 700): Promise<void> {
  const input = page.locator('#terminal-input');
  await input.fill(command);
  await input.press('Enter');
  await page.waitForTimeout(waitMs);
}
async function waitForOutput(page: Page, text: string, timeout = 6000): Promise<void> {
  await expect(page.locator('#terminal-output')).toContainText(text, { timeout, ignoreCase: true });
}
async function boot(page: Page): Promise<void> {
  await page.goto('http://localhost:5173');
  await waitForOutput(page, 'Connected.', 8000);
}
async function seedProgram(page: Page): Promise<void> {
  await cmd(page, `EDIT ${PRG_NAME}`, 1500);
  await expect(page.locator('#editor-view')).toBeVisible({ timeout: 6000 });
  await page.locator('#editor-textarea').fill(PRG_SRC);
  await page.waitForTimeout(300);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(400);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
}
async function menuChoice(page: Page, choice: string): Promise<void> {
  await expect(page.locator('#form-view')).toBeVisible({ timeout: 6000 });
  const input = page.locator('#form-view input.f-get').last();
  await input.fill(choice);
  await input.press('Enter');
  await page.waitForTimeout(1500);
}

test.describe('CRM demo', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    await seedProgram(page);
    await cmd(page, `DO ${PRG_NAME}`, 1800);
  });

  test('runs and shows the main menu', async ({ page }) => {
    await expect(page.locator('#form-view')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#form-view')).toContainText('CRM', { timeout: 6000 });
  });

  test('pipeline summary prints totals', async ({ page }) => {
    await menuChoice(page, '5');
    await expect(page.locator('#form-view, #terminal-output').first()).toContainText(/Pipeline|Open|Won/i, { timeout: 6000 });
  });

  test('top deals sorts into a new table', async ({ page }) => {
    await menuChoice(page, '6');
    await waitForOutput(page, 'TOPDEALS', 6000);
  });

  test('deals report renders the HTML preview', async ({ page }) => {
    await menuChoice(page, '7');
    await expect(page.locator('#report-preview-view')).toBeVisible({ timeout: 8000 });
    await page.keyboard.press('Escape');
  });

  test('export deals downloads a CSV', async ({ page }) => {
    const dl = page.waitForEvent('download');
    await menuChoice(page, '8');
    const d = await dl;
    expect(d.suggestedFilename().toLowerCase()).toContain('deals');
  });

  test('combined pipeline JOIN builds a table', async ({ page }) => {
    await menuChoice(page, '9');
    await waitForOutput(page, 'PIPELINE', 6000);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx playwright test tests/crm.spec.ts`
Expected: FAIL — the rewritten `crm.prg` doesn't exist yet, so menus/options don't match.

- [ ] **Step 3: Rewrite `demos/crm.prg`**

Replace the entire file with the program below. (It follows the proven idioms in the current `INVENTORY.prg`.)

```
* ============================================================
* crm.prg — WebBase-III CRM (usable example app)
*
* A working mini-CRM you can actually keep contacts & deals in.
* Three linked tables: COMPANIES, CONTACTS, DEALS.
* Shows: multi-work-area + SET RELATION, alias.field, SEEK,
*        SUM/AVERAGE ... FOR, SORT ON .../D TO, REPORT FORM,
*        COPY TO csv, JOIN WITH ... TO ... FOR.
*
* COPY THIS FILE (or EDIT crm) to build your own CRM.
* ============================================================

USE DATABASE CRM

SELECT COMP
USE DATABASE CRM
USE COMPANIES

SELECT DEAL
USE DATABASE CRM
USE DEALS

SELECT CONT
USE DATABASE CRM
USE CONTACTS

* ── First-run seeding ───────────────────────────────────────
IF RECCOUNT() == 0
  SELECT COMP
  IF RECCOUNT() == 0
    DROP TABLE COMPANIES
    CREATE TABLE COMPANIES (COMPID CHAR(5), NAME CHAR(40), INDUSTRY CHAR(20), CITY CHAR(20))
    INDEX ON COMPID TO BYCOMP
    APPEND RECORD
    REPLACE COMPID WITH "ACME", NAME WITH "Acme Corp", INDUSTRY WITH "Manufacturing", CITY WITH "Brussels"
    APPEND RECORD
    REPLACE COMPID WITH "GLOBX", NAME WITH "Globex", INDUSTRY WITH "Energy", CITY WITH "Antwerp"
    APPEND RECORD
    REPLACE COMPID WITH "INITC", NAME WITH "Initech", INDUSTRY WITH "Software", CITY WITH "Ghent"
  ENDIF

  SELECT DEAL
  DROP TABLE DEALS
  CREATE TABLE DEALS (DEALID CHAR(6), COMPID CHAR(5), TITLE CHAR(40), STAGE CHAR(12), VALUE NUM(12,2), CLOSEMONTH NUM(6))
  INDEX ON DEALID TO BYDEAL
  INDEX ON COMPID TO DEALCOMP
  APPEND RECORD
  REPLACE DEALID WITH "D00001", COMPID WITH "ACME", TITLE WITH "Annual supply contract", STAGE WITH "Proposal", VALUE WITH 48000.00, CLOSEMONTH WITH 3
  APPEND RECORD
  REPLACE DEALID WITH "D00002", COMPID WITH "ACME", TITLE WITH "Spare parts deal", STAGE WITH "Won", VALUE WITH 12500.00, CLOSEMONTH WITH 1
  APPEND RECORD
  REPLACE DEALID WITH "D00003", COMPID WITH "GLOBX", TITLE WITH "Solar rollout", STAGE WITH "Qualified", VALUE WITH 91000.00, CLOSEMONTH WITH 6
  APPEND RECORD
  REPLACE DEALID WITH "D00004", COMPID WITH "INITC", TITLE WITH "Platform license", STAGE WITH "Lead", VALUE WITH 22000.00, CLOSEMONTH WITH 4
  APPEND RECORD
  REPLACE DEALID WITH "D00005", COMPID WITH "INITC", TITLE WITH "Support renewal", STAGE WITH "Lost", VALUE WITH 8000.00, CLOSEMONTH WITH 2

  SELECT CONT
  DROP TABLE CONTACTS
  CREATE TABLE CONTACTS (CONTID CHAR(6), COMPID CHAR(5), NAME CHAR(40), EMAIL CHAR(40), PHONE CHAR(20))
  INDEX ON CONTID TO BYCONT
  INDEX ON COMPID TO CONTCOMP
  APPEND RECORD
  REPLACE CONTID WITH "C00001", COMPID WITH "ACME", NAME WITH "Jane Roe", EMAIL WITH "jane@acme.example", PHONE WITH "555-0101"
  APPEND RECORD
  REPLACE CONTID WITH "C00002", COMPID WITH "GLOBX", NAME WITH "Max Power", EMAIL WITH "max@globex.example", PHONE WITH "555-0102"
ENDIF

* ── Activate indexes + relations ─────────────────────────────
SELECT COMP
SET INDEX TO BYCOMP

SELECT DEAL
SET INDEX TO BYDEAL
SET RELATION TO COMPID INTO COMP

SELECT CONT
SET INDEX TO BYCONT
SET RELATION TO COMPID INTO COMP

SELECT DEAL

* ── Main menu ────────────────────────────────────────────────
STORE .T. TO running
DO WHILE running
  CLEAR
  @ 1,  5 SAY "============================================"
  @ 2, 12 SAY "   WEBBASE-III  CRM  (example app)"
  @ 3,  5 SAY "============================================"
  @ 5, 10 SAY "1. Add Company"
  @ 6, 10 SAY "2. Add Contact"
  @ 7, 10 SAY "3. Add Deal"
  @ 8, 10 SAY "4. Search Company (contacts + deals)"
  @ 9, 10 SAY "5. Pipeline Summary"
  @ 10, 10 SAY "6. Top Deals (sorted)"
  @ 11, 10 SAY "7. Deals Report"
  @ 12, 10 SAY "8. Export Deals to CSV"
  @ 13, 10 SAY "9. Combined Pipeline Table (JOIN)"
  @ 14, 10 SAY "B. Browse Deals"
  @ 15, 10 SAY "Q. Quit"
  @ 16,  5 SAY "============================================"
  STORE " " TO choice
  @ 17, 10 SAY "Enter choice: " GET choice
  READ

  DO CASE
    CASE UPPER(TRIM(choice)) == "1"
      CLEAR
      @ 2, 5 SAY "--- ADD COMPANY ---"
      STORE SPACE(5)  TO m_id
      STORE SPACE(40) TO m_name
      STORE SPACE(20) TO m_ind
      STORE SPACE(20) TO m_city
      @ 4, 5 SAY "Company ID (5): " GET m_id
      @ 5, 5 SAY "Name      (40): " GET m_name
      @ 6, 5 SAY "Industry  (20): " GET m_ind
      @ 7, 5 SAY "City      (20): " GET m_city
      READ
      SELECT COMP
      SET INDEX TO BYCOMP
      SEEK TRIM(m_id)
      IF FOUND()
        @ 9, 5 SAY "Company already exists: " + TRIM(m_id)
      ELSE
        APPEND RECORD
        REPLACE COMPID WITH TRIM(m_id), NAME WITH TRIM(m_name), INDUSTRY WITH TRIM(m_ind), CITY WITH TRIM(m_city)
        @ 9, 5 SAY "Company added: " + TRIM(m_id)
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT DEAL

    CASE UPPER(TRIM(choice)) == "2"
      CLEAR
      @ 2, 5 SAY "--- ADD CONTACT ---"
      STORE SPACE(6)  TO m_cid
      STORE SPACE(5)  TO m_comp
      STORE SPACE(40) TO m_name
      STORE SPACE(40) TO m_mail
      STORE SPACE(20) TO m_phone
      @ 4, 5 SAY "Contact ID (6): " GET m_cid
      @ 5, 5 SAY "Company ID (5): " GET m_comp
      @ 6, 5 SAY "Name      (40): " GET m_name
      @ 7, 5 SAY "Email     (40): " GET m_mail
      @ 8, 5 SAY "Phone     (20): " GET m_phone
      READ
      SELECT COMP
      SET INDEX TO BYCOMP
      SEEK TRIM(m_comp)
      IF FOUND()
        STORE COMP.NAME TO v_cname
        SELECT CONT
        APPEND RECORD
        REPLACE CONTID WITH TRIM(m_cid), COMPID WITH TRIM(m_comp), NAME WITH TRIM(m_name), EMAIL WITH TRIM(m_mail), PHONE WITH TRIM(m_phone)
        @ 10, 5 SAY "Contact added at " + TRIM(v_cname)
      ELSE
        @ 10, 5 SAY "Company not found: " + TRIM(m_comp)
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT DEAL

    CASE UPPER(TRIM(choice)) == "3"
      CLEAR
      @ 2, 5 SAY "--- ADD DEAL ---"
      STORE SPACE(6)  TO m_did
      STORE SPACE(5)  TO m_comp
      STORE SPACE(40) TO m_title
      STORE SPACE(12) TO m_stage
      STORE 0.00      TO m_val
      @ 4, 5 SAY "Deal ID   (6): " GET m_did
      @ 5, 5 SAY "Company ID(5): " GET m_comp
      @ 6, 5 SAY "Title    (40): " GET m_title
      @ 7, 5 SAY "Stage    (12): " GET m_stage
      @ 8, 5 SAY "Value   (num): " GET m_val
      READ
      SELECT COMP
      SET INDEX TO BYCOMP
      SEEK TRIM(m_comp)
      IF FOUND()
        SELECT DEAL
        APPEND RECORD
        REPLACE DEALID WITH TRIM(m_did), COMPID WITH TRIM(m_comp), TITLE WITH TRIM(m_title), STAGE WITH TRIM(m_stage), VALUE WITH m_val, CLOSEMONTH WITH 0
        @ 10, 5 SAY "Deal added: " + TRIM(m_did)
      ELSE
        @ 10, 5 SAY "Company not found: " + TRIM(m_comp)
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT DEAL

    CASE UPPER(TRIM(choice)) == "4"
      CLEAR
      @ 2, 5 SAY "--- SEARCH COMPANY ---"
      STORE SPACE(5) TO m_comp
      @ 4, 5 SAY "Company ID (5): " GET m_comp
      READ
      SELECT COMP
      SET INDEX TO BYCOMP
      SEEK TRIM(m_comp)
      IF FOUND()
        @ 6, 5 SAY "Company: " + TRIM(COMP.NAME) + "  [" + TRIM(COMP.CITY) + "]"
        SELECT DEAL
        SET INDEX TO DEALCOMP
        SEEK TRIM(m_comp)
        IF FOUND()
          @ 8, 5 SAY "First deal: " + TRIM(TITLE) + " (" + TRIM(STAGE) + ")"
        ELSE
          @ 8, 5 SAY "No deals for this company."
        ENDIF
      ELSE
        @ 6, 5 SAY "Not found: " + TRIM(m_comp)
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT DEAL
      SET INDEX TO BYDEAL

    CASE UPPER(TRIM(choice)) == "5"
      CLEAR
      SELECT DEAL
      @ 2, 5 SAY "--- PIPELINE SUMMARY ---"
      SUM VALUE FOR STAGE != "Won" AND STAGE != "Lost"
      @ 4, 5 SAY "(above: open pipeline value)"
      SUM VALUE FOR STAGE == "Won"
      @ 6, 5 SAY "(above: won value)"
      AVERAGE VALUE
      @ 8, 5 SAY "(above: average deal size)"
      @ 10, 5 SAY "Deals on file: " + STR(RECCOUNT(), 5)
      INPUT "Press Enter to continue" TO pause

    CASE UPPER(TRIM(choice)) == "6"
      CLEAR
      SELECT DEAL
      DROP TABLE TOPDEALS
      SORT ON VALUE/D TO TOPDEALS
      @ 2, 5 SAY "--- TOP DEALS (by value) ---"
      USE TOPDEALS
      LIST DEALID, TITLE, STAGE, VALUE
      INPUT "Press Enter to continue" TO pause
      USE DEALS
      SET INDEX TO BYDEAL
      SET RELATION TO COMPID INTO COMP

    CASE UPPER(TRIM(choice)) == "7"
      CLEAR
      SELECT DEAL
      USE DEALS
      REPORT FORM dealsbystage

    CASE UPPER(TRIM(choice)) == "8"
      CLEAR
      SELECT DEAL
      USE DEALS
      COPY TO deals.csv
      @ 2, 5 SAY "Deals exported to deals.csv (check your downloads)."
      INPUT "Press Enter to continue" TO pause
      SET INDEX TO BYDEAL
      SET RELATION TO COMPID INTO COMP

    CASE UPPER(TRIM(choice)) == "9"
      CLEAR
      SELECT DEAL
      DROP TABLE PIPELINE
      JOIN WITH COMP TO PIPELINE FOR DEAL.COMPID == COMP.COMPID FIELDS DEAL.TITLE, DEAL.STAGE, DEAL.VALUE, COMP.NAME
      @ 2, 5 SAY "--- COMBINED PIPELINE (deals + companies) ---"
      USE PIPELINE
      LIST
      INPUT "Press Enter to continue" TO pause
      USE DEALS
      SET INDEX TO BYDEAL
      SET RELATION TO COMPID INTO COMP

    CASE UPPER(TRIM(choice)) == "B"
      CLEAR
      @ 2, 5 SAY "TIP: open a second browser window, DO crm, and BROWSE the"
      @ 3, 5 SAY "same table. Edit a deal here and watch it refresh there live."
      INPUT "Press Enter to open the grid" TO pause
      SELECT DEAL
      BROWSE

    CASE UPPER(TRIM(choice)) == "Q"
      STORE .F. TO running

  ENDCASE
ENDDO
CLEAR
@ 2, 5 SAY "CRM demo closed. Type DO crm to run it again, or EDIT crm to customize."
```

- [ ] **Step 4: Run the test, iterate until green**

Run: `npx playwright test tests/crm.spec.ts`
Expected: PASS. If a step errors, open the app (`npm run dev`), `DO crm`, reproduce the failing option, read the `** Error` line, and fix the `.prg` (common causes: a table that must be dropped before re-create on re-run; an index not active before SEEK; a JOIN target table already existing — the program drops `TOPDEALS`/`PIPELINE` first to avoid this). Keep iterating; do not change the test to hide a real program bug (only adjust assertions for cosmetic output/casing).

- [ ] **Step 5: Commit**

```bash
git add demos/crm.prg tests/crm.spec.ts
git commit -m "feat(demos): rebuild crm.prg into a usable CRM example app (#29)"
```

---

## Task 4: Rebuild the Inventory demo

**Files:**
- Modify (full rewrite): `demos/INVENTORY.prg`
- Test: `tests/inventory.spec.ts` (extend)

- [ ] **Step 1: Add failing e2e cases**

Append a new describe block to `tests/inventory.spec.ts` (reuse its existing `boot`/`seedProgram`/`cmd`/`menuChoice` helpers — match their actual names in the file):

```typescript
test.describe('Inventory demo — v1.0/v1.1 features', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    await seedProgram(page);
    await cmd(page, `DO ${PRG_NAME}`, 1800);
  });

  test('valuation & stock summary prints totals', async ({ page }) => {
    await menuChoice(page, '6');
    await expect(page.locator('#form-view, #terminal-output').first()).toContainText(/valuation|stock|total/i, { timeout: 6000 });
  });

  test('low-stock report renders the HTML preview', async ({ page }) => {
    await menuChoice(page, '7');
    await expect(page.locator('#report-preview-view')).toBeVisible({ timeout: 8000 });
    await page.keyboard.press('Escape');
  });

  test('top products by value sorts into a new table', async ({ page }) => {
    await menuChoice(page, '9');
    await waitForOutput(page, 'TOPPROD', 6000);
  });

  test('export products downloads a CSV', async ({ page }) => {
    const dl = page.waitForEvent('download');
    await menuChoice(page, '10');
    const d = await dl;
    expect(d.suggestedFilename().toLowerCase()).toContain('products');
  });

  test('combined catalog JOIN builds a table', async ({ page }) => {
    await menuChoice(page, '11');
    await waitForOutput(page, 'CATALOG', 6000);
  });
});
```

If `waitForOutput`/`PRG_NAME` aren't exported helpers in that file, add the same small helpers used in `tests/crm.spec.ts`.

- [ ] **Step 2: Run to verify the new cases fail**

Run: `npx playwright test tests/inventory.spec.ts -g "v1.0/v1.1 features"`
Expected: FAIL — options 6/7/9/10/11 don't exist yet in the current menu.

- [ ] **Step 3: Rewrite `demos/INVENTORY.prg`**

Replace the entire file with the program below. It keeps Categories + Products (adds `REORDER`) and adds a MOVEMENTS ledger, then a feature-rich menu.

```
* ============================================================
* INVENTORY.prg — WebBase-III Inventory (usable example app)
*
* A working stock manager: CATEGORIES, PRODUCTS (with reorder
* level), and a MOVEMENTS ledger (receive / issue stock).
* Shows: multi-work-area + SET RELATION, alias.field, SEEK,
*        SUM/AVERAGE ... FOR, SORT ON .../D TO, REPORT FORM,
*        SET FILTER, COPY TO csv, JOIN WITH ... TO ... FOR.
*
* COPY THIS FILE (or EDIT inventory) to build your own.
* ============================================================

USE DATABASE INVDEMO

SELECT CAT
USE DATABASE INVDEMO
USE CATEGORIES

SELECT MOV
USE DATABASE INVDEMO
USE MOVEMENTS

SELECT INV
USE DATABASE INVDEMO
USE PRODUCTS

* ── First-run seeding ───────────────────────────────────────
IF RECCOUNT() == 0
  SELECT CAT
  IF RECCOUNT() == 0
    DROP TABLE CATEGORIES
    CREATE TABLE CATEGORIES (CATID CHAR(4), CATNAME CHAR(30), NOTES CHAR(60))
    INDEX ON CATID TO BYCAT
    APPEND RECORD
    REPLACE CATID WITH "ELEC", CATNAME WITH "Electronics", NOTES WITH "Gadgets and devices"
    APPEND RECORD
    REPLACE CATID WITH "TOOL", CATNAME WITH "Tools", NOTES WITH "Hand and power tools"
    APPEND RECORD
    REPLACE CATID WITH "OFFC", CATNAME WITH "Office", NOTES WITH "Office supplies"
  ENDIF

  SELECT MOV
  IF RECCOUNT() == 0
    DROP TABLE MOVEMENTS
    CREATE TABLE MOVEMENTS (MOVID CHAR(6), PRODID CHAR(6), KIND CHAR(3), QTY NUM(6), MMONTH NUM(6), REASON CHAR(30))
    INDEX ON PRODID TO MOVPROD
  ENDIF

  SELECT INV
  DROP TABLE PRODUCTS
  CREATE TABLE PRODUCTS (PRODID CHAR(6), CATID CHAR(4), NAME CHAR(40), STOCK NUM(6), REORDER NUM(6), PRICE NUM(8,2), ACTIVE LOGICAL)
  INDEX ON UPPER(NAME) TO BYNAME
  INDEX ON CATID TO BYCATID
  APPEND RECORD
  REPLACE PRODID WITH "P00001", CATID WITH "ELEC", NAME WITH "Laptop Pro 15", STOCK WITH 12, REORDER WITH 5, PRICE WITH 1299.99, ACTIVE WITH .T.
  APPEND RECORD
  REPLACE PRODID WITH "P00002", CATID WITH "ELEC", NAME WITH "Wireless Mouse", STOCK WITH 4, REORDER WITH 10, PRICE WITH 29.95, ACTIVE WITH .T.
  APPEND RECORD
  REPLACE PRODID WITH "P00003", CATID WITH "TOOL", NAME WITH "Cordless Drill", STOCK WITH 34, REORDER WITH 8, PRICE WITH 149.50, ACTIVE WITH .T.
  APPEND RECORD
  REPLACE PRODID WITH "P00004", CATID WITH "TOOL", NAME WITH "Hammer 16oz", STOCK WITH 2, REORDER WITH 6, PRICE WITH 18.75, ACTIVE WITH .T.
  APPEND RECORD
  REPLACE PRODID WITH "P00005", CATID WITH "OFFC", NAME WITH "Desk Chair Ergo", STOCK WITH 7, REORDER WITH 4, PRICE WITH 399.00, ACTIVE WITH .T.
ENDIF

* ── Activate indexes + relations ─────────────────────────────
SELECT CAT
SET INDEX TO BYCAT

SELECT MOV
SET INDEX TO MOVPROD

SELECT INV
SET INDEX TO BYNAME
SET RELATION TO CATID INTO CAT

* ── Main menu ────────────────────────────────────────────────
STORE .T. TO running
DO WHILE running
  CLEAR
  @ 1,  5 SAY "============================================"
  @ 2, 12 SAY "  WEBBASE-III  INVENTORY  (example app)"
  @ 3,  5 SAY "============================================"
  @ 5, 8 SAY "1. Add Category        7. Low-Stock Report"
  @ 6, 8 SAY "2. Add Product         8. Movement History"
  @ 7, 8 SAY "3. Receive Stock       9. Top Products (value)"
  @ 8, 8 SAY "4. Issue Stock        10. Export Products CSV"
  @ 9, 8 SAY "5. Search Product     11. Catalog Table (JOIN)"
  @ 10, 8 SAY "6. Valuation Summary  B. Browse Active"
  @ 11, 8 SAY "Q. Quit"
  @ 12,  5 SAY "============================================"
  STORE " " TO choice
  @ 13, 10 SAY "Enter choice: " GET choice
  READ

  DO CASE
    CASE UPPER(TRIM(choice)) == "1"
      CLEAR
      @ 2, 5 SAY "--- ADD CATEGORY ---"
      STORE SPACE(4)  TO m_id
      STORE SPACE(30) TO m_name
      STORE SPACE(60) TO m_notes
      @ 4, 5 SAY "Category ID  (4): " GET m_id
      @ 5, 5 SAY "Name        (30): " GET m_name
      @ 6, 5 SAY "Notes       (60): " GET m_notes
      READ
      SELECT CAT
      SET INDEX TO BYCAT
      SEEK TRIM(m_id)
      IF FOUND()
        @ 8, 5 SAY "Category already exists: " + TRIM(m_id)
      ELSE
        APPEND RECORD
        REPLACE CATID WITH TRIM(m_id), CATNAME WITH TRIM(m_name), NOTES WITH TRIM(m_notes)
        @ 8, 5 SAY "Category added: " + TRIM(m_id)
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT INV

    CASE UPPER(TRIM(choice)) == "2"
      CLEAR
      @ 2, 5 SAY "--- ADD PRODUCT ---"
      STORE SPACE(6)  TO m_pid
      STORE SPACE(4)  TO m_catid
      STORE SPACE(40) TO m_pname
      STORE 0         TO m_stock
      STORE 0         TO m_reord
      STORE 0.00      TO m_price
      @ 4, 5 SAY "Product ID  (6): " GET m_pid
      @ 5, 5 SAY "Category ID (4): " GET m_catid
      @ 6, 5 SAY "Name       (40): " GET m_pname
      @ 7, 5 SAY "Stock     (num): " GET m_stock
      @ 8, 5 SAY "Reorder   (num): " GET m_reord
      @ 9, 5 SAY "Price     (num): " GET m_price
      READ
      SELECT CAT
      SET INDEX TO BYCAT
      SEEK TRIM(m_catid)
      IF FOUND()
        SELECT INV
        APPEND RECORD
        REPLACE PRODID WITH TRIM(m_pid), CATID WITH TRIM(m_catid), NAME WITH TRIM(m_pname), STOCK WITH m_stock, REORDER WITH m_reord, PRICE WITH m_price, ACTIVE WITH .T.
        @ 11, 5 SAY "Product added: " + TRIM(m_pid)
      ELSE
        @ 11, 5 SAY "Category not found: " + TRIM(m_catid)
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT INV

    CASE UPPER(TRIM(choice)) == "3"
      CLEAR
      @ 2, 5 SAY "--- RECEIVE STOCK (IN) ---"
      STORE SPACE(40) TO m_search
      STORE 0         TO m_qty
      @ 4, 5 SAY "Product name: " GET m_search
      @ 5, 5 SAY "Quantity in : " GET m_qty
      READ
      SELECT INV
      SET INDEX TO BYNAME
      SEEK UPPER(TRIM(m_search))
      IF FOUND()
        REPLACE STOCK WITH STOCK + m_qty
        @ 7, 5 SAY "New stock for " + TRIM(NAME) + ": " + STR(STOCK, 6)
        SELECT MOV
        APPEND RECORD
        REPLACE MOVID WITH "M" + STR(RECCOUNT(), 5), PRODID WITH "", KIND WITH "IN", QTY WITH m_qty, MMONTH WITH 0, REASON WITH "Manual receive"
      ELSE
        @ 7, 5 SAY "Not found: " + TRIM(m_search)
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT INV

    CASE UPPER(TRIM(choice)) == "4"
      CLEAR
      @ 2, 5 SAY "--- ISSUE STOCK (OUT) ---"
      STORE SPACE(40) TO m_search
      STORE 0         TO m_qty
      @ 4, 5 SAY "Product name: " GET m_search
      @ 5, 5 SAY "Quantity out: " GET m_qty
      READ
      SELECT INV
      SET INDEX TO BYNAME
      SEEK UPPER(TRIM(m_search))
      IF FOUND()
        IF STOCK < m_qty
          @ 7, 5 SAY "Not enough stock (" + STR(STOCK, 6) + ")."
        ELSE
          REPLACE STOCK WITH STOCK - m_qty
          @ 7, 5 SAY "New stock for " + TRIM(NAME) + ": " + STR(STOCK, 6)
          SELECT MOV
          APPEND RECORD
          REPLACE MOVID WITH "M" + STR(RECCOUNT(), 5), PRODID WITH "", KIND WITH "OUT", QTY WITH m_qty, MMONTH WITH 0, REASON WITH "Manual issue"
        ENDIF
      ELSE
        @ 7, 5 SAY "Not found: " + TRIM(m_search)
      ENDIF
      INPUT "Press Enter to continue" TO pause
      SELECT INV

    CASE UPPER(TRIM(choice)) == "5"
      CLEAR
      @ 2, 5 SAY "--- SEARCH PRODUCT ---"
      STORE SPACE(40) TO m_search
      @ 4, 5 SAY "Product name: " GET m_search
      READ
      SELECT INV
      SET INDEX TO BYNAME
      SEEK UPPER(TRIM(m_search))
      IF FOUND()
        @ 6, 5 SAY "Name    : " + TRIM(NAME)
        @ 7, 5 SAY "Category: " + TRIM(CAT.CATNAME)
        @ 8, 5 SAY "Stock   : " + STR(STOCK, 6) + "   Reorder: " + STR(REORDER, 6)
        @ 9, 5 SAY "Price   : " + STR(PRICE, 8, 2)
      ELSE
        @ 6, 5 SAY "Not found: " + TRIM(m_search)
      ENDIF
      INPUT "Press Enter to continue" TO pause

    CASE UPPER(TRIM(choice)) == "6"
      CLEAR
      SELECT INV
      @ 2, 5 SAY "--- VALUATION & STOCK SUMMARY ---"
      SUM STOCK FOR ACTIVE == .T.
      @ 4, 5 SAY "(above: total active stock units)"
      AVERAGE PRICE
      @ 6, 5 SAY "(above: average price)"
      @ 8, 5 SAY "Products on file: " + STR(RECCOUNT(), 5)
      INPUT "Press Enter to continue" TO pause

    CASE UPPER(TRIM(choice)) == "7"
      CLEAR
      SELECT INV
      USE PRODUCTS
      SET FILTER TO STOCK <= REORDER
      REPORT FORM lowstock
      SET FILTER TO
      SET INDEX TO BYNAME
      SET RELATION TO CATID INTO CAT

    CASE UPPER(TRIM(choice)) == "8"
      CLEAR
      SELECT MOV
      @ 2, 5 SAY "--- MOVEMENT HISTORY ---"
      LIST MOVID, KIND, QTY, REASON
      INPUT "Press Enter to continue" TO pause
      SELECT INV

    CASE UPPER(TRIM(choice)) == "9"
      CLEAR
      SELECT INV
      DROP TABLE TOPPROD
      SORT ON PRICE/D TO TOPPROD
      @ 2, 5 SAY "--- TOP PRODUCTS (by price) ---"
      USE TOPPROD
      LIST PRODID, NAME, PRICE
      INPUT "Press Enter to continue" TO pause
      USE PRODUCTS
      SET INDEX TO BYNAME
      SET RELATION TO CATID INTO CAT

    CASE UPPER(TRIM(choice)) == "10"
      CLEAR
      SELECT INV
      USE PRODUCTS
      COPY TO products.csv
      @ 2, 5 SAY "Products exported to products.csv (check your downloads)."
      INPUT "Press Enter to continue" TO pause
      SET INDEX TO BYNAME
      SET RELATION TO CATID INTO CAT

    CASE UPPER(TRIM(choice)) == "11"
      CLEAR
      SELECT INV
      DROP TABLE CATALOG
      JOIN WITH CAT TO CATALOG FOR INV.CATID == CAT.CATID FIELDS INV.NAME, INV.STOCK, INV.PRICE, CAT.CATNAME
      @ 2, 5 SAY "--- CATALOG (products + categories) ---"
      USE CATALOG
      LIST
      INPUT "Press Enter to continue" TO pause
      USE PRODUCTS
      SET INDEX TO BYNAME
      SET RELATION TO CATID INTO CAT

    CASE UPPER(TRIM(choice)) == "B"
      CLEAR
      @ 2, 5 SAY "TIP: open a second browser window, DO inventory, and BROWSE"
      @ 3, 5 SAY "the same table. Edit stock here and watch it refresh there live."
      INPUT "Press Enter to open the grid" TO pause
      SELECT INV
      SET FILTER TO ACTIVE == .T.
      BROWSE
      SET FILTER TO

    CASE UPPER(TRIM(choice)) == "Q"
      STORE .F. TO running

  ENDCASE
ENDDO
CLEAR
@ 2, 5 SAY "Inventory demo closed. Type DO inventory to run it again, or EDIT inventory."
```

- [ ] **Step 4: Run the inventory suite, iterate until green**

Run: `npx playwright test tests/inventory.spec.ts`
Expected: PASS (existing seeding/regression cases + the new feature cases). Iterate on `.prg` errors as in Task 3 Step 4. Note the existing "second run does not re-seed" regression test must still pass — the `IF RECCOUNT() == 0` guards preserve that.

- [ ] **Step 5: Commit**

```bash
git add demos/INVENTORY.prg tests/inventory.spec.ts
git commit -m "feat(demos): rebuild INVENTORY.prg into a usable stock manager (#29)"
```

---

## Task 5: Discoverability surfaces

**Files:**
- Modify: `src/terminal/Terminal.ts` (splash `printWelcome`)
- Modify: `src/interpreter/Executor.ts` (HELP output)
- Modify: `src/ui/Assistant.ts` (Programs category demo launchers)
- Modify: `demos/crm.prg`, `demos/INVENTORY.prg` (header comments already added in Tasks 3–4 — verify present)
- Test: `tests/splash.spec.ts` (extend), `tests/assistant.spec.ts` (extend)

- [ ] **Step 1: Write the failing tests**

Append to `tests/assistant.spec.ts`:

```typescript
test.describe('Assistant — demo launchers', () => {
  test('Run CRM demo launches the CRM and opens its menu', async ({ page }) => {
    await boot(page);
    await clickAction(page, 'Run CRM demo');
    await expect(page.locator('#form-view')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#form-view')).toContainText('CRM', { timeout: 6000 });
  });

  test('Run Inventory demo launches the inventory and opens its menu', async ({ page }) => {
    await boot(page);
    await clickAction(page, 'Run Inventory demo');
    await expect(page.locator('#form-view')).toBeVisible({ timeout: 8000 });
    await expect(page.locator('#form-view')).toContainText('INVENTORY', { timeout: 6000 });
  });
});
```

Add to `tests/splash.spec.ts` an assertion (inside its existing test or a new one) that the splash advertises the demos:

```typescript
  await expect(page.locator('#terminal-output')).toContainText('DO crm', { timeout: 8000 });
  await expect(page.locator('#terminal-output')).toContainText('DO inventory', { timeout: 8000 });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test tests/assistant.spec.ts -g "demo launchers" tests/splash.spec.ts`
Expected: FAIL — launcher actions and splash demo lines don't exist.

- [ ] **Step 3: Add the splash block**

In `src/terminal/Terminal.ts` `printWelcome`, after the Quick start block (before the trailing `{ text: '' }`), add:

```typescript
      { text: '' },
      { text: 'Try a full example app:', cls: 'hdr' },
      { text: '  DO crm         — a working mini-CRM (companies, contacts, deals)', cls: 'out' },
      { text: '  DO inventory   — a working stock manager (categories, products, movements)', cls: 'out' },
      { text: '  These are complete, editable programs — EDIT crm to build your own.', cls: 'info' },
```

- [ ] **Step 4: Add a HELP demos section**

In `src/interpreter/Executor.ts`, find the HELP output array (the lines with `{ text: 'COPY TO ...' }` etc.) and add near the end, before the closing of the help list:

```typescript
      { text: '' },
      { text: 'Demos / examples:' },
      { text: 'DO crm        — usable CRM example (EDIT crm to customize)' },
      { text: 'DO inventory  — usable inventory example (EDIT inventory to customize)' },
```

(Match the exact object shape used by the surrounding HELP lines — some use `{ text }`, some `{ text, cls }`.)

- [ ] **Step 5: Add the Assistant demo launchers**

In `src/ui/Assistant.ts`, in the **Programs** category `actions` array, add two entries at the top (before `Run program…`):

```typescript
    { label: 'Run CRM demo', command: 'DO crm' },
    { label: 'Run Inventory demo', command: 'DO inventory' },
```

(These are always enabled — the demos are seeded on startup and self-contained. `command` runs immediately via the existing `activate()` path.)

- [ ] **Step 6: Verify the `.prg` header comments**

Confirm `demos/crm.prg` and `demos/INVENTORY.prg` start with the comment blocks authored in Tasks 3–4 (they do). No change needed if present.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx playwright test tests/assistant.spec.ts -g "demo launchers" tests/splash.spec.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/terminal/Terminal.ts src/interpreter/Executor.ts src/ui/Assistant.ts tests/assistant.spec.ts tests/splash.spec.ts
git commit -m "feat(demos): surface demos in splash, HELP, and Assistant (#29)"
```

---

## Task 6: Docs, demo-seed test, and screenshots

**Files:**
- Modify: `tests/demos.spec.ts`
- Modify: `README.md`, `CLAUDE.md`, `CHANGELOG.md`
- Modify: `docs/screenshots/*` (if demo UI changed materially)

- [ ] **Step 1: Add a report-seed assertion to `tests/demos.spec.ts`**

Add a test that the seeded report defs are available (via `LIST REPORTS`):

```typescript
test('seeded report definitions are available', async ({ page }) => {
  await page.goto('http://localhost:5173');
  await expect(page.locator('#terminal-output')).toContainText('Connected.', { timeout: 8000 });
  const input = page.locator('#terminal-input');
  await input.fill('LIST REPORTS');
  await input.press('Enter');
  await expect(page.locator('#terminal-output')).toContainText('dealsbystage', { timeout: 5000 });
  await expect(page.locator('#terminal-output')).toContainText('lowstock', { timeout: 5000 });
});
```

(Match the file's existing import/helper style.)

- [ ] **Step 2: Run it**

Run: `npx playwright test tests/demos.spec.ts`
Expected: PASS.

- [ ] **Step 3: Update `CHANGELOG.md`**

Under `## [1.1.0]` → `### Added`:

```
- Rebuilt the `crm` and `inventory` demos into usable example apps (companies/contacts/deals; categories/products/stock movements) that showcase SUM/AVERAGE FOR, SORT, JOIN, REPORT FORM, CSV export, relations, and live propagation. Each seeds a grouped report definition. Demos are now surfaced in the splash screen, HELP, and the Assistant. (#29)
```

- [ ] **Step 4: Update `README.md`**

Update the demo descriptions (search for `crm`/`INVENTORY`/`demos`) to describe the new usable apps and the seeded reports, and mention `DO crm` / `DO inventory` as ready-to-run examples.

- [ ] **Step 5: Update `CLAUDE.md`**

- In the `demos/` architecture block, mention `demos/reports/*.json` (seeded report defs) and the richer crm/inventory programs.
- In the `server/` block, note `DemoSeeder.seedDemoReports`.
- In the Testing section, add `tests/crm.spec.ts` to the Playwright suite list and update the suite count (run `npx playwright test --list 2>&1 | grep -oE '^[[:space:]]+[a-zA-Z-]+\.spec\.ts' | tr -d ' ' | sort | uniq -c` to get exact per-file counts and the new total).

- [ ] **Step 6: Full suites green**

Run: `npm test`
Expected: PASS.

Run: `npx playwright test`
Expected: PASS.

- [ ] **Step 7: Retake demo screenshots (if changed)**

If `docs/screenshots/` has demo screenshots that now look different (e.g. an inventory menu shot), retake them with the dev server running. The README demo GIF is a REPL showcase that does not run the demos, so it does not need re-recording for this issue.

- [ ] **Step 8: Commit**

```bash
git add tests/demos.spec.ts README.md CLAUDE.md CHANGELOG.md docs/screenshots
git commit -m "docs: document richer demos + report seeding; demo-seed e2e (#29)"
```

---

## Post-plan

After all tasks green:
- Push `feature/29-richer-demos` and open a PR **based on `release/v1.1.0`** (not `main`), closing #29.
- Tick the issue's feature checkboxes that are now covered; note JOIN is included (was gated on #10, now merged).
- This is the last v1.1.0 issue — once merged, `release/v1.1.0` is ready to merge to `main` and tag `v1.1.0`.
