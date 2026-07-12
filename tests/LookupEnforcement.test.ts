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
