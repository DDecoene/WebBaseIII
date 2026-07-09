import { describe, it, expect, afterEach } from 'vitest';
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
function uniqueDb() { return `test_time_${Date.now()}_${++dbCounter}`; }

afterEach(() => {
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.toLowerCase().startsWith('test_time_'))
      .forEach(f => fs.unlinkSync(path.join(dataDir, f)));
  }
});

async function run(session: Session, sent: ServerMessage[], text: string): Promise<string[]> {
  sent.length = 0;
  await session.handleMessage({ type: 'command', text });
  const out = sent.find(m => m.type === 'output') as any;
  return (out?.lines ?? []).map((l: any) => l.text);
}

describe('TIME column type', () => {
  it('creates a table with plain TIME and TIME(15) columns, LIST STRUCTURE shows them', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await run(session, sent, `USE DATABASE ${db}`);
    await run(session, sent, 'CREATE TABLE shifts (person CHAR(20), starttime TIME, breaktime TIME(15))');
    await run(session, sent, 'USE shifts');
    const lines = await run(session, sent, 'LIST STRUCTURE');
    const struct = lines.join('\n');
    expect(struct).toContain('STARTTIME');
    expect(struct).toMatch(/STARTTIME\s+TIME\b/);
    expect(struct).toMatch(/BREAKTIME\s+TIME\(15\)/);
  });

  it('rejects a malformed TIME value on REPLACE', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await run(session, sent, `USE DATABASE ${db}`);
    await run(session, sent, 'CREATE TABLE shifts (starttime TIME)');
    await run(session, sent, 'USE shifts');
    await run(session, sent, 'APPEND RECORD');
    const lines = await run(session, sent, 'REPLACE starttime WITH "9:30"');
    expect(lines.join('\n')).toMatch(/\*\* Error/);
  });

  it('rejects an out-of-range TIME value on REPLACE', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await run(session, sent, `USE DATABASE ${db}`);
    await run(session, sent, 'CREATE TABLE shifts (starttime TIME)');
    await run(session, sent, 'USE shifts');
    await run(session, sent, 'APPEND RECORD');
    const lines = await run(session, sent, 'REPLACE starttime WITH "25:00"');
    expect(lines.join('\n')).toMatch(/\*\* Error/);
  });

  it('accepts a well-formed TIME value on REPLACE', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await run(session, sent, `USE DATABASE ${db}`);
    await run(session, sent, 'CREATE TABLE shifts (starttime TIME)');
    await run(session, sent, 'USE shifts');
    await run(session, sent, 'APPEND RECORD');
    const lines = await run(session, sent, 'REPLACE starttime WITH "09:30"');
    expect(lines.join('\n')).toContain('Replaced');
    const listLines = await run(session, sent, 'LIST');
    expect(listLines.join('\n')).toContain('09:30');
  });

  it('rejects a TIME(15) value that violates the granularity qualifier', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await run(session, sent, `USE DATABASE ${db}`);
    await run(session, sent, 'CREATE TABLE shifts (breaktime TIME(15))');
    await run(session, sent, 'USE shifts');
    await run(session, sent, 'APPEND RECORD');
    const lines = await run(session, sent, 'REPLACE breaktime WITH "08:07"');
    expect(lines.join('\n')).toMatch(/\*\* Error/);
  });

  it('accepts a TIME(15) value on a quarter-hour boundary', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await run(session, sent, `USE DATABASE ${db}`);
    await run(session, sent, 'CREATE TABLE shifts (breaktime TIME(15))');
    await run(session, sent, 'USE shifts');
    await run(session, sent, 'APPEND RECORD');
    const lines = await run(session, sent, 'REPLACE breaktime WITH "08:15"');
    expect(lines.join('\n')).toContain('Replaced');
  });

  it('allows APPEND RECORD to leave TIME columns NULL without validation error', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await run(session, sent, `USE DATABASE ${db}`);
    await run(session, sent, 'CREATE TABLE shifts (starttime TIME(15))');
    await run(session, sent, 'USE shifts');
    const lines = await run(session, sent, 'APPEND RECORD');
    expect(lines.join('\n')).toContain('Record appended');
  });
});
