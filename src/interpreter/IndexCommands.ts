import type { ExecResult } from './Executor.js';
import type { Expr } from './Parser.js';
import type { IIndexStore, OutputLine, WorkArea, IDatabaseBridge } from '../shared/types.js';
import { Parser } from './Parser.js';
import { Lexer } from './Lexer.js';

export interface IndexCommandsHost {
  readonly area: WorkArea;
  readonly activeAlias: string;
  readonly indexStore: IIndexStore | null;
  /** Database key for index/column metadata — same-named tables in different DBs must not collide. */
  readonly metaDb: string;
  readonly db: IDatabaseBridge;
  evalExpr(e: Expr): unknown;
  requireTable(): void;
  getOrderedRows(limit?: number): Promise<Record<string, unknown>[]>;
  evalExprOnRowParsed(exprNode: Expr, row: Record<string, unknown>): unknown;
  resolveRelations(): Promise<void>;
}

export class IndexCommands {
  constructor(private host: IndexCommandsHost) {}

  async doIndexOn(expression: string, tag: string): Promise<ExecResult> {
    this.host.requireTable();
    if (!this.host.indexStore) return { output: [{ text: '** IndexStore not available', cls: 'error' }] };
    const table = this.host.area.table!;
    this.host.indexStore.saveIndex(this.host.metaDb, table, tag, expression);
    if (/^[A-Z_][A-Z0-9_]*$/i.test(expression.trim())) {
      try {
        await this.host.db.exec(
          `CREATE INDEX IF NOT EXISTS "${`idx_${table}_${tag}`.replace(/"/g, '""')}" ON "${table.replace(/"/g, '""')}" ("${expression.trim().replace(/"/g, '""')}")`
        );
      } catch { /* ignore — expression may not be a valid SQL column ref */ }
    }
    this.host.indexStore.setActive(this.host.metaDb, table, tag);
    this.host.area.activeIndex = { tag, expression };
    return { output: [{ text: `Index created: ${tag}  ON  ${expression}`, cls: 'ok' }] };
  }

  async doSetIndex(tag: string | null): Promise<ExecResult> {
    this.host.requireTable();
    if (!this.host.indexStore) return { output: [{ text: '** IndexStore not available', cls: 'error' }] };
    const table = this.host.area.table!;
    if (tag === null) {
      this.host.indexStore.clearActive(this.host.metaDb, table);
      this.host.area.activeIndex = null;
      return { output: [{ text: 'Active index cleared', cls: 'ok' }] };
    }
    const def = this.host.indexStore.listIndexes(this.host.metaDb, table).find(i => i.tag.toUpperCase() === tag.toUpperCase());
    if (!def) return { output: [{ text: `Index '${tag}' not found — use INDEX ON to create it`, cls: 'warn' }] };
    this.host.indexStore.setActive(this.host.metaDb, table, def.tag);
    this.host.area.activeIndex = { tag: def.tag, expression: def.expression };
    return { output: [{ text: `Index active: ${def.tag}  (${def.expression})`, cls: 'ok' }] };
  }

  async doReindex(): Promise<ExecResult> {
    this.host.requireTable();
    await this.host.db.exec('REINDEX');
    return { output: [{ text: 'Indexes rebuilt', cls: 'ok' }] };
  }

  async doListIndexes(): Promise<ExecResult> {
    this.host.requireTable();
    if (!this.host.indexStore) return { output: [{ text: '** IndexStore not available', cls: 'error' }] };
    const table = this.host.area.table!;
    const indexes = this.host.indexStore.listIndexes(this.host.metaDb, table);
    if (!indexes.length) return { output: [{ text: '(No indexes defined)', cls: 'info' }] };
    const out: OutputLine[] = [
      { text: `Indexes for table: ${table}`, cls: 'hdr' },
      { text: `${'Tag'.padEnd(20)}  ${'Expression'.padEnd(40)}  Active`, cls: 'hdr' },
      { text: '─'.repeat(65), cls: 'sep' },
    ];
    for (const idx of indexes) {
      const active = this.host.area.activeIndex?.tag?.toUpperCase() === idx.tag.toUpperCase() ? ' *' : '';
      out.push({ text: `${idx.tag.padEnd(20)}  ${idx.expression.padEnd(40)}${active}` });
    }
    return { output: out };
  }

  async doSeek(valueExpr: Expr): Promise<ExecResult> {
    this.host.requireTable();
    if (!this.host.area.activeIndex) {
      return { output: [{ text: 'No index active — use SET INDEX TO <tag> first', cls: 'warn' }] };
    }
    const seekVal = String(this.host.evalExpr(valueExpr)).toLowerCase();
    const rows = await this.host.getOrderedRows(100000);
    const idx = this.host.area.activeIndex;
    const exprNode = new Parser(new Lexer(idx.expression).tokenize()).parseExprPublic();

    const pos = rows.findIndex(row => {
      const v = String(this.host.evalExprOnRowParsed(exprNode, row)).toLowerCase();
      return v === seekVal;
    });

    if (pos === -1) {
      this.host.area._found = false;
      this.host.area.rowPtr = rows.length + 1;
      return { output: [{ text: 'Record not found', cls: 'warn' }] };
    }

    this.host.area._found = true;
    this.host.area.rowPtr = pos + 1;
    await this.host.resolveRelations();
    const row = rows[pos];
    const preview = Object.entries(row).map(([k, v]) => `${k}: ${v}`).join('  ');
    return { output: [{ text: `Found at position ${pos + 1}: ${preview}`, cls: 'ok' }] };
  }

  async doFind(value: string): Promise<ExecResult> {
    const litExpr: Expr = { k: 'lit', v: value };
    return this.doSeek(litExpr);
  }
}
