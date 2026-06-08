// Shared between server (Session, ServerDatabaseBridge) and browser (WsClient, Terminal)

export interface ColInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

export interface FormField {
  row: number;
  col: number;
  label: string;
  varName: string;
}

export interface OutputLine {
  text: string;
  cls?: string;
}

// The interface Executor accepts — implemented by both DatabaseBridge (old) and ServerDatabaseBridge (new)
export interface IDatabaseBridge {
  opfsAvailable: boolean;
  currentDb: string | null;
  openDatabase(dbName: string): Promise<{ dbName: string; opfsAvailable: boolean }>;
  closeDatabase(): Promise<void>;
  exec(sql: string, params?: unknown[]): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  getTables(): Promise<string[]>;
  getStructure(tableName: string): Promise<ColInfo[]>;
  getRowCount(tableName: string, filter?: string): Promise<number>;
  tableExists(name: string): Promise<boolean>;
}

export interface IndexDef {
  tag: string;
  expression: string;
}

export interface IIndexStore {
  saveIndex(tableName: string, tag: string, expression: string): void;
  listIndexes(tableName: string): IndexDef[];
  getActive(tableName: string): IndexDef | null;
  setActive(tableName: string, tag: string): void;
  clearActive(tableName: string): void;
  dropTable(tableName: string): void;
}

// ── WebSocket message types ────────────────────────────────────────────────

// Client → Server
export type ClientMessage =
  | { type: 'command'; text: string }
  | { type: 'input-response'; value: string }
  | { type: 'form-submit'; values: Record<string, string> }
  | { type: 'grid-edit'; rowid: number; col: string; value: string }
  | { type: 'grid-delete'; rowid: number }
  | { type: 'grid-new-row' }
  | { type: 'grid-refresh' }
  | { type: 'grid-exit' }
  | { type: 'save-program'; name: string; content: string };

// Server → Client
export type ServerMessage =
  | { type: 'output'; lines: OutputLine[] }
  | { type: 'status'; db: string | null; table: string | null; record: number; total: number }
  | { type: 'input-request'; prompt: string }
  | { type: 'grid-open'; table: string; filter: string | null; columns: ColInfo[]; rows: Record<string, unknown>[] }
  | { type: 'form-open'; fields: FormField[] }
  | { type: 'program-open'; name: string; content: string }
  | { type: 'view-terminal' }
  | { type: 'clear' }
  | { type: 'error'; message: string };
