import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { IDatabaseBridge, ColInfo } from '../src/shared/types.js';

const DATA_DIR = path.join(process.cwd(), 'data');

// Shared across sessions — one Database instance per named DB file
const openDbs = new Map<string, Database.Database>();

/** FOR TESTS ONLY — close and evict a named DB from the shared pool. */
export function __closeAndEvictForTest(dbName: string): void {
  const db = openDbs.get(dbName);
  if (db) {
    db.close();
    openDbs.delete(dbName);
  }
}

function getDb(dbName: string): Database.Database {
  if (!openDbs.has(dbName)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const db = new Database(path.join(DATA_DIR, `${dbName}.sqlite3`));
    db.pragma('journal_mode = WAL');
    openDbs.set(dbName, db);
  }
  return openDbs.get(dbName)!;
}

export class ServerDatabaseBridge implements IDatabaseBridge {
  public opfsAvailable = false;
  public currentDb: string | null = null;
  private db: Database.Database | null = null;

  async openDatabase(dbName: string): Promise<{ dbName: string; opfsAvailable: boolean }> {
    if (!/^[a-zA-Z0-9_-]+$/.test(dbName)) {
      throw new Error(`Invalid database name: "${dbName}". Only alphanumeric, underscore, and hyphen allowed.`);
    }
    this.db = getDb(dbName);
    this.currentDb = dbName;
    return { dbName, opfsAvailable: false };
  }

  async closeDatabase(): Promise<void> {
    // The handle in `openDbs` is shared across all sessions, so we must NOT
    // close it here — that would break every other session using the same DB.
    // WAL handles stay open for the process lifetime; just detach this session.
    this.db = null;
    this.currentDb = null;
  }

  async exec(sql: string, params?: unknown[]): Promise<void> {
    if (!this.db) throw new Error('No database open — run: USE <tablename>');
    this.db.prepare(sql).run(...(params ?? []));
  }

  async query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
    if (!this.db) throw new Error('No database open — run: USE <tablename>');
    return this.db.prepare(sql).all(...(params ?? [])) as Record<string, unknown>[];
  }

  async getTables(): Promise<string[]> {
    if (!this.db) return [];
    const rows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];
    return rows.map(r => r.name);
  }

  async getStructure(tableName: string): Promise<ColInfo[]> {
    if (!this.db) return [];
    return this.db
      .prepare(`PRAGMA table_info(${JSON.stringify(tableName)})`)
      .all() as ColInfo[];
  }

  async getRowCount(tableName: string, filter?: string): Promise<number> {
    if (!this.db) return 0;
    const where = filter ? ` WHERE ${filter}` : '';
    const row = this.db
      .prepare(`SELECT COUNT(*) as n FROM ${JSON.stringify(tableName)}${where}`)
      .get() as { n: number };
    return Number(row?.n ?? 0);
  }

  async tableExists(name: string): Promise<boolean> {
    const tables = await this.getTables();
    return tables.map(t => t.toLowerCase()).includes(name.toLowerCase());
  }

  async listDatabases(): Promise<string[]> {
    if (!fs.existsSync(DATA_DIR)) return [];
    return fs.readdirSync(DATA_DIR)
      .filter(f => f.endsWith('.sqlite3') && f !== 'system.sqlite3')
      .map(f => f.slice(0, -8))
      .sort();
  }
}
