import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { Lexer } from '../src/interpreter/Lexer';
import { Parser } from '../src/interpreter/Parser';

function parse(src: string) {
  return new Parser(new Lexer(src).tokenize()).parse();
}

describe('JOIN parsing', () => {
  it('parses JOIN WITH alias TO file FOR cond', () => {
    const nodes = parse('JOIN WITH ord TO custord FOR cust.id = ord.custid');
    expect(nodes[0]).toEqual({
      type: 'JOIN',
      withAlias: 'ORD',
      target: 'CUSTORD',
      forCond: 'CUST.ID = ORD.CUSTID',
      fields: null,
    });
  });

  it('parses an explicit FIELDS list with alias.field tokens', () => {
    const nodes = parse('JOIN WITH ord TO custord FOR cust.id = ord.custid FIELDS name, ord.amount');
    expect(nodes[0]).toEqual({
      type: 'JOIN',
      withAlias: 'ORD',
      target: 'CUSTORD',
      forCond: 'CUST.ID = ORD.CUSTID',
      fields: ['NAME', 'ORD.AMOUNT'],
    });
  });

  it('re-quotes string literals in the FOR condition', () => {
    const nodes = parse("JOIN WITH ord TO t FOR cust.city = 'Paris'");
    expect((nodes[0] as any).forCond).toBe("CUST.CITY = 'Paris'");
  });

  it('yields an empty fields list when FIELDS has no names', () => {
    const nodes = parse('JOIN WITH ord TO custord FOR cust.id = ord.custid FIELDS');
    expect((nodes[0] as any).fields).toEqual([]);
  });

  it('throws when FOR is missing', () => {
    expect(() => parse('JOIN WITH ord TO custord')).toThrow(/JOIN requires a FOR/i);
  });
});

import { Session } from '../server/Session';
import type { ServerMessage } from '../src/shared/types.js';

let dbCounter = 0;
function makeSession() {
  const sent: ServerMessage[] = [];
  const send = vi.fn((msg: ServerMessage) => { sent.push(msg); });
  return { session: new Session(send), sent };
}
function listText(sent: any[]) {
  return sent.filter(m => m.type === 'output')
    .flatMap((m: any) => m.lines.map((l: any) => l.text)).join(' | ');
}

afterEach(() => {
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.toLowerCase().startsWith('test_join_'))
      .forEach(f => fs.unlinkSync(path.join(dataDir, f)));
  }
});

async function seedTwoAreas() {
  const { session, sent } = makeSession();
  const db = `test_join_${++dbCounter}`;
  const run = (text: string) => session.handleMessage({ type: 'command', text });
  // Create tables in the named database
  await run(`USE DATABASE ${db}`);
  await run('CREATE TABLE customers (id NUMERIC, name TEXT, city TEXT)');
  await run('CREATE TABLE orders (custid NUMERIC, amount NUMERIC)');
  // Open orders in area ORD (must set db again after SELECT)
  await run('SELECT ORD');
  await run(`USE DATABASE ${db}`);
  await run('USE orders');
  await run('APPEND RECORD'); await run('REPLACE custid WITH 1, amount WITH 100');
  await run('APPEND RECORD'); await run('REPLACE custid WITH 1, amount WITH 50');
  await run('APPEND RECORD'); await run('REPLACE custid WITH 2, amount WITH 75');
  // Open customers in area CUST (active)
  await run('SELECT CUST');
  await run(`USE DATABASE ${db}`);
  await run('USE customers');
  await run('APPEND RECORD'); await run('REPLACE id WITH 1, name WITH "Alice", city WITH "Paris"');
  await run('APPEND RECORD'); await run('REPLACE id WITH 2, name WITH "Bob", city WITH "Rome"');
  return { session, sent, run };
}

describe('JOIN integration', () => {
  it('materializes a snapshot table with explicit FIELDS', async () => {
    const { sent, run } = await seedTwoAreas();
    await run('JOIN WITH ORD TO custord FOR CUST.id = ORD.custid FIELDS CUST.name, ORD.amount');
    expect(listText(sent)).toMatch(/Joined 3 record\(s\) into CUSTORD/i);

    sent.length = 0;
    await run('USE custord');
    await run('LIST');
    const out = listText(sent);
    expect(out).toMatch(/Alice/);
    expect(out).toMatch(/100/);
    expect(out).toMatch(/Bob/);
    expect(out).toMatch(/75/);
  });

  it('applies the FOR condition (only matching pairs)', async () => {
    const { sent, run } = await seedTwoAreas();
    await run('JOIN WITH ORD TO custord FOR CUST.id = ORD.custid FIELDS CUST.name, ORD.amount');
    // Alice (id 1) matches 2 orders, Bob (id 2) matches 1 → 3 rows, never 6 (cross product).
    expect(listText(sent)).toMatch(/Joined 3 record/i);
  });

  it('default projection takes active columns then non-clashing alias columns', async () => {
    const { sent, run } = await seedTwoAreas();
    await run('JOIN WITH ORD TO custord FOR CUST.id = ORD.custid');
    sent.length = 0;
    await run('USE custord');
    await run('LIST STRUCTURE');
    const out = listText(sent).toUpperCase();
    // Active (customers) columns present: ID, NAME, CITY. Alias-only column: AMOUNT.
    expect(out).toMatch(/NAME/);
    expect(out).toMatch(/CITY/);
    expect(out).toMatch(/AMOUNT/);
  });

  it('errors when the active area has no table', async () => {
    const { session, sent } = makeSession();
    const run = (text: string) => session.handleMessage({ type: 'command', text });
    const db = `test_join_${++dbCounter}`;
    await run(`USE DATABASE ${db}`);
    await run('SELECT ORD'); await run(`USE DATABASE ${db}`);   // empty area, referenced below
    await run('SELECT CUST'); await run(`USE DATABASE ${db}`);  // active, no table
    await run('JOIN WITH ORD TO t FOR 1 = 1');
    expect(listText(sent)).toMatch(/no table in use/i);
  });

  it('errors when the alias area has no open table', async () => {
    const { sent, run } = await seedTwoAreas();
    await run('JOIN WITH NOPE TO t FOR CUST.id = 1');
    expect(listText(sent)).toMatch(/work area 'NOPE' has no open table/i);
  });

  it('errors when the target table already exists', async () => {
    const { sent, run } = await seedTwoAreas();
    await run('JOIN WITH ORD TO custord FOR CUST.id = ORD.custid');
    sent.length = 0;
    await run('JOIN WITH ORD TO custord FOR CUST.id = ORD.custid');
    expect(listText(sent)).toMatch(/already exists: CUSTORD/i);
  });

  it('errors on an empty FIELDS clause', async () => {
    const { sent, run } = await seedTwoAreas();
    await run('JOIN WITH ORD TO custord FOR CUST.id = ORD.custid FIELDS');
    expect(listText(sent)).toMatch(/FIELDS .*empty|empty FIELDS|requires at least one field/i);
  });

  it('reports a friendly error when the FOR references an unknown column', async () => {
    const { sent, run } = await seedTwoAreas();
    await run('JOIN WITH ORD TO custord FOR CUST.nope = ORD.custid');
    const out = listText(sent);
    expect(out).toMatch(/JOIN failed/i);
    expect(out).not.toMatch(/Joined/i);
  });

  it('errors when the two areas are in different databases', async () => {
    const { session, sent } = makeSession();
    const run = (text: string) => session.handleMessage({ type: 'command', text });
    const dbA = `test_join_${++dbCounter}`;
    const dbB = `test_join_${++dbCounter}`;
    await run(`USE DATABASE ${dbA}`);
    await run('CREATE TABLE a (id NUMERIC, name TEXT)');
    await run('USE a');
    await run('APPEND RECORD'); await run('REPLACE id WITH 1, name WITH "Alice"');
    await run('SELECT OTHER');
    await run(`USE DATABASE ${dbB}`);
    await run('CREATE TABLE b (id NUMERIC, qty NUMERIC)');
    await run('USE b');
    await run('APPEND RECORD'); await run('REPLACE id WITH 1, qty WITH 5');
    // Back to area 1 (db A, table a) as active:
    await run('SELECT 1');
    await run('JOIN WITH OTHER TO ab FOR id = OTHER.id');
    expect(listText(sent)).toMatch(/different database|cross-database/i);
  });

  it('warns and drops the alias duplicate on a column-name clash', async () => {
    const { session, sent } = makeSession();
    const db = `test_join_${++dbCounter}`;
    const run = (text: string) => session.handleMessage({ type: 'command', text });
    await run(`USE DATABASE ${db}`);
    // Both tables have a column named CODE → clash on default projection.
    await run('CREATE TABLE a (code NUMERIC, label TEXT)');
    await run('CREATE TABLE b (code NUMERIC, qty NUMERIC)');
    await run('SELECT BB'); await run(`USE DATABASE ${db}`); await run('USE b');
    await run('APPEND RECORD'); await run('REPLACE code WITH 1, qty WITH 9');
    await run('SELECT AA'); await run(`USE DATABASE ${db}`); await run('USE a');
    await run('APPEND RECORD'); await run('REPLACE code WITH 1, label WITH "x"');
    await run('JOIN WITH BB TO ab FOR AA.code = BB.code');
    const out = listText(sent);
    expect(out).toMatch(/dropped.*code/i);     // warning mentions the dropped column
    expect(out).toMatch(/Joined 1 record/i);
  });
});

describe('JOIN help', () => {
  it('HELP lists the JOIN command', async () => {
    const sent2: any[] = [];
    const session = new Session((m: any) => sent2.push(m));
    await session.handleMessage({ type: 'command', text: 'HELP' });
    const out = sent2.filter(m => m.type === 'output')
      .flatMap((m: any) => m.lines.map((l: any) => l.text)).join(' | ');
    expect(out).toMatch(/JOIN WITH .* TO .* FOR/i);
  });
});
