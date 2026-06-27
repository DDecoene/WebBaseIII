import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServerDatabaseBridge, __closeAndEvictForTest } from '../server/ServerDatabaseBridge';
import fs from 'fs';
import path from 'path';

const TEST_DB = 'test_bridge_db';
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, `${TEST_DB}.sqlite3`);

describe('ServerDatabaseBridge', () => {
  let bridge: ServerDatabaseBridge;

  beforeEach(() => {
    bridge = new ServerDatabaseBridge();
  });

  afterEach(async () => {
    await bridge.closeDatabase();
    // Close and evict the shared handle so the next test gets a fresh DB file.
    __closeAndEvictForTest(TEST_DB);
    for (const f of [DB_PATH, DB_PATH + '-shm', DB_PATH + '-wal']) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  it('opens a database and returns dbName', async () => {
    const result = await bridge.openDatabase(TEST_DB);
    expect(result.dbName).toBe(TEST_DB);
    expect(result.opfsAvailable).toBe(false);
  });

  it('creates a table and queries it', async () => {
    await bridge.openDatabase(TEST_DB);
    await bridge.exec('CREATE TABLE t (name TEXT, age INTEGER)');
    await bridge.exec('INSERT INTO t VALUES (?, ?)', ['Alice', 30]);
    const rows = await bridge.query('SELECT * FROM t');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Alice', age: 30 });
  });

  it('returns table names', async () => {
    await bridge.openDatabase(TEST_DB);
    await bridge.exec('CREATE TABLE employees (id INTEGER PRIMARY KEY)');
    const tables = await bridge.getTables();
    expect(tables).toContain('employees');
  });

  it('returns row count with and without filter', async () => {
    await bridge.openDatabase(TEST_DB);
    await bridge.exec('CREATE TABLE t (v INTEGER)');
    await bridge.exec("INSERT INTO t VALUES (1)");
    await bridge.exec("INSERT INTO t VALUES (2)");
    await bridge.exec("INSERT INTO t VALUES (3)");
    expect(await bridge.getRowCount('t')).toBe(3);
    expect(await bridge.getRowCount('t', 'v > 1')).toBe(2);
  });

  it('detects table existence', async () => {
    await bridge.openDatabase(TEST_DB);
    await bridge.exec('CREATE TABLE exists_table (id INTEGER)');
    expect(await bridge.tableExists('exists_table')).toBe(true);
    expect(await bridge.tableExists('no_such_table')).toBe(false);
  });

  it('throws when exec called with no open database', async () => {
    await expect(bridge.exec('SELECT 1')).rejects.toThrow('No database open');
  });

  it('rejects invalid database names', async () => {
    await expect(bridge.openDatabase('../evil')).rejects.toThrow('Invalid database name');
    await expect(bridge.openDatabase('../../etc/passwd')).rejects.toThrow('Invalid database name');
  });

  it('fires onMutate after a successful exec, not after a query', async () => {
    const calls: number[] = [];
    await bridge.openDatabase(TEST_DB);
    bridge.onMutate = () => calls.push(1);
    await bridge.exec('CREATE TABLE m (id INTEGER)');
    await bridge.exec('INSERT INTO m (id) VALUES (1)');
    await bridge.query('SELECT * FROM m');     // must NOT fire onMutate
    expect(calls.length).toBe(2);
  });

  it('keeps the shared handle usable after another session closes it', async () => {
    const a = new ServerDatabaseBridge();
    const b = new ServerDatabaseBridge();
    await a.openDatabase(TEST_DB);
    await b.openDatabase(TEST_DB);            // same shared handle
    await a.exec('CREATE TABLE IF NOT EXISTS shared_t (id INTEGER)');

    await a.closeDatabase();                  // A leaves

    // B must still work — previously this threw "The database connection is not open"
    await expect(b.query('SELECT COUNT(*) AS n FROM shared_t')).resolves.toBeDefined();
    await b.closeDatabase();
  });
});
