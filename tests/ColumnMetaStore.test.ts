import { describe, it, expect, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ColumnMetaStore } from '../server/ColumnMetaStore';

const tmpFiles: string[] = [];
function tmpDbPath(): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wb3-colmeta-')), 'system.sqlite3');
  tmpFiles.push(p);
  return p;
}

afterEach(() => {
  while (tmpFiles.length) {
    const p = tmpFiles.pop()!;
    fs.rmSync(path.dirname(p), { recursive: true, force: true });
  }
});

describe('ColumnMetaStore', () => {
  it('round-trips a declared type with qualifier and scale', () => {
    const store = new ColumnMetaStore(tmpDbPath());
    store.setColumnType('DB', 'T', 'PRICE', 'NUM', 8, 2);
    expect(store.getColumnType('DB', 'T', 'PRICE')).toEqual({ baseType: 'NUM', qualifier: 8, scale: 2 });
  });

  it('scopes metadata per database', () => {
    const store = new ColumnMetaStore(tmpDbPath());
    store.setColumnType('A', 'SHARED', 'VAL', 'TIME', 15, null);
    store.setColumnType('B', 'SHARED', 'VAL', 'CHAR', 20, null);
    expect(store.getColumnType('A', 'SHARED', 'VAL')).toEqual({ baseType: 'TIME', qualifier: 15, scale: null });
    expect(store.getColumnType('B', 'SHARED', 'VAL')).toEqual({ baseType: 'CHAR', qualifier: 20, scale: null });
  });

  it('returns null for an untracked column', () => {
    const store = new ColumnMetaStore(tmpDbPath());
    expect(store.getColumnType('DB', 'T', 'NOPE')).toBeNull();
  });

  it('drops, renames, and lists per (db, table)', () => {
    const store = new ColumnMetaStore(tmpDbPath());
    store.setColumnType('DB', 'T', 'A', 'TIME', 15, null);
    store.setColumnType('DB', 'T', 'B', 'DATE', null, null);
    store.setColumnType('DB', 'OTHER', 'A', 'INT', null, null);

    expect(Object.keys(store.listColumnTypes('DB', 'T')).sort()).toEqual(['A', 'B']);

    store.renameColumn('DB', 'T', 'A', 'RENAMED');
    expect(store.getColumnType('DB', 'T', 'RENAMED')?.baseType).toBe('TIME');
    expect(store.getColumnType('DB', 'T', 'A')).toBeNull();

    store.dropColumn('DB', 'T', 'B');
    expect(store.getColumnType('DB', 'T', 'B')).toBeNull();

    store.dropTable('DB', 'T');
    expect(store.listColumnTypes('DB', 'T')).toEqual({});
    expect(store.getColumnType('DB', 'OTHER', 'A')?.baseType).toBe('INT');   // untouched
  });

  // The #43 cut of this table had neither db_name nor scale. Opening an old file
  // must migrate rather than throw "no such column".
  it('migrates a pre-#45 column_types table', () => {
    const p = tmpDbPath();
    const legacy = new Database(p);
    legacy.exec(`
      CREATE TABLE column_types (
        table_name TEXT NOT NULL, col_name TEXT NOT NULL,
        base_type TEXT NOT NULL, qualifier INTEGER,
        PRIMARY KEY (table_name, col_name)
      );
    `);
    legacy.prepare('INSERT INTO column_types VALUES (?,?,?,?)').run('SHIFTS', 'STARTTIME', 'TIME', 15);
    legacy.close();

    const store = new ColumnMetaStore(p);
    store.setColumnType('MYDB', 'SHIFTS', 'STARTTIME', 'TIME', 15, null);
    expect(store.getColumnType('MYDB', 'SHIFTS', 'STARTTIME')).toEqual({ baseType: 'TIME', qualifier: 15, scale: null });
    expect(store.getColumnType('OTHERDB', 'SHIFTS', 'STARTTIME')).toBeNull();
  });
});

describe('lookup persistence', () => {
  it('round-trips a table lookup with display', () => {
    const store = new ColumnMetaStore(tmpDbPath());
    store.setColumnType('DB', 'EMPLOYEES', 'SCHEDID', 'CHAR', 4, null,
      { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID', display: 'DESCR' });
    expect(store.getColumnType('DB', 'EMPLOYEES', 'SCHEDID')).toEqual({
      baseType: 'CHAR', qualifier: 4, scale: null,
      lookup: { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID', display: 'DESCR' },
    });
  });

  it('round-trips a literal list preserving order and case', () => {
    const store = new ColumnMetaStore(tmpDbPath());
    store.setColumnType('DB', 'DEALS', 'STAGE', 'CHAR', 12, null,
      { kind: 'list', values: ['Lead', 'Won', 'lost'] });
    expect(store.getColumnType('DB', 'DEALS', 'STAGE')?.lookup)
      .toEqual({ kind: 'list', values: ['Lead', 'Won', 'lost'] });
  });

  it('omits the lookup key entirely when none was declared', () => {
    const store = new ColumnMetaStore(tmpDbPath());
    store.setColumnType('DB', 'T', 'PLAIN', 'CHAR', 10, null);
    expect(store.getColumnType('DB', 'T', 'PLAIN')).toEqual({ baseType: 'CHAR', qualifier: 10, scale: null });
  });

  it('re-declaring a column without a lookup clears the stored one', () => {
    const store = new ColumnMetaStore(tmpDbPath());
    store.setColumnType('DB', 'T', 'C', 'CHAR', 4, null, { kind: 'list', values: ['A'] });
    store.setColumnType('DB', 'T', 'C', 'CHAR', 4, null);
    expect(store.getColumnType('DB', 'T', 'C')?.lookup).toBeUndefined();
  });

  it('scopes lookups per database (two DBs, same table+column)', () => {
    const store = new ColumnMetaStore(tmpDbPath());
    store.setColumnType('A', 'T', 'C', 'CHAR', 4, null, { kind: 'list', values: ['X'] });
    store.setColumnType('B', 'T', 'C', 'CHAR', 4, null, { kind: 'list', values: ['Y'] });
    expect(store.getColumnType('A', 'T', 'C')?.lookup).toEqual({ kind: 'list', values: ['X'] });
    expect(store.getColumnType('B', 'T', 'C')?.lookup).toEqual({ kind: 'list', values: ['Y'] });
  });

  it('listColumnTypes carries lookups', () => {
    const store = new ColumnMetaStore(tmpDbPath());
    store.setColumnType('DB', 'T', 'C', 'CHAR', 4, null, { kind: 'list', values: ['A'] });
    expect(store.listColumnTypes('DB', 'T').C.lookup).toEqual({ kind: 'list', values: ['A'] });
  });

  // A v1.2.0 store has db_name and scale but no lookup columns. It SHIPPED —
  // it must be migrated additively, never dropped (dropping erases users'
  // declared TIME(15)/NUM(p,s) types).
  it('adds lookup columns to a v1.2.0 store without losing existing rows', () => {
    const p = tmpDbPath();
    const v120 = new Database(p);
    v120.exec(`
      CREATE TABLE column_types (
        db_name    TEXT NOT NULL,
        table_name TEXT NOT NULL,
        col_name   TEXT NOT NULL,
        base_type  TEXT NOT NULL,
        qualifier  INTEGER,
        scale      INTEGER,
        PRIMARY KEY (db_name, table_name, col_name)
      );
    `);
    v120.prepare('INSERT INTO column_types VALUES (?,?,?,?,?,?)')
      .run('OVERTIME', 'SCHEDULEDAYS', 'TIMEIN', 'TIME', 15, null);
    v120.close();

    const store = new ColumnMetaStore(p);
    // The pre-existing row SURVIVES:
    expect(store.getColumnType('OVERTIME', 'SCHEDULEDAYS', 'TIMEIN'))
      .toEqual({ baseType: 'TIME', qualifier: 15, scale: null });
    // And the new columns work:
    store.setColumnType('OVERTIME', 'EMPLOYEES', 'SCHEDID', 'CHAR', 4, null,
      { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID' });
    expect(store.getColumnType('OVERTIME', 'EMPLOYEES', 'SCHEDID')?.lookup)
      .toEqual({ kind: 'table', table: 'SCHEDULES', column: 'SCHEDID' });
  });
});
