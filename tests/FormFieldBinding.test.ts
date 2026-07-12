import { describe, it, expect, afterEach } from 'vitest';
import { Session } from '../server/Session';
import type { ServerMessage } from '../src/shared/types';
import fs from 'fs';
import path from 'path';

let dbCounter = 0;
function uniqueDb() { return `test_formbind_${Date.now()}_${++dbCounter}`; }

afterEach(() => {
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.toLowerCase().startsWith('test_formbind_'))
      .forEach(f => fs.unlinkSync(path.join(dataDir, f)));
  }
});

async function setup() {
  const sent: ServerMessage[] = [];
  const session = new Session((m) => sent.push(m));
  const run = async (text: string) => {
    sent.length = 0;
    await session.handleMessage({ type: 'command', text });
    const out = sent.filter(m => m.type === 'output') as any[];
    return out.flatMap(o => o.lines).map((l: any) => l.text).join('\n');
  };
  await run(`USE DATABASE ${uniqueDb()}`);
  await run('CREATE TABLE EMPLOYEES (EMPID CHAR(4), NAME CHAR(30), SCHEDID CHAR(4) LOOKUP ("S001","S002"))');
  await run('USE EMPLOYEES');
  return { session, sent, run };
}

/** Run a multi-line block as one command (the terminal sends blocks whole). */
async function runBlock(session: Session, sent: ServerMessage[], src: string) {
  sent.length = 0;
  await session.handleMessage({ type: 'command', text: src });
}

describe('field-bound @ SAY GET', () => {
  it('binds a GET whose name matches a column: field target, prefill, options', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    await run('REPLACE EMPID WITH "E001", NAME WITH "Ada", SCHEDID WITH "S001"');

    await runBlock(session, sent, '@ 4, 5 SAY "Name: " GET NAME\n@ 5, 5 SAY "Sched: " GET SCHEDID\nREAD');
    const form = sent.find(m => m.type === 'form-open') as any;
    expect(form).toBeDefined();
    const nameField = form.fields.find((f: any) => f.varName === 'NAME');
    expect(nameField.target.kind).toBe('field');
    expect(nameField.target.column).toBe('NAME');
    expect(typeof nameField.target.rowid).toBe('number');
    expect(nameField.value).toBe('Ada');
    const schedField = form.fields.find((f: any) => f.varName === 'SCHEDID');
    expect(schedField.options).toEqual([
      { value: 'S001', label: 'S001' },
      { value: 'S002', label: 'S002' },
    ]);
    expect(schedField.value).toBe('S001');
  });

  it('fields shadow memory variables: an existing var of the same name loses', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    await run('STORE "not-the-field" TO NAME');
    await runBlock(session, sent, '@ 4, 5 SAY "Name: " GET NAME\nREAD');
    const form = sent.find(m => m.type === 'form-open') as any;
    expect(form.fields[0].target.kind).toBe('field');
  });

  it('falls back to a memory variable when no column matches', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    await runBlock(session, sent, '@ 4, 5 SAY "Id: " GET M_EMP\nREAD');
    const form = sent.find(m => m.type === 'form-open') as any;
    expect(form.fields[0].target.kind).toBe('var');
    expect(form.fields[0].value).toBe('');
  });

  it('is a variable GET when no table is in use', async () => {
    const sent: ServerMessage[] = [];
    const session = new Session((m) => sent.push(m));
    await session.handleMessage({ type: 'command', text: '@ 4, 5 SAY "X: " GET WHATEVER\nREAD' });
    const form = sent.find(m => m.type === 'form-open') as any;
    expect(form.fields[0].target.kind).toBe('var');
  });

  it('errors on a field-bound GET with no current record', async () => {
    const { session, sent } = await setup();  // table is empty
    await runBlock(session, sent, '@ 4, 5 SAY "Name: " GET NAME\nREAD');
    const out = sent.filter(m => m.type === 'output') as any[];
    expect(out.flatMap(o => o.lines).map((l: any) => l.text).join('\n'))
      .toMatch(/GET NAME: no current record/);
    expect(sent.find(m => m.type === 'form-open')).toBeUndefined();
  });

  it('degrades a dead lookup on a field GET: no options, warn line, form still opens', async () => {
    const { session, sent, run } = await setup();
    await run('ALTER TABLE EMPLOYEES ADD BADCOL CHAR LOOKUP GHOST.X');
    await run('APPEND RECORD');
    await runBlock(session, sent, '@ 4, 5 SAY "B: " GET BADCOL\nREAD');
    const form = sent.find(m => m.type === 'form-open') as any;
    expect(form.fields[0].options).toBeUndefined();
    const out = sent.filter(m => m.type === 'output') as any[];
    expect(out.flatMap(o => o.lines).map((l: any) => l.text).join('\n')).toMatch(/lookup for BADCOL/i);
  });
});
