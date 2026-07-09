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
  listDatabases(): Promise<string[]>;
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

// Metadata for the column types SQLite's own affinity can't distinguish (TIME vs
// DATE vs CHAR are all TEXT; LOGICAL vs INT are both INTEGER; NUM(p,s) loses its
// precision/scale). qualifier carries CHAR(n) length / TIME(n) granularity /
// NUM(p,s) precision; scale carries the NUM(p,s) scale.
export type ColumnTypeInfo = import('./cellValidation').ColumnMeta;

// Scoped by database: two databases can hold same-named tables with different types.
export interface IColumnMetaStore {
  setColumnType(dbName: string, tableName: string, colName: string, baseType: string, qualifier: number | null, scale: number | null): void;
  getColumnType(dbName: string, tableName: string, colName: string): ColumnTypeInfo | null;
  listColumnTypes(dbName: string, tableName: string): Record<string, ColumnTypeInfo>;
  renameColumn(dbName: string, tableName: string, oldName: string, newName: string): void;
  dropColumn(dbName: string, tableName: string, colName: string): void;
  dropTable(dbName: string, tableName: string): void;
}

export interface ReportColumn {
  field: string;
  heading: string;
  width: number;
  total?: boolean;
}

export interface ReportDef {
  title: string;
  pageWidth?: number;
  columns: ReportColumn[];
  groupBy?: string;
  pageHeader?: string;
  pageFooter?: string;
}

export interface WorkArea {
  alias: string;
  db: string | null;
  table: string | null;
  filter: string | null;
  rowPtr: number;
  cachedRecCount: number;
  activeIndex: { tag: string; expression: string } | null;
  _found: boolean;
  opfsAvailable: boolean;
  relation: {
    expression: string;
    intoAlias: string;
  } | null;
}

export interface CatalogTable { name: string; count: number; }
export interface CatalogIndex { tag: string; expression: string; active: boolean; }
export interface CatalogReport { name: string; content: string; }

/**
 * "Fire-and-forget" client side-effects an executing command emits immediately
 * (rather than returning as an ExecResult action), so they survive being run
 * inside a program's control-flow block (DO WHILE / DO CASE / IF). Each variant
 * mirrors a ServerMessage shape so the Session can forward it verbatim.
 */
export type ClientSideEffect =
  | { type: 'csv-download'; filename: string; content: string }
  | { type: 'csv-upload-open'; table: string; filename: string }
  | { type: 'report-preview'; html: string };

export interface Catalog {
  databases: string[];
  tables: CatalogTable[];
  columns: ColInfo[];
  indexes: CatalogIndex[];
  reports: CatalogReport[];
  programs: string[];
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
  | { type: 'abort-suspended' }
  | { type: 'save-program'; name: string; content: string }
  | { type: 'catalog-request' }
  | { type: 'csv-upload'; filename: string; content: string };

// Server → Client
export type ServerMessage =
  | { type: 'output'; lines: OutputLine[] }
  | { type: 'status'; db: string | null; table: string | null; record: number; total: number }
  | { type: 'input-request'; prompt: string }
  | { type: 'grid-open'; table: string; filter: string | null; columns: ColInfo[]; columnTypes: Record<string, ColumnTypeInfo>; rows: Record<string, unknown>[] }
  | { type: 'modstruct-open'; table: string; columns: ColInfo[] }
  | { type: 'form-open'; fields: FormField[] }
  | { type: 'program-open'; name: string; content: string }
  | { type: 'view-terminal' }
  | { type: 'clear' }
  | { type: 'report-preview'; html: string }
  | { type: 'error'; message: string }
  | { type: 'catalog'; catalog: Catalog }
  | { type: 'data-changed'; db: string; table: string }
  | { type: 'csv-download'; filename: string; content: string }
  | { type: 'csv-upload-open'; table: string; filename: string };
