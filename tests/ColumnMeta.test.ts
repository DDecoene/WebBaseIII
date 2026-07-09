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
  return { session: new Session((m: ServerMessage) => { sent.push(m); }), sent };
}
function uniqueDb() { return `test_colmeta_${Date.now()}_${++dbCounter}`; }

afterEach(() => {
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.toLowerCase().startsWith('test_colmeta_'))
      .forEach(f => fs.unlinkSync(path.join(dataDir, f)));
  }
});

async function run(session: Session, sent: ServerMessage[], text: string): Promise<string[]> {
  sent.length = 0;
  await session.handleMessage({ type: 'command', text });
  const out = sent.find(m => m.type === 'output') as any;
  return (out?.lines ?? []).map((l: any) => l.text);
}

function parse(src: string) {
  return new Parser(new Lexer(src).tokenize()).parse();
}

describe('Parser: NUM(p,s) precision/scale', () => {
  it('captures both precision and scale, without inventing a phantom column', () => {
    const ast = parse('CREATE TABLE t (price NUM(8,2))')[0] as any;
    expect(ast.cols).toEqual([{ name: 'PRICE', colType: 'NUM', size: 8, scale: 2 }]);
  });

  it('keeps parsing the columns that follow a NUM(p,s)', () => {
    const ast = parse('CREATE TABLE t (price NUM(8,2), active LOGICAL)')[0] as any;
    expect(ast.cols.map((c: any) => c.name)).toEqual(['PRICE', 'ACTIVE']);
    expect(ast.cols[1]).toEqual({ name: 'ACTIVE', colType: 'LOGICAL' });
  });

  it('still parses a single-arg size', () => {
    const ast = parse('CREATE TABLE t (name CHAR(40), qty NUM(6))')[0] as any;
    expect(ast.cols).toEqual([
      { name: 'NAME', colType: 'CHAR', size: 40 },
      { name: 'QTY', colType: 'NUM', size: 6 },
    ]);
  });
});

describe('CREATE TABLE with NUM(p,s) creates only the declared columns', () => {
  it('does not create a phantom column named after the scale', async () => {
    const { session, sent } = makeSession();
    await run(session, sent, `USE DATABASE ${uniqueDb()}`);
    await run(session, sent, 'CREATE TABLE products (name CHAR(10), price NUM(8,2), active LOGICAL)');
    await run(session, sent, 'USE products');
    const lines = await run(session, sent, 'LIST STRUCTURE');
    const struct = lines.join('\n');
    expect(struct).toContain('NAME');
    expect(struct).toContain('PRICE');
    expect(struct).toContain('ACTIVE');
    expect(struct).not.toMatch(/^\d+\s+2\s/m);   // no column literally named "2"
  });
});

describe('LIST STRUCTURE prints declared types', () => {
  it('shows CHAR(n), NUM(p,s), DATE, TIME(n), LOGICAL as declared', async () => {
    const { session, sent } = makeSession();
    await run(session, sent, `USE DATABASE ${uniqueDb()}`);
    await run(session, sent, 'CREATE TABLE t (a CHAR(10), b NUM(8,2), c DATE, d TIME(15), e LOGICAL, f INT)');
    await run(session, sent, 'USE t');
    const struct = (await run(session, sent, 'LIST STRUCTURE')).join('\n');
    expect(struct).toMatch(/A\s+CHAR\(10\)/);
    expect(struct).toMatch(/B\s+NUM\(8,2\)/);
    expect(struct).toMatch(/C\s+DATE/);
    expect(struct).toMatch(/D\s+TIME\(15\)/);
    expect(struct).toMatch(/E\s+LOGICAL/);
    expect(struct).toMatch(/F\s+INT/);
  });
});

describe('grid-open carries declared column types', () => {
  it('sends a columnTypes map alongside the raw SQLite columns', async () => {
    const { session, sent } = makeSession();
    await run(session, sent, `USE DATABASE ${uniqueDb()}`);
    await run(session, sent, 'CREATE TABLE t (name CHAR(10), price NUM(8,2), shift TIME(15))');
    await run(session, sent, 'USE t');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const grid = sent.find(m => m.type === 'grid-open') as any;
    expect(grid).toBeDefined();
    expect(grid.columnTypes.PRICE).toEqual({ baseType: 'NUM', qualifier: 8, scale: 2 });
    expect(grid.columnTypes.SHIFT).toEqual({ baseType: 'TIME', qualifier: 15, scale: null });
    expect(grid.columnTypes.NAME).toEqual({ baseType: 'CHAR', qualifier: 10, scale: null });
  });
});

describe('grid-edit is validated server-side', () => {
  async function browseTable(session: Session, sent: ServerMessage[]) {
    await run(session, sent, `USE DATABASE ${uniqueDb()}`);
    await run(session, sent, 'CREATE TABLE t (shift TIME(15), price NUM(8,2))');
    await run(session, sent, 'USE t');
    await run(session, sent, 'APPEND RECORD');
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const grid = sent.find(m => m.type === 'grid-open') as any;
    return grid.rows[0]._rowid as number;
  }

  it('rejects an invalid TIME(15) cell edit and does not write it', async () => {
    const { session, sent } = makeSession();
    const rowid = await browseTable(session, sent);

    sent.length = 0;
    await session.handleMessage({ type: 'grid-edit', rowid, col: 'SHIFT', value: '08:07' });
    const out = sent.find(m => m.type === 'output') as any;
    expect(out).toBeDefined();
    expect(out.lines.map((l: any) => l.text).join('\n')).toMatch(/multiple of 15/);

    const lines = await run(session, sent, 'LIST');
    expect(lines.join('\n')).not.toContain('08:07');
  });

  it('accepts a valid cell edit and writes it', async () => {
    const { session, sent } = makeSession();
    const rowid = await browseTable(session, sent);

    await session.handleMessage({ type: 'grid-edit', rowid, col: 'SHIFT', value: '08:15' });
    const lines = await run(session, sent, 'LIST');
    expect(lines.join('\n')).toContain('08:15');
  });

  it('rejects an out-of-scale NUM(8,2) cell edit', async () => {
    const { session, sent } = makeSession();
    const rowid = await browseTable(session, sent);

    sent.length = 0;
    await session.handleMessage({ type: 'grid-edit', rowid, col: 'PRICE', value: '1.234' });
    const out = sent.find(m => m.type === 'output') as any;
    expect(out.lines.map((l: any) => l.text).join('\n')).toMatch(/2 decimal/);
  });
});

describe('column metadata is scoped per database', () => {
  it('does not leak a declared type between same-named tables in different databases', async () => {
    const { session, sent } = makeSession();
    const dbA = uniqueDb();
    const dbB = uniqueDb();

    await run(session, sent, `USE DATABASE ${dbA}`);
    await run(session, sent, 'CREATE TABLE shared (val TIME(15))');

    await run(session, sent, `USE DATABASE ${dbB}`);
    await run(session, sent, 'CREATE TABLE shared (val CHAR(20))');
    await run(session, sent, 'USE shared');
    await run(session, sent, 'APPEND RECORD');
    // CHAR is unconstrained — this must be accepted, not judged against TIME(15).
    const lines = await run(session, sent, 'REPLACE val WITH "hello"');
    expect(lines.join('\n')).toContain('Replaced');

    // And dbA's TIME(15) must still be enforced.
    await run(session, sent, `USE DATABASE ${dbA}`);
    await run(session, sent, 'USE shared');
    await run(session, sent, 'APPEND RECORD');
    const bad = await run(session, sent, 'REPLACE val WITH "08:07"');
    expect(bad.join('\n')).toMatch(/\*\* Error/);
  });
});
