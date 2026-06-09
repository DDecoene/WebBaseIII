import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH  = path.join(DATA_DIR, 'system.sqlite3');

export class ReportStore {
  private db: Database.Database;

  constructor(dbPath = DB_PATH) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS reports (
        name       TEXT PRIMARY KEY,
        content    TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  }

  load(name: string): string | null {
    const row = this.db.prepare('SELECT content FROM reports WHERE name = ?').get(name) as { content: string } | undefined;
    return row ? row.content : null;
  }

  save(name: string, content: string): void {
    this.db.prepare(`
      INSERT INTO reports (name, content, updated_at) VALUES (?, ?, datetime('now'))
      ON CONFLICT(name) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at
    `).run(name, content);
  }

  list(): string[] {
    const rows = this.db.prepare('SELECT name FROM reports ORDER BY name').all() as { name: string }[];
    return rows.map(r => r.name);
  }

  delete(name: string): void {
    this.db.prepare('DELETE FROM reports WHERE name = ?').run(name);
  }
}

export const reportStore = new ReportStore();
