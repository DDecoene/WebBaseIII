import { describe, it, expect, afterEach } from 'vitest';
import { Lexer } from '../src/interpreter/Lexer';
import { Parser } from '../src/interpreter/Parser';
import { Session } from '../server/Session';
import type { ServerMessage } from '../src/shared/types';
import fs from 'fs';
import path from 'path';

let dbCounter = 0;
function makeSession() {
  const sent: ServerMessage[] = [];
  const send = (msg: ServerMessage) => { sent.push(msg); };
  return { session: new Session(send), sent };
}
function uniqueDb() { return `test_alter_${Date.now()}_${++dbCounter}`; }

afterEach(() => {
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.toLowerCase().startsWith('test_alter_'))
      .forEach(f => fs.unlinkSync(path.join(dataDir, f)));
  }
});

async function structure(session: Session, sent: ServerMessage[], _table: string): Promise<string[]> {
  sent.length = 0;
  await session.handleMessage({ type: 'command', text: 'LIST STRUCTURE' });
  const out = sent.find(m => m.type === 'output') as any;
  return (out?.lines ?? []).map((l: any) => l.text);
}

function parse(src: string) {
  return new Parser(new Lexer(src).tokenize()).parse();
}

describe('Parser: MODIFY STRUCTURE / ALTER TABLE', () => {
  it('parses MODIFY STRUCTURE', () => {
    expect(parse('MODIFY STRUCTURE')[0]).toEqual({ type: 'MODIFY_STRUCTURE' });
  });

  it('parses ALTER TABLE ADD', () => {
    expect(parse('ALTER TABLE customers ADD phone CHAR(20)')[0]).toEqual({
      type: 'ALTER_TABLE', name: 'CUSTOMERS', op: 'ADD', col: 'PHONE', colType: 'CHAR', lookup: null,
    });
  });

  it('parses ALTER TABLE DROP', () => {
    expect(parse('ALTER TABLE customers DROP phone')[0]).toEqual({
      type: 'ALTER_TABLE', name: 'CUSTOMERS', op: 'DROP', col: 'PHONE',
    });
  });

  it('parses ALTER TABLE RENAME', () => {
    expect(parse('ALTER TABLE customers RENAME phone TO mobile')[0]).toEqual({
      type: 'ALTER_TABLE', name: 'CUSTOMERS', op: 'RENAME', col: 'PHONE', newName: 'MOBILE',
    });
  });

  it('parses ALTER TABLE ALTER (type change)', () => {
    expect(parse('ALTER TABLE customers ALTER age INT')[0]).toEqual({
      type: 'ALTER_TABLE', name: 'CUSTOMERS', op: 'ALTER', col: 'AGE', colType: 'INT', lookup: null,
    });
  });
});

describe('Executor: ALTER TABLE ADD', () => {
  it('adds a new column', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t (name CHAR(10))' });
    await session.handleMessage({ type: 'command', text: 'USE t' });
    await session.handleMessage({ type: 'command', text: 'ALTER TABLE t ADD age INT' });
    const lines = await structure(session, sent, 't');
    expect(lines.join(' ').toLowerCase()).toContain('age');
  });

  it('errors when the table does not exist', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'ALTER TABLE ghost ADD age INT' });
    const out = sent.find(m => m.type === 'output') as any;
    expect((out?.lines ?? []).some((l: any) => l.cls === 'error')).toBe(true);
  });

  it('errors when the column already exists', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t (name CHAR(10))' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'ALTER TABLE t ADD name CHAR(20)' });
    const out = sent.find(m => m.type === 'output') as any;
    expect((out?.lines ?? []).some((l: any) => l.cls === 'error')).toBe(true);
  });
});

describe('Executor: ALTER TABLE drops affected indexes', () => {
  it('drops indexes and warns when a column is dropped', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t (name CHAR(10), age INT)' });
    await session.handleMessage({ type: 'command', text: 'USE t' });
    await session.handleMessage({ type: 'command', text: 'INDEX ON name TO byname' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'ALTER TABLE t DROP age' });
    const out = sent.find(m => m.type === 'output') as any;
    const text = (out?.lines ?? []).map((l: any) => l.text).join(' ').toLowerCase();
    expect(text).toContain('byname');   // warning lists the dropped index
    // index metadata is gone
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'LIST INDEXES' });
    const out2 = sent.find(m => m.type === 'output') as any;
    expect((out2?.lines ?? []).map((l: any) => l.text).join(' ').toLowerCase()).not.toContain('byname');
  });
});

describe('Executor: ALTER TABLE DROP / RENAME', () => {
  async function setup() {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t (name CHAR(10), age INT)' });
    await session.handleMessage({ type: 'command', text: 'USE t' });
    return { session, sent };
  }

  it('drops a column', async () => {
    const { session, sent } = await setup();
    await session.handleMessage({ type: 'command', text: 'ALTER TABLE t DROP age' });
    const lines = await structure(session, sent, 't');
    expect(lines.join(' ').toLowerCase()).not.toContain('age');
  });

  it('errors dropping a non-existent column', async () => {
    const { session, sent } = await setup();
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'ALTER TABLE t DROP ghost' });
    const out = sent.find(m => m.type === 'output') as any;
    expect((out?.lines ?? []).some((l: any) => l.cls === 'error')).toBe(true);
  });

  it('renames a column', async () => {
    const { session, sent } = await setup();
    await session.handleMessage({ type: 'command', text: 'ALTER TABLE t RENAME age TO years' });
    const lines = await structure(session, sent, 't');
    const joined = lines.join(' ').toLowerCase();
    expect(joined).toContain('years');
    expect(joined).not.toContain('age');
  });

  it('errors renaming to an existing column name', async () => {
    const { session, sent } = await setup();
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'ALTER TABLE t RENAME age TO name' });
    const out = sent.find(m => m.type === 'output') as any;
    expect((out?.lines ?? []).some((l: any) => l.cls === 'error')).toBe(true);
  });
});

describe('Executor: ALTER TABLE ALTER (type change)', () => {
  it('changes a column type and preserves data', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t (name CHAR(10), age CHAR(5))' });
    await session.handleMessage({ type: 'command', text: 'USE t' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Bob", age WITH "42"' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'ALTER TABLE t ALTER age INT' });
    const ok = sent.find(m => m.type === 'output') as any;
    expect((ok?.lines ?? []).some((l: any) => l.cls === 'error')).toBe(false);
    // data survived
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'GO TOP' });
    await session.handleMessage({ type: 'command', text: 'LIST' });
    const out = sent.filter(m => m.type === 'output').at(-1) as any;
    expect((out?.lines ?? []).map((l: any) => l.text).join(' ')).toContain('Bob');
    expect((out?.lines ?? []).map((l: any) => l.text).join(' ')).toContain('42');
  });
});

describe('Session: MODIFY STRUCTURE', () => {
  it('sends modstruct-open with table and columns', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t (name CHAR(10), age INT)' });
    await session.handleMessage({ type: 'command', text: 'USE t' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'MODIFY STRUCTURE' });
    const msg = sent.find(m => m.type === 'modstruct-open') as any;
    expect(msg).toBeDefined();
    expect(msg.table.toLowerCase()).toBe('t');
    expect(msg.columns.map((c: any) => c.name.toLowerCase())).toEqual(['name', 'age']);
  });

  it('errors MODIFY STRUCTURE with no table', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'MODIFY STRUCTURE' });
    const out = sent.find(m => m.type === 'output') as any;
    expect((out?.lines ?? []).some((l: any) => l.cls === 'error')).toBe(true);
  });
});
