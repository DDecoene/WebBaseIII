import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { IColumnMetaStore, ColumnTypeInfo } from '../src/shared/types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH  = path.join(DATA_DIR, 'system.sqlite3');

/**
 * Declared column types, keyed by (database, table, column).
 *
 * SQLite only records a storage affinity (TEXT/REAL/INTEGER), which cannot tell
 * TIME from DATE from CHAR, LOGICAL from INT, or recover a NUM(p,s) qualifier.
 * The grid and REPLACE need the declared type to validate writes.
 *
 * Scoping by database matters: two databases may each hold a table of the same
 * name with different column types.
 */
export class ColumnMetaStore implements IColumnMetaStore {
  private db: Database.Database;

  constructor(dbPath = DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS column_types (
        db_name    TEXT NOT NULL,
        table_name TEXT NOT NULL,
        col_name   TEXT NOT NULL,
        base_type  TEXT NOT NULL,
        qualifier  INTEGER,
        scale      INTEGER,
        PRIMARY KEY (db_name, table_name, col_name)
      );
    `);
    // v1.2.0 dev migration: the first cut of this table (#43) had neither db_name
    // nor scale. The rows only cache what CREATE TABLE re-records, so rebuilding
    // is cheaper and safer than back-filling an unscoped key.
    const cols = this.db.prepare('PRAGMA table_info(column_types)').all() as { name: string }[];
    if (!cols.some(c => c.name === 'db_name') || !cols.some(c => c.name === 'scale')) {
      this.db.exec(`
        DROP TABLE column_types;
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
    }
  }

  setColumnType(dbName: string, tableName: string, colName: string, baseType: string, qualifier: number | null, scale: number | null): void {
    this.db.prepare(`
      INSERT INTO column_types (db_name, table_name, col_name, base_type, qualifier, scale)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(db_name, table_name, col_name) DO UPDATE SET
        base_type = excluded.base_type, qualifier = excluded.qualifier, scale = excluded.scale
    `).run(dbName, tableName, colName, baseType, qualifier, scale);
  }

  getColumnType(dbName: string, tableName: string, colName: string): ColumnTypeInfo | null {
    const row = this.db.prepare(
      'SELECT base_type AS baseType, qualifier, scale FROM column_types WHERE db_name = ? AND table_name = ? AND col_name = ?'
    ).get(dbName, tableName, colName) as ColumnTypeInfo | undefined;
    return row ?? null;
  }

  listColumnTypes(dbName: string, tableName: string): Record<string, ColumnTypeInfo> {
    const rows = this.db.prepare(
      'SELECT col_name AS colName, base_type AS baseType, qualifier, scale FROM column_types WHERE db_name = ? AND table_name = ?'
    ).all(dbName, tableName) as Array<ColumnTypeInfo & { colName: string }>;
    const out: Record<string, ColumnTypeInfo> = {};
    for (const r of rows) out[r.colName] = { baseType: r.baseType, qualifier: r.qualifier, scale: r.scale };
    return out;
  }

  renameColumn(dbName: string, tableName: string, oldName: string, newName: string): void {
    this.db.prepare(
      'UPDATE column_types SET col_name = ? WHERE db_name = ? AND table_name = ? AND col_name = ?'
    ).run(newName, dbName, tableName, oldName);
  }

  dropColumn(dbName: string, tableName: string, colName: string): void {
    this.db.prepare('DELETE FROM column_types WHERE db_name = ? AND table_name = ? AND col_name = ?')
      .run(dbName, tableName, colName);
  }

  dropTable(dbName: string, tableName: string): void {
    this.db.prepare('DELETE FROM column_types WHERE db_name = ? AND table_name = ?').run(dbName, tableName);
  }
}

export const columnMetaStore = new ColumnMetaStore();
