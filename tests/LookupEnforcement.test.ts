import { describe, it, expect, afterEach } from 'vitest';
import { Session } from '../server/Session';
import type { ServerMessage } from '../src/shared/types';
import fs from 'fs';
import path from 'path';

let dbCounter = 0;
function uniqueDb() { return `test_lookupenf_${Date.now()}_${++dbCounter}`; }

afterEach(() => {
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.toLowerCase().startsWith('test_lookupenf_'))
      .forEach(f => fs.unlinkSync(path.join(dataDir, f)));
  }
});

async function setup() {
  const sent: ServerMessage[] = [];
  const session = new Session((m) => sent.push(m));
  const run = async (text: string) => {
    sent.length = 0;
    await session.handleMessage({ type: 'command', text });
    const out = sent.filter(m => m.type === 'output') as any[];
    return out.flatMap(o => o.lines).map((l: any) => l.text).join('\n');
  };
  await run(`USE DATABASE ${uniqueDb()}`);
  return { session, sent, run };
}

describe('CREATE/ALTER TABLE record the declared lookup', () => {
  it('CREATE TABLE with a literal-list LOOKUP persists it (visible via BROWSE grid-open columnTypes)', async () => {
    const { session, sent, run } = await setup();
    await run('CREATE TABLE DEALS (TITLE CHAR(20), STAGE CHAR(12) LOOKUP ("Lead","Won","Lost"))');
    await run('USE DEALS');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const grid = sent.find(m => m.type === 'grid-open') as any;
    expect(grid.columnTypes.STAGE.lookup).toEqual({ kind: 'list', values: ['Lead', 'Won', 'Lost'] });
  });

  it('CREATE TABLE with a table LOOKUP + DISPLAY persists it', async () => {
    const { session, sent, run } = await setup();
    await run('CREATE TABLE EMPLOYEES (SCHEDID CHAR(4) LOOKUP SCHEDULES.SCHEDID DISPLAY DESCR)');
    await run('USE EMPLOYEES');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const grid = sent.find(m => m.type === 'grid-open') as any;
    expect(grid.columnTypes.SCHEDID.lookup).toEqual({
      kind: 'table', table: 'SCHEDULES', column: 'SCHEDID', display: 'DESCR',
    });
  });

  it('a column with no LOOKUP clause has no lookup key at all', async () => {
    const { session, sent, run } = await setup();
    await run('CREATE TABLE T (PLAIN CHAR(10))');
    await run('USE T');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const grid = sent.find(m => m.type === 'grid-open') as any;
    expect(grid.columnTypes.PLAIN.lookup).toBeUndefined();
  });

  it('ALTER TABLE ADD with a LOOKUP clause persists it', async () => {
    const { session, sent, run } = await setup();
    await run('CREATE TABLE T (A CHAR(4))');
    await run('USE T');
    await run('ALTER TABLE T ADD STAGE CHAR LOOKUP ("X","Y")');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const grid = sent.find(m => m.type === 'grid-open') as any;
    expect(grid.columnTypes.STAGE.lookup).toEqual({ kind: 'list', values: ['X', 'Y'] });
  });

  it('ALTER TABLE ADD without a LOOKUP clause stores no lookup', async () => {
    const { session, sent, run } = await setup();
    await run('CREATE TABLE T (A CHAR(4))');
    await run('USE T');
    await run('ALTER TABLE T ADD PLAINCOL CHAR');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const grid = sent.find(m => m.type === 'grid-open') as any;
    expect(grid.columnTypes.PLAINCOL.lookup).toBeUndefined();
  });

  it('ALTER TABLE ALTER with a LOOKUP clause persists it', async () => {
    const { session, sent, run } = await setup();
    await run('CREATE TABLE T (STAGE CHAR(4))');
    await run('USE T');
    await run('ALTER TABLE T ALTER STAGE CHAR LOOKUP ("A","B")');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const grid = sent.find(m => m.type === 'grid-open') as any;
    expect(grid.columnTypes.STAGE.lookup).toEqual({ kind: 'list', values: ['A', 'B'] });
  });
});

describe('REPLACE enforces lookup membership', () => {
  it('rejects an off-list value on a literal-lookup column and does not write it', async () => {
    const { run } = await setup();
    await run('CREATE TABLE DEALS (TITLE CHAR(20), STAGE CHAR(12) LOOKUP ("Lead","Won","Lost"))');
    await run('USE DEALS');
    await run('APPEND RECORD');
    const out = await run('REPLACE STAGE WITH "Maybe"');
    expect(out).toMatch(/not one of the allowed values/);
    expect(await run('LIST')).not.toContain('Maybe');
  });

  it('accepts an on-list value (exact case)', async () => {
    const { run } = await setup();
    await run('CREATE TABLE DEALS (TITLE CHAR(20), STAGE CHAR(12) LOOKUP ("Lead","Won","Lost"))');
    await run('USE DEALS');
    await run('APPEND RECORD');
    expect(await run('REPLACE STAGE WITH "Won"')).toContain('Replaced');
    expect(await run('LIST')).toContain('Won');
  });

  it('rejects the wrong case', async () => {
    const { run } = await setup();
    await run('CREATE TABLE DEALS (STAGE CHAR(12) LOOKUP ("Won"))');
    await run('USE DEALS');
    await run('APPEND RECORD');
    expect(await run('REPLACE STAGE WITH "won"')).toMatch(/not one of the allowed values/);
  });

  it('enforces a table lookup against live source rows', async () => {
    const { run } = await setup();
    await run('CREATE TABLE SCHEDULES (SCHEDID CHAR(4), DESCR CHAR(30))');
    await run('USE SCHEDULES');
    await run('APPEND RECORD');
    await run('REPLACE SCHEDID WITH "S001", DESCR WITH "Std day"');
    await run('CREATE TABLE EMPLOYEES (EMPID CHAR(4), SCHEDID CHAR(4) LOOKUP SCHEDULES.SCHEDID DISPLAY DESCR)');
    await run('USE EMPLOYEES');
    await run('APPEND RECORD');
    expect(await run('REPLACE SCHEDID WITH "S999"')).toMatch(/not one of the allowed values/);
    expect(await run('REPLACE SCHEDID WITH "S001"')).toContain('Replaced');
  });

  it('a new source row becomes legal immediately (fresh re-resolve at write time)', async () => {
    const { run } = await setup();
    await run('CREATE TABLE SCHEDULES (SCHEDID CHAR(4))');
    await run('USE SCHEDULES');
    await run('APPEND RECORD');
    await run('REPLACE SCHEDID WITH "S001"');
    await run('CREATE TABLE EMPLOYEES (SCHEDID CHAR(4) LOOKUP SCHEDULES.SCHEDID)');
    await run('USE EMPLOYEES');
    await run('APPEND RECORD');
    expect(await run('REPLACE SCHEDID WITH "S002"')).toMatch(/not one of the allowed values/);
    await run('USE SCHEDULES');
    await run('APPEND RECORD');
    await run('REPLACE SCHEDID WITH "S002"');
    await run('USE EMPLOYEES');
    expect(await run('REPLACE SCHEDID WITH "S002"')).toContain('Replaced');
  });

  it('an unresolvable lookup degrades: the write is allowed', async () => {
    const { run } = await setup();
    await run('CREATE TABLE EMPLOYEES (SCHEDID CHAR(4) LOOKUP GHOSTTABLE.SCHEDID)');
    await run('USE EMPLOYEES');
    await run('APPEND RECORD');
    expect(await run('REPLACE SCHEDID WITH "ANY"')).toContain('Replaced');
  });

  it('ALTER TABLE ADD carries the lookup', async () => {
    const { run } = await setup();
    await run('CREATE TABLE T (A CHAR(4))');
    await run('USE T');
    await run('ALTER TABLE T ADD STAGE CHAR LOOKUP ("X","Y")');
    await run('APPEND RECORD');
    expect(await run('REPLACE STAGE WITH "Z"')).toMatch(/not one of the allowed values/);
    expect(await run('REPLACE STAGE WITH "X"')).toContain('Replaced');
  });

  it('two databases keep independent lookups for the same table+column', async () => {
    const sent: ServerMessage[] = [];
    const session = new Session((m) => sent.push(m));
    const run = async (text: string) => {
      sent.length = 0;
      await session.handleMessage({ type: 'command', text });
      const out = sent.filter(m => m.type === 'output') as any[];
      return out.flatMap(o => o.lines).map((l: any) => l.text).join('\n');
    };
    const dbA = uniqueDb(); const dbB = uniqueDb();
    await run(`USE DATABASE ${dbA}`);
    await run('CREATE TABLE T (C CHAR(4) LOOKUP ("A"))');
    await run(`USE DATABASE ${dbB}`);
    await run('CREATE TABLE T (C CHAR(4) LOOKUP ("B"))');
    await run('USE T');
    await run('APPEND RECORD');
    expect(await run('REPLACE C WITH "A"')).toMatch(/not one of the allowed values/);
    expect(await run('REPLACE C WITH "B"')).toContain('Replaced');
  });
});

describe('grid messages with lookups', () => {
  it('grid-open ships resolved options for a lookup column — exact list', async () => {
    const { session, sent, run } = await setup();
    await run('CREATE TABLE DEALS (STAGE CHAR(12) LOOKUP ("Lead","Won","Lost"))');
    await run('USE DEALS');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const grid = sent.find(m => m.type === 'grid-open') as any;
    expect(grid.columnTypes.STAGE.options).toEqual([
      { value: 'Lead', label: 'Lead' },
      { value: 'Won', label: 'Won' },
      { value: 'Lost', label: 'Lost' },
    ]);
  });

  it('grid-open degrades an unresolvable lookup: no options, a warning line', async () => {
    const { session, sent, run } = await setup();
    await run('CREATE TABLE E (SCHEDID CHAR(4) LOOKUP GHOST.SCHEDID)');
    await run('USE E');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const grid = sent.find(m => m.type === 'grid-open') as any;
    expect(grid.columnTypes.SCHEDID.options).toBeUndefined();
    const out = sent.filter(m => m.type === 'output') as any[];
    expect(out.flatMap(o => o.lines).map((l: any) => l.text).join('\n')).toMatch(/lookup for SCHEDID/i);
  });

  it('grid-edit rejects an off-list value server-side (forged message path)', async () => {
    const { session, sent, run } = await setup();
    await run('CREATE TABLE DEALS (STAGE CHAR(12) LOOKUP ("Lead","Won"))');
    await run('USE DEALS');
    await run('APPEND RECORD');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const grid = sent.find(m => m.type === 'grid-open') as any;

    sent.length = 0;
    await session.handleMessage({ type: 'grid-edit', rowid: grid.rows[0]._rowid, col: 'STAGE', value: 'Hacked' });
    const out = sent.find(m => m.type === 'output') as any;
    expect(out.lines.map((l: any) => l.text).join('\n')).toMatch(/not one of the allowed values/);
    expect(await run('LIST')).not.toContain('Hacked');
  });

  it('grid-edit accepts an on-list value', async () => {
    const { session, sent, run } = await setup();
    await run('CREATE TABLE DEALS (STAGE CHAR(12) LOOKUP ("Lead","Won"))');
    await run('USE DEALS');
    await run('APPEND RECORD');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const grid = sent.find(m => m.type === 'grid-open') as any;
    await session.handleMessage({ type: 'grid-edit', rowid: grid.rows[0]._rowid, col: 'STAGE', value: 'Won' });
    expect(await run('LIST')).toContain('Won');
  });
});
