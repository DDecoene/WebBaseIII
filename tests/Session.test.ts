import { describe, it, expect, vi, afterEach } from 'vitest';
import { Session } from '../server/Session';
import type { ServerMessage } from '../src/shared/types.js';
import fs from 'fs';
import path from 'path';

let testDbCounter = 0;

function makeSession() {
  const sent: ServerMessage[] = [];
  const send = vi.fn((msg: ServerMessage) => { sent.push(msg); });
  const session = new Session(send);
  return { session, sent, send };
}

function uniqueDb() {
  return `test_session_${++testDbCounter}`;
}

afterEach(() => {
  // Clean up all test_session_* databases created during tests
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.startsWith('test_session_') && f.endsWith('.sqlite3'))
      .forEach(f => fs.unlinkSync(path.join(dataDir, f)));
  }
});

describe('Session', () => {
  it('processes a HELP command and returns output lines', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'command', text: 'HELP' });
    const outputMsg = sent.find(m => m.type === 'output');
    expect(outputMsg).toBeDefined();
    expect((outputMsg as any).lines.length).toBeGreaterThan(5);
  });

  it('returns status after a command', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'command', text: 'HELP' });
    const statusMsg = sent.find(m => m.type === 'status');
    expect(statusMsg).toBeDefined();
  });

  it('sends warn/error output for unknown command', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'command', text: 'FOOBAR XYZ' });
    const outputMsg = sent.find(m => m.type === 'output') as any;
    expect(outputMsg).toBeDefined();
    const hasWarn = outputMsg.lines.some((l: any) => l.cls === 'warn' || l.cls === 'error');
    expect(hasWarn).toBe(true);
  });

  it('sends grid-open when BROWSE issued after table created and selected', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE browse_tbl (name TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE browse_tbl' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const gridMsg = sent.find(m => m.type === 'grid-open');
    expect(gridMsg).toBeDefined();
  });

  it('SET FILTER with string value filters correctly', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE filter_tbl (name TEXT, age INTEGER)' });
    await session.handleMessage({ type: 'command', text: 'USE filter_tbl' });
    // Insert Alice at row 1 (REPLACE without ALL updates current row)
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Alice", age WITH 30' });
    // Insert Bob at row 2
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    await session.handleMessage({ type: 'command', text: 'REPLACE name WITH "Bob", age WITH 25' });
    // Filter for Alice — string quotes must survive into SQL
    await session.handleMessage({ type: 'command', text: 'SET FILTER TO name == "Alice"' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'LIST' });
    const listMsg = sent.find(m => m.type === 'output') as any;
    const lines = listMsg?.lines?.map((l: any) => l.text).join(' ') ?? '';
    expect(lines).toContain('Alice');
    expect(lines).not.toContain('Bob');
    const hasError = (listMsg?.lines ?? []).some((l: any) => l.cls === 'error');
    expect(hasError).toBe(false);
  });

  it('sends view-terminal on grid-exit', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'grid-exit' });
    const vtMsg = sent.find(m => m.type === 'view-terminal');
    expect(vtMsg).toBeDefined();
  });

  it('REPLACE ALL with multiple comma-separated fields updates all fields', async () => {
    const { session, sent } = makeSession();
    const db = uniqueDb();
    await session.handleMessage({ type: 'command', text: `USE DATABASE ${db}` });
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE replace_tbl (name TEXT, value INTEGER, city TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE replace_tbl' });
    await session.handleMessage({ type: 'command', text: 'APPEND RECORD' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'REPLACE ALL name WITH "Acme Corp", value WITH 42, city WITH "Brussels"' });
    const outputMsg = sent.find(m => m.type === 'output') as any;
    expect(outputMsg).toBeDefined();
    // Should NOT produce an "Unknown command" line
    const hasUnknown = outputMsg?.lines?.some((l: any) => l.text?.includes('Unknown command'));
    expect(hasUnknown).toBe(false);
    // Verify data was actually written
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'LIST' });
    const listMsg = sent.find(m => m.type === 'output') as any;
    const listText = listMsg?.lines?.map((l: any) => l.text).join(' ') ?? '';
    expect(listText).toContain('Acme Corp');
    expect(listText).toContain('42');
    expect(listText).toContain('Brussels');
  });
});
