import { IDatabaseBridge, IIndexStore, OutputLine, FormField } from '../shared/types';
import { ASTNode, Expr, ColDef, Parser } from './Parser';
import { Lexer } from './Lexer';

export type { OutputLine, FormField } from '../shared/types';

export interface ExecResult {
  output: OutputLine[];
  action?: 'BROWSE' | 'CLEAR' | 'QUIT' | 'FORM_READY' | 'FORM_SUBMIT' | 'DO_PRG' | 'EDIT_PRG' | 'LIST_PROGRAMS';
  formFields?: FormField[];
  prgName?: string;
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

  constructor(
    private db: IDatabaseBridge,
    private indexStore: IIndexStore | null = null,
  ) {
    this.state = {
      db: null, table: null, filter: null,
      vars: new Map(), rowPtr: 1,
      pendingForm: [], opfsAvailable: false,
      activeIndex: null,
      _found: false,
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
        if (action === 'QUIT' || action === 'CLEAR') break;
        if (action === 'FORM_READY' || action === 'BROWSE') {
          const afterForm = nodes.slice(i + 1);
          const innerCont = r.continuation;
          continuation = async () => {
            const tail = await this.run(afterForm);
            if (innerCont && (!tail.action || tail.action === 'FORM_READY' || tail.action === 'BROWSE')) {
              return { output: [...tail.output], action: tail.action, formFields: tail.formFields, continuation: tail.continuation ?? innerCont };
            }
            return tail;
          };
          break;
        }
        // propagate loop continuations from inner blocks
        if (r.continuation) continuation = r.continuation;
      }
    }
    return { output: out, action, formFields, continuation };
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
        case 'INDEX_ON':    return this.doIndexOn(node.expression, node.tag);
        case 'SET_INDEX':   return this.doSetIndex(node.tag);
        case 'REINDEX':     return this.doReindex();
        case 'LIST_INDEXES':return this.doListIndexes();
        case 'SEEK':        return this.doSeek(node.value);
        case 'FIND':        return this.doFind(node.value);
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
    this.state.activeIndex = this.indexStore?.getActive(name) ?? null;
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
    if (this.state.activeIndex) {
      lines.push({ text: `Index    : ${this.state.activeIndex.tag}  (${this.state.activeIndex.expression})`, cls: 'info' });
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
    const cnt = await this.db.getRowCount(this.state.table!, this.state.filter ?? undefined);
    if (target === 'TOP')         this.state.rowPtr = 1;
    else if (target === 'BOTTOM') this.state.rowPtr = cnt;
    else                          this.state.rowPtr = Math.max(1, Math.min(cnt, target));
    const idxNote = this.state.activeIndex ? `  [index: ${this.state.activeIndex.tag}]` : '';
    return { output: [{ text: `Record pointer: ${this.state.rowPtr} / ${cnt}${idxNote}`, cls: 'info' }] };
  }

  private async doSkip(n: number): Promise<ExecResult> {
    this.requireTable();
    const cnt = await this.db.getRowCount(this.state.table!, this.state.filter ?? undefined);
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

  private async doWhile(condE: Expr, body: ASTNode[], startIter = 0): Promise<ExecResult> {
    const out: OutputLine[] = [];
    let iters = startIter;
    while (this.evalExpr(condE) && iters++ < 10000) {
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

  // Drains the continuation chain from inside a loop, then re-enters the loop.
  // Threads "re-enter loop" through every level of nested FORM_READY.
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

  private async doIndexOn(expression: string, tag: string): Promise<ExecResult> {
    this.requireTable();
    if (!this.indexStore) return { output: [{ text: '** IndexStore not available', cls: 'error' }] };
    const table = this.state.table!;
    this.indexStore.saveIndex(table, tag, expression);
    // For simple single-field: also create a real SQLite index for query performance
    if (/^[A-Z_][A-Z0-9_]*$/i.test(expression.trim())) {
      try {
        await this.db.exec(
          `CREATE INDEX IF NOT EXISTS ${q(`idx_${table}_${tag}`)} ON ${q(table)} (${q(expression.trim())})`
        );
      } catch { /* ignore — expression may not be a valid SQL column ref */ }
    }
    this.indexStore.setActive(table, tag);
    this.state.activeIndex = { tag, expression };
    return { output: [{ text: `Index created: ${tag}  ON  ${expression}`, cls: 'ok' }] };
  }
  private async doSetIndex(tag: string | null): Promise<ExecResult> {
    this.requireTable();
    if (!this.indexStore) return { output: [{ text: '** IndexStore not available', cls: 'error' }] };
    const table = this.state.table!;
    if (tag === null) {
      this.indexStore.clearActive(table);
      this.state.activeIndex = null;
      return { output: [{ text: 'Active index cleared', cls: 'ok' }] };
    }
    const def = this.indexStore.listIndexes(table).find(i => i.tag.toUpperCase() === tag.toUpperCase());
    if (!def) return { output: [{ text: `Index '${tag}' not found — use INDEX ON to create it`, cls: 'warn' }] };
    this.indexStore.setActive(table, def.tag);
    this.state.activeIndex = { tag: def.tag, expression: def.expression };
    return { output: [{ text: `Index active: ${def.tag}  (${def.expression})`, cls: 'ok' }] };
  }
  private async doReindex(): Promise<ExecResult> {
    this.requireTable();
    await this.db.exec('REINDEX');
    return { output: [{ text: 'Indexes rebuilt', cls: 'ok' }] };
  }
  private async doListIndexes(): Promise<ExecResult> {
    this.requireTable();
    if (!this.indexStore) return { output: [{ text: '** IndexStore not available', cls: 'error' }] };
    const table = this.state.table!;
    const indexes = this.indexStore.listIndexes(table);
    if (!indexes.length) return { output: [{ text: '(No indexes defined)', cls: 'info' }] };
    const out: OutputLine[] = [
      { text: `Indexes for table: ${table}`, cls: 'hdr' },
      { text: `${'Tag'.padEnd(20)}  ${'Expression'.padEnd(40)}  Active`, cls: 'hdr' },
      { text: '─'.repeat(65), cls: 'sep' },
    ];
    for (const idx of indexes) {
      const active = this.state.activeIndex?.tag?.toUpperCase() === idx.tag.toUpperCase() ? ' *' : '';
      out.push({ text: `${idx.tag.padEnd(20)}  ${idx.expression.padEnd(40)}${active}` });
    }
    return { output: out };
  }
  private async doSeek(_value: Expr): Promise<ExecResult> {
    return { output: [{ text: 'SEEK: not yet implemented', cls: 'warn' }] };
  }
  private async doFind(_value: string): Promise<ExecResult> {
    return { output: [{ text: 'FIND: not yet implemented', cls: 'warn' }] };
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
      { text: 'DO <name>               — run a saved program' },
      { text: 'EDIT <name>             — create/edit a program' },
      { text: 'LIST PROGRAMS           — list saved programs' },
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

  private async getOrderedRows(limit = 500): Promise<Record<string, unknown>[]> {
    this.requireTable();
    const table = this.state.table!;
    const filter = this.state.filter;
    const where = filter ? ` WHERE ${filter}` : '';
    const idx = this.state.activeIndex;

    if (!idx) {
      return this.db.query(`SELECT * FROM ${q(table)}${where} LIMIT ${limit}`);
    }

    const expr = idx.expression.trim();
    const isSimpleField = /^[A-Z_][A-Z0-9_]*$/i.test(expr);

    if (isSimpleField) {
      return this.db.query(
        `SELECT * FROM ${q(table)}${where} ORDER BY ${q(expr)} LIMIT ${limit}`
      );
    }

    // Complex expression: fetch all, sort in JS using W3Script evaluator
    const rows = await this.db.query(`SELECT * FROM ${q(table)}${where}`);
    // Parse expression once before sort loop
    const exprNode = new Parser(new Lexer(idx.expression).tokenize()).parseExprPublic();
    rows.sort((a, b) => {
      const va = this.evalExprOnRowParsed(exprNode, a);
      const vb = this.evalExprOnRowParsed(exprNode, b);
      if (typeof va === 'number' && typeof vb === 'number') return va - vb;
      return String(va) < String(vb) ? -1 : String(va) > String(vb) ? 1 : 0;
    });
    return rows.slice(0, limit);
  }

  private evalExprOnRowParsed(exprNode: Expr, row: Record<string, unknown>): unknown {
    const saved = new Map<string, unknown>();
    for (const [k, v] of Object.entries(row)) {
      saved.set(k, this.state.vars.get(k));
      this.state.vars.set(k, v);
    }
    let result: unknown = '';
    try {
      result = this.evalExpr(exprNode);
    } catch {
      result = '';
    }
    for (const [k, v] of saved) {
      if (v === undefined) this.state.vars.delete(k);
      else this.state.vars.set(k, v);
    }
    return result;
  }

  private evalExprOnRow(expression: string, row: Record<string, unknown>): unknown {
    const exprNode = new Parser(new Lexer(expression).tokenize()).parseExprPublic();
    return this.evalExprOnRowParsed(exprNode, row);
  }

  async getOrderedRowsPublic(limit = 500): Promise<Record<string, unknown>[]> {
    return this.getOrderedRows(limit);
  }

  private requireTable() {
    if (!this.state.table) throw new Error('No table selected — run: USE <tablename>');
  }
}

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
