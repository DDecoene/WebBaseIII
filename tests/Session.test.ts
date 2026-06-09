import { describe, it, expect, vi, afterEach } from 'vitest';
import { Lexer } from '../src/interpreter/Lexer';
import { Parser } from '../src/interpreter/Parser';
import { Session } from '../server/Session';
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
});
