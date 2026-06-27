import { describe, it, expect, afterEach } from 'vitest';
import { Session } from '../server/Session';
import type { ServerMessage } from '../src/shared/types.js';
import fs from 'fs';
import path from 'path';

// Unique DB per test — the openDbs handle pool is shared across sessions, so a
// fixed name would let rows leak between tests. (Same pattern as Session.test.ts.)
let counter = 0;

afterEach(() => {
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.toLowerCase().startsWith('test_agg_db'))
      .forEach(f => fs.unlinkSync(path.join(dataDir, f)));
  }
});

// Run a sequence of commands in one session; return all printed output lines.
async function run(extra: string[]): Promise<string[]> {
  const DB = `test_agg_db_${++counter}`;
  const sent: ServerMessage[] = [];
  const session = new Session((m) => sent.push(m));
  const setup = [
    `USE DATABASE ${DB}`,
    'CREATE TABLE orders (amount INTEGER, country TEXT)',
    'USE orders',
    'APPEND RECORD', 'REPLACE amount WITH 100, country WITH "BE"',
    'APPEND RECORD', 'REPLACE amount WITH 250, country WITH "NL"',
    'APPEND RECORD', 'REPLACE amount WITH 900, country WITH "BE"',
  ];
  for (const c of [...setup, ...extra]) {
    await session.handleMessage({ type: 'command', text: c });
  }
  // Only keep output produced by the trailing `extra` commands: clear nothing —
  // setup commands don't print numeric aggregate lines, so filtering by content is safe.
  const lines: string[] = [];
  for (const m of sent) {
    if (m.type === 'output') {
      for (const l of (m as { lines: { text: string }[] }).lines) lines.push(l.text);
    }
  }
  return lines;
}

describe('SUM / AVERAGE commands', () => {
  it('SUM totals a numeric field across the table', async () => {
    const lines = await run(['SUM amount']);
    expect(lines.some(l => l.trim() === '1250')).toBe(true);
  });

  it('SUM result is right-justified', async () => {
    const lines = await run(['SUM amount']);
    const hit = lines.find(l => l.trim() === '1250');
    expect(hit!.startsWith(' ')).toBe(true);
  });

  it('SUM honours a FOR condition', async () => {
    const lines = await run(['SUM amount FOR country == "BE"']);
    expect(lines.some(l => l.trim() === '1000')).toBe(true);
  });

  it('AVERAGE computes the mean', async () => {
    const lines = await run(['AVERAGE amount FOR country == "BE"']);
    expect(lines.some(l => l.trim() === '500')).toBe(true);
  });

  it('AVERAGE returns a fractional mean across all rows', async () => {
    const lines = await run(['AVERAGE amount']);
    expect(lines.some(l => l.trim().startsWith('416.6'))).toBe(true);
  });

  it('SUM honours the active SET FILTER', async () => {
    const lines = await run(['SET FILTER TO country == "BE"', 'SUM amount']);
    expect(lines.some(l => l.trim() === '1000')).toBe(true);
  });
});
