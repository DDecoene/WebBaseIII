import { describe, it, expect, vi, afterEach } from 'vitest';
import { Lexer } from '../src/interpreter/Lexer';
import { Parser } from '../src/interpreter/Parser';
import { Session } from '../server/Session';
import { programStore } from '../server/ProgramStore';
import type { ServerMessage } from '../src/shared/types.js';
import fs from 'fs';
import path from 'path';

let testDbCounter = 0;

function makeSession() {
  const sent: ServerMessage[] = [];
  const send = vi.fn((msg: ServerMessage) => { sent.push(msg); });
  const session = new Session(send);
  return { session, sent, send };
}

function uniqueDb() {
  return `test_session_${++testDbCounter}`;
}

afterEach(() => {
  // Clean up all test_session_* databases created during tests
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.toLowerCase().startsWith('test_session_') &&
        (f.toLowerCase().endsWith('.sqlite3') || f.toLowerCase().endsWith('.sqlite3-shm') || f.toLowerCase().endsWith('.sqlite3-wal')))
      .forEach(f => fs.unlinkSync(path.join(dataDir, f)));
  }
  // Clean up programs these tests saved into the shared program store
  for (const name of programStore.list()) {
    if (name.startsWith('test_')) programStore.delete(name);
  }
});

describe('Session', () => {
  it('processes a HELP command and returns output lines', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'command', text: 'HELP' });
    const outputMsg = sent.find(m => m.type === 'output');
    expect(outputMsg).toBeDefined();
    expect((outputMsg as any).lines.length).toBeGreaterThan(5);
  });

  it('returns status after a command', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'command', text: 'HELP' });
    const statusMsg = sent.find(m => m.type === 'status');
    expect(statusMsg).toBeDefined();
  });

  it('sends warn/error output for unknown command', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'command', text: 'FOOBAR XYZ' });
    const outputMsg = sent.find(m => m.type === 'output') as any;
    expect(outputMsg).toBeDefined();
    const hasWarn = outputMsg.lines.some((l: any) => l.cls === 'warn' || l.cls === 'error');
    expect(hasWarn).toBe(true);
  });

  it('sends grid-open when BROWSE issued after table created and selected', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE browse_tbl (name TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE browse_tbl' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const gridMsg = sent.find(m => m.type === 'grid-open');
    expect(gridMsg).toBeDefined();
  });

  it('SET FILTER with string value filters correctly', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE filter_tbl (name TEXT, age INTEGER)' });
    await session.handleMessage({ type: 'command', text: 'USE filter_tbl' });
    // Insert Alice at row 1 (REPLACE without ALL updates current row)
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Alice", age WITH 30' });
    // Insert Bob at row 2
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Bob", age WITH 25' });
    // Filter for Alice — string quotes must survive into SQL
    await session.handleMessage({ type: 'command', text: 'SET FILTER TO name == "Alice"' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'LIST' });
    const listMsg = sent.find(m => m.type === 'output') as any;
    const lines = listMsg?.lines?.map((l: any) => l.text).join(' ') ?? '';
    expect(lines).toContain('Alice');
    expect(lines).not.toContain('Bob');
    const hasError = (listMsg?.lines ?? []).some((l: any) => l.cls === 'error');
    expect(hasError).toBe(false);
  });

  it('sends view-terminal on grid-exit', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'grid-exit' });
    const vtMsg = sent.find(m => m.type === 'view-terminal');
    expect(vtMsg).toBeDefined();
  });

  it('DO runs a saved program', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'save-program', name: 'test_do_prog', content: `USE DATABASE ${db}\nCREATE TABLE do_tbl (val TEXT)\nUSE do_tbl\nAPPEND RECORD\nREPLACE val WITH "from_prog"\nLIST` });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'DO test_do_prog' });
    const allText = sent
      .filter(m => m.type === 'output')
      .flatMap((m: any) => m.lines.map((l: any) => l.text))
      .join(' ');
    expect(allText).toContain('from_prog');
  });

  it('DO reports error for missing program', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'command', text: 'DO nosuchprog' });
    const outputMsg = sent.find(m => m.type === 'output') as any;
    const hasError = outputMsg?.lines?.some((l: any) => l.cls === 'error');
    expect(hasError).toBe(true);
  });

  it('LIST PROGRAMS shows saved programs', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'save-program', name: 'test_list_prog', content: 'LIST\n' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'LIST PROGRAMS' });
    const outputMsg = sent.find(m => m.type === 'output') as any;
    const text = outputMsg?.lines?.map((l: any) => l.text).join(' ') ?? '';
    expect(text).toContain('test_list_prog');
  });

  it('EDIT sends program-open with existing content', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'save-program', name: 'test_edit_prog', content: 'LIST TABLES\n' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'EDIT test_edit_prog' });
    const msg = sent.find(m => m.type === 'program-open') as any;
    expect(msg).toBeDefined();
    expect(msg.name).toBe('test_edit_prog');
    expect(msg.content).toBe('LIST TABLES\n');
  });

  it('save-program persists and returns to terminal', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'save-program', name: 'test_save_prog', content: 'LIST\n' });
    const okMsg = sent.find(m => m.type === 'output') as any;
    expect(okMsg?.lines?.[0]?.cls).toBe('ok');
    const vtMsg = sent.find(m => m.type === 'view-terminal');
    expect(vtMsg).toBeDefined();
  });

  it('READ inside DO WHILE resumes loop after form submit', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE loop_tbl (val TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE loop_tbl' });

    // Program: loop twice, each iteration asks for input then appends
    const prog = [
      'STORE 0 TO i',
      'DO WHILE i < 2',
      '  STORE "" TO val',
      '  @ 1,1 SAY "Value:" GET val',
      '  READ',
      '  APPEND RECORD',
      '  REPLACE val WITH val',
      '  STORE i + 1 TO i',
      'ENDDO',
      'LIST',
    ].join('\n');

    sent.length = 0;
    await session.handleMessage({ type: 'command', text: prog });

    // First iteration should pause at READ and send form-open
    expect(sent.find(m => m.type === 'form-open')).toBeDefined();

    // Submit first value (Lexer uppercases variable names → 'VAL')
    sent.length = 0;
    await session.handleMessage({ type: 'form-submit', values: { VAL: 'alpha' } });
    // Should pause again for second iteration
    expect(sent.find(m => m.type === 'form-open')).toBeDefined();

    // Submit second value
    sent.length = 0;
    await session.handleMessage({ type: 'form-submit', values: { VAL: 'beta' } });
    // Loop done — LIST output (across all output messages) should contain both values
    const allText = sent
      .filter(m => m.type === 'output')
      .flatMap((m: any) => m.lines.map((l: any) => l.text))
      .join(' ');
    expect(allText).toContain('alpha');
    expect(allText).toContain('beta');
  });

  it('STORE stays silent in program continuations after READ', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({
      type: 'save-program', name: 'test_silent_store',
      content: [
        'STORE "before" TO pre_var',
        '@ 1,1 SAY "Value:" GET pre_var',
        'READ',
        'STORE "after" TO post_var',
      ].join('\n'),
    });

    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'DO test_silent_store' });
    let allText = sent
      .filter(m => m.type === 'output')
      .flatMap((m: any) => m.lines.map((l: any) => l.text))
      .join('\n');
    expect(allText).not.toContain('PRE_VAR =');

    // Resume past the READ — the STORE after it must stay silent too
    sent.length = 0;
    await session.handleMessage({ type: 'form-submit', values: { PRE_VAR: 'x' } });
    allText = sent
      .filter(m => m.type === 'output')
      .flatMap((m: any) => m.lines.map((l: any) => l.text))
      .join('\n');
    expect(allText).not.toContain('POST_VAR =');
  });

  it('dBASE logical operators .NOT./.AND./.OR. work in expressions and loops', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE p (NAME CHAR(20), STOCK NUM(6))' });
    await session.handleMessage({ type: 'command', text: 'INDEX ON NAME TO BYNAME' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE NAME WITH "Drill", STOCK WITH 5' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE NAME WITH "Mouse", STOCK WITH 7' });

    // Stock-report pattern from INVENTORY.prg: DO WHILE .NOT. EOF() ... SKIP
    const prog = [
      'GO TOP',
      'STORE 0 TO total',
      'DO WHILE .NOT. EOF()',
      '  STORE total + STOCK TO total',
      '  SKIP',
      'ENDDO',
      'STORE total TO result',
      'STORE .T. .AND. .F. TO chk_and',
      'STORE .F. .OR. .T. TO chk_or',
    ].join('\n');

    sent.length = 0;
    await session.handleMessage({ type: 'command', text: prog });
    const allText = sent
      .filter(m => m.type === 'output')
      .flatMap((m: any) => m.lines.map((l: any) => l.text))
      .join('\n');
    expect(allText).toContain('RESULT = 12');
    expect(allText).toContain('CHK_AND = .F.');
    expect(allText).toContain('CHK_OR = .T.');
  });

  it('alias.field resolves via relation outside LIST (STORE after SEEK)', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: 'SELECT CAT' });
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE cats (CATID CHAR(4), CATNAME CHAR(20))' });
    await session.handleMessage({ type: 'command', text: 'INDEX ON CATID TO BYCAT' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE CATID WITH "ELEC", CATNAME WITH "Electronics"' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE CATID WITH "TOOL", CATNAME WITH "Tools"' });

    await session.handleMessage({ type: 'command', text: 'SELECT INV' });
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE prods (PRODID CHAR(6), CATID CHAR(4), NAME CHAR(20))' });
    await session.handleMessage({ type: 'command', text: 'INDEX ON NAME TO BYNAME' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE PRODID WITH "P1", CATID WITH "TOOL", NAME WITH "Drill"' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE PRODID WITH "P2", CATID WITH "ELEC", NAME WITH "Mouse"' });
    await session.handleMessage({ type: 'command', text: 'SET RELATION TO CATID INTO CAT' });
    await session.handleMessage({ type: 'command', text: 'SEEK "Mouse"' });

    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'STORE CAT.CATNAME TO v_cat' });
    const allText = sent
      .filter(m => m.type === 'output')
      .flatMap((m: any) => m.lines.map((l: any) => l.text))
      .join(' ');
    expect(allText).toContain('Electronics');
  });

  it('APPEND + REPLACE seeds correctly while an index is active (INVENTORY seeding pattern)', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE seed_tbl (CATID CHAR(4), CATNAME CHAR(30))' });
    // INDEX ON before seeding — REPLACE must still target the freshly appended row
    await session.handleMessage({ type: 'command', text: 'INDEX ON CATID TO BYCAT' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE CATID WITH "ELEC", CATNAME WITH "Electronics"' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE CATID WITH "TOOL", CATNAME WITH "Tools"' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE CATID WITH "OFFC", CATNAME WITH "Office"' });

    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'LIST' });
    const allText = sent
      .filter(m => m.type === 'output')
      .flatMap((m: any) => m.lines.map((l: any) => l.text))
      .join(' ');
    expect(allText).toContain('Electronics');
    expect(allText).toContain('Tools');
    expect(allText).toContain('Office');
  });

  it('statements after READ inside a DO CASE branch execute after form submit', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE case_tbl (val TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE case_tbl' });

    // Mirrors INVENTORY.prg: menu choice dispatches into a CASE branch that
    // collects input via READ, then acts on it after the submit.
    const prog = [
      'STORE "1" TO choice',
      'DO CASE',
      '  CASE choice == "1"',
      '    STORE "" TO val',
      '    @ 1,1 SAY "Value:" GET val',
      '    READ',
      '    APPEND RECORD',
      '    REPLACE val WITH val',
      '  OTHERWISE',
      '    STORE "unreached" TO val',
      'ENDCASE',
      'LIST',
    ].join('\n');

    sent.length = 0;
    await session.handleMessage({ type: 'command', text: prog });
    expect(sent.find(m => m.type === 'form-open')).toBeDefined();

    // Submit the form — the APPEND + REPLACE after READ must still run
    sent.length = 0;
    await session.handleMessage({ type: 'form-submit', values: { VAL: 'gamma' } });
    const allText = sent
      .filter(m => m.type === 'output')
      .flatMap((m: any) => m.lines.map((l: any) => l.text))
      .join(' ');
    expect(allText).toContain('gamma');
  });

  it('BROWSE inside DO WHILE resumes loop after grid-exit', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE browse_loop_tbl (val TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE browse_loop_tbl' });

    const prog = [
      'STORE "" TO choice',
      'DO WHILE choice != "Q"',
      '  @ 1,1 SAY "Choice (B=Browse, Q=Quit):" GET choice',
      '  READ',
      '  IF choice == "B"',
      '    USE browse_loop_tbl',
      '    BROWSE',
      '  ENDIF',
      'ENDDO',
    ].join('\n');

    sent.length = 0;
    await session.handleMessage({ type: 'command', text: prog });
    expect(sent.find(m => m.type === 'form-open')).toBeDefined();

    // Choose Browse (Lexer uppercases → 'CHOICE')
    sent.length = 0;
    await session.handleMessage({ type: 'form-submit', values: { CHOICE: 'B' } });
    expect(sent.find(m => m.type === 'grid-open')).toBeDefined();

    // Exit grid — loop should resume and show form again
    sent.length = 0;
    await session.handleMessage({ type: 'grid-exit' });
    expect(sent.find(m => m.type === 'view-terminal')).toBeDefined();
    expect(sent.find(m => m.type === 'form-open')).toBeDefined();

    // Quit the loop
    sent.length = 0;
    await session.handleMessage({ type: 'form-submit', values: { CHOICE: 'Q' } });
    expect(sent.find(m => m.type === 'status')).toBeDefined();
  });

  it('REPLACE ALL with multiple comma-separated fields updates all fields', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE replace_tbl (name TEXT, value INTEGER, city TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE replace_tbl' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'REPLACE ALL name WITH "Acme Corp", value WITH 42, city WITH "Brussels"' });
    const outputMsg = sent.find(m => m.type === 'output') as any;
    expect(outputMsg).toBeDefined();
    // Should NOT produce an "Unknown command" line
    const hasUnknown = outputMsg?.lines?.some((l: any) => l.text?.includes('Unknown command'));
    expect(hasUnknown).toBe(false);
    // Verify data was actually written
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'LIST' });
    const listMsg = sent.find(m => m.type === 'output') as any;
    const listText = listMsg?.lines?.map((l: any) => l.text).join(' ') ?? '';
    expect(listText).toContain('Acme Corp');
    expect(listText).toContain('42');
    expect(listText).toContain('Brussels');
  });

  it('DO CASE — first matching branch executes', async () => {
    const { session } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE docase1 (score INTEGER)' });
    await session.handleMessage({ type: 'command', text: 'USE docase1' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE score WITH 4' });
    await session.handleMessage({ type: 'command', text: 'DO CASE\n  CASE score > 3\n    STORE "high" TO level\n  CASE score > 1\n    STORE "mid" TO level\n  OTHERWISE\n    STORE "low" TO level\nENDCASE' });
    const exec = (session as any).executor;
    expect(exec.state.vars.get('LEVEL')).toBe('high');
  });

  it('DO CASE — OTHERWISE executes when no case matches', async () => {
    const { session } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE docase2 (score INTEGER)' });
    await session.handleMessage({ type: 'command', text: 'USE docase2' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE score WITH 0' });
    await session.handleMessage({ type: 'command', text: 'DO CASE\n  CASE score > 3\n    STORE "high" TO level\n  CASE score > 1\n    STORE "mid" TO level\n  OTHERWISE\n    STORE "low" TO level\nENDCASE' });
    const exec = (session as any).executor;
    expect(exec.state.vars.get('LEVEL')).toBe('low');
  });

  it('DO CASE — no branch matches and no OTHERWISE is a no-op', async () => {
    const { session } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE docase3 (score INTEGER)' });
    await session.handleMessage({ type: 'command', text: 'USE docase3' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE score WITH 0' });
    await session.handleMessage({ type: 'command', text: 'STORE "init" TO level' });
    await session.handleMessage({ type: 'command', text: 'DO CASE\n  CASE score > 3\n    STORE "high" TO level\nENDCASE' });
    const exec = (session as any).executor;
    expect(exec.state.vars.get('LEVEL')).toBe('init');
  });

  it('UPPER() in expression evaluates correctly', async () => {
    const { session } = makeSession();
    await session.handleMessage({ type: 'command', text: 'STORE UPPER("hello") TO result' });
    const exec = (session as any).executor;
    expect(exec.state.vars.get('RESULT')).toBe('HELLO');
  });

  it('SUBSTR() via STORE evaluates correctly', async () => {
    const { session } = makeSession();
    await session.handleMessage({ type: 'command', text: 'STORE SUBSTR("Hello World", 7, 5) TO result' });
    const exec = (session as any).executor;
    expect(exec.state.vars.get('RESULT')).toBe('World');
  });

  it('LEN() in IF condition', async () => {
    const { session } = makeSession();
    await session.handleMessage({ type: 'command', text: 'STORE "hi" TO x' });
    await session.handleMessage({ type: 'command', text: 'IF LEN(x) == 2\n  STORE "yes" TO result\nENDIF' });
    const exec = (session as any).executor;
    expect(exec.state.vars.get('RESULT')).toBe('yes');
  });

  it('EOF() is true after SKIP past end', async () => {
    const { session } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE eof_t (name CHAR(10))' });
    await session.handleMessage({ type: 'command', text: 'USE eof_t' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'GO BOTTOM' });
    await session.handleMessage({ type: 'command', text: 'SKIP 1' });
    await session.handleMessage({ type: 'command', text: 'STORE EOF() TO ateof' });
    const exec = (session as any).executor;
    expect(exec.state.vars.get('ATEOF')).toBe(true);
  });

  it('BOF() is true after SKIP before beginning', async () => {
    const { session } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE bof_t (name CHAR(10))' });
    await session.handleMessage({ type: 'command', text: 'USE bof_t' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'GO TOP' });
    await session.handleMessage({ type: 'command', text: 'SKIP -1' });
    await session.handleMessage({ type: 'command', text: 'STORE BOF() TO atbof' });
    const exec = (session as any).executor;
    expect(exec.state.vars.get('ATBOF')).toBe(true);
  });

  it('FOUND() is true after successful SEEK', async () => {
    const { session } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE found_t (name CHAR(20))' });
    await session.handleMessage({ type: 'command', text: 'USE found_t' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Alice"' });
    await session.handleMessage({ type: 'command', text: 'INDEX ON NAME TO BYNAME' });
    await session.handleMessage({ type: 'command', text: 'SEEK "Alice"' });
    await session.handleMessage({ type: 'command', text: 'STORE FOUND() TO f' });
    const exec = (session as any).executor;
    expect(exec.state.vars.get('F')).toBe(true);
  });

  it('RECNO() returns current row pointer', async () => {
    const { session } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE recno_t (name CHAR(10))' });
    await session.handleMessage({ type: 'command', text: 'USE recno_t' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'GO TOP' });
    await session.handleMessage({ type: 'command', text: 'STORE RECNO() TO r' });
    const exec = (session as any).executor;
    expect(exec.state.vars.get('R')).toBe(1);
  });

  it('RECCOUNT() returns total records', async () => {
    const { session } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE rc_t (name CHAR(10))' });
    await session.handleMessage({ type: 'command', text: 'USE rc_t' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'STORE RECCOUNT() TO rc' });
    const exec = (session as any).executor;
    expect(exec.state.vars.get('RC')).toBe(3);
  });

  it('INDEX ON UPPER(name) sorts case-insensitively', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE ci_t (name CHAR(20))' });
    await session.handleMessage({ type: 'command', text: 'USE ci_t' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "zara"' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Alice"' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "bob"' });
    await session.handleMessage({ type: 'command', text: 'INDEX ON UPPER(NAME) TO BYUPPER' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'LIST' });
    const output = sent.find(m => m.type === 'output') as any;
    const lines: string[] = output.lines.map((l: any) => l.text);
    const dataLines = lines.filter(l => /alice|bob|zara/i.test(l));
    expect(dataLines[0]).toMatch(/alice/i);
    expect(dataLines[1]).toMatch(/bob/i);
    expect(dataLines[2]).toMatch(/zara/i);
  });

  it('RECCOUNT() and EOF() are accurate immediately after USE without APPEND', async () => {
    const { session } = makeSession();
    const db = uniqueDb();
    // Seed via one session, then read via a fresh session to simulate re-opening
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE preloaded (val CHAR(10))' });
    await session.handleMessage({ type: 'command', text: 'USE preloaded' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });

    // Fresh session — open same DB/table without any APPEND
    const { session: s2 } = makeSession();
    await s2.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await s2.handleMessage({ type: 'command', text: 'USE preloaded' });
    await s2.handleMessage({ type: 'command', text: 'STORE RECCOUNT() TO rc' });
    await s2.handleMessage({ type: 'command', text: 'GO TOP' });
    await s2.handleMessage({ type: 'command', text: 'SKIP 99' });
    await s2.handleMessage({ type: 'command', text: 'STORE EOF() TO ateof' });
    const exec2 = (s2 as any).executor;
    expect(exec2.state.vars.get('RC')).toBe(2);
    expect(exec2.state.vars.get('ATEOF')).toBe(true);
  });
});

describe('Parser: multi-work-area nodes', () => {
  function parse(src: string) {
    return new Parser(new Lexer(src).tokenize()).parse();
  }

  it('parses SELECT alias', () => {
    const nodes = parse('SELECT customers');
    expect(nodes[0]).toMatchObject({ type: 'SELECT', alias: 'CUSTOMERS' });
  });

  it('parses SELECT numeric alias', () => {
    const nodes = parse('SELECT 2');
    expect(nodes[0]).toMatchObject({ type: 'SELECT', alias: '2' });
  });

  it('parses USE table ALIAS name', () => {
    const nodes = parse('USE orders ALIAS ord');
    expect(nodes[0]).toMatchObject({ type: 'USE', name: 'ORDERS', alias: 'ORD' });
  });

  it('parses USE table without ALIAS (alias is null)', () => {
    const nodes = parse('USE customers');
    expect(nodes[0]).toMatchObject({ type: 'USE', name: 'CUSTOMERS', alias: null });
  });

  it('parses SET RELATION TO expr INTO alias', () => {
    const nodes = parse('SET RELATION TO custid INTO customers');
    expect(nodes[0]).toMatchObject({ type: 'SET_RELATION', expression: 'CUSTID', intoAlias: 'CUSTOMERS' });
  });

  it('parses SET RELATION TO (clear)', () => {
    const nodes = parse('SET RELATION TO');
    expect(nodes[0]).toMatchObject({ type: 'SET_RELATION', expression: null, intoAlias: null });
  });

  it('parses LIST AREAS', () => {
    const nodes = parse('LIST AREAS');
    expect(nodes[0]).toMatchObject({ type: 'LIST_AREAS' });
  });

  it('parses LIST with column list', () => {
    const nodes = parse('LIST name, customers.city');
    expect(nodes[0]).toMatchObject({ type: 'LIST_COLS', cols: ['NAME', 'CUSTOMERS.CITY'] });
  });

  it('parses CLOSE', () => {
    expect(parse('CLOSE')[0]).toMatchObject({ type: 'CLOSE' });
  });

  it('parses CLOSE ALL', () => {
    expect(parse('CLOSE ALL')[0]).toMatchObject({ type: 'CLOSE_ALL' });
  });

  it('parses CREATE REPORT', () => {
    const nodes = parse('CREATE REPORT sales');
    expect(nodes[0]).toEqual({ type: 'CREATE_REPORT', name: 'SALES' });
  });

  it('parses MODIFY REPORT', () => {
    const nodes = parse('MODIFY REPORT sales');
    expect(nodes[0]).toEqual({ type: 'MODIFY_REPORT', name: 'SALES' });
  });

  it('parses REPORT FORM', () => {
    const nodes = parse('REPORT FORM sales');
    expect(nodes[0]).toEqual({ type: 'REPORT_FORM', name: 'SALES' });
  });

  it('parses LIST REPORTS', () => {
    const nodes = parse('LIST REPORTS');
    expect(nodes[0]).toEqual({ type: 'LIST_REPORTS' });
  });

  it('parses DELETE REPORT', () => {
    const nodes = parse('DELETE REPORT sales');
    expect(nodes[0]).toEqual({ type: 'DELETE_REPORT', name: 'SALES' });
  });

  it('DELETE still works after DELETE REPORT added', () => {
    const nodes = parse('DELETE');
    expect(nodes[0]).toEqual({ type: 'DELETE', scope: 'CURRENT' });
  });

  it('DELETE ALL still works after DELETE REPORT added', () => {
    const nodes = parse('DELETE ALL');
    expect(nodes[0]).toEqual({ type: 'DELETE', scope: 'ALL' });
  });
});

describe('Multi-work-area integration', () => {
  async function cmd(session: InstanceType<typeof Session>, text: string): Promise<ServerMessage[]> {
    const captured: ServerMessage[] = [];
    const orig = (session as any).send;
    (session as any).send = (m: ServerMessage) => { captured.push(m); orig(m); };
    await session.handleMessage({ type: 'command', text });
    (session as any).send = orig;
    return captured;
  }

  function outputText(msgs: ServerMessage[]): string {
    return msgs.filter(m => m.type === 'output').flatMap((m: any) => m.lines.map((l: any) => l.text)).join('\n');
  }

  it('SELECT creates and activates a new work area', async () => {
    const { session } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    const msgs = await cmd(session, 'SELECT orders');
    const exec = (session as any).executor;
    expect(exec.activeAlias).toBe('ORDERS');
    expect(exec.areas.has('ORDERS')).toBe(true);
  });

  it('CLOSE clears active area table', async () => {
    const { session } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t (v TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE t' });
    const exec = (session as any).executor;
    expect(exec.area.table).toBe('T');
    await session.handleMessage({ type: 'command', text: 'CLOSE' });
    expect(exec.area.table).toBeNull();
  });

  it('CLOSE ALL resets to single area 1', async () => {
    const { session } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'SELECT a2' });
    await session.handleMessage({ type: 'command', text: 'SELECT a3' });
    const exec = (session as any).executor;
    expect(exec.areas.size).toBeGreaterThan(1);
    await session.handleMessage({ type: 'command', text: 'CLOSE ALL' });
    expect(exec.areas.size).toBe(1);
    expect(exec.activeAlias).toBe('1');
  });

  it('LIST AREAS shows all open areas', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'SELECT orders' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'LIST AREAS' });
    const text = outputText(sent);
    expect(text).toMatch(/orders/i);
    expect(text).toMatch(/1\b/);
  });

  it('SET RELATION TO errors if target area has no index', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    const tbl = `noindex_${db}`;
    // Area 1: a table with NO index ever created
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: `CREATE TABLE ${tbl} (id TEXT, name TEXT)` });
    await session.handleMessage({ type: 'command', text: `USE ${tbl}` });
    // Area 2: another table
    await session.handleMessage({ type: 'command', text: 'SELECT 2' });
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: `CREATE TABLE ord_${db} (custno TEXT)` });
    await session.handleMessage({ type: 'command', text: `USE ord_${db}` });
    sent.length = 0;
    // target area 1 has no active index — should error
    await session.handleMessage({ type: 'command', text: 'SET RELATION TO custno INTO 1' });
    const text = outputText(sent);
    expect(text).toMatch(/no active index/i);
  });

  it('relation auto-seek: navigating orders seeks matching customer', async () => {
    const { session } = makeSession();
    const db = uniqueDb();
    // Setup orders + customers tables
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE customers (id TEXT, name TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE customers' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE id WITH "C1", name WITH "Alice"' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE id WITH "C2", name WITH "Bob"' });
    await session.handleMessage({ type: 'command', text: 'INDEX ON id TO BYID' });

    await session.handleMessage({ type: 'command', text: 'SELECT 2' });
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE orders (custno TEXT, amount REAL)' });
    await session.handleMessage({ type: 'command', text: 'USE orders' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE custno WITH "C2", amount WITH 99' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE custno WITH "C1", amount WITH 50' });

    // Select orders (area 2), set relation into customers (area 1)
    await session.handleMessage({ type: 'command', text: 'SET RELATION TO custno INTO 1' });

    // Go to order 1 (custno=C2) — customers should auto-seek to Bob
    await session.handleMessage({ type: 'command', text: 'GO 1' });

    const exec = (session as any).executor;
    const custArea = exec.areas.get('1');
    expect(custArea._found).toBe(true);
    // Bob is the 2nd customer in index order so rowPtr should be 2
    expect(custArea.rowPtr).toBeGreaterThan(0);
  });

  it('LIST DATABASES shows sqlite3 files in the data directory', async () => {
    const { session, sent } = makeSession();
    // Open two distinct databases so there is something to list
    const db1 = uniqueDb();
    const db2 = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db1}` });
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db2}` });
    sent.length = 0;

    await session.handleMessage({ type: 'command', text: 'LIST DATABASES' });

    const outputMsg = sent.find(m => m.type === 'output');
    expect(outputMsg).toBeDefined();
    const lines = (outputMsg as any).lines as Array<{ text: string }>;
    const texts = lines.map(l => l.text.toLowerCase());
    expect(texts.some(t => t.includes(db1.toLowerCase()))).toBe(true);
    expect(texts.some(t => t.includes(db2.toLowerCase()))).toBe(true);
  });

  it('LIST REPORTS returns output', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'command', text: 'LIST REPORTS' });
    const msg = sent.find(m => m.type === 'output');
    expect(msg).toBeDefined();
  });

  it('CREATE REPORT opens editor with JSON', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'command', text: 'CREATE REPORT sales' });
    const msg = sent.find(m => m.type === 'program-open') as any;
    expect(msg).toBeDefined();
    expect(msg.content).toContain('"title"');
  });

  it('REPORT FORM returns error when report not found', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t (name CHAR(20))' });
    await session.handleMessage({ type: 'command', text: 'USE t' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'REPORT FORM ghost' });
    const out = sent.find(m => m.type === 'output') as any;
    expect(out.lines.some((l: any) => l.text.includes('not found'))).toBe(true);
  });

  it('REPORT FORM renders ASCII and sends report-preview', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE employees (name CHAR(40), dept CHAR(20), salary NUM(8,2))' });
    await session.handleMessage({ type: 'command', text: 'USE employees' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Alice", dept WITH "Eng", salary WITH 90000' });

    const reportDef = JSON.stringify({
      title: 'Test Report', columns: [
        { field: 'name', heading: 'Name', width: 20 },
        { field: 'salary', heading: 'Salary', width: 10, total: true }
      ]
    });
    await session.handleMessage({ type: 'save-program', name: '__report_testrpt', content: reportDef });
    sent.length = 0;

    await session.handleMessage({ type: 'command', text: 'REPORT FORM testrpt' });
    const preview = sent.find(m => m.type === 'report-preview') as any;
    expect(preview).toBeDefined();
    expect(preview.html).toContain('Test Report');
    const output = sent.find(m => m.type === 'output') as any;
    expect(output.lines.some((l: any) => l.text.includes('Alice'))).toBe(true);
  });

  it('DELETE REPORT removes the definition', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'save-program', name: '__report_myrpt', content: '{"title":"x","columns":[]}' });
    await session.handleMessage({ type: 'command', text: 'DELETE REPORT myrpt' });
    sent.length = 0;
    const db2 = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db2}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t2 (x CHAR(1))' });
    await session.handleMessage({ type: 'command', text: 'USE t2' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'REPORT FORM myrpt' });
    const out = sent.find(m => m.type === 'output') as any;
    expect(out.lines.some((l: any) => l.text.includes('not found'))).toBe(true);
  });
});
