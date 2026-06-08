/**
 * CRM program integration test — exercises the full interactive .prg flow:
 *   DO WHILE loop, @ SAY GET forms, READ, APPEND+REPLACE, SEEK/FOUND(), BROWSE
 *
 * The program under test is the exact CRM scenario from the design doc.
 */
import { test, expect, Page } from '@playwright/test';

const CRM_PROGRAM = `USE DATABASE CRM
CREATE TABLE CUSTOMERS (NAME CHAR(40), COMP CHAR(40), PHONE CHAR(20))
USE CUSTOMERS
INDEX ON UPPER(NAME) TO BYNAME
SET INDEX TO BYNAME

STORE .T. TO active
DO WHILE active
  CLEAR
  @ 2, 10 SAY "--- WEBBASE-III CRM ---"
  @ 4, 15 SAY "1. Add Customer"
  @ 5, 15 SAY "2. Search/Edit"
  @ 6, 15 SAY "3. Browse Grid"
  @ 8, 15 SAY "Q. Quit"
  STORE " " TO choice
  @ 10, 10 SAY "Selection: " GET choice
  READ

  IF choice == "1"
    CLEAR
    STORE SPACE(40) TO m_name
    STORE SPACE(40) TO m_comp
    @ 2, 5 SAY "--- NEW CUSTOMER ---"
    @ 4, 5 SAY "Name: " GET m_name
    @ 5, 5 SAY "Comp: " GET m_comp
    READ
    APPEND RECORD
    REPLACE NAME WITH TRIM(m_name), COMP WITH TRIM(m_comp)
  ENDIF

  IF choice == "2"
    CLEAR
    STORE SPACE(40) TO m_look
    @ 2, 5 SAY "Search Name: " GET m_look
    READ
    SEEK UPPER(TRIM(m_look))
    IF FOUND()
      STORE NAME TO v_name
      @ 5, 5 SAY "Editing: " + v_name
      @ 7, 5 SAY "New Name: " GET v_name
      READ
      REPLACE NAME WITH v_name
    ELSE
      @ 5, 5 SAY "Not Found."
      INPUT "Press Enter" TO pause
    ENDIF
  ENDIF

  IF choice == "3"
    BROWSE
  ENDIF

  IF choice == "Q" OR choice == "q"
    STORE .F. TO active
  ENDIF
ENDDO
CLEAR`;

// ── helpers ──────────────────────────────────────────────────────────────────

async function boot(page: Page): Promise<void> {
  await page.goto('http://localhost:5173');
  await expect(page.locator('#terminal-output')).toContainText('Connected.', { timeout: 8000 });
  // Clean CRM database so each test starts with no leftover records
  await typeCmd(page, 'USE DATABASE CRM');
  await expect(page.locator('#terminal-output')).toContainText('Opened database', { timeout: 4000 });
  await typeCmd(page, 'DROP TABLE CUSTOMERS');
  await page.waitForTimeout(500);
  await typeCmd(page, 'USE DATABASE testdb');
  await expect(page.locator('#terminal-output')).toContainText('Opened database', { timeout: 4000 });
}

async function typeCmd(page: Page, command: string, waitMs = 600): Promise<void> {
  const input = page.locator('#terminal-input');
  await input.fill(command);
  await input.press('Enter');
  await page.waitForTimeout(waitMs);
}

/** Returns text added to the terminal output since before fn() ran */
async function outputAfter(page: Page, fn: () => Promise<void>): Promise<string> {
  const before = (await page.locator('#terminal-output').textContent()) ?? '';
  await fn();
  await page.waitForTimeout(800);
  return ((await page.locator('#terminal-output').textContent()) ?? '').slice(before.length);
}

/** Wait for the form view to appear with at least one input */
async function waitForForm(page: Page, timeout = 5000): Promise<void> {
  await expect(page.locator('#form-view')).toBeVisible({ timeout });
  await expect(page.locator('#form-view input.f-get').first()).toBeVisible({ timeout });
}

/** Fill a single-field form (e.g. the menu "Selection:" prompt) and submit */
async function fillForm(page: Page, values: Record<string, string>): Promise<void> {
  await waitForForm(page);
  const canvas = page.locator('#form-canvas');
  for (const [varName, value] of Object.entries(values)) {
    const inp = canvas.locator(`input[data-var="${varName.toUpperCase()}"]`);
    await inp.fill(value);
  }
  // Submit: press Enter on the last input
  const inputs = canvas.locator('input.f-get');
  await inputs.last().press('Enter');
  await page.waitForTimeout(600);
}

/** Save a program via EDIT then close the editor */
async function saveProgram(page: Page, name: string, source: string): Promise<void> {
  await typeCmd(page, `EDIT ${name}`, 1500);
  const editor = page.locator('#editor-view');
  await expect(editor).toBeVisible({ timeout: 5000 });
  await editor.locator('textarea').fill(source);
  const saveBtn = editor.locator('button', { hasText: /save/i });
  if (await saveBtn.count() > 0) {
    await saveBtn.click();
  } else {
    await editor.locator('textarea').press('Control+s');
  }
  await expect(page.locator('#terminal-output')).toContainText('saved', {
    timeout: 3000,
    ignoreCase: true,
  });
  // Close editor
  const closeBtn = editor.locator('button', { hasText: /close|exit|back/i });
  if (await closeBtn.count() > 0) await closeBtn.click();
  else await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
}

// ── tests ────────────────────────────────────────────────────────────────────

test.describe('CRM program', () => {

  test('01. save program and run — menu appears', async ({ page }) => {
    await boot(page);
    await saveProgram(page, 'crm', CRM_PROGRAM);

    // DO crm — should hit the menu READ immediately
    await typeCmd(page, 'DO crm', 1000);
    await waitForForm(page);

    // Form should contain the "choice" GET field
    const choiceInput = page.locator('#form-canvas input[data-var="CHOICE"]');
    await expect(choiceInput).toBeVisible();

    // SAY labels should be visible
    const formText = await page.locator('#form-canvas').textContent();
    console.log('Menu form text:', formText);
    expect(formText).toMatch(/WEBBASE-III CRM|Add Customer|Search/i);

    // Quit cleanly
    await fillForm(page, { CHOICE: 'Q' });
    await expect(page.locator('#terminal-output')).toContainText('', { timeout: 2000 });
  });

  test('02. option 1 — add two customers', async ({ page }) => {
    await boot(page);
    await saveProgram(page, 'crm', CRM_PROGRAM);
    await typeCmd(page, 'DO crm', 1000);

    // Menu → choose "1"
    await fillForm(page, { CHOICE: '1' });
    await waitForForm(page);

    // Add first customer
    await fillForm(page, { M_NAME: 'Alice Smith', M_COMP: 'Acme Corp' });
    await page.waitForTimeout(800); // APPEND+REPLACE runs

    // Back at menu → choose "1" again
    await waitForForm(page);
    await fillForm(page, { CHOICE: '1' });
    await waitForForm(page);

    // Add second customer
    await fillForm(page, { M_NAME: 'Bob Jones', M_COMP: 'Globex' });
    await page.waitForTimeout(800);

    // Quit
    await waitForForm(page);
    await fillForm(page, { CHOICE: 'Q' });
    await page.waitForTimeout(600);

    // Verify records were saved
    await typeCmd(page, 'USE DATABASE CRM');
    await typeCmd(page, 'USE CUSTOMERS');
    await page.waitForTimeout(500);
    const out = await outputAfter(page, () => typeCmd(page, 'LIST'));
    console.log('LIST after adds:', out);
    expect(out).toContain('Alice');
    expect(out).toContain('Bob');
    expect(out).toContain('Acme');
    expect(out).toContain('Globex');
  });

  test('03. option 2 — search by name and edit', async ({ page }) => {
    await boot(page);
    await saveProgram(page, 'crm', CRM_PROGRAM);
    await typeCmd(page, 'DO crm', 1000);

    // Ensure Alice exists first (add her)
    await fillForm(page, { CHOICE: '1' });
    await waitForForm(page);
    await fillForm(page, { M_NAME: 'Alice Smith', M_COMP: 'Acme Corp' });
    await page.waitForTimeout(800);

    // Menu → choose "2" (Search/Edit)
    await waitForForm(page);
    await fillForm(page, { CHOICE: '2' });
    await waitForForm(page);

    // Search for Alice
    await fillForm(page, { M_LOOK: 'Alice Smith' });
    await page.waitForTimeout(800);

    // Should show editing form with current name pre-filled
    await waitForForm(page);
    const editForm = page.locator('#form-canvas');
    const formText = await editForm.textContent();
    console.log('Edit form text:', formText);
    expect(formText).toMatch(/Editing|Alice/i);

    // Change name to "Alice Johnson"
    const nameInput = editForm.locator('input[data-var="V_NAME"]');
    await nameInput.fill('Alice Johnson');
    await nameInput.press('Enter');
    await page.waitForTimeout(800);

    // Quit
    await waitForForm(page);
    await fillForm(page, { CHOICE: 'Q' });
    await page.waitForTimeout(600);

    // Verify the name was updated
    await typeCmd(page, 'USE DATABASE CRM');
    await typeCmd(page, 'USE CUSTOMERS', 500);
    const out = await outputAfter(page, () => typeCmd(page, 'LIST'));
    console.log('LIST after edit:', out);
    expect(out).toContain('Alice Johnson');
    expect(out).not.toContain('Alice Smith');
  });

  test('04. option 2 — search for nonexistent name shows Not Found', async ({ page }) => {
    await boot(page);
    await saveProgram(page, 'crm', CRM_PROGRAM);
    await typeCmd(page, 'DO crm', 1000);

    // Menu → "2"
    await fillForm(page, { CHOICE: '2' });
    await waitForForm(page);

    // Search for someone who doesn't exist
    await fillForm(page, { M_LOOK: 'Zaphod Beeblebrox' });
    await page.waitForTimeout(800);

    // "Not Found." branch — form should show "Not Found." SAY + INPUT prompt
    await waitForForm(page);
    const formText = await page.locator('#form-canvas').textContent();
    console.log('Not found form:', formText);
    expect(formText).toMatch(/Not Found/i);

    // Submit the INPUT form (press Enter on the pause field)
    await page.locator('#form-canvas input[data-var="PAUSE"]').press('Enter');
    await page.waitForTimeout(600);

    // Should be back at menu
    await waitForForm(page);
    await fillForm(page, { CHOICE: 'Q' });
  });

  test('05. option 3 — BROWSE opens grid and returns to menu on Escape', async ({ page }) => {
    await boot(page);
    await saveProgram(page, 'crm', CRM_PROGRAM);
    await typeCmd(page, 'DO crm', 1000);

    // Menu → "3"
    await fillForm(page, { CHOICE: '3' });
    await page.waitForTimeout(1000);

    const gridView = page.locator('#grid-view');
    await expect(gridView).toBeVisible({ timeout: 5000 });
    const gridText = await gridView.textContent();
    console.log('Grid in CRM:', gridText?.slice(0, 200));
    expect(gridText?.toUpperCase()).toMatch(/NAME|COMP|CUSTOMERS/);

    // Escape exits BROWSE — program should continue the DO WHILE and show menu again
    await page.keyboard.press('Escape');
    await page.waitForTimeout(800);

    await waitForForm(page, 6000);
    await fillForm(page, { CHOICE: 'Q' });
  });

  test('06. index order — LIST after program run is alphabetical', async ({ page }) => {
    await boot(page);
    await saveProgram(page, 'crm', CRM_PROGRAM);
    await typeCmd(page, 'DO crm', 1000);

    // Add in reverse alphabetical order
    for (const [name, comp] of [['Zoe Zebra', 'ZCorp'], ['Anna Apple', 'ACorp'], ['Mike Middle', 'MCorp']]) {
      await waitForForm(page);
      await fillForm(page, { CHOICE: '1' });
      await waitForForm(page);
      await fillForm(page, { M_NAME: name, M_COMP: comp });
      await page.waitForTimeout(600);
    }

    await waitForForm(page);
    await fillForm(page, { CHOICE: 'Q' });
    await page.waitForTimeout(600);

    // Use the CRM database directly and check index order
    await typeCmd(page, 'USE DATABASE CRM');
    await typeCmd(page, 'USE CUSTOMERS', 500);
    await typeCmd(page, 'SET INDEX TO BYNAME', 500);
    const out = await outputAfter(page, () => typeCmd(page, 'LIST'));
    console.log('Indexed LIST:', out);

    // Anna should appear before Mike, Mike before Zoe
    const annaPos = out.indexOf('Anna');
    const mikePos = out.indexOf('Mike');
    const zoePos  = out.indexOf('Zoe');
    expect(annaPos).toBeGreaterThanOrEqual(0);
    expect(mikePos).toBeGreaterThan(annaPos);
    expect(zoePos).toBeGreaterThan(mikePos);
  });

  test('07. program survives multiple quit+rerun cycles', async ({ page }) => {
    await boot(page);
    await saveProgram(page, 'crm', CRM_PROGRAM);

    for (let i = 0; i < 3; i++) {
      await typeCmd(page, 'DO crm', 1000);
      await waitForForm(page);
      const choiceInput = page.locator('#form-canvas input[data-var="CHOICE"]');
      await expect(choiceInput).toBeVisible();
      await fillForm(page, { CHOICE: 'Q' });
      await page.waitForTimeout(400);
    }
    // Terminal should still be responsive
    const out = await outputAfter(page, () => typeCmd(page, 'STORE "alive" TO x'));
    expect(out).toContain('alive');
  });

});
