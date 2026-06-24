import { Lexer } from '../src/interpreter/Lexer.js';
import { Parser } from '../src/interpreter/Parser.js';
import { Executor } from '../src/interpreter/Executor.js';
import type { ASTNode } from '../src/interpreter/Parser.js';
import { ServerDatabaseBridge } from './ServerDatabaseBridge.js';
import { programStore } from './ProgramStore.js';
import { reportStore } from './ReportStore.js';
import { indexStore } from './IndexStore.js';
import type { ClientMessage, ServerMessage, ColInfo } from '../src/shared/types.js';

export class Session {
  private bridge: ServerDatabaseBridge;
  private executor: Executor;
  private pendingContinuation: (() => Promise<import('../src/interpreter/Executor.js').ExecResult>) | null = null;
  // Whether pendingContinuation was captured while a program (DO <name>) was
  // running — its resumption must re-enter program scope (e.g. silent STORE).
  private pendingFromProgram = false;

  constructor(private send: (msg: ServerMessage) => void) {
    this.bridge = new ServerDatabaseBridge();
    this.executor = new Executor(this.bridge, indexStore);
  }

  async handleMessage(msg: ClientMessage): Promise<void> {
    try {
      switch (msg.type) {
        case 'command':
          await this.runCommand(msg.text);
          break;

        case 'form-submit':
          if (this.pendingContinuation !== null) {
            for (const [k, v] of Object.entries(msg.values)) {
              this.executor.setVar(k, v);
            }
            const cont = this.pendingContinuation;
            const fromProgram = this.pendingFromProgram;
            this.pendingContinuation = null;
            if (fromProgram) this.executor.enterProgram();
            try {
              const done = await this.handleExecResult(await cont());
              if (!done) this.sendStatus();
            } finally {
              if (fromProgram) this.executor.exitProgram();
            }
          }
          break;

        case 'grid-edit': {
          const { rowid, col, value } = msg;
          const table = this.executor.area.table;
          if (table) {
            await this.bridge.exec(
              `UPDATE ${q(table)} SET ${q(col)} = ? WHERE rowid = ?`,
              [value, rowid]
            );
          }
          break;
        }

        case 'grid-delete': {
          const table = this.executor.area.table;
          if (table) {
            await this.bridge.exec(
              `DELETE FROM ${q(table)} WHERE rowid = ?`,
              [msg.rowid]
            );
            await this.sendGridData();
          }
          break;
        }

        case 'grid-new-row': {
          const table = this.executor.area.table;
          if (table) {
            const cols = await this.bridge.getStructure(table);
            const fields = cols.filter(c => !c.pk);
            if (fields.length) {
              const names = fields.map(c => q(c.name)).join(', ');
              const vals = fields.map(() => 'NULL').join(', ');
              await this.bridge.exec(`INSERT INTO ${q(table)} (${names}) VALUES (${vals})`);
            } else {
              await this.bridge.exec(`INSERT INTO ${q(table)} DEFAULT VALUES`);
            }
            await this.sendGridData();
          }
          break;
        }

        case 'grid-refresh':
          await this.sendGridData();
          break;

        case 'catalog-request': {
          const area = this.executor.area;
          const databases = await this.bridge.listDatabases();
          let tables: { name: string; count: number }[] = [];
          let columns: ColInfo[] = [];
          let indexes: { tag: string; expression: string; active: boolean }[] = [];
          if (area.db) {
            const names = await this.bridge.getTables();
            for (const n of names) {
              tables.push({ name: n, count: await this.bridge.getRowCount(n) });
            }
            if (area.table && await this.bridge.tableExists(area.table)) {
              columns = await this.bridge.getStructure(area.table);
              const active = indexStore.getActive(area.table);
              indexes = indexStore.listIndexes(area.table)
                .map(i => ({ tag: i.tag, expression: i.expression, active: active?.tag === i.tag }));
            }
          }
          const reports = reportStore.list().map(name => ({ name, content: reportStore.load(name) ?? '' }));
          this.send({ type: 'catalog', catalog: { databases, tables, columns, indexes, reports, programs: programStore.list() } });
          break;
        }

        case 'grid-exit':
          this.send({ type: 'view-terminal' });
          if (this.pendingContinuation) {
            const cont = this.pendingContinuation;
            const fromProgram = this.pendingFromProgram;
            this.pendingContinuation = null;
            if (fromProgram) this.executor.enterProgram();
            try {
              await this.handleExecResult(await cont());
            } finally {
              if (fromProgram) this.executor.exitProgram();
            }
          } else {
            this.sendStatus();
          }
          break;

        case 'abort-suspended': {
          // A wizard was opened while a form/grid was suspended. The client has
          // already torn down the view, so the pending continuation can never be
          // resumed — drop it cleanly so a later form-submit can't misfire it.
          if (this.pendingContinuation !== null) {
            const wasProgram = this.pendingFromProgram;
            this.pendingContinuation = null;
            this.pendingFromProgram = false;
            this.executor.resetProgramDepth();
            if (wasProgram) {
              this.send({ type: 'output', lines: [{ text: '** Program aborted (a wizard was opened).', cls: 'warn' }] });
            }
            this.sendStatus();
          }
          break;
        }

        case 'save-program': {
          const safeName = msg.name.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
          if (!safeName) break;
          if (safeName.startsWith('__report_')) {
            const reportName = safeName.slice('__report_'.length);
            reportStore.save(reportName, msg.content);
            this.send({ type: 'output', lines: [{ text: `Report saved: ${reportName}`, cls: 'ok' }] });
          } else {
            programStore.save(safeName, msg.content);
            this.send({ type: 'output', lines: [{ text: `Saved: ${safeName}.prg`, cls: 'ok' }] });
          }
          this.send({ type: 'view-terminal' });
          this.sendStatus();
          break;
        }

      }
    } catch (err: unknown) {
      this.send({ type: 'output', lines: [{ text: `** Error: ${err instanceof Error ? err.message : String(err)}`, cls: 'error' }] });
    }
  }

  private async runCommand(src: string): Promise<void> {
    let nodes: ASTNode[];
    try {
      const tokens = new Lexer(src).tokenize();
      nodes = new Parser(tokens).parse();
    } catch (err: unknown) {
      this.send({ type: 'output', lines: [{ text: `** Parse error: ${err instanceof Error ? err.message : String(err)}`, cls: 'error' }] });
      return;
    }
    await this.executeNodes(nodes);
  }

  private async executeNodes(nodes: ASTNode[]): Promise<void> {
    for (let i = 0; i < nodes.length; i++) {
      let result = await this.executor.exec(nodes[i]);

      // Thread remaining top-level nodes into FORM_READY/BROWSE continuations
      // so nodes after a DO WHILE (e.g. a trailing LIST) still execute after the loop finishes.
      if ((result.action === 'FORM_READY' || result.action === 'BROWSE') && i + 1 < nodes.length) {
        const remaining = nodes.slice(i + 1);
        const innerCont = result.continuation;
        result = {
          ...result,
          continuation: () => this.drainAndContinue(innerCont, remaining),
        };
      }

      const done = await this.handleExecResult(result);
      if (done) return;
    }
    this.sendStatus();
  }

  // Drains innerCont (threading FORM_READY/BROWSE through), then runs remaining top-level nodes.
  private async drainAndContinue(
    innerCont: (() => Promise<import('../src/interpreter/Executor.js').ExecResult>) | undefined,
    remaining: ASTNode[],
  ): Promise<import('../src/interpreter/Executor.js').ExecResult> {
    if (innerCont) {
      const r = await innerCont();
      if (r.action === 'FORM_READY' || r.action === 'BROWSE') {
        return { ...r, continuation: () => this.drainAndContinue(r.continuation, remaining) };
      }
      if (r.action === 'QUIT') return r;
    }
    await this.executeNodes(remaining);
    return { output: [] };
  }

  /** Handles a single ExecResult. Returns true if execution should stop. */
  private async handleExecResult(result: import('../src/interpreter/Executor.js').ExecResult): Promise<boolean> {
    // Split output on 'clear' sentinels: send clear + flush preceding lines inline
    if (result.output.length > 0) {
      let batch: typeof result.output = [];
      for (const line of result.output) {
        if (line.cls === 'clear') {
          if (batch.length > 0) { this.send({ type: 'output', lines: batch }); batch = []; }
          this.send({ type: 'clear' });
          this.sendStatus();
        } else {
          batch.push(line);
        }
      }
      if (batch.length > 0) this.send({ type: 'output', lines: batch });
    }

    if (result.action === 'QUIT') {
      this.send({ type: 'output', lines: [{ text: 'Goodbye.', cls: 'ok' }] });
      this.sendStatus();
      return true;
    }

    if (result.action === 'BROWSE') {
      if (result.continuation) {
        this.pendingContinuation = result.continuation;
        this.pendingFromProgram = this.executor.isInProgram();
      }
      await this.sendGridData();
      return true;
    }

    if (result.action === 'FORM_READY' && result.formFields) {
      this.pendingContinuation = result.continuation ?? null;
      this.pendingFromProgram = this.executor.isInProgram();
      this.send({ type: 'form-open', fields: result.formFields });
      return true;
    }

    if (result.action === 'DO_PRG' && result.prgName) {
      const safeName = result.prgName.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
      const src = programStore.load(safeName);
      if (src === null) {
        this.send({ type: 'output', lines: [{ text: `Program not found: ${safeName}`, cls: 'error' }] });
      } else {
        this.executor.enterProgram();
        try {
          await this.runCommand(src);
        } finally {
          this.executor.exitProgram();
        }
      }
      return false;
    }

    if (result.action === 'LIST_PROGRAMS') {
      const names = programStore.list();
      if (!names.length) {
        this.send({ type: 'output', lines: [{ text: '(No programs)', cls: 'info' }] });
      } else {
        this.send({ type: 'output', lines: names.map(n => ({ text: n, cls: 'info' })) });
      }
      return false;
    }

    if (result.action === 'EDIT_PRG' && result.prgName) {
      const safeName = result.prgName.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
      const content = (result as any).prgContent ?? (safeName.startsWith('__report_')
        ? reportStore.load(safeName.slice('__report_'.length)) ?? ''
        : programStore.load(safeName) ?? '');
      this.send({ type: 'program-open', name: safeName, content });
      return true;
    }

    if (result.action === 'REPORT_PREVIEW' && (result as any).reportHtml) {
      this.send({ type: 'report-preview', html: (result as any).reportHtml });
    }

    return false;
  }

  private async sendGridData(): Promise<void> {
    const area = this.executor.area;
    if (!area.table) {
      this.send({ type: 'output', lines: [{ text: 'No table selected', cls: 'error' }] });
      return;
    }
    const columns = await this.bridge.getStructure(area.table);
    const rows = await this.executor.getOrderedRowsWithIds(2000);
    this.send({ type: 'grid-open', table: area.table, filter: area.filter, columns, rows });
  }

  private sendStatus(): void {
    const a = this.executor.area;
    this.send({
      type: 'status',
      db: a.db,
      table: a.table,
      record: a.rowPtr,
      total: a.cachedRecCount,
    });
  }
}

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
