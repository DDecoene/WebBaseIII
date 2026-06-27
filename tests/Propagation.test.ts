import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../server/SessionManager';
import fs from 'fs';
import path from 'path';

function fakeWs() {
  const sent: any[] = [];
  return {
    OPEN: 1,
    readyState: 1,
    send: (s: string) => sent.push(JSON.parse(s)),
    sent,
  } as any;
}

const DB = 'test_prop_db';

afterEach(() => {
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.toLowerCase().startsWith('test_prop_db'))
      .forEach(f => fs.unlinkSync(path.join(dataDir, f)));
  }
});

describe('SessionManager live propagation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('notifies a peer viewing the same table, skips the originator, coalesces a burst', async () => {
    const mgr = new SessionManager();
    const wsA = fakeWs();
    const wsB = fakeWs();
    const a = mgr.add(wsA);
    const b = mgr.add(wsB);

    for (const s of [a, b]) {
      await s.handleMessage({ type: 'command', text: `USE DATABASE ${DB}` });
    }
    await a.handleMessage({ type: 'command', text: 'CREATE TABLE t (id INTEGER, name TEXT)' });
    for (const s of [a, b]) {
      await s.handleMessage({ type: 'command', text: 'USE t' });
    }

    wsA.sent.length = 0;
    wsB.sent.length = 0;

    await a.handleMessage({ type: 'command', text: 'APPEND BLANK' });
    await a.handleMessage({ type: 'command', text: 'APPEND BLANK' });

    vi.advanceTimersByTime(60);

    const aChanges = wsA.sent.filter(m => m.type === 'data-changed');
    const bChanges = wsB.sent.filter(m => m.type === 'data-changed');
    expect(aChanges.length).toBe(0);
    expect(bChanges.length).toBe(1);
    // The W3Script lexer upper-cases all identifiers, so the db + table that
    // round-trip through the interpreter come back upper-cased.
    expect(bChanges[0]).toMatchObject({ db: DB.toUpperCase(), table: 'T' });
  });

  it('does NOT notify a peer viewing a different table', async () => {
    const mgr = new SessionManager();
    const wsA = fakeWs();
    const wsB = fakeWs();
    const a = mgr.add(wsA);
    const b = mgr.add(wsB);
    for (const s of [a, b]) {
      await s.handleMessage({ type: 'command', text: `USE DATABASE ${DB}` });
    }
    await a.handleMessage({ type: 'command', text: 'CREATE TABLE t1 (id INTEGER)' });
    await a.handleMessage({ type: 'command', text: 'CREATE TABLE t2 (id INTEGER)' });
    await a.handleMessage({ type: 'command', text: 'USE t1' });
    await b.handleMessage({ type: 'command', text: 'USE t2' });

    // CREATE TABLE is itself a mutation that sets the active table, so the setup
    // above leaves debounced broadcasts pending (e.g. A's CREATE of t2). Flush
    // and discard them so the assertion window only sees A's write to t1.
    vi.advanceTimersByTime(60);
    wsB.sent.length = 0;
    await a.handleMessage({ type: 'command', text: 'APPEND BLANK' });
    vi.advanceTimersByTime(60);

    expect(wsB.sent.filter(m => m.type === 'data-changed').length).toBe(0);
  });
});
