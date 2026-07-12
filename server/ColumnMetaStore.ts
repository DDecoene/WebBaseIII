import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { IColumnMetaStore, ColumnTypeInfo, Lookup } from '../src/shared/types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH  = path.join(DATA_DIR, 'system.sqlite3');

const LOOKUP_COLS = ['lookup_kind', 'lookup_table', 'lookup_col', 'lookup_display', 'lookup_values'] as const;

interface Row {
  baseType: string; qualifier: number | null; scale: number | null;
  lookup_kind: string | null; lookup_table: string | null; lookup_col: string | null;
  lookup_display: string | null; lookup_values: string | null;
}

function rowToMeta(r: Row): ColumnTypeInfo {
  const meta: ColumnTypeInfo = { baseType: r.baseType, qualifier: r.qualifier, scale: r.scale };
  if (r.lookup_kind === 'list') {
    meta.lookup = { kind: 'list', values: JSON.parse(r.lookup_values ?? '[]') as string[] };
  } else if (r.lookup_kind === 'table' && r.lookup_table && r.lookup_col) {
    meta.lookup = r.lookup_display
      ? { kind: 'table', table: r.lookup_table, column: r.lookup_col, display: r.lookup_display }
      : { kind: 'table', table: r.lookup_table, column: r.lookup_col };
  }
  return meta;
}

const SELECT_COLS = `base_type AS baseType, qualifier, scale,
       lookup_kind, lookup_table, lookup_col, lookup_display, lookup_values`;

/**
 * Declared column types (+ optional lookup constraint), keyed by
 * (database, table, column).
 *
 * SQLite only records a storage affinity (TEXT/REAL/INTEGER), which cannot tell
 * TIME from DATE from CHAR, LOGICAL from INT, or recover a NUM(p,s) qualifier.
 * The grid, forms and REPLACE need the declared type + lookup to validate writes.
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
        db_name        TEXT NOT NULL,
        table_name     TEXT NOT NULL,
        col_name       TEXT NOT NULL,
        base_type      TEXT NOT NULL,
        qualifier      INTEGER,
        scale          INTEGER,
        lookup_kind    TEXT,
        lookup_table   TEXT,
        lookup_col     TEXT,
        lookup_display TEXT,
        lookup_values  TEXT,
        PRIMARY KEY (db_name, table_name, col_name)
      );
    `);
    // v1.2.0 dev migration: the first cut of this table (#43) had neither db_name
    // nor scale. Those rows never shipped in a release, so rebuilding was safe.
    let cols = this.db.prepare('PRAGMA table_info(column_types)').all() as { name: string }[];
    if (!cols.some(c => c.name === 'db_name') || !cols.some(c => c.name === 'scale')) {
      this.db.exec(`
        DROP TABLE column_types;
        CREATE TABLE column_types (
          db_name        TEXT NOT NULL,
          table_name     TEXT NOT NULL,
          col_name       TEXT NOT NULL,
          base_type      TEXT NOT NULL,
          qualifier      INTEGER,
          scale          INTEGER,
          lookup_kind    TEXT,
          lookup_table   TEXT,
          lookup_col     TEXT,
          lookup_display TEXT,
          lookup_values  TEXT,
          PRIMARY KEY (db_name, table_name, col_name)
        );
      `);
      cols = this.db.prepare('PRAGMA table_info(column_types)').all() as { name: string }[];
    }
    // v1.3.0 lookup migration (#58): v1.2.0 SHIPPED, so this one must be
    // additive — dropping the table here would silently erase every released
    // user's declared TIME(15)/NUM(p,s) types.
    for (const col of LOOKUP_COLS) {
      if (!cols.some(c => c.name === col)) {
        this.db.exec(`ALTER TABLE column_types ADD COLUMN ${col} TEXT`);
      }
    }
  }

  setColumnType(dbName: string, tableName: string, colName: string, baseType: string, qualifier: number | null, scale: number | null, lookup: Lookup | null = null): void {
    const kind = lookup?.kind ?? null;
    const lTable = lookup?.kind === 'table' ? lookup.table : null;
    const lCol = lookup?.kind === 'table' ? lookup.column : null;
    const lDisplay = lookup?.kind === 'table' ? (lookup.display ?? null) : null;
    const lValues = lookup?.kind === 'list' ? JSON.stringify(lookup.values) : null;
    this.db.prepare(`
      INSERT INTO column_types (db_name, table_name, col_name, base_type, qualifier, scale,
                                lookup_kind, lookup_table, lookup_col, lookup_display, lookup_values)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(db_name, table_name, col_name) DO UPDATE SET
        base_type = excluded.base_type, qualifier = excluded.qualifier, scale = excluded.scale,
        lookup_kind = excluded.lookup_kind, lookup_table = excluded.lookup_table,
        lookup_col = excluded.lookup_col, lookup_display = excluded.lookup_display,
        lookup_values = excluded.lookup_values
    `).run(dbName, tableName, colName, baseType, qualifier, scale, kind, lTable, lCol, lDisplay, lValues);
  }

  getColumnType(dbName: string, tableName: string, colName: string): ColumnTypeInfo | null {
    const row = this.db.prepare(
      `SELECT ${SELECT_COLS} FROM column_types WHERE db_name = ? AND table_name = ? AND col_name = ?`
    ).get(dbName, tableName, colName) as Row | undefined;
    return row ? rowToMeta(row) : null;
  }

  listColumnTypes(dbName: string, tableName: string): Record<string, ColumnTypeInfo> {
    const rows = this.db.prepare(
      `SELECT col_name AS colName, ${SELECT_COLS} FROM column_types WHERE db_name = ? AND table_name = ?`
    ).all(dbName, tableName) as Array<Row & { colName: string }>;
    const out: Record<string, ColumnTypeInfo> = {};
    for (const r of rows) out[r.colName] = rowToMeta(r);
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
