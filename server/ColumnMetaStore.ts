import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { IColumnMetaStore, ColumnTypeInfo } from '../src/shared/types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH  = path.join(DATA_DIR, 'system.sqlite3');

export class ColumnMetaStore implements IColumnMetaStore {
  private db: Database.Database;

  constructor(dbPath = DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS column_types (
        table_name TEXT NOT NULL,
        col_name   TEXT NOT NULL,
        base_type  TEXT NOT NULL,
        qualifier  INTEGER,
        PRIMARY KEY (table_name, col_name)
      );
    `);
  }

  setColumnType(tableName: string, colName: string, baseType: string, qualifier: number | null): void {
    this.db.prepare(`
      INSERT INTO column_types (table_name, col_name, base_type, qualifier)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(table_name, col_name) DO UPDATE SET base_type = excluded.base_type, qualifier = excluded.qualifier
    `).run(tableName, colName, baseType, qualifier);
  }

  getColumnType(tableName: string, colName: string): ColumnTypeInfo | null {
    const row = this.db.prepare(
      'SELECT base_type AS baseType, qualifier FROM column_types WHERE table_name = ? AND col_name = ?'
    ).get(tableName, colName) as ColumnTypeInfo | undefined;
    return row ?? null;
  }

  listColumnTypes(tableName: string): Record<string, ColumnTypeInfo> {
    const rows = this.db.prepare(
      'SELECT col_name AS colName, base_type AS baseType, qualifier FROM column_types WHERE table_name = ?'
    ).all(tableName) as Array<ColumnTypeInfo & { colName: string }>;
    const out: Record<string, ColumnTypeInfo> = {};
    for (const r of rows) out[r.colName] = { baseType: r.baseType, qualifier: r.qualifier };
    return out;
  }

  renameColumn(tableName: string, oldName: string, newName: string): void {
    this.db.prepare(
      'UPDATE column_types SET col_name = ? WHERE table_name = ? AND col_name = ?'
    ).run(newName, tableName, oldName);
  }

  dropColumn(tableName: string, colName: string): void {
    this.db.prepare('DELETE FROM column_types WHERE table_name = ? AND col_name = ?').run(tableName, colName);
  }

  dropTable(tableName: string): void {
    this.db.prepare('DELETE FROM column_types WHERE table_name = ?').run(tableName);
  }
}

export const columnMetaStore = new ColumnMetaStore();
