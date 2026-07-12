import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServerDatabaseBridge, __closeAndEvictForTest } from '../server/ServerDatabaseBridge';
import { resolveLookup, LOOKUP_MAX_VALUES } from '../src/interpreter/LookupResolver';
import fs from 'fs';
import path from 'path';

const TEST_DB = 'test_lookupresolver';
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, `${TEST_DB}.sqlite3`);

describe('resolveLookup', () => {
  let bridge: ServerDatabaseBridge;

  beforeEach(async () => {
    bridge = new ServerDatabaseBridge();
    await bridge.openDatabase(TEST_DB);
  });

  afterEach(async () => {
    await bridge.closeDatabase();
    __closeAndEvictForTest(TEST_DB);
    for (const f of [DB_PATH, DB_PATH + '-shm', DB_PATH + '-wal']) {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    }
  });

  it('resolves a literal list verbatim, value === label', async () => {
    expect(await resolveLookup(bridge, { kind: 'list', values: ['Lead', 'Won'] })).toEqual([
      { value: 'Lead', label: 'Lead' },
      { value: 'Won', label: 'Won' },
    ]);
  });

  it('resolves a table lookup to DISTINCT ordered values', async () => {
    await bridge.exec('CREATE TABLE SCHEDULES (SCHEDID TEXT, DESCR TEXT)');
    await bridge.exec("INSERT INTO SCHEDULES VALUES ('S002','Short day'),('S001','Std day'),('S001','Std day')");
    expect(await resolveLookup(bridge, { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID' })).toEqual([
      { value: 'S001', label: 'S001' },
      { value: 'S002', label: 'S002' },
    ]);
  });

  it('uses the DISPLAY column as the label, storing the value', async () => {
    await bridge.exec('CREATE TABLE SCHEDULES (SCHEDID TEXT, DESCR TEXT)');
    await bridge.exec("INSERT INTO SCHEDULES VALUES ('S001','Std day'),('S002','Short day')");
    expect(await resolveLookup(bridge, { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID', display: 'DESCR' })).toEqual([
      { value: 'S001', label: 'Std day' },
      { value: 'S002', label: 'Short day' },
    ]);
  });

  it('returns null when the source table is missing', async () => {
    expect(await resolveLookup(bridge, { kind: 'table', table: 'NOPE', column: 'X' })).toBeNull();
  });

  it('returns null when the source column is missing', async () => {
    await bridge.exec('CREATE TABLE SCHEDULES (SCHEDID TEXT)');
    expect(await resolveLookup(bridge, { kind: 'table', table: 'SCHEDULES', column: 'MISSING' })).toBeNull();
  });

  it('returns null when the display column is missing', async () => {
    await bridge.exec('CREATE TABLE SCHEDULES (SCHEDID TEXT)');
    expect(await resolveLookup(bridge, { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID', display: 'MISSING' })).toBeNull();
  });

  it('returns null when the source is empty', async () => {
    await bridge.exec('CREATE TABLE SCHEDULES (SCHEDID TEXT)');
    expect(await resolveLookup(bridge, { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID' })).toBeNull();
  });

  it('degrades (null), never truncates, over the ceiling', async () => {
    await bridge.exec('CREATE TABLE BIG (V TEXT)');
    const values = Array.from({ length: LOOKUP_MAX_VALUES + 1 }, (_, i) => `('v${String(i).padStart(5, '0')}')`);
    await bridge.exec(`INSERT INTO BIG VALUES ${values.join(',')}`);
    expect(await resolveLookup(bridge, { kind: 'table', table: 'BIG', column: 'V' })).toBeNull();
  });

  it('skips NULL/empty values from the source', async () => {
    await bridge.exec('CREATE TABLE SCHEDULES (SCHEDID TEXT)');
    await bridge.exec("INSERT INTO SCHEDULES VALUES ('S001'),(NULL),('')");
    expect(await resolveLookup(bridge, { kind: 'table', table: 'SCHEDULES', column: 'SCHEDID' })).toEqual([
      { value: 'S001', label: 'S001' },
    ]);
  });
});
