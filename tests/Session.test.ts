import { describe, it, expect, vi, afterEach } from 'vitest';
import { Session } from '../server/Session';
import type { ServerMessage } from '../src/shared/types.js';
import fs from 'fs';
import path from 'path';

function makeSession() {
  const sent: ServerMessage[] = [];
  const send = vi.fn((msg: ServerMessage) => { sent.push(msg); });
  const session = new Session(send);
  return { session, sent, send };
}

afterEach(() => {
  // Clean up any test databases
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.startsWith('test_') && f.endsWith('.sqlite3'))
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
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE test_browse (name TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE test_browse' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const gridMsg = sent.find(m => m.type === 'grid-open');
    expect(gridMsg).toBeDefined();
  });

  it('sends view-terminal on grid-exit', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'grid-exit' });
    const vtMsg = sent.find(m => m.type === 'view-terminal');
    expect(vtMsg).toBeDefined();
  });

  it('REPLACE ALL with multiple comma-separated fields updates all fields', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE test_replace (name TEXT, value INTEGER, city TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE test_replace' });
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
