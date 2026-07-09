import { describe, it, expect, afterEach } from 'vitest';
import { Session } from '../server/Session';
import type { ServerMessage } from '../src/shared/types';
import fs from 'fs';
import path from 'path';

/**
 * The grid's write path had no test at all before #50: `grid-edit`, `grid-delete`,
 * `grid-new-row` and `grid-refresh` were never sent by any test, so `grid-edit`
 * could `UPDATE` any column with any value unnoticed. These drive each message and
 * assert the effect on the database.
 */
let dbCounter = 0;
function uniqueDb() { return `test_gridmsg_${Date.now()}_${++dbCounter}`; }

afterEach(() => {
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.toLowerCase().startsWith('test_gridmsg_'))
      .forEach(f => fs.unlinkSync(path.join(dataDir, f)));
  }
});

async function setup() {
  const sent: ServerMessage[] = [];
  const session = new Session((m) => sent.push(m));
  const run = async (text: string) => {
    sent.length = 0;
    await session.handleMessage({ type: 'command', text });
    const out = sent.find(m => m.type === 'output') as any;
    return (out?.lines ?? []).map((l: any) => l.text).join('\n');
  };
  await run(`USE DATABASE ${uniqueDb()}`);
  await run('CREATE TABLE t (name CHAR(20), qty INT)');
  await run('USE t');
  return { session, sent, run };
}

/** Open the grid and return its rows. */
async function browse(session: Session, sent: ServerMessage[]) {
  sent.length = 0;
  await session.handleMessage({ type: 'command', text: 'BROWSE' });
  const grid = sent.find(m => m.type === 'grid-open') as any;
  return grid;
}

describe('grid WebSocket messages', () => {
  it('grid-new-row inserts a blank record and returns the refreshed grid', async () => {
    const { session, sent, run } = await setup();
    await browse(session, sent);

    sent.length = 0;
    await session.handleMessage({ type: 'grid-new-row' });
    const grid = sent.find(m => m.type === 'grid-open') as any;
    expect(grid.rows).toHaveLength(1);
    expect(grid.rows[0].NAME).toBeNull();

    expect(await run('LIST')).not.toContain('(No records)');
  });

  it('grid-edit writes the value to the right row and column', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    await run('APPEND RECORD');
    const grid = await browse(session, sent);
    const secondRowId = grid.rows[1]._rowid;

    await session.handleMessage({ type: 'grid-edit', rowid: secondRowId, col: 'NAME', value: 'second' });

    const after = await browse(session, sent);
    expect(after.rows[0].NAME).toBeNull();          // first row untouched
    expect(after.rows[1].NAME).toBe('second');
  });

  it('grid-delete removes only the targeted row', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    await run('REPLACE name WITH "keep"');
    await run('APPEND RECORD');
    await run('REPLACE name WITH "drop"');

    const grid = await browse(session, sent);
    const dropId = grid.rows.find((r: any) => r.NAME === 'drop')._rowid;

    sent.length = 0;
    await session.handleMessage({ type: 'grid-delete', rowid: dropId });
    const refreshed = sent.find(m => m.type === 'grid-open') as any;
    expect(refreshed.rows).toHaveLength(1);
    expect(refreshed.rows[0].NAME).toBe('keep');

    expect(await run('LIST')).not.toContain('drop');
  });

  it('grid-refresh re-reads the table after an out-of-band change', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    await browse(session, sent);

    // Mutate through the REPL while the grid is open.
    await run('REPLACE name WITH "changed"');

    sent.length = 0;
    await session.handleMessage({ type: 'grid-refresh' });
    const grid = sent.find(m => m.type === 'grid-open') as any;
    expect(grid.rows[0].NAME).toBe('changed');
  });

  it('grid-edit is rejected when it violates the declared column type', async () => {
    const sent: ServerMessage[] = [];
    const session = new Session((m) => sent.push(m));
    const run = async (text: string) => {
      sent.length = 0;
      await session.handleMessage({ type: 'command', text });
      const out = sent.find(m => m.type === 'output') as any;
      return (out?.lines ?? []).map((l: any) => l.text).join('\n');
    };
    await run(`USE DATABASE ${uniqueDb()}`);
    await run('CREATE TABLE s (shift TIME(15))');
    await run('USE s');
    await run('APPEND RECORD');
    const grid = await browse(session, sent);

    sent.length = 0;
    await session.handleMessage({ type: 'grid-edit', rowid: grid.rows[0]._rowid, col: 'SHIFT', value: '08:07' });
    const out = sent.find(m => m.type === 'output') as any;
    expect(out.lines.map((l: any) => l.text).join('\n')).toMatch(/multiple of 15/);
    expect(await run('LIST')).not.toContain('08:07');
  });
});

describe('INPUT command', () => {
  // `INPUT` collects its value through the form surface (form-open / form-submit).
  // The `input-request`/`input-response` message types were declared in the protocol
  // but never sent or handled by anything; they were removed in #50.
  it('opens a form and stores the submitted value in the variable', async () => {
    const sent: ServerMessage[] = [];
    const session = new Session((m) => sent.push(m));

    await session.handleMessage({ type: 'command', text: 'INPUT "Name? " TO who' });
    const form = sent.find(m => m.type === 'form-open') as any;
    expect(form).toBeDefined();
    expect(form.fields.at(-1)).toMatchObject({ varName: 'WHO', label: 'Name? ' });

    await session.handleMessage({ type: 'form-submit', values: { WHO: 'Ada' } });

    sent.length = 0;
    await session.handleMessage({ type: 'command', text: '? who' });
    const out = sent.find(m => m.type === 'output') as any;
    expect(out.lines.map((l: any) => l.text).join('\n')).toContain('Ada');
  });
});
