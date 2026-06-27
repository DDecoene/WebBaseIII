import { describe, it, expect, afterEach } from 'vitest';
import { Lexer } from '../src/interpreter/Lexer';
import { Parser } from '../src/interpreter/Parser';
import { Session } from '../server/Session';
import type { ServerMessage } from '../src/shared/types.js';
import fs from 'fs';
import path from 'path';

function parse(src: string) {
  return new Parser(new Lexer(src).tokenize()).parse();
}

let dbN = 0;
afterEach(() => {
  const dir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dir)) {
    fs.readdirSync(dir)
      .filter(f => f.toLowerCase().startsWith('test_csv_db'))
      .forEach(f => fs.unlinkSync(path.join(dir, f)));
  }
});

async function session() {
  const sent: ServerMessage[] = [];
  const s = new Session((m) => sent.push(m));
  const run = (text: string) => s.handleMessage({ type: 'command', text });
  return { s, sent, run, db: `test_csv_db_${++dbN}` };
}

function outText(sent: ServerMessage[]): string {
  return (sent.filter(m => m.type === 'output') as Extract<ServerMessage, { type: 'output' }>[])
    .flatMap(m => m.lines.map(l => l.text))
    .join('\n');
}

describe('COPY TO / APPEND FROM parsing', () => {
  it('parses COPY TO with a dotted filename', () => {
    expect(parse('COPY TO customers.csv')).toEqual([{ type: 'COPY_TO', file: 'customers.csv' }]);
  });
  it('parses APPEND FROM with a dotted filename', () => {
    expect(parse('APPEND FROM customers.csv')).toEqual([{ type: 'APPEND_FROM', file: 'customers.csv' }]);
  });
  it('still parses bare APPEND as a blank-record append', () => {
    expect(parse('APPEND')).toEqual([{ type: 'APPEND' }]);
    expect(parse('APPEND BLANK')).toEqual([{ type: 'APPEND' }]);
  });
});

describe('COPY TO export', () => {
  it('emits a csv-download with header + filtered rows', async () => {
    const { sent, run, db } = await session();
    await run(`USE DATABASE ${db}`);
    await run('CREATE TABLE orders (amount INTEGER, country TEXT)');
    await run('USE orders');
    await run('APPEND RECORD'); await run('REPLACE amount WITH 100, country WITH "BE"');
    await run('APPEND RECORD'); await run('REPLACE amount WITH 250, country WITH "NL"');
    await run('SET FILTER TO country == "BE"');
    await run('COPY TO orders.csv');
    const dl = sent.find(m => m.type === 'csv-download') as Extract<ServerMessage, { type: 'csv-download' }>;
    expect(dl).toBeDefined();
    expect(dl.filename).toBe('orders.csv');
    expect(dl.content).toContain('AMOUNT,COUNTRY'); // column names are stored upper-case
    expect(dl.content).toContain('100,BE');
    expect(dl.content).not.toContain('250');
  });
});
