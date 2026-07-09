import { IDatabaseBridge, IIndexStore, IColumnMetaStore, ColumnTypeInfo, OutputLine, FormField, WorkArea, ClientSideEffect } from '../shared/types';
import { ASTNode, Expr, ColDef, Parser } from './Parser';
import { Lexer } from './Lexer';
import { callStateless } from './Builtins';
import { IndexCommands, IndexCommandsHost } from './IndexCommands';
import { ReportCommands } from './ReportCommands';
import { toCSV, parseCSV, MAX_EXPORT_ROWS, MAX_IMPORT_BYTES, MAX_IMPORT_SKIPS } from '../shared/csv';
import { validateCellValue } from '../shared/cellValidation';

export type { OutputLine, FormField } from '../shared/types';

export interface ExecResult {
  output: OutputLine[];
  action?: 'BROWSE' | 'QUIT' | 'FORM_READY' | 'FORM_SUBMIT' | 'DO_PRG' | 'EDIT_PRG' | 'LIST_PROGRAMS' | 'MODIFY_STRUCTURE';
  formFields?: FormField[];
  prgName?: string;
  prgContent?: string;
  remainingNodes?: ASTNode[];
  continuation?: () => Promise<ExecResult>;
}

export interface State {
  db: string | null;
  table: string | null;
  filter: string | null;
  vars: Map<string, unknown>;
  rowPtr: number;
  pendingForm: FormField[];
  opfsAvailable: boolean;
  activeIndex: { tag: string; expression: string } | null;
  _found: boolean;
  cachedRecCount: number;
}

type DbType = 'TEXT' | 'REAL' | 'INTEGER' | 'BLOB';

function mapType(t: string): DbType {
  switch (t.toUpperCase()) {
    case 'CHAR': case 'CHARACTER': case 'VARCHAR': case 'STRING': case 'MEMO': case 'DATE': case 'TIME': return 'TEXT';
    case 'NUM': case 'NUMERIC': case 'FLOAT': case 'DOUBLE': case 'DECIMAL': return 'REAL';
    case 'INT': case 'INTEGER': case 'LOGICAL': case 'BOOLEAN': return 'INTEGER';
    default: return 'TEXT';
  }
}

/** Render a declared column type the way it was written: NUM(8,2), TIME(15), DATE. */
function declaredTypeText(info: ColumnTypeInfo | undefined): string | null {
  if (!info) return null;
  if (info.qualifier === null) return info.baseType;
  if (info.scale !== null && info.scale !== undefined) return `${info.baseType}(${info.qualifier},${info.scale})`;
  return `${info.baseType}(${info.qualifier})`;
}

function makeArea(alias: string): WorkArea {
  return {
    alias,
    db: null, table: null, filter: null,
    rowPtr: 1, cachedRecCount: 0,
    activeIndex: null, _found: false,
    opfsAvailable: false, relation: null,
  };
}

export class Executor implements IndexCommandsHost {
  public areas: Map<string, WorkArea>;
  public activeAlias: string;
  public vars: Map<string, unknown>;
  public pendingForm: FormField[];
  private rowCache: Map<string, Record<string, unknown>> = new Map();
  private indexCmds: IndexCommands;
  private reportCmds: ReportCommands;
  private programDepth = 0;

  /** Sink for fire-and-forget client side-effects (CSV download, report preview,
      CSV upload picker). Set by the Session so these survive control-flow blocks. */
  public onSideEffect: ((e: ClientSideEffect) => void) | null = null;

  constructor(
    public db: IDatabaseBridge,
    public indexStore: IIndexStore | null = null,
    public columnMetaStore: IColumnMetaStore | null = null,
  ) {
    this.areas = new Map([['1', makeArea('1')]]);
    this.activeAlias = '1';
    this.vars = new Map();
    this.pendingForm = [];
    this.indexCmds = new IndexCommands(this);
    this.reportCmds = new ReportCommands(this);
  }

  get area(): WorkArea {
    return this.areas.get(this.activeAlias)!;
  }

  /** Database key for column metadata — same-named tables in different DBs must not collide. */
  private get metaDb(): string {
    return this.area.db ?? '';
  }

  /** Backwards-compat shim — Session.ts and legacy tests still read executor.state */
  get state(): State {
    const a = this.area;
    return {
      db: a.db, table: a.table, filter: a.filter,
      rowPtr: a.rowPtr, cachedRecCount: a.cachedRecCount,
      activeIndex: a.activeIndex, _found: a._found,
      opfsAvailable: a.opfsAvailable,
      vars: this.vars,
      pendingForm: this.pendingForm,
    };
  }

  async run(nodes: ASTNode[]): Promise<ExecResult> {
    const out: OutputLine[] = [];
    let action: ExecResult['action'];
    let formFields: FormField[] | undefined;
    let continuation: (() => Promise<ExecResult>) | undefined;

    for (let i = 0; i < nodes.length; i++) {
      const r = await this.exec(nodes[i]);
      out.push(...r.output);
      if (r.action) {
        action = r.action;
        formFields = r.formFields;
        if (action === 'QUIT') break;
        if (action === 'FORM_READY' || action === 'BROWSE') {
          const remaining = nodes.slice(i + 1);
          const innerCont = r.continuation;
          continuation = async () => {
            if (innerCont) {
              const inner = await innerCont();
              if (inner.action === 'FORM_READY' || inner.action === 'BROWSE') {
                const outerRemaining = remaining;
                return {
                  ...inner,
                  continuation: async () => {
                    const afterInner = inner.continuation ? await inner.continuation() : { output: inner.output };
                    if (afterInner.action === 'FORM_READY' || afterInner.action === 'BROWSE') return afterInner;
                    const tail = await this.run(outerRemaining);
                    return { output: [...afterInner.output, ...tail.output], action: tail.action, formFields: tail.formFields, continuation: tail.continuation };
                  },
                };
              }
              if (inner.action === 'QUIT') return inner;
            }
            return this.run(remaining);
          };
          break;
        }
        if (r.continuation) continuation = r.continuation;
      }
    }
    return { output: out, action, formFields, continuation };
  }

  async exec(node: ASTNode): Promise<ExecResult> {
    const out: OutputLine[] = [];
    try {
      switch (node.type) {
        case 'USE':         return this.doUse(node.name, node.alias);
        case 'USE_DB':      return this.doUseDb(node.name);
        case 'SELECT':      return this.doSelect(node.alias);
        case 'CLOSE':       return this.doClose();
        case 'CLOSE_ALL':   return this.doCloseAll();
        case 'SET_RELATION':return this.doSetRelation(node.expression, node.intoAlias);
        case 'LIST':        return this.doList();
        case 'LIST_STRUCT': return this.doListStruct();
        case 'LIST_TABLES':     return this.doListTables();
        case 'LIST_DATABASES':  return this.doListDatabases();
        case 'LIST_AREAS':  return this.doListAreas();
        case 'LIST_COLS':   return this.doListCols(node.cols);
        case 'BROWSE':      return { output: [], action: 'BROWSE' };
        case 'PRINT':       return this.doPrint(node.exprs);
        case 'AGGREGATE':   return this.doAggregate(node.op, node.field, node.forCond, node.toVar);
        case 'COPY_TO':     return this.doCopyTo(node.file);
        case 'APPEND_FROM': return this.doAppendFrom(node.file);
        case 'CLEAR':       return { output: [{ text: '', cls: 'clear' }] };
        case 'QUIT':        return { output: [], action: 'QUIT' };
        case 'HELP':        return this.doHelp();
        case 'SET_FILTER':  return this.doSetFilter(node.expr);
        case 'REPLACE_ALL': return this.doReplaceAll(node.fields, node.scope);
        case 'APPEND':      return this.doAppend();
        case 'DELETE':      return this.doDelete(node.scope);
        case 'RECALL':      return this.doRecall(node.scope);
        case 'PACK':        return this.doPack();
        case 'GO':          return this.doGo(node.target);
        case 'SKIP':        return this.doSkip(node.n);
        case 'AT_SAY':      return this.doAtSay(node.row, node.col, node.text);
        case 'AT_SAY_GET':  return this.doAtSayGet(node.row, node.col, node.text, node.varName);
        case 'READ':        return this.doRead();
        case 'STORE':       return this.doStore(node.value, node.varName);
        case 'INPUT':       return this.doInput(node.prompt, node.varName);
        case 'IF':          return this.doIf(node.cond, node.body, node.elseBody);
        case 'DO_WHILE':    return this.doWhile(node.cond, node.body);
        case 'CREATE_TABLE':return this.doCreateTable(node.name, node.cols);
        case 'DROP_TABLE':  return this.doDropTable(node.name);
        case 'ALTER_TABLE': return this.doAlterTable(node);
        case 'MODIFY_STRUCTURE': return this.doModifyStructure();
        case 'DO_PRG':      return { output: [], action: 'DO_PRG', prgName: node.name };
        case 'LIST_PROGRAMS': return { output: [], action: 'LIST_PROGRAMS' };
        case 'EDIT_PRG':    return { output: [], action: 'EDIT_PRG', prgName: node.name };
        case 'INDEX_ON':    return this.indexCmds.doIndexOn(node.expression, node.tag);
        case 'SET_INDEX':   return this.indexCmds.doSetIndex(node.tag);
        case 'REINDEX':     return this.indexCmds.doReindex();
        case 'LIST_INDEXES':return this.indexCmds.doListIndexes();
        case 'SORT':        return this.doSort(node.field, node.descending, node.target);
        case 'JOIN':        return this.doJoin(node.withAlias, node.target, node.forCond, node.fields);
        case 'SEEK':        return this.indexCmds.doSeek(node.value);
        case 'FIND':        return this.indexCmds.doFind(node.value);
        case 'DO_CASE':       return this.doCase(node.cases, node.otherwise);
        case 'CREATE_REPORT': return this.reportCmds.doCreateReport(node.name);
        case 'MODIFY_REPORT': return this.reportCmds.doModifyReport(node.name);
        case 'REPORT_FORM':   return this.reportCmds.doReportForm(node.name);
        case 'LIST_REPORTS':  return this.reportCmds.doListReports();
        case 'DELETE_REPORT': return this.reportCmds.doDeleteReport(node.name);
        case 'UNKNOWN':     return { output: [{ text: `Unknown command: ${node.raw}`, cls: 'warn' }] };
      }
    } catch (e: unknown) {
      out.push({ text: `** Error: ${e instanceof Error ? e.message : String(e)}`, cls: 'error' });
    }
    return { output: out };
  }

  private async doUse(name: string, alias: string | null): Promise<ExecResult> {
    const dbName = this.area.db ?? 'webbaseiii';
    if (!this.area.db) {
      const r = await this.db.openDatabase(dbName);
      this.area.db = dbName;
      this.area.opfsAvailable = r.opfsAvailable;
    }
    if (alias) {
      // Rename the area slot
      this.areas.delete(this.activeAlias);
      this.area.alias = alias;
      this.areas.set(alias, this.area);
      this.activeAlias = alias;
    }
    this.area.table = name;
    this.area.filter = null;
    this.area.rowPtr = 1;
    this.area.activeIndex = this.indexStore?.getActive(name) ?? null;
    const exists = await this.db.tableExists(name);
    const storage = this.area.opfsAvailable ? 'OPFS (persistent)' : 'server-side persistent';
    const lines: OutputLine[] = [
      { text: `Database : ${dbName}  [${storage}]`, cls: 'info' },
    ];
    if (exists) {
      const cnt = await this.db.getRowCount(name);
      this.area.cachedRecCount = cnt;
      lines.push({ text: `Table    : ${name}  (${cnt} records)`, cls: 'ok' });
    } else {
      lines.push({ text: `Table    : ${name}  (table not found — use CREATE TABLE to create it)`, cls: 'warn' });
    }
    if (this.area.activeIndex) {
      lines.push({ text: `Index    : ${this.area.activeIndex.tag}  (${this.area.activeIndex.expression})`, cls: 'info' });
    }
    return { output: lines };
  }

  private async doUseDb(name: string): Promise<ExecResult> {
    await this.db.openDatabase(name);
    this.area.db = name;
    this.area.table = null;
    this.area.opfsAvailable = this.db.opfsAvailable;
    const tables = await this.db.getTables();
    const storage = this.area.opfsAvailable ? 'OPFS (persistent)' : 'server-side persistent';
    return { output: [
      { text: `Opened database: ${name}  [${storage}]`, cls: 'ok' },
      { text: `Tables: ${tables.length ? tables.join(', ') : '(none)'}`, cls: 'info' },
    ]};
  }

  private doSelect(alias: string): ExecResult {
    if (!this.areas.has(alias)) {
      this.areas.set(alias, makeArea(alias));
    }
    this.activeAlias = alias;
    return { output: [{ text: `Work area: ${alias}`, cls: 'info' }] };
  }

  private doClose(): ExecResult {
    const a = this.area;
    a.table = null; a.filter = null; a.rowPtr = 1;
    a.activeIndex = null; a.relation = null; a.cachedRecCount = 0;
    return { output: [{ text: 'Work area closed', cls: 'ok' }] };
  }

  private doCloseAll(): ExecResult {
    this.areas.clear();
    this.areas.set('1', makeArea('1'));
    this.activeAlias = '1';
    return { output: [{ text: 'All work areas closed', cls: 'ok' }] };
  }

  private doSetRelation(expression: string | null, intoAlias: string | null): ExecResult {
    if (expression === null) {
      this.area.relation = null;
      return { output: [{ text: 'Relation cleared', cls: 'ok' }] };
    }
    if (!intoAlias) return { output: [{ text: '** SET RELATION TO requires INTO <alias>', cls: 'error' }] };
    const target = this.areas.get(intoAlias);
    if (!target?.table) {
      return { output: [{ text: `** Work area '${intoAlias}' has no open table`, cls: 'error' }] };
    }
    if (!target.activeIndex) {
      return { output: [{ text: `** Work area '${intoAlias}' has no active index — use SET INDEX TO first`, cls: 'error' }] };
    }
    this.area.relation = { expression, intoAlias };
    return { output: [{ text: `Relation set: ${expression} → ${intoAlias}`, cls: 'ok' }] };
  }

  private doListAreas(): ExecResult {
    const out: OutputLine[] = [
      { text: `${'Alias'.padEnd(15)}  ${'Table'.padEnd(20)}  ${'Ptr'.padEnd(6)}  ${'Index'.padEnd(15)}  Relation`, cls: 'hdr' },
      { text: '─'.repeat(80), cls: 'sep' },
    ];
    for (const [alias, a] of this.areas) {
      const active = alias === this.activeAlias ? '*' : ' ';
      const rel = a.relation ? `${a.relation.expression} → ${a.relation.intoAlias}` : '';
      out.push({ text: `${active}${alias.padEnd(14)}  ${(a.table ?? '').padEnd(20)}  ${String(a.rowPtr).padEnd(6)}  ${(a.activeIndex?.tag ?? '').padEnd(15)}  ${rel}` });
    }
    return { output: out };
  }

  private async doListCols(cols: string[]): Promise<ExecResult> {
    this.requireTable();
    await this.refreshRecCount();
    await this.primeRowCache();
    const rows = await this.getOrderedRows(500);
    if (!rows.length) return { output: [{ text: '(No records)', cls: 'info' }] };

    const widths = cols.map(c => c.length);
    for (const row of rows) {
      for (let i = 0; i < cols.length; i++) {
        const col = cols[i];
        const val = col.includes('.') ? '' : String(row[col] ?? row[col.toUpperCase()] ?? '');
        widths[i] = Math.max(widths[i], val.length);
      }
    }
    const out: OutputLine[] = [];
    out.push({ text: cols.map((c, i) => c.padEnd(widths[i])).join('  '), cls: 'hdr' });
    out.push({ text: cols.map((_, i) => '-'.repeat(widths[i])).join('  '), cls: 'sep' });
    for (const row of rows) {
      // Sync alias.field via rowCache — cache the active-area row for this iteration
      this.rowCache.set(this.activeAlias, row as Record<string, unknown>);
      out.push({ text: cols.map((c, i) => {
        let val: string;
        if (c.includes('.')) {
          const dot = c.indexOf('.');
          const alias = c.slice(0, dot);
          const field = c.slice(dot + 1);
          const cachedRow = this.rowCache.get(alias);
          val = cachedRow ? String(cachedRow[field] ?? cachedRow[field.toUpperCase()] ?? '') : '';
        } else {
          val = String(row[c] ?? row[c.toUpperCase()] ?? '');
        }
        return val.padEnd(widths[i]);
      }).join('  ') });
    }
    out.push({ text: `${rows.length} record(s)`, cls: 'info' });
    return { output: out };
  }

  private async doList(): Promise<ExecResult> {
    this.requireTable();
    await this.refreshRecCount();
    const rows = await this.getOrderedRows(500);
    if (!rows.length) return { output: [{ text: '(No records)', cls: 'info' }] };

    const cols = Object.keys(rows[0]);
    const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)));
    const out: OutputLine[] = [];
    out.push({ text: cols.map((c, i) => c.padEnd(widths[i])).join('  '), cls: 'hdr' });
    out.push({ text: cols.map((_, i) => '-'.repeat(widths[i])).join('  '), cls: 'sep' });
    rows.forEach(r => {
      out.push({ text: cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  ') });
    });
    out.push({ text: `${rows.length} record(s)`, cls: 'info' });
    return { output: out };
  }

  private async doListStruct(): Promise<ExecResult> {
    this.requireTable();
    const cols = await this.db.getStructure(this.area.table!);
    const meta = this.columnMetaStore?.listColumnTypes(this.metaDb, this.area.table!) ?? {};
    const out: OutputLine[] = [
      { text: `Structure of table: ${this.area.table}`, cls: 'hdr' },
      { text: `${'#'.padEnd(4)}  ${'Field'.padEnd(20)}  ${'Type'.padEnd(10)}  ${'Null'.padEnd(5)}  ${'PK'}`, cls: 'hdr' },
      { text: `${'─'.repeat(55)}`, cls: 'sep' },
    ];
    cols.forEach(c => {
      const typeText = declaredTypeText(meta[c.name]) ?? c.type;
      out.push({ text: `${String(c.cid + 1).padEnd(4)}  ${c.name.padEnd(20)}  ${typeText.padEnd(10)}  ${c.notnull ? 'NO' : 'YES'.padEnd(5)}  ${c.pk ? 'PK' : ''}` });
    });
    return { output: out };
  }

  private async doListTables(): Promise<ExecResult> {
    if (!this.area.db) return { output: [{ text: 'No database open', cls: 'warn' }] };
    const tables = await this.db.getTables();
    if (!tables.length) return { output: [{ text: '(No tables)', cls: 'info' }] };
    const out: OutputLine[] = [{ text: 'Tables in database:', cls: 'hdr' }];
    for (const t of tables) {
      const n = await this.db.getRowCount(t);
      out.push({ text: `  ${t.padEnd(30)}  ${n} record(s)` });
    }
    return { output: out };
  }

  private async doListDatabases(): Promise<ExecResult> {
    const dbs = await this.db.listDatabases();
    if (!dbs.length) return { output: [{ text: '(No databases found)', cls: 'info' }] };
    const out: OutputLine[] = [{ text: 'Databases:', cls: 'hdr' }];
    const current = this.area.db?.toLowerCase();
    for (const name of dbs) {
      const marker = name.toLowerCase() === current ? ' *' : '';
      out.push({ text: `  ${name}${marker}` });
    }
    return { output: out };
  }

  private async doSetFilter(expr: string | null): Promise<ExecResult> {
    this.area.filter = expr;
    return { output: [{ text: expr ? `Filter set: ${expr}` : 'Filter cleared', cls: 'ok' }] };
  }

  private async doReplaceAll(fields: Array<{ field: string; value: Expr }>, scope: 'ALL' | 'CURRENT'): Promise<ExecResult> {
    this.requireTable();
    await this.refreshRecCount();
    const pairs = fields.map(f => ({ field: f.field, value: this.evalExpr(f.value) }));
    // TIME is the only declared type REPLACE enforces (#43). The grid validates
    // every declared type (#45) because it has no other guard; widening REPLACE
    // would change the semantics of existing programs.
    for (const p of pairs) {
      if (p.value === null || p.value === undefined) continue;
      const info = this.columnMetaStore?.getColumnType(this.metaDb, this.area.table!, p.field);
      if (info?.baseType === 'TIME') {
        const err = validateCellValue(p.field, String(p.value), info);
        if (err) throw new Error(err);
      }
    }
    const setClauses = pairs.map(p => `${q(p.field)} = ?`).join(', ');
    const params = pairs.map(p => typeof p.value === 'boolean' ? (p.value ? 1 : 0) : p.value);
    if (scope === 'ALL') {
      const where = this.area.filter ? ` WHERE ${this.area.filter}` : '';
      await this.db.exec(`UPDATE ${q(this.area.table!)} SET ${setClauses}${where}`, params);
    } else {
      const row = await this.fetchCurrentRow();
      if (!row) return { output: [{ text: 'REPLACE: no current record', cls: 'warn' }] };
      await this.db.exec(
        `UPDATE ${q(this.area.table!)} SET ${setClauses} WHERE rowid = ?`,
        [...params, row._rowid]
      );
      // If an indexed field changed, the record may have moved in index order —
      // keep the pointer on the record, like dBASE does.
      const rows = await this.getOrderedRowsWithIds(100000);
      const pos = rows.findIndex(r => r._rowid === row._rowid);
      if (pos !== -1) this.area.rowPtr = pos + 1;
    }
    const desc = pairs.map(p => `${p.field} = ${JSON.stringify(p.value)}`).join(', ');
    return { output: [{ text: `Replaced: ${desc} (${scope})`, cls: 'ok' }] };
  }

  private async doAppend(): Promise<ExecResult> {
    this.requireTable();
    const cols = await this.db.getStructure(this.area.table!);
    const fields = cols.filter(c => !c.pk || c.pk === 0);
    if (!fields.length) {
      await this.db.exec(`INSERT INTO ${q(this.area.table!)} DEFAULT VALUES`);
    } else {
      const names = fields.map(c => q(c.name)).join(', ');
      const vals = fields.map(() => 'NULL').join(', ');
      await this.db.exec(`INSERT INTO ${q(this.area.table!)} (${names}) VALUES (${vals})`);
    }
    const cnt = await this.db.getRowCount(this.area.table!);
    this.area.cachedRecCount = cnt;
    // Point at the new record — its position in the active index order, not just cnt
    const idRows = await this.db.query('SELECT last_insert_rowid() AS id');
    const newId = idRows[0]?.id;
    const rows = await this.getOrderedRowsWithIds(100000);
    const pos = rows.findIndex(r => r._rowid === newId);
    this.area.rowPtr = pos === -1 ? cnt : pos + 1;
    await this.resolveRelations();
    return { output: [{ text: `Record appended. Total: ${cnt}`, cls: 'ok' }] };
  }

  private async doDelete(scope: 'ALL' | 'CURRENT'): Promise<ExecResult> {
    this.requireTable();
    if (scope === 'ALL') {
      const where = this.area.filter ? ` WHERE ${this.area.filter}` : '';
      await this.db.exec(`DELETE FROM ${q(this.area.table!)}${where}`);
      return { output: [{ text: 'Records deleted', cls: 'ok' }] };
    }
    const row = await this.fetchCurrentRow();
    if (!row) return { output: [{ text: 'DELETE: no current record', cls: 'warn' }] };
    await this.db.exec(`DELETE FROM ${q(this.area.table!)} WHERE rowid = ?`, [row._rowid]);
    return { output: [{ text: 'Current record deleted', cls: 'ok' }] };
  }

  private async doRecall(_scope: 'ALL' | 'CURRENT'): Promise<ExecResult> {
    return { output: [{ text: 'RECALL not applicable in SQL mode (no soft-delete)', cls: 'warn' }] };
  }

  private async doPack(): Promise<ExecResult> {
    if (this.area.db) await this.db.exec('VACUUM');
    return { output: [{ text: 'VACUUM complete', cls: 'ok' }] };
  }

  private async doGo(target: 'TOP' | 'BOTTOM' | number): Promise<ExecResult> {
    this.requireTable();
    const cnt = await this.db.getRowCount(this.area.table!, this.area.filter ?? undefined);
    this.area.cachedRecCount = cnt;
    if (target === 'TOP')         this.area.rowPtr = 1;
    else if (target === 'BOTTOM') this.area.rowPtr = cnt;
    else                          this.area.rowPtr = Math.max(1, Math.min(cnt, target));
    const idxNote = this.area.activeIndex ? `  [index: ${this.area.activeIndex.tag}]` : '';
    await this.resolveRelations();
    return { output: [{ text: `Record pointer: ${this.area.rowPtr} / ${cnt}${idxNote}`, cls: 'info' }] };
  }

  private async doSkip(n: number): Promise<ExecResult> {
    this.requireTable();
    const cnt = await this.db.getRowCount(this.area.table!, this.area.filter ?? undefined);
    this.area.cachedRecCount = cnt;
    const newPtr = this.area.rowPtr + n;
    if (newPtr > cnt) this.area.rowPtr = cnt + 1;
    else if (newPtr < 1) this.area.rowPtr = 0;
    else this.area.rowPtr = newPtr;
    await this.resolveRelations();
    return { output: [{ text: `Record pointer: ${this.area.rowPtr} / ${cnt}`, cls: 'info' }] };
  }

  private async doAtSay(rowE: Expr, colE: Expr, textE: Expr): Promise<ExecResult> {
    await this.refreshRecCount(true);
    const row = Number(this.evalExpr(rowE));
    const col = Number(this.evalExpr(colE));
    const text = String(this.evalExpr(textE));
    this.pendingForm.push({ row, col, label: text, varName: '' });
    return { output: [] };
  }

  private async doAtSayGet(rowE: Expr, colE: Expr, textE: Expr, varName: string): Promise<ExecResult> {
    await this.refreshRecCount(true);
    const row = Number(this.evalExpr(rowE));
    const col = Number(this.evalExpr(colE));
    const text = String(this.evalExpr(textE));
    this.pendingForm.push({ row, col, label: text, varName });
    return { output: [] };
  }

  private doRead(): ExecResult {
    const fields = [...this.pendingForm];
    this.pendingForm = [];
    if (!fields.length) return { output: [{ text: 'READ: no GET fields defined', cls: 'warn' }] };
    return { output: [], action: 'FORM_READY', formFields: fields };
  }

  enterProgram()  { this.programDepth++; }
  exitProgram()   { if (this.programDepth > 0) this.programDepth--; }
  isInProgram()   { return this.programDepth > 0; }
  resetProgramDepth() { this.programDepth = 0; }

  private async doStore(valueExpr: Expr, varName: string): Promise<ExecResult> {
    await this.refreshRecCount();
    const v = this.evalExpr(valueExpr);
    this.vars.set(varName, v);
    if (this.programDepth > 0) return { output: [] };
    return { output: [{ text: `${varName} = ${fmtVal(v)}`, cls: 'info' }] };
  }

  // COPY TO <file>.csv — export the current table (filtered + index-ordered) as a
  // CSV the browser downloads. Honours SET FILTER; capped at MAX_EXPORT_ROWS.
  private async doCopyTo(file: string): Promise<ExecResult> {
    this.requireTable();
    const table = this.area.table!;
    const filename = file.toLowerCase().endsWith('.csv') ? file : `${file}.csv`;
    const count = await this.db.getRowCount(table, this.area.filter ?? undefined);
    if (count > MAX_EXPORT_ROWS) {
      throw new Error(`Too many rows to export (${count} > ${MAX_EXPORT_ROWS}). Narrow with SET FILTER TO ...`);
    }
    const cols = (await this.db.getStructure(table)).map(c => c.name);
    const rows = await this.getOrderedRows(MAX_EXPORT_ROWS);
    // Emit the download as a side-effect so it survives running inside a program
    // block (DO WHILE / DO CASE / IF), where the returned action would be lost.
    this.onSideEffect?.({ type: 'csv-download', filename, content: toCSV(cols, rows) });
    return { output: [{ text: `${rows.length} record(s) copied to ${filename}.`, cls: 'ok' }] };
  }

  // APPEND FROM <file>.csv — the import is a round-trip: open a file picker in the
  // browser; the actual insert runs when the resulting csv-upload calls importCSV().
  private async doAppendFrom(file: string): Promise<ExecResult> {
    this.requireTable();
    const filename = file.toLowerCase().endsWith('.csv') ? file : `${file}.csv`;
    this.onSideEffect?.({ type: 'csv-upload-open', table: this.area.table ?? '', filename });
    return { output: [] };
  }

  // Bulk-import CSV into the current table. Header-mapped (by name, case-insensitive),
  // lenient up to MAX_IMPORT_SKIPS bad rows; beyond that, roll back entirely.
  async importCSV(filename: string, content: string): Promise<ExecResult> {
    this.requireTable();
    const table = this.area.table!;

    if (Buffer.byteLength(content, 'utf8') > MAX_IMPORT_BYTES) {
      return { output: [{ text: `** ${filename} is too large; the limit is 5 MB.`, cls: 'error' }] };
    }

    const struct = await this.db.getStructure(table);
    const numeric = new Map(struct.map(c => [c.name.toLowerCase(), /INT|REAL|NUM|DEC|DOUB|FLOA/i.test(c.type)]));
    const colByLower = new Map(struct.map(c => [c.name.toLowerCase(), c.name]));

    const { header, rows } = parseCSV(content);
    const map = header.map(h => colByLower.get(h.trim().toLowerCase()) ?? null);

    type Skip = { line: number; reason: string };
    const skips: Skip[] = [];
    const good: { cols: string[]; vals: unknown[] }[] = [];

    rows.forEach((cells, idx) => {
      const fileLine = idx + 2; // header is line 1
      if (cells.length !== header.length) {
        skips.push({ line: fileLine, reason: `expected ${header.length} fields, got ${cells.length}` });
        return;
      }
      const cols: string[] = [];
      const vals: unknown[] = [];
      let bad: Skip | null = null;
      for (let c = 0; c < header.length; c++) {
        const col = map[c];
        if (!col) continue; // unknown header -> ignore this column
        const raw = cells[c];
        if (raw === '') { cols.push(col); vals.push(null); continue; }
        if (numeric.get(col.toLowerCase())) {
          const n = Number(raw);
          if (Number.isNaN(n)) { bad = { line: fileLine, reason: `column "${col}" — "${raw}" is not numeric` }; break; }
          cols.push(col); vals.push(n);
        } else {
          cols.push(col); vals.push(raw);
        }
      }
      if (bad) { skips.push(bad); return; }
      good.push({ cols, vals });
    });

    if (skips.length > MAX_IMPORT_SKIPS) {
      const detail = skips.slice(0, MAX_IMPORT_SKIPS).map(s => ({ text: `   line ${s.line}: ${s.reason}`, cls: 'warn' as const }));
      return { output: [
        { text: `** Import aborted: more than ${MAX_IMPORT_SKIPS} malformed rows (${skips.length} total). No records were appended.`, cls: 'error' },
        ...detail,
      ] };
    }

    await this.db.exec('BEGIN');
    try {
      for (const g of good) {
        if (g.cols.length === 0) continue;
        const names = g.cols.map(c => q(c)).join(', ');
        const placeholders = g.cols.map(() => '?').join(', ');
        await this.db.exec(`INSERT INTO ${q(table)} (${names}) VALUES (${placeholders})`, g.vals);
      }
      await this.db.exec('COMMIT');
    } catch (e) {
      await this.db.exec('ROLLBACK');
      throw e;
    }
    await this.refreshRecCount();

    const out: OutputLine[] = [{ text: `Appended ${good.length} record(s) from ${filename}.`, cls: 'ok' }];
    if (skips.length) {
      out.push({ text: `** Skipped ${skips.length} row(s):`, cls: 'warn' });
      for (const s of skips.slice(0, MAX_IMPORT_SKIPS)) out.push({ text: `   line ${s.line}: ${s.reason}`, cls: 'warn' });
    }
    return { output: out };
  }

  // dBASE SUM / AVERAGE — aggregate a numeric field over the current table,
  // honouring the active SET FILTER plus an optional FOR condition. SQLite does the
  // aggregation server-side. Result is printed right-justified like ?.
  private async doAggregate(op: 'SUM' | 'AVERAGE', field: string, forCond: string | null, toVar: string | null = null): Promise<ExecResult> {
    this.requireTable();
    const fn = op === 'SUM' ? 'SUM' : 'AVG';
    const conds = [this.area.filter, forCond].filter((c): c is string => !!c);
    const where = conds.length ? ` WHERE ${conds.map(c => `(${c})`).join(' AND ')}` : '';
    const rows = await this.db.query(
      `SELECT ${fn}(${q(field)}) AS v FROM ${q(this.area.table!)}${where}`
    );
    const v = Number(rows[0]?.v ?? 0);
    // dBASE `... TO <var>` assigns the result to a memory variable and prints
    // nothing; otherwise the value is printed right-justified like ?.
    if (toVar) {
      this.vars.set(toVar, v);
      return { output: [] };
    }
    return { output: [{ text: fmtPrint(v), cls: 'info' }] };
  }

  // dBASE ? / ?? — evaluate expression(s) and print the result. A bare ? prints a
  // blank line. Multiple comma-separated expressions are joined by a single space.
  // (?? "no leading newline" semantics aren't expressible in the line-based web
  // terminal, so ?? shares ?'s formatting.)
  private async doPrint(exprs: Expr[]): Promise<ExecResult> {
    await this.refreshRecCount();
    if (exprs.length === 0) return { output: [{ text: '', cls: 'info' }] };
    const text = exprs.map(e => fmtPrint(this.evalExpr(e))).join(' ');
    return { output: [{ text, cls: 'info' }] };
  }

  private doInput(prompt: string, varName: string): ExecResult {
    this.vars.set(varName, this.vars.get(varName) ?? '');
    const pending = [...this.pendingForm];
    this.pendingForm = [];
    const inputRow = pending.length ? Math.max(...pending.map(f => f.row)) + 2 : 10;
    const form: FormField[] = [...pending, { row: inputRow, col: 5, label: prompt || `Enter ${varName}:`, varName }];
    return { output: [], action: 'FORM_READY', formFields: form };
  }

  private async doIf(condE: Expr, body: ASTNode[], elseBody: ASTNode[]): Promise<ExecResult> {
    await this.refreshRecCount(true);
    const cond = this.evalExpr(condE);
    return this.run(cond ? body : elseBody);
  }

  private async doWhile(condE: Expr, body: ASTNode[], startIter = 0): Promise<ExecResult> {
    const out: OutputLine[] = [];
    let iters = startIter;
    while (true) {
      await this.refreshRecCount(true);
      if (!this.evalExpr(condE) || iters++ >= 10000) break;
      const r = await this.run(body);
      out.push(...r.output);
      if (r.action === 'QUIT') return { output: out, action: 'QUIT' };
      if (r.action === 'FORM_READY' || r.action === 'BROWSE') {
        return {
          output: out,
          action: r.action,
          formFields: r.formFields,
          continuation: () => this.resumeAndLoop(r.continuation, condE, body, iters),
        };
      }
    }
    if (iters >= 10000) out.push({ text: '** DO WHILE limit (10000) reached', cls: 'warn' });
    return { output: out };
  }

  private async resumeAndLoop(
    innerCont: (() => Promise<ExecResult>) | undefined,
    condE: Expr, body: ASTNode[], capturedIter: number,
  ): Promise<ExecResult> {
    if (innerCont) {
      const resume = await innerCont();
      if (resume.action === 'FORM_READY' || resume.action === 'BROWSE') {
        return {
          ...resume,
          continuation: () => this.resumeAndLoop(resume.continuation, condE, body, capturedIter),
        };
      }
      if (resume.action === 'QUIT') return resume;
    }
    return this.doWhile(condE, body, capturedIter);
  }

  private async doCreateTable(name: string, cols: ColDef[]): Promise<ExecResult> {
    if (!this.area.db) {
      await this.db.openDatabase('webbaseiii');
      this.area.db = 'webbaseiii';
      this.area.opfsAvailable = this.db.opfsAvailable;
    }
    const colsSql = cols.length
      ? cols.map(c => `${q(c.name)} ${mapType(c.colType)}`).join(', ')
      : '"id" INTEGER PRIMARY KEY AUTOINCREMENT';
    for (const c of cols) {
      if (c.colType.toUpperCase() === 'TIME' && c.size !== undefined && (!Number.isInteger(c.size) || c.size < 1 || c.size > 59)) {
        throw new Error(`CREATE TABLE: invalid TIME granularity qualifier TIME(${c.size}) — must be an integer between 1 and 59`);
      }
    }
    const sql = `CREATE TABLE IF NOT EXISTS ${q(name)} (${colsSql})`;
    await this.db.exec(sql);
    // Record the *declared* type of every column. SQLite only stores an affinity
    // (TEXT/REAL/INTEGER), which can't tell TIME from DATE from CHAR, LOGICAL from
    // INT, or recover a NUM(p,s) precision — the grid needs the declared type to
    // validate edits.
    for (const c of cols) {
      this.columnMetaStore?.setColumnType(
        this.metaDb, name, c.name, c.colType.toUpperCase(), c.size ?? null, c.scale ?? null,
      );
    }
    this.area.table = name;
    this.area.filter = null;
    this.area.rowPtr = 1;
    this.area.cachedRecCount = 0;
    this.area.activeIndex = null;
    return { output: [{ text: `Table created: ${name}`, cls: 'ok' }] };
  }

  private async doSort(field: string, descending: boolean, target: string): Promise<ExecResult> {
    const source = this.area.table;
    if (!source) {
      return { output: [{ text: 'SORT: no table in use', cls: 'error' }] };
    }
    // Validate the sort field against the table's columns (also guards the
    // column name we splice into the ORDER BY clause). SQLite column matching
    // is case-insensitive, so compare uppercased names.
    const cols = await this.db.getStructure(source);
    const col = cols.find(c => c.name.toUpperCase() === field.toUpperCase());
    if (!col) {
      return { output: [{ text: `SORT: no such field: ${field}`, cls: 'error' }] };
    }
    if (await this.db.tableExists(target)) {
      return { output: [{ text: `SORT: target table already exists: ${target}`, cls: 'error' }] };
    }
    // Thin alias: lean on SQLite's CREATE TABLE ... AS SELECT ... ORDER BY.
    // Honors the active filter; ignores any active index (SORT defines its own order).
    const where = this.area.filter ? ` WHERE ${this.area.filter}` : '';
    const dir = descending ? ' DESC' : '';
    await this.db.exec(
      `CREATE TABLE ${q(target)} AS SELECT * FROM ${q(source)}${where} ORDER BY ${q(col.name)}${dir}`
    );
    const count = await this.db.getRowCount(target);
    return { output: [{ text: `Sorted ${count} record(s) into ${target}.`, cls: 'ok' }] };
  }

  private async doJoin(
    withAlias: string,
    target: string,
    forCond: string,
    fields: string[] | null,
  ): Promise<ExecResult> {
    const activeArea = this.area;
    const activeTable = activeArea.table;
    if (!activeTable) {
      return { output: [{ text: 'JOIN: no table in use', cls: 'error' }] };
    }
    const withArea = this.areas.get(withAlias);
    if (!withArea || !withArea.table) {
      return { output: [{ text: `JOIN: work area '${withAlias}' has no open table`, cls: 'error' }] };
    }
    if (withArea.db !== activeArea.db) {
      return { output: [{ text: `JOIN: '${withAlias}' is in a different database — cross-database JOIN is not supported`, cls: 'error' }] };
    }
    if (await this.db.tableExists(target)) {
      return { output: [{ text: `JOIN: target table already exists: ${target}`, cls: 'error' }] };
    }
    if (fields && fields.length === 0) {
      return { output: [{ text: 'JOIN: FIELDS clause is empty — list at least one field or omit FIELDS', cls: 'error' }] };
    }

    const aQ = q(activeArea.alias);
    const bQ = q(withArea.alias);
    const warnings: OutputLine[] = [];

    // Build the SELECT projection.
    let projection: string;
    if (fields && fields.length) {
      projection = fields.map(f => {
        const dot = f.indexOf('.');
        if (dot !== -1) return `${q(f.slice(0, dot))}.${q(f.slice(dot + 1))}`;
        return q(f);
      }).join(', ');
    } else {
      const activeCols = await this.db.getStructure(activeTable);
      const withCols = await this.db.getStructure(withArea.table);
      const activeNames = new Set(activeCols.map(c => c.name.toUpperCase()));
      const parts = activeCols.map(c => `${aQ}.${q(c.name)}`);
      for (const c of withCols) {
        if (activeNames.has(c.name.toUpperCase())) {
          warnings.push({ text: `JOIN: dropped duplicate column '${c.name}' from ${withArea.alias} (active wins)`, cls: 'warn' });
          continue;
        }
        parts.push(`${bQ}.${q(c.name)}`);
      }
      projection = parts.join(', ');
    }

    const where = activeArea.filter ? ` WHERE (${activeArea.filter})` : '';
    const sql =
      `CREATE TABLE ${q(target)} AS SELECT ${projection} ` +
      `FROM ${q(activeTable)} AS ${aQ} ` +
      `JOIN ${q(withArea.table)} AS ${bQ} ON (${forCond})${where}`;
    try {
      await this.db.exec(sql);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { output: [{ text: `JOIN failed: ${msg}`, cls: 'error' }] };
    }

    const count = await this.db.getRowCount(target);
    return { output: [...warnings, { text: `Joined ${count} record(s) into ${target}.`, cls: 'ok' }] };
  }

  private async doDropTable(name: string): Promise<ExecResult> {
    await this.db.exec(`DROP TABLE IF EXISTS ${q(name)}`);
    this.indexStore?.dropTable(name);
    this.columnMetaStore?.dropTable(this.metaDb, name);
    if (this.area.table === name) {
      this.area.table = null;
      this.area.activeIndex = null;
    }
    return { output: [{ text: `Table dropped: ${name}`, cls: 'ok' }] };
  }

  private async doModifyStructure(): Promise<ExecResult> {
    if (!this.area.table) {
      return { output: [{ text: 'MODIFY STRUCTURE: no table in use', cls: 'error' }] };
    }
    return { output: [], action: 'MODIFY_STRUCTURE' };
  }

  private async doAlterTable(node: Extract<ASTNode, { type: 'ALTER_TABLE' }>): Promise<ExecResult> {
    const { name } = node;
    if (!(await this.db.tableExists(name))) {
      return { output: [{ text: `ALTER TABLE: no such table: ${name}`, cls: 'error' }] };
    }
    const cols = await this.db.getStructure(name);
    const has = (c: string) => cols.some(col => col.name.toUpperCase() === c.toUpperCase());

    if (node.op === 'ADD') {
      if (has(node.col)) return { output: [{ text: `ALTER TABLE: column already exists: ${node.col}`, cls: 'error' }] };
      await this.db.exec(`ALTER TABLE ${q(name)} ADD COLUMN ${q(node.col)} ${mapType(node.colType)}`);
      // ALTER TABLE drops any (n)/(p,s) qualifier — the parser skips it.
      this.columnMetaStore?.setColumnType(this.metaDb, name, node.col, node.colType.toUpperCase(), null, null);
      await this.refreshIfActive(name);
      return { output: [{ text: `Added column ${node.col} to ${name}.`, cls: 'ok' }] };
    }
    if (node.op === 'DROP') {
      if (!has(node.col)) return { output: [{ text: `ALTER TABLE: no such column: ${node.col}`, cls: 'error' }] };
      if (cols.length <= 1) return { output: [{ text: 'ALTER TABLE: cannot drop the only column', cls: 'error' }] };
      const dropped = await this.dropAllIndexes(name);
      await this.db.exec(`ALTER TABLE ${q(name)} DROP COLUMN ${q(node.col)}`);
      this.columnMetaStore?.dropColumn(this.metaDb, name, node.col);
      await this.refreshIfActive(name);
      return { output: [
        { text: `Dropped column ${node.col} from ${name}.`, cls: 'ok' },
        ...(dropped.length ? [{ text: `Dropped index(es) (rebuild with INDEX ON): ${dropped.join(', ')}`, cls: 'warn' }] : []),
      ] };
    }

    if (node.op === 'RENAME') {
      if (!has(node.col)) return { output: [{ text: `ALTER TABLE: no such column: ${node.col}`, cls: 'error' }] };
      if (has(node.newName)) return { output: [{ text: `ALTER TABLE: column already exists: ${node.newName}`, cls: 'error' }] };
      const dropped = await this.dropAllIndexes(name);
      await this.db.exec(`ALTER TABLE ${q(name)} RENAME COLUMN ${q(node.col)} TO ${q(node.newName)}`);
      this.columnMetaStore?.renameColumn(this.metaDb, name, node.col, node.newName);
      await this.refreshIfActive(name);
      return { output: [
        { text: `Renamed ${node.col} to ${node.newName} in ${name}.`, cls: 'ok' },
        ...(dropped.length ? [{ text: `Dropped index(es) (rebuild with INDEX ON): ${dropped.join(', ')}`, cls: 'warn' }] : []),
      ] };
    }

    if (node.op === 'ALTER') {
      if (!has(node.col)) return { output: [{ text: `ALTER TABLE: no such column: ${node.col}`, cls: 'error' }] };
      const dropped = await this.dropAllIndexes(name);
      const tmp = `__alttmp_${name}`;
      // Build the new schema: same columns, but the target column retyped.
      const newType = mapType(node.colType);
      const colDefs = cols.map(c =>
        c.name.toUpperCase() === node.col.toUpperCase()
          ? `${q(c.name)} ${newType}`
          : `${q(c.name)} ${c.type || 'TEXT'}`
      ).join(', ');
      const colList = cols.map(c =>
        c.name.toUpperCase() === node.col.toUpperCase()
          ? `CAST(${q(c.name)} AS ${newType}) AS ${q(c.name)}`
          : q(c.name)
      ).join(', ');
      await this.db.exec(`DROP TABLE IF EXISTS ${q(tmp)}`);
      await this.db.exec(`ALTER TABLE ${q(name)} RENAME TO ${q(tmp)}`);
      await this.db.exec(`CREATE TABLE ${q(name)} (${colDefs})`);
      await this.db.exec(`INSERT INTO ${q(name)} SELECT ${colList} FROM ${q(tmp)}`);
      await this.db.exec(`DROP TABLE ${q(tmp)}`);
      this.columnMetaStore?.setColumnType(this.metaDb, name, node.col, node.colType.toUpperCase(), null, null);
      await this.refreshIfActive(name);
      return { output: [
        { text: `Changed type of ${node.col} to ${node.colType} in ${name}.`, cls: 'ok' },
        ...(dropped.length ? [{ text: `Dropped index(es) (rebuild with INDEX ON): ${dropped.join(', ')}`, cls: 'warn' }] : []),
      ] };
    }

    return { output: [{ text: 'ALTER TABLE: operation not implemented', cls: 'error' }] };
  }

  // Refresh cached structure/record count if the altered table is the one in USE.
  private async refreshIfActive(name: string): Promise<void> {
    if (this.area.table === name) {
      this.area.cachedRecCount = await this.db.getRowCount(name, this.area.filter ?? undefined);
    }
  }

  // Drop every index on a table — both the SQLite index objects and the
  // IndexStore metadata. Returns the tags dropped (for a warning line).
  // Used by column ops that can invalidate an index expression.
  private async dropAllIndexes(table: string): Promise<string[]> {
    if (!this.indexStore) return [];
    const tags = this.indexStore.listIndexes(table).map(i => i.tag);
    for (const tag of tags) {
      const sqlName = `idx_${table}_${tag}`.replace(/"/g, '""');
      await this.db.exec(`DROP INDEX IF EXISTS "${sqlName}"`);
    }
    this.indexStore.dropTable(table);          // clears metadata + active marker
    if (this.area.table === table) this.area.activeIndex = null;
    return tags;
  }

  private doHelp(): ExecResult {
    return { output: [
      { text: 'WebBase-III — W3Script Command Reference', cls: 'hdr' },
      { text: '─'.repeat(50), cls: 'sep' },
      { text: 'USE <table>             — open/select a table' },
      { text: 'USE DATABASE <name>     — open a named database' },
      { text: 'COPY TO <file>.csv      — export current table (header CSV, modern, not dBASE SDF)' },
      { text: 'APPEND FROM <file>.csv  — import a header CSV into current table' },
      { text: 'SELECT <alias>          — activate or create work area' },
      { text: 'USE <table> ALIAS <n>   — open table with alias override' },
      { text: 'SET RELATION TO <expr> INTO <alias> — link work areas by key' },
      { text: 'SET RELATION TO         — clear relation' },
      { text: 'LIST AREAS              — show all open work areas' },
      { text: 'CLOSE                   — close active work area table' },
      { text: 'CLOSE ALL               — close all work areas' },
      { text: 'LIST                    — list records' },
      { text: 'LIST STRUCTURE          — show table schema' },
      { text: 'LIST TABLES             — list all tables' },
      { text: 'LIST DATABASES          — list all databases on disk' },
      { text: 'BROWSE                  — open spreadsheet grid' },
      { text: 'CLEAR                   — clear terminal' },
      { text: 'CREATE TABLE <n> (...)  — create a table' },
      { text: 'DROP TABLE <name>       — delete a table' },
      { text: 'APPEND RECORD           — add blank row' },
      { text: 'DELETE                  — delete current row' },
      { text: 'DELETE ALL              — delete all rows' },
      { text: 'REPLACE ALL <f> WITH v  — update field' },
      { text: 'SET FILTER TO <expr>    — set WHERE filter' },
      { text: 'SET FILTER TO           — clear filter' },
      { text: 'INDEX ON <expr> TO <tag> — create index on expression' },
      { text: 'SET INDEX TO <tag>       — activate a named index' },
      { text: 'SET INDEX TO             — clear active index' },
      { text: 'LIST INDEXES             — list indexes for current table' },
      { text: 'REINDEX                  — rebuild SQLite indexes' },
      { text: 'SEEK <value>             — position to first match in active index' },
      { text: 'FIND <string>            — same as SEEK (legacy string form)' },
      { text: 'SORT ON <field>[/D] TO <newtable> — sorted copy of the table' },
      { text: 'JOIN WITH <a> TO <file> FOR <cond> [FIELDS <list>] — materialize a combined table' },
      { text: 'CREATE REPORT <name>    — create a new report definition (opens editor)' },
      { text: 'MODIFY REPORT <name>    — edit an existing report definition' },
      { text: 'REPORT FORM <name>      — run report: ASCII + HTML preview' },
      { text: 'LIST REPORTS            — list all saved reports' },
      { text: 'DELETE REPORT <name>    — delete a report definition' },
      { text: 'STORE <val> TO <var>    — assign variable' },
      { text: '@ r,c SAY "text" GET v  — form field' },
      { text: 'READ                    — show form, collect input' },
      { text: 'IF <cond> … ENDIF       — conditional block' },
      { text: 'DO WHILE <cond> … ENDDO — loop' },
      { text: 'DO CASE … CASE … ENDCASE  — multi-branch conditional' },
      { text: 'EOF() BOF() FOUND()       — record position / seek state functions' },
      { text: 'RECNO() RECCOUNT()        — record number / count functions' },
      { text: 'UPPER() LOWER() TRIM()    — string functions' },
      { text: 'SUBSTR(s,n,l) LEN() AT()  — string extraction functions' },
      { text: 'STR(n,l,d) VAL() INT()    — type conversion functions' },
      { text: 'DATE() CTOD() DTOC()      — date functions' },
      { text: 'DO <name>               — run a saved program' },
      { text: 'EDIT <name>             — create/edit a program' },
      { text: 'LIST PROGRAMS           — list saved programs' },
      { text: '' },
      { text: 'Demos / examples:' },
      { text: 'DO crm        — usable CRM example app (EDIT crm to customize)' },
      { text: 'DO inventory  — usable inventory example app (EDIT inventory to customize)' },
      { text: '' },
      { text: 'QUIT                    — exit' },
    ]};
  }

  // ── Expression evaluator ─────────────────────────────────────────────────

  evalExpr(e: Expr): unknown {
    switch (e.k) {
      case 'lit': return e.v;
      case 'var': {
        const dot = e.name.indexOf('.');
        if (dot !== -1) {
          const alias = e.name.slice(0, dot);
          const field = e.name.slice(dot + 1);
          const cachedRow = this.rowCache.get(alias);
          if (cachedRow) return cachedRow[field] ?? cachedRow[field.toUpperCase()] ?? null;
          const targetArea = this.areas.get(alias);
          if (!targetArea) throw new Error(`Unknown work area: '${alias}'`);
          if (targetArea.rowPtr === 0 || !targetArea.table) return null;
          return null;
        }
        return this.vars.get(e.name) ?? e.name;
      }
      case 'not': return !this.evalExpr(e.e);
      case 'bin': {
        const l = this.evalExpr(e.l);
        const r = this.evalExpr(e.r);
        switch (e.op) {
          case '+':  return typeof l === 'number' && typeof r === 'number' ? l + r : String(l) + String(r);
          case '-':  return Number(l) - Number(r);
          case '*':  return Number(l) * Number(r);
          case '/':  return Number(r) !== 0 ? Number(l) / Number(r) : 0;
          case '==': case '=': return String(l).toLowerCase() === String(r).toLowerCase();
          case '!=': return String(l).toLowerCase() !== String(r).toLowerCase();
          case '<':  return Number(l) < Number(r);
          case '>':  return Number(l) > Number(r);
          case '<=': return Number(l) <= Number(r);
          case '>=': return Number(l) >= Number(r);
          case 'AND': return Boolean(l) && Boolean(r);
          case 'OR':  return Boolean(l) || Boolean(r);
        }
        return null;
      }
      case 'call': {
        const args = e.args.map(a => this.evalExpr(a));
        return this.callBuiltin(e.fn, args);
      }
    }
  }

  private callBuiltin(fn: string, args: unknown[]): unknown {
    switch (fn) {
      case 'EOF':      return this.area.table ? this.area.rowPtr > this.area.cachedRecCount : true;
      case 'BOF':      return this.area.table ? this.area.rowPtr < 1 : false;
      case 'FOUND':    return this.area._found;
      case 'RECNO':    return this.area.rowPtr;
      case 'RECCOUNT': return this.area.cachedRecCount;
    }
    return callStateless(fn, args);
  }

  private async refreshRecCount(loadFields = false): Promise<void> {
    // Keep alias.field lookups (rowCache) in sync before expressions are evaluated
    await this.primeRowCache();
    if (this.area.table) {
      const tableOk = await this.db.tableExists(this.area.table);
      if (!tableOk) { this.area.cachedRecCount = 0; return; }
      this.area.cachedRecCount = await this.db.getRowCount(this.area.table, this.area.filter ?? undefined);
      if (loadFields && this.area.rowPtr >= 1) {
        const row = await this.fetchCurrentRow();
        if (row) {
          for (const [k, v] of Object.entries(row)) {
            if (k === '_rowid') continue;
            this.vars.set(k.toUpperCase(), v);
          }
        }
      }
    } else {
      this.area.cachedRecCount = 0;
    }
  }

  private async doCase(
    cases: Array<{ cond: Expr; body: ASTNode[] }>,
    otherwise: ASTNode[]
  ): Promise<ExecResult> {
    await this.refreshRecCount(true);
    for (const { cond, body } of cases) {
      if (this.evalExpr(cond)) {
        return this.run(body);
      }
    }
    if (otherwise.length) {
      return this.run(otherwise);
    }
    return { output: [] };
  }

  setVar(name: string, value: unknown) { this.vars.set(name, value); }

  async getOrderedRows(limit = 500): Promise<Record<string, unknown>[]> {
    this.requireTable();
    const table = this.area.table!;
    const filter = this.area.filter;
    const where = filter ? ` WHERE ${filter}` : '';
    const idx = this.area.activeIndex;

    if (!idx) {
      return this.db.query(`SELECT * FROM ${q(table)}${where} ORDER BY rowid LIMIT ${limit}`);
    }

    const expr = idx.expression.trim();
    const isSimpleField = /^[A-Z_][A-Z0-9_]*$/i.test(expr);

    if (isSimpleField) {
      return this.db.query(
        `SELECT * FROM ${q(table)}${where} ORDER BY ${q(expr)}, rowid LIMIT ${limit}`
      );
    }

    const rows = await this.db.query(`SELECT * FROM ${q(table)}${where} ORDER BY rowid`);
    const exprNode = new Parser(new Lexer(idx.expression).tokenize()).parseExprPublic();
    rows.sort((a, b) => {
      const va = this.evalExprOnRowParsed(exprNode, a);
      const vb = this.evalExprOnRowParsed(exprNode, b);
      if (typeof va === 'number' && typeof vb === 'number') return va - vb;
      return String(va) < String(vb) ? -1 : String(va) > String(vb) ? 1 : 0;
    });
    return rows.slice(0, limit);
  }

  evalExprOnRowParsed(exprNode: Expr, row: Record<string, unknown>): unknown {
    const saved = new Map<string, unknown>();
    for (const [k, v] of Object.entries(row)) {
      saved.set(k, this.vars.get(k));
      this.vars.set(k, v);
    }
    let result: unknown = '';
    try {
      result = this.evalExpr(exprNode);
    } catch {
      result = '';
    }
    for (const [k, v] of saved) {
      if (v === undefined) this.vars.delete(k);
      else this.vars.set(k, v);
    }
    return result;
  }

  async getOrderedRowsWithIds(limit = 2000): Promise<Record<string, unknown>[]> {
    this.requireTable();
    const table = this.area.table!;
    const filter = this.area.filter;
    const where = filter ? ` WHERE ${filter}` : '';
    const idx = this.area.activeIndex;

    if (!idx) {
      return this.db.query(`SELECT rowid as _rowid, * FROM ${q(table)}${where} ORDER BY rowid LIMIT ${limit}`);
    }

    const expr = idx.expression.trim();
    const isSimpleField = /^[A-Z_][A-Z0-9_]*$/i.test(expr);

    if (isSimpleField) {
      return this.db.query(
        `SELECT rowid as _rowid, * FROM ${q(table)}${where} ORDER BY ${q(expr)}, rowid LIMIT ${limit}`
      );
    }

    const rows = await this.db.query(`SELECT rowid as _rowid, * FROM ${q(table)}${where} ORDER BY rowid`);
    const exprNode = new Parser(new Lexer(idx.expression).tokenize()).parseExprPublic();
    rows.sort((a, b) => {
      const va = this.evalExprOnRowParsed(exprNode, a);
      const vb = this.evalExprOnRowParsed(exprNode, b);
      if (typeof va === 'number' && typeof vb === 'number') return va - vb;
      return String(va) < String(vb) ? -1 : String(va) > String(vb) ? 1 : 0;
    });
    return rows.slice(0, limit);
  }

  /**
   * Resolves an area's current record (rowPtr) to the actual row, honouring the
   * area's active index order — the same order getOrderedRows/SEEK use. The
   * returned row includes `_rowid` so writes can target it directly.
   */
  async fetchCurrentRow(alias: string = this.activeAlias): Promise<Record<string, unknown> | null> {
    const area = this.areas.get(alias);
    if (!area?.table || area.rowPtr < 1) return null;
    const saved = this.activeAlias;
    this.activeAlias = alias;
    try {
      const rows = await this.getOrderedRowsWithIds(100000);
      return (rows[area.rowPtr - 1] as Record<string, unknown> | undefined) ?? null;
    } finally {
      this.activeAlias = saved;
    }
  }

  async primeRowCache(): Promise<void> {
    this.rowCache.clear();
    for (const [alias, area] of this.areas) {
      if (area.table && area.rowPtr >= 1 && area.rowPtr <= area.cachedRecCount) {
        const row = await this.fetchCurrentRow(alias);
        if (row) this.rowCache.set(alias, row);
      }
    }
  }

  async resolveRelations(): Promise<void> {
    const activeArea = this.area;
    if (!activeArea.relation) return;
    const { expression, intoAlias } = activeArea.relation;
    const target = this.areas.get(intoAlias);
    if (!target?.table || !target.activeIndex) return;
    if (activeArea.rowPtr < 1 || activeArea.rowPtr > activeArea.cachedRecCount) {
      target.rowPtr = 0; target._found = false; return;
    }
    // Fetch current row of active area to evaluate the key expression
    const currentRow = await this.fetchCurrentRow();
    if (!currentRow) { target.rowPtr = 0; target._found = false; return; }

    const exprNode = new Parser(new Lexer(expression).tokenize()).parseExprPublic();
    const keyVal = String(this.evalExprOnRowParsed(exprNode, currentRow)).toLowerCase();

    // Seek target area
    const savedAlias = this.activeAlias;
    this.activeAlias = intoAlias;
    const targetRows = await this.getOrderedRows(100000);
    const idxExpr = target.activeIndex.expression;
    const idxNode = new Parser(new Lexer(idxExpr).tokenize()).parseExprPublic();
    const pos = targetRows.findIndex(row =>
      String(this.evalExprOnRowParsed(idxNode, row)).toLowerCase() === keyVal
    );
    if (pos === -1) { target.rowPtr = 0; target._found = false; }
    else { target.rowPtr = pos + 1; target._found = true; }
    this.activeAlias = savedAlias;
  }

  requireTable() {
    if (!this.area.table) throw new Error('No table selected — run: USE <tablename>');
  }
}

function fmtVal(v: unknown): string {
  if (typeof v === 'boolean') return v ? '.T.' : '.F.';
  if (typeof v === 'string') return `"${v}"`;
  return String(v);
}

// Formatting for the ? / ?? print command: strings unquoted, booleans as .T./.F.,
// numbers right-justified in a 10-wide field (dBASE III numeric display, matching
// STR()'s default width).
function fmtPrint(v: unknown): string {
  if (typeof v === 'boolean') return v ? '.T.' : '.F.';
  if (typeof v === 'number') return String(v).padStart(10);
  if (v === null || v === undefined) return '';
  return String(v);
}

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
