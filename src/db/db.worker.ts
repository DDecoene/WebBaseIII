/// <reference lib="webworker" />

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

declare const self: DedicatedWorkerGlobalScope;

type MsgType = 'openDb' | 'closeDb' | 'exec' | 'query' | 'tables' | 'structure' | 'rowCount';

interface WorkerReq {
  id: number;
  type: MsgType;
  sql?: string;
  params?: unknown[];
  dbName?: string;
}

let db: any = null;
let sqlite3: any = null;
let opfsAvailable = false;

async function init() {
  sqlite3 = await sqlite3InitModule({
    locateFile: (f: string) => `/${f}`,
    print: () => {},
    printErr: () => {},
  });
  opfsAvailable = !!sqlite3.capi.sqlite3_vfs_find('opfs');
  self.postMessage({ type: 'ready', opfsAvailable });
}

function openDb(dbName: string) {
  if (db) { try { db.close(); } catch (_) {} db = null; }
  if (opfsAvailable) {
    db = new sqlite3.oo1.OpfsDb(`/${dbName}.sqlite3`);
  } else {
    db = new sqlite3.oo1.DB(':memory:');
  }
  return { dbName, opfsAvailable };
}

function closeDb() {
  if (db) { try { db.close(); } catch (_) {} db = null; }
}

function execSql(sql: string, params?: unknown[]) {
  if (!db) throw new Error('No database open — run: USE <tablename>');
  db.exec({ sql, bind: params ?? [] });
  return null;
}

function querySql(sql: string, params?: unknown[]): Record<string, unknown>[] {
  if (!db) throw new Error('No database open — run: USE <tablename>');
  const rows: Record<string, unknown>[] = [];
  db.exec({ sql, bind: params ?? [], rowMode: 'object', callback: (r: Record<string, unknown>) => rows.push({ ...r }) });
  return rows;
}

function getTables(): string[] {
  if (!db) return [];
  return querySql("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map(r => r.name as string);
}

function getStructure(tableName: string) {
  if (!db) return [];
  return querySql(`PRAGMA table_info(${JSON.stringify(tableName)})`);
}

function getRowCount(tableName: string, filter?: string): number {
  if (!db) return 0;
  const where = filter ? ` WHERE ${filter}` : '';
  const rows = querySql(`SELECT COUNT(*) as n FROM ${JSON.stringify(tableName)}${where}`);
  return Number(rows[0]?.n ?? 0);
}

self.onmessage = async (e: MessageEvent<WorkerReq>) => {
  const { id, type } = e.data;
  try {
    let result: unknown;
    switch (type) {
      case 'openDb':    result = openDb(e.data.dbName!); break;
      case 'closeDb':   closeDb(); result = null; break;
      case 'exec':      result = execSql(e.data.sql!, e.data.params); break;
      case 'query':     result = querySql(e.data.sql!, e.data.params); break;
      case 'tables':    result = getTables(); break;
      case 'structure': result = getStructure(e.data.sql!); break;
      case 'rowCount':  result = getRowCount(e.data.sql!, e.data.params?.[0] as string); break;
      default: throw new Error(`Unknown type: ${type}`);
    }
    self.postMessage({ id, result });
  } catch (err: unknown) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};

init().catch(err => self.postMessage({ type: 'initError', message: String(err) }));
