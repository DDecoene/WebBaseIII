import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { IIndexStore, IndexDef } from '../src/shared/types.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH  = path.join(DATA_DIR, 'system.sqlite3');

/**
 * Index metadata, keyed by (database, table, tag).
 *
 * Scoping by database matters: two databases may each hold a table of the same
 * name. Before v1.2.0 (#50) the key omitted the database, so opening `PEOPLE` in
 * one database silently activated an index defined on another database's
 * `PEOPLE` — pointing the record order at a column that need not even exist.
 */
export class IndexStore implements IIndexStore {
  private db: Database.Database;

  constructor(dbPath = DB_PATH, dataDir = DATA_DIR) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS indexes (
        id         INTEGER PRIMARY KEY,
        db_name    TEXT NOT NULL DEFAULT '',
        table_name TEXT NOT NULL,
        tag        TEXT NOT NULL,
        expression TEXT NOT NULL,
        created_at INTEGER DEFAULT (unixepoch()),
        UNIQUE(db_name, table_name, tag)
      );
      CREATE TABLE IF NOT EXISTS active_indexes (
        db_name    TEXT NOT NULL DEFAULT '',
        table_name TEXT NOT NULL,
        tag        TEXT NOT NULL,
        PRIMARY KEY (db_name, table_name)
      );
    `);
    this.addDbNameColumn(dataDir);
    this.migrateUnscoped(dataDir);
  }

  /**
   * A pre-#50 system.sqlite3 has `indexes`/`active_indexes` without db_name (and
   * with the wrong key). CREATE TABLE IF NOT EXISTS leaves those alone, so rebuild
   * them here, carrying every row across with an empty db_name for migrateUnscoped
   * to adopt.
   */
  private addDbNameColumn(_dataDir: string): void {
    const hasCol = (t: string) =>
      (this.db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[])
        .some(c => c.name === 'db_name');
    if (hasCol('indexes') && hasCol('active_indexes')) return;

    this.db.transaction(() => {
      if (!hasCol('indexes')) {
        this.db.exec(`
          CREATE TABLE indexes_new (
            id         INTEGER PRIMARY KEY,
            db_name    TEXT NOT NULL DEFAULT '',
            table_name TEXT NOT NULL,
            tag        TEXT NOT NULL,
            expression TEXT NOT NULL,
            created_at INTEGER DEFAULT (unixepoch()),
            UNIQUE(db_name, table_name, tag)
          );
          INSERT INTO indexes_new (db_name, table_name, tag, expression)
            SELECT '', table_name, tag, expression FROM indexes;
          DROP TABLE indexes;
          ALTER TABLE indexes_new RENAME TO indexes;
        `);
      }
      if (!hasCol('active_indexes')) {
        this.db.exec(`
          CREATE TABLE active_indexes_new (
            db_name    TEXT NOT NULL DEFAULT '',
            table_name TEXT NOT NULL,
            tag        TEXT NOT NULL,
            PRIMARY KEY (db_name, table_name)
          );
          INSERT INTO active_indexes_new (db_name, table_name, tag)
            SELECT '', table_name, tag FROM active_indexes;
          DROP TABLE active_indexes;
          ALTER TABLE active_indexes_new RENAME TO active_indexes;
        `);
      }
    })();
  }

  /**
   * Pre-#50 rows carry no db_name. Index definitions are not re-derivable (only
   * `INDEX ON` creates them), so rather than discard them, adopt each row into the
   * one database that actually owns a table of that name. Rows whose owner is
   * ambiguous or gone are dropped — keeping them unscoped is what caused the bug.
   */
  private migrateUnscoped(dataDir: string): void {
    const hasLegacy = (this.db.prepare(
      `SELECT COUNT(*) AS n FROM indexes WHERE db_name = ''`
    ).get() as { n: number }).n > 0;
    if (!hasLegacy) return;

    const owners = new Map<string, string[]>();   // TABLE (upper) → [dbName]
    if (fs.existsSync(dataDir)) {
      for (const f of fs.readdirSync(dataDir)) {
        if (!f.endsWith('.sqlite3') || f === 'system.sqlite3') continue;
        const dbName = f.slice(0, -8);
        try {
          const user = new Database(path.join(dataDir, f), { readonly: true });
          const tables = user.prepare(
            "SELECT name FROM sqlite_master WHERE type='table'"
          ).all() as { name: string }[];
          user.close();
          for (const t of tables) {
            const key = t.name.toUpperCase();
            owners.set(key, [...(owners.get(key) ?? []), dbName]);
          }
        } catch { /* unreadable file — skip, its rows become ambiguous */ }
      }
    }

    const legacy = this.db.prepare(
      `SELECT table_name, tag FROM indexes WHERE db_name = ''`
    ).all() as { table_name: string; tag: string }[];

    const adopt = this.db.prepare(
      `UPDATE indexes SET db_name = ? WHERE db_name = '' AND table_name = ?`
    );
    const adoptActive = this.db.prepare(
      `UPDATE active_indexes SET db_name = ? WHERE db_name = '' AND table_name = ?`
    );
    const migrate = this.db.transaction(() => {
      for (const row of legacy) {
        const cands = owners.get(row.table_name.toUpperCase()) ?? [];
        if (cands.length === 1) {
          adopt.run(cands[0], row.table_name);
          adoptActive.run(cands[0], row.table_name);
        }
      }
      this.db.prepare(`DELETE FROM indexes WHERE db_name = ''`).run();
      this.db.prepare(`DELETE FROM active_indexes WHERE db_name = ''`).run();
    });
    migrate();
  }

  saveIndex(dbName: string, tableName: string, tag: string, expression: string): void {
    this.db.prepare(`
      INSERT INTO indexes (db_name, table_name, tag, expression)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(db_name, table_name, tag) DO UPDATE SET expression = excluded.expression
    `).run(dbName, tableName, tag, expression);
  }

  listIndexes(dbName: string, tableName: string): IndexDef[] {
    return this.db.prepare(
      'SELECT tag, expression FROM indexes WHERE db_name = ? AND table_name = ? ORDER BY tag'
    ).all(dbName, tableName) as IndexDef[];
  }

  getActive(dbName: string, tableName: string): IndexDef | null {
    const row = this.db.prepare(`
      SELECT i.tag, i.expression
      FROM active_indexes a
      JOIN indexes i ON i.db_name = a.db_name AND i.table_name = a.table_name AND i.tag = a.tag
      WHERE a.db_name = ? AND a.table_name = ?
    `).get(dbName, tableName) as IndexDef | undefined;
    return row ?? null;
  }

  setActive(dbName: string, tableName: string, tag: string): void {
    const exists = this.db.prepare(
      'SELECT 1 FROM indexes WHERE db_name = ? AND table_name = ? AND tag = ?'
    ).get(dbName, tableName, tag);
    if (!exists) throw new Error(`Index '${tag}' not found on table '${tableName}'`);
    this.db.prepare(`
      INSERT INTO active_indexes (db_name, table_name, tag) VALUES (?, ?, ?)
      ON CONFLICT(db_name, table_name) DO UPDATE SET tag = excluded.tag
    `).run(dbName, tableName, tag);
  }

  clearActive(dbName: string, tableName: string): void {
    this.db.prepare('DELETE FROM active_indexes WHERE db_name = ? AND table_name = ?')
      .run(dbName, tableName);
  }

  dropTable(dbName: string, tableName: string): void {
    this.db.prepare('DELETE FROM active_indexes WHERE db_name = ? AND table_name = ?').run(dbName, tableName);
    this.db.prepare('DELETE FROM indexes WHERE db_name = ? AND table_name = ?').run(dbName, tableName);
  }
}

export const indexStore = new IndexStore();
