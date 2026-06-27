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

describe('APPEND FROM import', () => {
  async function seeded() {
    const ctx = await session();
    await ctx.run(`USE DATABASE ${ctx.db}`);
    await ctx.run('CREATE TABLE people (name TEXT, age INTEGER)');
    await ctx.run('USE people');
    return ctx;
  }

  it('imports good rows by header name and reports skips with line + reason', async () => {
    const { s, sent } = await seeded();
    const csv = 'name,age\r\nAda,36\r\nBo,nine\r\nCy,12,extra\r\nDee,40';
    sent.length = 0;
    await s.handleMessage({ type: 'csv-upload', filename: 'people.csv', content: csv });
    const text = outText(sent);
    expect(text).toContain('Appended 2 record(s)');
    expect(text).toContain('Skipped 2');
    expect(text).toContain('line 3: column "AGE" — "nine" is not numeric');
    expect(text).toContain('line 4: expected 2 fields, got 3');
  });

  it('inserts the good rows (round-trip via SUM)', async () => {
    const { s, sent, run } = await seeded();
    await s.handleMessage({ type: 'csv-upload', filename: 'people.csv', content: 'name,age\r\nAda,36\r\nDee,40' });
    sent.length = 0;
    await run('SUM age');
    expect(outText(sent)).toContain('76');
  });

  it('aborts and rolls back when more than 10 rows are malformed', async () => {
    const { s, sent, run } = await seeded();
    const bad = ['name,age'];
    for (let i = 0; i < 12; i++) bad.push(`P${i},notnum`);
    sent.length = 0;
    await s.handleMessage({ type: 'csv-upload', filename: 'bad.csv', content: bad.join('\r\n') });
    const text = outText(sent);
    expect(text).toContain('Import aborted');
    expect(text).toContain('No records were appended');
    // verify nothing was inserted
    sent.length = 0;
    await run('SUM age');
    expect(outText(sent)).toContain('0');
  });

  it('rejects a file over the 5 MB size cap', async () => {
    const { s, sent } = await seeded();
    const huge = 'name,age\r\n' + 'A'.repeat(5 * 1024 * 1024 + 10) + ',1';
    sent.length = 0;
    await s.handleMessage({ type: 'csv-upload', filename: 'huge.csv', content: huge });
    expect(outText(sent)).toMatch(/limit is 5 MB|too large/i);
  });
});
