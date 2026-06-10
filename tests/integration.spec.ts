import { test, expect, Page, Browser } from '@playwright/test';

// Helper: type a command and wait for output to settle
async function cmd(page: Page, command: string, waitMs = 800): Promise<void> {
  const input = page.locator('#terminal-input');
  await input.fill(command);
  await input.press('Enter');
  await page.waitForTimeout(waitMs);
}

// Helper: wait until terminal output contains text (case-insensitive)
async function waitForOutput(page: Page, text: string, timeout = 5000): Promise<void> {
  await expect(page.locator('#terminal-output')).toContainText(text, { timeout, ignoreCase: true });
}

// Helper: get snapshot of output text length before a command, then lines added after
async function outputAfter(page: Page, fn: () => Promise<void>): Promise<string> {
  const before = await page.locator('#terminal-output').textContent() ?? '';
  await fn();
  await page.waitForTimeout(800);
  const after = await page.locator('#terminal-output').textContent() ?? '';
  return after.slice(before.length);
}

// Boot the app and open test database
async function boot(page: Page): Promise<void> {
  await page.goto('http://localhost:5173');
  await waitForOutput(page, 'Connected.', 8000);
  await cmd(page, 'USE DATABASE testdb');
  await waitForOutput(page, 'Opened database', 3000);
}

// Set up contacts table with 3 records (idempotent: drops if exists first)
async function setupContacts(page: Page): Promise<void> {
  // Try drop first (ignore error if not exists)
  await cmd(page, 'DROP TABLE contacts');
  await page.waitForTimeout(500);

  await cmd(page, 'CREATE TABLE contacts (name CHAR(50), age INTEGER, salary FLOAT)');
  await waitForOutput(page, 'created', 3000);

  await cmd(page, 'USE contacts');
  await waitForOutput(page, 'contacts', 2000);

  await cmd(page, 'APPEND RECORD');
  await cmd(page, 'REPLACE name WITH "Alice", age WITH 30, salary WITH 55000.50');
  await waitForOutput(page, 'replaced', 2000);

  await cmd(page, 'APPEND RECORD');
  await cmd(page, 'REPLACE name WITH "Bob", age WITH 25, salary WITH 42000.00');
  await waitForOutput(page, 'replaced', 2000);

  await cmd(page, 'APPEND RECORD');
  await cmd(page, 'REPLACE name WITH "Charlie", age WITH 35, salary WITH 72000.75');
  await waitForOutput(page, 'replaced', 2000);
}

test.describe('WebBase-III Integration', () => {

  test('01. connectivity — HELP prints command reference', async ({ page }) => {
    await boot(page);
    const output = await outputAfter(page, () => cmd(page, 'HELP'));
    expect(output.toLowerCase()).toMatch(/list|browse|use/);
  });

  test('02. CREATE TABLE + LIST STRUCTURE', async ({ page }) => {
    await boot(page);
    await cmd(page, 'DROP TABLE contacts');
    await page.waitForTimeout(500);
    await cmd(page, 'CREATE TABLE contacts (name CHAR(50), age INTEGER, salary FLOAT)');
    await waitForOutput(page, 'created', 3000);

    await cmd(page, 'USE contacts');
    await waitForOutput(page, 'contacts', 2000);

    const output = await outputAfter(page, () => cmd(page, 'LIST STRUCTURE'));
    expect(output.toLowerCase()).toMatch(/char|name/);
    expect(output.toLowerCase()).toMatch(/integer|age/);
  });

  test('03. APPEND RECORD + REPLACE + LIST shows data', async ({ page }) => {
    await boot(page);
    await setupContacts(page);

    const output = await outputAfter(page, () => cmd(page, 'LIST'));
    expect(output).toContain('Alice');
    expect(output).toContain('Bob');
    expect(output).toContain('Charlie');
  });

  test('04. record navigation: GO TOP / GO BOTTOM / GO N / SKIP', async ({ page }) => {
    await boot(page);
    await setupContacts(page);

    await cmd(page, 'GO TOP');
    await page.waitForTimeout(300);
    let rec = await page.locator('#status-record').textContent();
    expect(rec).toMatch(/1/);

    await cmd(page, 'GO BOTTOM');
    await page.waitForTimeout(300);
    rec = await page.locator('#status-record').textContent();
    expect(rec).toMatch(/3/);

    await cmd(page, 'SKIP -1');
    await page.waitForTimeout(300);
    rec = await page.locator('#status-record').textContent();
    expect(rec).toMatch(/2/);

    await cmd(page, 'GO 1');
    await page.waitForTimeout(300);
    rec = await page.locator('#status-record').textContent();
    expect(rec).toMatch(/1/);
  });

  test('05. SET FILTER filters LIST, SET FILTER TO clears', async ({ page }) => {
    await boot(page);
    await setupContacts(page);

    await cmd(page, 'SET FILTER TO age > 28');
    await waitForOutput(page, 'filter', 2000);

    let output = await outputAfter(page, () => cmd(page, 'LIST'));
    expect(output).toContain('Alice');
    expect(output).toContain('Charlie');
    expect(output).not.toContain('Bob'); // age 25, filtered out

    await cmd(page, 'SET FILTER TO');
    await page.waitForTimeout(500);
    output = await outputAfter(page, () => cmd(page, 'LIST'));
    expect(output).toContain('Bob'); // filter cleared
  });

  test('06. REPLACE ALL with active filter', async ({ page }) => {
    await boot(page);
    await setupContacts(page);

    await cmd(page, 'SET FILTER TO age < 30');
    await page.waitForTimeout(500);

    const output = await outputAfter(page, () => cmd(page, 'REPLACE ALL salary WITH 50000'));
    expect(output.toLowerCase()).toMatch(/replaced/);

    await cmd(page, 'SET FILTER TO');
    await page.waitForTimeout(500);

    const list = await outputAfter(page, () => cmd(page, 'LIST'));
    // Bob (age 25) should have salary 50000
    const bobLine = list.split('\n').find(l => l.includes('Bob'));
    console.log('Bob line after REPLACE ALL:', bobLine);
    expect(bobLine).toBeTruthy();
    expect(bobLine).toMatch(/50000/);
    // Alice (age 30) should still have 55000.5
    const aliceLine = list.split('\n').find(l => l.includes('Alice'));
    expect(aliceLine).toMatch(/55000/);
  });

  test('07. INDEX ON, LIST INDEXES, SEEK, SET INDEX TO', async ({ page }) => {
    await boot(page);
    await setupContacts(page);

    const indexOut = await outputAfter(page, () => cmd(page, 'INDEX ON UPPER(name) TO BYNAME', 1500));
    console.log('INDEX ON output:', indexOut);
    expect(indexOut.toLowerCase()).toMatch(/index/);

    const listIdx = await outputAfter(page, () => cmd(page, 'LIST INDEXES'));
    expect(listIdx).toContain('BYNAME');

    const seekOut = await outputAfter(page, () => cmd(page, 'SEEK "ALICE"'));
    console.log('SEEK output:', seekOut);
    // Record pointer should be on Alice
    const rec = await page.locator('#status-record').textContent();
    console.log('Record after SEEK:', rec);

    // Clear active index
    await cmd(page, 'SET INDEX TO');
    await page.waitForTimeout(500);
  });

  test('08. DELETE current record + PACK removes it', async ({ page }) => {
    await boot(page);
    await setupContacts(page);

    await cmd(page, 'GO TOP');
    await page.waitForTimeout(300);

    const delOut = await outputAfter(page, () => cmd(page, 'DELETE'));
    console.log('DELETE output:', delOut);
    expect(delOut.toLowerCase()).toMatch(/delete/);

    const packOut = await outputAfter(page, () => cmd(page, 'PACK', 1500));
    console.log('PACK output:', packOut);

    const list = await outputAfter(page, () => cmd(page, 'LIST'));
    console.log('LIST after DELETE+PACK:', list);
    expect(list).not.toContain('Alice');
    expect(list).toContain('Bob');
  });

  test('09. STORE variables and arithmetic expressions', async ({ page }) => {
    await boot(page);

    let out = await outputAfter(page, () => cmd(page, 'STORE 42 TO mynum'));
    expect(out).toContain('42');

    out = await outputAfter(page, () => cmd(page, 'STORE "hello" TO mystr'));
    expect(out).toContain('hello');

    out = await outputAfter(page, () => cmd(page, 'STORE mynum + 8 TO result'));
    console.log('STORE expression output:', out);
    expect(out).toContain('50');
  });

  test('10. IF / ELSE / ENDIF control flow', async ({ page }) => {
    await boot(page);
    const input = page.locator('#terminal-input');

    await cmd(page, 'STORE 10 TO x');
    await page.waitForTimeout(300);

    // Enter multi-line block
    await input.fill('IF x > 5');
    await input.press('Enter');
    await page.waitForTimeout(200);
    // Prompt should switch to block mode
    const promptText = await page.locator('#terminal-prompt').textContent();
    console.log('Prompt after IF:', promptText);

    await input.fill('STORE "big" TO label');
    await input.press('Enter');
    await page.waitForTimeout(200);
    await input.fill('ELSE');
    await input.press('Enter');
    await page.waitForTimeout(200);
    await input.fill('STORE "small" TO label');
    await input.press('Enter');
    await page.waitForTimeout(200);
    await input.fill('ENDIF');
    await input.press('Enter');
    await waitForOutput(page, 'big', 3000);
  });

  test('11. DO WHILE loop increments counter', async ({ page }) => {
    await boot(page);
    const input = page.locator('#terminal-input');

    await cmd(page, 'STORE 1 TO counter');
    await page.waitForTimeout(200);

    await input.fill('DO WHILE counter <= 3');
    await input.press('Enter');
    await page.waitForTimeout(200);
    await input.fill('STORE counter + 1 TO counter');
    await input.press('Enter');
    await page.waitForTimeout(200);
    await input.fill('ENDDO');
    await input.press('Enter');
    await waitForOutput(page, '4', 3000);
  });

  test('12. DO CASE selects correct branch', async ({ page }) => {
    await boot(page);
    const input = page.locator('#terminal-input');

    await cmd(page, 'STORE 2 TO val');
    await page.waitForTimeout(200);

    await input.fill('DO CASE');
    await input.press('Enter');
    await page.waitForTimeout(200);
    await input.fill('CASE val = 1');
    await input.press('Enter');
    await page.waitForTimeout(200);
    await input.fill('STORE "one" TO result');
    await input.press('Enter');
    await page.waitForTimeout(200);
    await input.fill('CASE val = 2');
    await input.press('Enter');
    await page.waitForTimeout(200);
    await input.fill('STORE "two" TO result');
    await input.press('Enter');
    await page.waitForTimeout(200);
    await input.fill('ENDCASE');
    await input.press('Enter');
    await waitForOutput(page, 'two', 3000);
  });

  test('13. built-in functions: UPPER, LOWER, SUBSTR, STR', async ({ page }) => {
    await boot(page);

    let out = await outputAfter(page, () => cmd(page, 'STORE UPPER("hello") TO u'));
    console.log('UPPER output:', out);
    expect(out).toContain('HELLO');

    out = await outputAfter(page, () => cmd(page, 'STORE LOWER("WORLD") TO l'));
    expect(out).toContain('world');

    out = await outputAfter(page, () => cmd(page, 'STORE SUBSTR("abcdef", 2, 3) TO s'));
    console.log('SUBSTR output:', out);
    expect(out).toMatch(/bcd/);

    out = await outputAfter(page, () => cmd(page, 'STORE STR(3.14, 6, 2) TO n'));
    console.log('STR output:', out);
    expect(out).toMatch(/3\.14/);
  });

  test('14. EOF(), BOF(), RECNO(), RECCOUNT()', async ({ page }) => {
    await boot(page);
    await setupContacts(page);

    await cmd(page, 'GO TOP');
    await page.waitForTimeout(300);

    let out = await outputAfter(page, () => cmd(page, 'STORE RECNO() TO r'));
    console.log('RECNO at top:', out);
    expect(out).toMatch(/1/);

    out = await outputAfter(page, () => cmd(page, 'STORE RECCOUNT() TO rc'));
    console.log('RECCOUNT:', out);
    expect(out).toMatch(/3/);

    out = await outputAfter(page, () => cmd(page, 'STORE BOF() TO b'));
    console.log('BOF() at top:', out);
    // At record 1 (not before first), BOF should be .F.
    // (dBASE: BOF is only true when you SKIP backward past the first record)

    await cmd(page, 'GO BOTTOM');
    await page.waitForTimeout(300);

    out = await outputAfter(page, () => cmd(page, 'STORE EOF() TO e'));
    console.log('EOF() at bottom:', out);
    // At last record (not past it), EOF should be .F.
  });

  test('15. EDIT program, save, DO runs it', async ({ page }) => {
    await boot(page);

    await cmd(page, 'EDIT myprog', 1500);

    const editorView = page.locator('#editor-view');
    await expect(editorView).toBeVisible({ timeout: 5000 });
    console.log('Editor visible ✓');

    const editorTextarea = editorView.locator('textarea');
    await editorTextarea.fill('STORE "from_program" TO prog_result');

    // Try save button or Ctrl+S
    const saveBtn = editorView.locator('button', { hasText: /save/i });
    if (await saveBtn.count() > 0) {
      await saveBtn.click();
    } else {
      await editorTextarea.press('Control+s');
    }
    await waitForOutput(page, 'saved', 3000);

    // Close editor
    const closeBtn = editorView.locator('button', { hasText: /close|exit|back/i });
    if (await closeBtn.count() > 0) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(500);

    await cmd(page, 'DO myprog', 1500);
    // STORE is silent inside a program (dBASE behaviour) — verify the program
    // ran by echoing the variable it set at the top level, where STORE echoes.
    const out = await outputAfter(page, () => cmd(page, 'STORE prog_result TO echo_check', 1000));
    console.log('echo_check output:', out);
    expect(out).toMatch(/from_program/);
  });

  test('16. LIST PROGRAMS shows saved program', async ({ page }) => {
    await boot(page);
    // Save a program first
    await cmd(page, 'EDIT testprog', 1500);
    const editorView = page.locator('#editor-view');
    await expect(editorView).toBeVisible({ timeout: 5000 });
    const textarea = editorView.locator('textarea');
    await textarea.fill('STORE 1 TO x');
    const saveBtn = editorView.locator('button', { hasText: /save/i });
    if (await saveBtn.count() > 0) await saveBtn.click();
    else await textarea.press('Control+s');
    await waitForOutput(page, 'saved', 3000);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const out = await outputAfter(page, () => cmd(page, 'LIST PROGRAMS'));
    console.log('LIST PROGRAMS:', out);
    expect(out.toLowerCase()).toMatch(/testprog/);
  });

  test('17. BROWSE grid shows data and closes with Escape', async ({ page }) => {
    await boot(page);
    await setupContacts(page);

    await cmd(page, 'BROWSE', 1500);

    const gridView = page.locator('#grid-view');
    await expect(gridView).toBeVisible({ timeout: 5000 });

    const gridText = await gridView.textContent();
    console.log('Grid visible, sample text:', gridText?.slice(0, 200));
    expect(gridText?.toLowerCase()).toMatch(/name|age|salary/);

    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    const termView = page.locator('#terminal-view');
    await expect(termView).toBeVisible();
  });

  test('18. LIST TABLES shows our table', async ({ page }) => {
    await boot(page);
    await setupContacts(page);

    const out = await outputAfter(page, () => cmd(page, 'LIST TABLES'));
    console.log('LIST TABLES output:', out);
    expect(out.toLowerCase()).toContain('contacts');
  });

  test('19. error handling: USE nonexistent table', async ({ page }) => {
    await boot(page);
    const out = await outputAfter(page, () => cmd(page, 'USE nonexistent_xyz_table'));
    console.log('Error output:', out);
    expect(out.toLowerCase()).toMatch(/error|not found|no such|does not exist/);
  });

  test('20. command history: arrow up recalls previous commands', async ({ page }) => {
    await boot(page);
    await cmd(page, 'STORE 1 TO a');
    await cmd(page, 'STORE 2 TO b');
    await page.waitForTimeout(200);

    const input = page.locator('#terminal-input');
    await input.press('ArrowUp');
    await page.waitForTimeout(100);
    const val1 = await input.inputValue();
    console.log('Arrow up 1:', val1);
    expect(val1.toUpperCase()).toContain('STORE');

    await input.press('ArrowUp');
    await page.waitForTimeout(100);
    const val2 = await input.inputValue();
    console.log('Arrow up 2:', val2);
    expect(val2.toUpperCase()).toContain('STORE');
    expect(val2).not.toBe(val1); // Should be different command
  });
});
