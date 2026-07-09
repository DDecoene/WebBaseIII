import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { IndexStore } from '../server/IndexStore';
import fs from 'fs';
import os from 'os';
import path from 'path';

const dirs: string[] = [];
function workspace(): { sysPath: string; dataDir: string } {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb3-idxmig-'));
  dirs.push(dataDir);
  return { sysPath: path.join(dataDir, 'system.sqlite3'), dataDir };
}
function legacySystemDb(sysPath: string, rows: [string, string, string][]) {
  const d = new Database(sysPath);
  d.exec(`
    CREATE TABLE indexes (
      id INTEGER PRIMARY KEY, table_name TEXT NOT NULL, tag TEXT NOT NULL,
      expression TEXT NOT NULL, created_at INTEGER DEFAULT (unixepoch()),
      UNIQUE(table_name, tag)
    );
    CREATE TABLE active_indexes (table_name TEXT PRIMARY KEY, tag TEXT NOT NULL);
  `);
  for (const [t, tag, expr] of rows) {
    d.prepare('INSERT INTO indexes (table_name, tag, expression) VALUES (?,?,?)').run(t, tag, expr);
    d.prepare('INSERT OR REPLACE INTO active_indexes (table_name, tag) VALUES (?,?)').run(t, tag);
  }
  d.close();
}
function userDbWithTable(dataDir: string, dbName: string, table: string) {
  const d = new Database(path.join(dataDir, `${dbName}.sqlite3`));
  d.exec(`CREATE TABLE "${table}" (x TEXT)`);
  d.close();
}

afterEach(() => { while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true }); });

describe('IndexStore migration from the pre-#50 unscoped schema', () => {
  it('adopts a legacy index into the one database that owns the table', () => {
    const { sysPath, dataDir } = workspace();
    legacySystemDb(sysPath, [['PEOPLE', 'BYNAME', 'LASTNAME']]);
    userDbWithTable(dataDir, 'HRDB', 'PEOPLE');

    const store = new IndexStore(sysPath, dataDir);
    expect(store.listIndexes('HRDB', 'PEOPLE')).toEqual([{ tag: 'BYNAME', expression: 'LASTNAME' }]);
    expect(store.getActive('HRDB', 'PEOPLE')).toEqual({ tag: 'BYNAME', expression: 'LASTNAME' });
    expect(store.listIndexes('', 'PEOPLE')).toEqual([]);   // no unscoped rows survive
  });

  it('drops a legacy index whose owning database is ambiguous', () => {
    const { sysPath, dataDir } = workspace();
    legacySystemDb(sysPath, [['PEOPLE', 'BYNAME', 'LASTNAME']]);
    userDbWithTable(dataDir, 'HRDB', 'PEOPLE');
    userDbWithTable(dataDir, 'CRMDB', 'PEOPLE');       // two owners → ambiguous

    const store = new IndexStore(sysPath, dataDir);
    expect(store.listIndexes('HRDB', 'PEOPLE')).toEqual([]);
    expect(store.listIndexes('CRMDB', 'PEOPLE')).toEqual([]);
  });

  it('drops a legacy index whose table no longer exists anywhere', () => {
    const { sysPath, dataDir } = workspace();
    legacySystemDb(sysPath, [['GHOST', 'BYNAME', 'LASTNAME']]);

    const store = new IndexStore(sysPath, dataDir);
    expect(store.listIndexes('', 'GHOST')).toEqual([]);
    expect(store.getActive('', 'GHOST')).toBeNull();
  });

  it('is idempotent — reopening an already-migrated store keeps the rows', () => {
    const { sysPath, dataDir } = workspace();
    legacySystemDb(sysPath, [['PEOPLE', 'BYNAME', 'LASTNAME']]);
    userDbWithTable(dataDir, 'HRDB', 'PEOPLE');

    new IndexStore(sysPath, dataDir);
    const reopened = new IndexStore(sysPath, dataDir);
    expect(reopened.listIndexes('HRDB', 'PEOPLE')).toEqual([{ tag: 'BYNAME', expression: 'LASTNAME' }]);
  });
});
