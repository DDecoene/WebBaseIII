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

  it('a variable GET prefills from the variable\'s current value, not blank', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    await run('STORE "2026-07-06" TO M_WEEK');
    await runBlock(session, sent, '@ 4, 5 SAY "Week: " GET M_WEEK\nREAD');
    const form = sent.find(m => m.type === 'form-open') as any;
    expect(form.fields[0].target.kind).toBe('var');
    expect(form.fields[0].value).toBe('2026-07-06');
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

describe('form-submit with field targets', () => {
  it('writes submitted field values to the record and resumes', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    await runBlock(session, sent, '@ 4, 5 SAY "Name: " GET NAME\n@ 5, 5 SAY "Sched: " GET SCHEDID\nREAD');
    expect(sent.find(m => m.type === 'form-open')).toBeDefined();

    sent.length = 0;
    await session.handleMessage({ type: 'form-submit', values: { NAME: 'Grace', SCHEDID: 'S002' } });
    expect(sent.find(m => m.type === 'view-terminal')).toBeDefined();
    const listing = await run('LIST');
    expect(listing).toContain('Grace');
    expect(listing).toContain('S002');
  });

  it('rejects the whole submit when one field is off-list: form-error, nothing written', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    await runBlock(session, sent, '@ 4, 5 SAY "Name: " GET NAME\n@ 5, 5 SAY "Sched: " GET SCHEDID\nREAD');

    sent.length = 0;
    await session.handleMessage({ type: 'form-submit', values: { NAME: 'Grace', SCHEDID: 'BOGUS' } });
    const err = sent.find(m => m.type === 'form-error') as any;
    expect(err).toBeDefined();
    expect(err.errors).toEqual([
      { varName: 'SCHEDID', message: 'SCHEDID: "BOGUS" is not one of the allowed values' },
    ]);
    expect(sent.find(m => m.type === 'view-terminal')).toBeUndefined();
    // All-or-nothing: NAME was valid but must NOT have been written.
    expect(await run('LIST')).not.toContain('Grace');
  });

  it('a corrected resubmit after form-error succeeds (state was retained)', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    await runBlock(session, sent, '@ 4, 5 SAY "Sched: " GET SCHEDID\nREAD');

    await session.handleMessage({ type: 'form-submit', values: { SCHEDID: 'BOGUS' } });
    sent.length = 0;
    await session.handleMessage({ type: 'form-submit', values: { SCHEDID: 'S001' } });
    expect(sent.find(m => m.type === 'form-error')).toBeUndefined();
    expect(await run('LIST')).toContain('S001');
  });

  it('a forged form-submit naming a column the form never offered cannot write it', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    // The form only offers the variable M_X — EMPID is NOT a field of this form.
    await runBlock(session, sent, '@ 4, 5 SAY "X: " GET M_X\nREAD');

    await session.handleMessage({ type: 'form-submit', values: { M_X: 'ok', EMPID: 'HAX' } });
    // EMPID lands in a memory variable at worst — never in the table.
    expect(await run('LIST')).not.toContain('HAX');
  });

  it('field type validation applies too (DATE column gets a real date)', async () => {
    const { session, sent, run } = await setup();
    await run('ALTER TABLE EMPLOYEES ADD HIRED DATE');
    await run('APPEND RECORD');
    await runBlock(session, sent, '@ 4, 5 SAY "Hired: " GET HIRED\nREAD');

    sent.length = 0;
    await session.handleMessage({ type: 'form-submit', values: { HIRED: '2026-02-30' } });
    const err = sent.find(m => m.type === 'form-error') as any;
    expect(err.errors[0].message).toMatch(/not a real date/);
  });

  it('Escape (grid-exit) writes nothing and clears the retained fields', async () => {
    const { session, sent, run } = await setup();
    await run('APPEND RECORD');
    await runBlock(session, sent, '@ 4, 5 SAY "Name: " GET NAME\nREAD');

    await session.handleMessage({ type: 'grid-exit' });
    expect(await run('LIST')).not.toContain('Grace');
    // A form-submit arriving after the cancel must not write the field either.
    await session.handleMessage({ type: 'form-submit', values: { NAME: 'Grace' } });
    expect(await run('LIST')).not.toContain('Grace');
  });

  it('bare INPUT still stores its value (the #50 regression stays fixed)', async () => {
    const sent: ServerMessage[] = [];
    const session = new Session((m) => sent.push(m));
    await session.handleMessage({ type: 'command', text: 'INPUT "Name? " TO who' });
    await session.handleMessage({ type: 'form-submit', values: { WHO: 'Ada' } });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: '? who' });
    const out = sent.find(m => m.type === 'output') as any;
    expect(out.lines.map((l: any) => l.text).join('\n')).toContain('Ada');
  });
});
