import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { IIndexStore, IndexDef } from '../src/shared/types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH  = path.join(DATA_DIR, 'system.sqlite3');

export class IndexStore implements IIndexStore {
  private db: Database.Database;

  constructor(dbPath = DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS indexes (
        id         INTEGER PRIMARY KEY,
        table_name TEXT NOT NULL,
        tag        TEXT NOT NULL,
        expression TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        UNIQUE(table_name, tag)
      );
      CREATE TABLE IF NOT EXISTS active_indexes (
        table_name TEXT PRIMARY KEY,
        tag        TEXT NOT NULL
      );
    `);
  }

  saveIndex(tableName: string, tag: string, expression: string): void {
    this.db.prepare(`
      INSERT INTO indexes (table_name, tag, expression)
      VALUES (?, ?, ?)
      ON CONFLICT(table_name, tag) DO UPDATE SET expression = excluded.expression
    `).run(tableName, tag, expression);
  }

  listIndexes(tableName: string): IndexDef[] {
    return this.db.prepare(
      'SELECT tag, expression FROM indexes WHERE table_name = ? ORDER BY tag'
    ).all(tableName) as IndexDef[];
  }

  getActive(tableName: string): IndexDef | null {
    const row = this.db.prepare(`
      SELECT i.tag, i.expression
      FROM active_indexes a
      JOIN indexes i ON i.table_name = a.table_name AND i.tag = a.tag
      WHERE a.table_name = ?
    `).get(tableName) as IndexDef | undefined;
    return row ?? null;
  }

  setActive(tableName: string, tag: string): void {
    const exists = this.db.prepare(
      'SELECT 1 FROM indexes WHERE table_name = ? AND tag = ?'
    ).get(tableName, tag);
    if (!exists) throw new Error(`Index '${tag}' not found on table '${tableName}'`);
    this.db.prepare(`
      INSERT INTO active_indexes (table_name, tag) VALUES (?, ?)
      ON CONFLICT(table_name) DO UPDATE SET tag = excluded.tag
    `).run(tableName, tag);
  }

  clearActive(tableName: string): void {
    this.db.prepare('DELETE FROM active_indexes WHERE table_name = ?').run(tableName);
  }
}

export const indexStore = new IndexStore();
