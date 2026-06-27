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
});
