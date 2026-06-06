import DbWorkerCtor from './db.worker?worker';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export interface ColInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

export class DatabaseBridge {
  private worker: Worker;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private readyPromise: Promise<{ opfsAvailable: boolean }>;
  private readyResolve!: (v: { opfsAvailable: boolean }) => void;

  public opfsAvailable = false;
  public currentDb: string | null = null;

  constructor() {
    this.worker = new DbWorkerCtor();
    this.readyPromise = new Promise(res => { this.readyResolve = res; });

    this.worker.onmessage = (e: MessageEvent) => {
      const d = e.data;
      if (d.type === 'ready') { this.opfsAvailable = d.opfsAvailable; this.readyResolve(d); return; }
      if (d.type === 'initError') { console.error('SQLite init error:', d.message); return; }
      const p = this.pending.get(d.id);
      if (!p) return;
      this.pending.delete(d.id);
      d.error ? p.reject(new Error(d.error)) : p.resolve(d.result);
    };
  }

  waitReady(): Promise<{ opfsAvailable: boolean }> { return this.readyPromise; }

  private send(type: string, extra: Record<string, unknown> = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, ...extra });
    });
  }

  async openDatabase(dbName: string): Promise<{ dbName: string; opfsAvailable: boolean }> {
    const r = await this.send('openDb', { dbName }) as { dbName: string; opfsAvailable: boolean };
    this.currentDb = dbName;
    return r;
  }

  async closeDatabase(): Promise<void> {
    await this.send('closeDb');
    this.currentDb = null;
  }

  async exec(sql: string, params?: unknown[]): Promise<void> {
    await this.send('exec', { sql, params });
  }

  async query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
    return this.send('query', { sql, params }) as Promise<Record<string, unknown>[]>;
  }

  async getTables(): Promise<string[]> {
    return this.send('tables') as Promise<string[]>;
  }

  async getStructure(tableName: string): Promise<ColInfo[]> {
    return this.send('structure', { sql: tableName }) as Promise<ColInfo[]>;
  }

  async getRowCount(tableName: string, filter?: string): Promise<number> {
    return this.send('rowCount', { sql: tableName, params: filter ? [filter] : [] }) as Promise<number>;
  }

  async tableExists(name: string): Promise<boolean> {
    const tables = await this.getTables();
    return tables.map(t => t.toLowerCase()).includes(name.toLowerCase());
  }
}
