import { describe, it, expect, afterEach } from 'vitest';
import { Session } from '../server/Session';
import { Lexer } from '../src/interpreter/Lexer';
import { Parser } from '../src/interpreter/Parser';
import type { ServerMessage } from '../src/shared/types';
import fs from 'fs';
import path from 'path';

/**
 * Golden schemas for the tables the demo programs create. (#50)
 *
 * These are deliberate pins, not derived from the source — a demo schema change
 * must be a conscious edit here too. They exist because `NUM(8,2)` used to add a
 * phantom column named "2" to PRODUCTS/DEALS/SALES and every `toContain`-style
 * assertion in the suite sailed straight past it.
 */
const DEMO_SCHEMAS: Record<string, string[]> = {
  COMPANIES:  ['COMPID', 'NAME', 'INDUSTRY', 'CITY'],
  CONTACTS:   ['CONTID', 'COMPID', 'NAME', 'EMAIL', 'PHONE'],
  DEALS:      ['DEALID', 'COMPID', 'TITLE', 'STAGE', 'VALUE', 'CLOSEMONTH'],
  CATEGORIES: ['CATID', 'CATNAME', 'NOTES'],
  PRODUCTS:   ['PRODID', 'CATID', 'NAME', 'STOCK', 'REORDER', 'PRICE', 'ACTIVE'],
  MOVEMENTS:  ['MOVID', 'PRODID', 'KIND', 'QTY', 'MMONTH', 'REASON'],
  SALES:      ['REGION', 'PRODUCT', 'AMOUNT', 'QTY'],

  // overtime.prg (#46)
  EMPLOYEES:    ['EMPID', 'NAME', 'SCHEDID'],
  SCHEDULES:    ['SCHEDID', 'DESCR'],
  SCHEDULEDAYS: ['SCHEDID', 'DOW', 'TIMEIN', 'BSTART', 'BEND', 'TIMEOUT'],
  TIMESHEET:    ['EMPID', 'WEEKDATE', 'DOW', 'WORKDATE', 'TIMEIN', 'BSTART', 'BEND', 'TIMEOUT', 'WORKEDHOURS'],
  WEEKSUMMARY:  ['EMPID', 'WEEKDATE', 'WEEKNO', 'WORKEDHOURS', 'STANDARDHOURS', 'OVERTIME'],
  LEAVETAKEN:   ['EMPID', 'LDATE', 'HOURS', 'NOTES'],
};

const DEMOS_DIR = path.join(process.cwd(), 'demos');

/** Every `CREATE TABLE …` statement written in demos/*.prg, keyed by table name. */
function demoCreateStatements(): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of fs.readdirSync(DEMOS_DIR).filter(f => f.toLowerCase().endsWith('.prg'))) {
    const src = fs.readFileSync(path.join(DEMOS_DIR, f), 'utf8');
    for (const line of src.split('\n')) {
      const m = line.trim().match(/^CREATE\s+TABLE\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/i);
      if (m) out.set(m[1].toUpperCase(), line.trim());
    }
  }
  return out;
}

let dbCounter = 0;
function uniqueDb() { return `test_demoschema_${Date.now()}_${++dbCounter}`; }

afterEach(() => {
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.toLowerCase().startsWith('test_demoschema_'))
      .forEach(f => fs.unlinkSync(path.join(dataDir, f)));
  }
});

describe('demo table schemas', () => {
  const statements = demoCreateStatements();

  it('every pinned table is actually created by a demo program', () => {
    expect([...statements.keys()].sort()).toEqual(Object.keys(DEMO_SCHEMAS).sort());
  });

  for (const [table, expectedCols] of Object.entries(DEMO_SCHEMAS)) {
    it(`${table} parses to exactly its declared columns`, () => {
      const stmt = statements.get(table);
      expect(stmt, `no CREATE TABLE ${table} found in demos/*.prg`).toBeDefined();
      const ast = new Parser(new Lexer(stmt!).tokenize()).parse()[0] as any;
      expect(ast.cols.map((c: any) => c.name)).toEqual(expectedCols);
    });

    it(`${table} creates exactly its declared columns in SQLite`, async () => {
      const sent: ServerMessage[] = [];
      const session = new Session((m) => sent.push(m));
      await session.handleMessage({ type: 'command', text: `USE DATABASE ${uniqueDb()}` });
      await session.handleMessage({ type: 'command', text: statements.get(table)! });
      await session.handleMessage({ type: 'command', text: `USE ${table}` });

      sent.length = 0;
      await session.handleMessage({ type: 'command', text: 'BROWSE' });
      const grid = sent.find(m => m.type === 'grid-open') as any;
      expect(grid.columns.map((c: any) => c.name)).toEqual(expectedCols);
    });
  }

  it('no demo table has a column whose name is a bare number', () => {
    // The phantom-column signature: NUM(8,2) leaked a column literally named "2".
    for (const [table, stmt] of statements) {
      const ast = new Parser(new Lexer(stmt).tokenize()).parse()[0] as any;
      for (const c of ast.cols) {
        expect(/^\d+$/.test(c.name), `${table} has a numeric column name "${c.name}"`).toBe(false);
      }
    }
  });
});
