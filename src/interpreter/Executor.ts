import { IDatabaseBridge, OutputLine, FormField } from '../shared/types';
import { ASTNode, Expr, ColDef } from './Parser';

export type { OutputLine, FormField } from '../shared/types';

export interface ExecResult {
  output: OutputLine[];
  action?: 'BROWSE' | 'CLEAR' | 'QUIT' | 'FORM_READY' | 'FORM_SUBMIT' | 'DO_PRG' | 'EDIT_PRG' | 'LIST_PROGRAMS';
  formFields?: FormField[];
  prgName?: string;
}

export interface State {
  db: string | null;
  table: string | null;
  filter: string | null;
  vars: Map<string, unknown>;
  rowPtr: number;
  pendingForm: FormField[];
  opfsAvailable: boolean;
}

type DbType = 'TEXT' | 'REAL' | 'INTEGER' | 'BLOB';

function mapType(t: string): DbType {
  switch (t.toUpperCase()) {
    case 'CHAR': case 'CHARACTER': case 'VARCHAR': case 'STRING': case 'MEMO': case 'DATE': return 'TEXT';
    case 'NUM': case 'NUMERIC': case 'FLOAT': case 'DOUBLE': case 'DECIMAL': return 'REAL';
    case 'INT': case 'INTEGER': case 'LOGICAL': case 'BOOLEAN': return 'INTEGER';
    default: return 'TEXT';
  }
}

export class Executor {
  public state: State;

  constructor(private db: IDatabaseBridge) {
    this.state = {
      db: null, table: null, filter: null,
      vars: new Map(), rowPtr: 1,
      pendingForm: [], opfsAvailable: false,
    };
  }

  async run(nodes: ASTNode[]): Promise<ExecResult> {
    const out: OutputLine[] = [];
    let action: ExecResult['action'];
    let formFields: FormField[] | undefined;

    for (const node of nodes) {
      const r = await this.exec(node);
      out.push(...r.output);
      if (r.action) {
        action = r.action;
        formFields = r.formFields;
        if (action === 'QUIT') break;
        if (action === 'CLEAR') { break; }
        if (action === 'FORM_READY') break;
      }
    }
    return { output: out, action, formFields };
  }

  async exec(node: ASTNode): Promise<ExecResult> {
    const out: OutputLine[] = [];
    try {
      switch (node.type) {
        case 'USE':         return this.doUse(node.name);
        case 'USE_DB':      return this.doUseDb(node.name);
        case 'LIST':        return this.doList();
        case 'LIST_STRUCT': return this.doListStruct();
        case 'LIST_TABLES': return this.doListTables();
        case 'BROWSE':      return { output: [], action: 'BROWSE' };
        case 'CLEAR':       return { output: [], action: 'CLEAR' };
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
        case 'DO_PRG':      return { output: [], action: 'DO_PRG', prgName: node.name };
        case 'LIST_PROGRAMS': return { output: [], action: 'LIST_PROGRAMS' };
        case 'EDIT_PRG':    return { output: [], action: 'EDIT_PRG', prgName: node.name };
        case 'UNKNOWN':     return { output: [{ text: `Unknown command: ${node.raw}`, cls: 'warn' }] };
      }
    } catch (e: unknown) {
      out.push({ text: `** Error: ${e instanceof Error ? e.message : String(e)}`, cls: 'error' });
    }
    return { output: out };
  }

  private async doUse(name: string): Promise<ExecResult> {
    const dbName = this.state.db ?? 'webbaseiii';
    if (!this.state.db) {
      const r = await this.db.openDatabase(dbName);
      this.state.db = dbName;
      this.state.opfsAvailable = r.opfsAvailable;
    }
    this.state.table = name;
    this.state.filter = null;
    this.state.rowPtr = 1;
    const exists = await this.db.tableExists(name);
    const storage = this.state.opfsAvailable ? 'OPFS (persistent)' : 'server-side persistent';
    const lines: OutputLine[] = [
      { text: `Database : ${dbName}  [${storage}]`, cls: 'info' },
    ];
    if (exists) {
      const cnt = await this.db.getRowCount(name);
      lines.push({ text: `Table    : ${name}  (${cnt} records)`, cls: 'ok' });
    } else {
      lines.push({ text: `Table    : ${name}  (table not found — use CREATE TABLE to create it)`, cls: 'warn' });
    }
    return { output: lines };
  }

  private async doUseDb(name: string): Promise<ExecResult> {
    await this.db.openDatabase(name);
    this.state.db = name;
    this.state.table = null;
    this.state.opfsAvailable = this.db.opfsAvailable;
    const tables = await this.db.getTables();
    const storage = this.state.opfsAvailable ? 'OPFS (persistent)' : 'server-side persistent';
    return { output: [
      { text: `Opened database: ${name}  [${storage}]`, cls: 'ok' },
      { text: `Tables: ${tables.length ? tables.join(', ') : '(none)'}`, cls: 'info' },
    ]};
  }

  private async doList(): Promise<ExecResult> {
    this.requireTable();
    const filter = this.state.filter;
    const sql = `SELECT * FROM ${q(this.state.table!)}${filter ? ' WHERE ' + filter : ''} LIMIT 500`;
    const rows = await this.db.query(sql);
    if (!rows.length) return { output: [{ text: '(No records)', cls: 'info' }] };

    const cols = Object.keys(rows[0]);
    const widths = cols.map(c => Math.max(c.length, ...rows.map(r => String(r[c] ?? '').length)));
    const out: OutputLine[] = [];
    out.push({ text: cols.map((c, i) => c.padEnd(widths[i])).join('  '), cls: 'hdr' });
    out.push({ text: cols.map((_, i) => '-'.repeat(widths[i])).join('  '), cls: 'sep' });
    rows.forEach((r, ri) => {
      out.push({ text: cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  '), cls: ri % 2 === 0 ? 'out' : 'out' });
    });
    out.push({ text: `${rows.length} record(s)`, cls: 'info' });
    return { output: out };
  }

  private async doListStruct(): Promise<ExecResult> {
    this.requireTable();
    const cols = await this.db.getStructure(this.state.table!);
    const out: OutputLine[] = [
      { text: `Structure of table: ${this.state.table}`, cls: 'hdr' },
      { text: `${'#'.padEnd(4)}  ${'Field'.padEnd(20)}  ${'Type'.padEnd(10)}  ${'Null'.padEnd(5)}  ${'PK'}`, cls: 'hdr' },
      { text: `${'─'.repeat(55)}`, cls: 'sep' },
    ];
    cols.forEach(c => {
      out.push({ text: `${String(c.cid + 1).padEnd(4)}  ${c.name.padEnd(20)}  ${c.type.padEnd(10)}  ${c.notnull ? 'NO' : 'YES'.padEnd(5)}  ${c.pk ? 'PK' : ''}` });
    });
    return { output: out };
  }

  private async doListTables(): Promise<ExecResult> {
    if (!this.state.db) return { output: [{ text: 'No database open', cls: 'warn' }] };
    const tables = await this.db.getTables();
    if (!tables.length) return { output: [{ text: '(No tables)', cls: 'info' }] };
    const out: OutputLine[] = [{ text: 'Tables in database:', cls: 'hdr' }];
    for (const t of tables) {
      const n = await this.db.getRowCount(t);
      out.push({ text: `  ${t.padEnd(30)}  ${n} record(s)` });
    }
    return { output: out };
  }

  private async doSetFilter(expr: string | null): Promise<ExecResult> {
    this.state.filter = expr;
    return { output: [{ text: expr ? `Filter set: ${expr}` : 'Filter cleared', cls: 'ok' }] };
  }

  private async doReplaceAll(fields: Array<{ field: string; value: Expr }>, scope: 'ALL' | 'CURRENT'): Promise<ExecResult> {
    this.requireTable();
    const pairs = fields.map(f => ({ field: f.field, value: this.evalExpr(f.value) }));
    const setClauses = pairs.map(p => `${q(p.field)} = ?`).join(', ');
    const params = pairs.map(p => p.value);
    let sql: string;
    if (scope === 'ALL') {
      const where = this.state.filter ? ` WHERE ${this.state.filter}` : '';
      sql = `UPDATE ${q(this.state.table!)} SET ${setClauses}${where}`;
    } else {
      sql = `UPDATE ${q(this.state.table!)} SET ${setClauses} WHERE rowid = (SELECT rowid FROM ${q(this.state.table!)} LIMIT 1 OFFSET ${this.state.rowPtr - 1})`;
    }
    await this.db.exec(sql, params);
    const desc = pairs.map(p => `${p.field} = ${JSON.stringify(p.value)}`).join(', ');
    return { output: [{ text: `Replaced: ${desc} (${scope})`, cls: 'ok' }] };
  }

  private async doAppend(): Promise<ExecResult> {
    this.requireTable();
    const cols = await this.db.getStructure(this.state.table!);
    const fields = cols.filter(c => !c.pk || c.pk === 0);
    if (!fields.length) {
      await this.db.exec(`INSERT INTO ${q(this.state.table!)} DEFAULT VALUES`);
    } else {
      const names = fields.map(c => q(c.name)).join(', ');
      const vals = fields.map(() => 'NULL').join(', ');
      await this.db.exec(`INSERT INTO ${q(this.state.table!)} (${names}) VALUES (${vals})`);
    }
    const cnt = await this.db.getRowCount(this.state.table!);
    this.state.rowPtr = cnt;
    return { output: [{ text: `Record appended. Total: ${cnt}`, cls: 'ok' }] };
  }

  private async doDelete(scope: 'ALL' | 'CURRENT'): Promise<ExecResult> {
    this.requireTable();
    if (scope === 'ALL') {
      const where = this.state.filter ? ` WHERE ${this.state.filter}` : '';
      await this.db.exec(`DELETE FROM ${q(this.state.table!)}${where}`);
      return { output: [{ text: 'Records deleted', cls: 'ok' }] };
    }
    await this.db.exec(
      `DELETE FROM ${q(this.state.table!)} WHERE rowid = (SELECT rowid FROM ${q(this.state.table!)} LIMIT 1 OFFSET ${this.state.rowPtr - 1})`
    );
    return { output: [{ text: 'Current record deleted', cls: 'ok' }] };
  }

  private async doRecall(_scope: 'ALL' | 'CURRENT'): Promise<ExecResult> {
    return { output: [{ text: 'RECALL not applicable in SQL mode (no soft-delete)', cls: 'warn' }] };
  }

  private async doPack(): Promise<ExecResult> {
    if (this.state.db) await this.db.exec('VACUUM');
    return { output: [{ text: 'VACUUM complete', cls: 'ok' }] };
  }

  private async doGo(target: 'TOP' | 'BOTTOM' | number): Promise<ExecResult> {
    this.requireTable();
    const cnt = await this.db.getRowCount(this.state.table!);
    if (target === 'TOP')    this.state.rowPtr = 1;
    else if (target === 'BOTTOM') this.state.rowPtr = cnt;
    else this.state.rowPtr = Math.max(1, Math.min(cnt, target));
    return { output: [{ text: `Record pointer: ${this.state.rowPtr} / ${cnt}`, cls: 'info' }] };
  }

  private async doSkip(n: number): Promise<ExecResult> {
    this.requireTable();
    const cnt = await this.db.getRowCount(this.state.table!);
    this.state.rowPtr = Math.max(1, Math.min(cnt, this.state.rowPtr + n));
    return { output: [{ text: `Record pointer: ${this.state.rowPtr} / ${cnt}`, cls: 'info' }] };
  }

  private doAtSay(rowE: Expr, colE: Expr, textE: Expr): ExecResult {
    const row = Number(this.evalExpr(rowE));
    const col = Number(this.evalExpr(colE));
    const text = String(this.evalExpr(textE));
    this.state.pendingForm.push({ row, col, label: text, varName: '' });
    return { output: [] };
  }

  private doAtSayGet(rowE: Expr, colE: Expr, textE: Expr, varName: string): ExecResult {
    const row = Number(this.evalExpr(rowE));
    const col = Number(this.evalExpr(colE));
    const text = String(this.evalExpr(textE));
    this.state.pendingForm.push({ row, col, label: text, varName });
    return { output: [] };
  }

  private doRead(): ExecResult {
    const fields = [...this.state.pendingForm];
    this.state.pendingForm = [];
    if (!fields.length) return { output: [{ text: 'READ: no GET fields defined', cls: 'warn' }] };
    return { output: [], action: 'FORM_READY', formFields: fields };
  }

  private doStore(valueExpr: Expr, varName: string): ExecResult {
    const v = this.evalExpr(valueExpr);
    this.state.vars.set(varName, v);
    return { output: [{ text: `${varName} = ${JSON.stringify(v)}`, cls: 'info' }] };
  }

  private doInput(prompt: string, varName: string): ExecResult {
    // In terminal mode, INPUT requires interactive input – handled at Terminal level.
    // For scripted use, we pre-seed with empty string.
    this.state.vars.set(varName, this.state.vars.get(varName) ?? '');
    const form: FormField[] = [{ row: 10, col: 5, label: prompt || `Enter ${varName}:`, varName }];
    return { output: [], action: 'FORM_READY', formFields: form };
  }

  private async doIf(condE: Expr, body: ASTNode[], elseBody: ASTNode[]): Promise<ExecResult> {
    const cond = this.evalExpr(condE);
    return this.run(cond ? body : elseBody);
  }

  private async doWhile(condE: Expr, body: ASTNode[]): Promise<ExecResult> {
    const out: OutputLine[] = [];
    let iters = 0;
    while (this.evalExpr(condE) && iters++ < 10000) {
      const r = await this.run(body);
      out.push(...r.output);
      if (r.action === 'QUIT') return { output: out, action: 'QUIT' };
    }
    if (iters >= 10000) out.push({ text: '** DO WHILE limit (10000) reached', cls: 'warn' });
    return { output: out };
  }

  private async doCreateTable(name: string, cols: ColDef[]): Promise<ExecResult> {
    if (!this.state.db) {
      await this.db.openDatabase('webbaseiii');
      this.state.db = 'webbaseiii';
      this.state.opfsAvailable = this.db.opfsAvailable;
    }
    const colsSql = cols.length
      ? cols.map(c => `${q(c.name)} ${mapType(c.colType)}`).join(', ')
      : '"id" INTEGER PRIMARY KEY AUTOINCREMENT';
    const sql = `CREATE TABLE IF NOT EXISTS ${q(name)} (${colsSql})`;
    await this.db.exec(sql);
    return { output: [{ text: `Table created: ${name}`, cls: 'ok' }] };
  }

  private async doDropTable(name: string): Promise<ExecResult> {
    await this.db.exec(`DROP TABLE IF EXISTS ${q(name)}`);
    if (this.state.table === name) this.state.table = null;
    return { output: [{ text: `Table dropped: ${name}`, cls: 'ok' }] };
  }

  private doHelp(): ExecResult {
    return { output: [
      { text: 'WebBase-III — W3Script Command Reference', cls: 'hdr' },
      { text: '─'.repeat(50), cls: 'sep' },
      { text: 'USE <table>             — open/select a table' },
      { text: 'USE DATABASE <name>     — open a named database' },
      { text: 'LIST                    — list records' },
      { text: 'LIST STRUCTURE          — show table schema' },
      { text: 'LIST TABLES             — list all tables' },
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
      { text: 'STORE <val> TO <var>    — assign variable' },
      { text: '@ r,c SAY "text" GET v  — form field' },
      { text: 'READ                    — show form, collect input' },
      { text: 'IF <cond> … ENDIF       — conditional block' },
      { text: 'DO WHILE <cond> … ENDDO — loop' },
      { text: 'QUIT                    — exit' },
    ]};
  }

  // ── Expression evaluator ─────────────────────────────────────────────────

  evalExpr(e: Expr): unknown {
    switch (e.k) {
      case 'lit': return e.v;
      case 'var': return this.state.vars.get(e.name) ?? e.name;
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
    }
  }

  setVar(name: string, value: unknown) { this.state.vars.set(name, value); }

  private requireTable() {
    if (!this.state.table) throw new Error('No table selected — run: USE <tablename>');
  }
}

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
