import { Lexer } from '../src/interpreter/Lexer.js';
import { Parser } from '../src/interpreter/Parser.js';
import { Executor } from '../src/interpreter/Executor.js';
import type { ASTNode } from '../src/interpreter/Parser.js';
import { ServerDatabaseBridge } from './ServerDatabaseBridge.js';
import { programStore } from './ProgramStore.js';
import type { ClientMessage, ServerMessage } from '../src/shared/types.js';

export class Session {
  private bridge: ServerDatabaseBridge;
  private executor: Executor;
  private pendingNodes: ASTNode[] | null = null;

  constructor(private send: (msg: ServerMessage) => void) {
    this.bridge = new ServerDatabaseBridge();
    this.executor = new Executor(this.bridge);
  }

  async handleMessage(msg: ClientMessage): Promise<void> {
    try {
      switch (msg.type) {
        case 'command':
          await this.runCommand(msg.text);
          break;

        case 'form-submit':
          if (this.pendingNodes !== null) {
            for (const [k, v] of Object.entries(msg.values)) {
              this.executor.setVar(k, v);
            }
            const remaining = this.pendingNodes;
            this.pendingNodes = null;
            await this.executeNodes(remaining);
          }
          break;

        case 'grid-edit': {
          const { rowid, col, value } = msg;
          const table = this.executor.state.table;
          if (table) {
            await this.bridge.exec(
              `UPDATE ${q(table)} SET ${q(col)} = ? WHERE rowid = ?`,
              [value, rowid]
            );
          }
          break;
        }

        case 'grid-delete': {
          const table = this.executor.state.table;
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
          const table = this.executor.state.table;
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

        case 'grid-exit':
          this.send({ type: 'view-terminal' });
          this.sendStatus();
          break;

        case 'save-program': {
          const safeName = msg.name.replace(/[^a-zA-Z0-9_-]/g, '');
          if (!safeName) break;
          programStore.save(safeName, msg.content);
          this.send({ type: 'output', lines: [{ text: `Saved: ${safeName}.prg`, cls: 'ok' }] });
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
      const result = await this.executor.exec(nodes[i]);

      if (result.output.length > 0) {
        this.send({ type: 'output', lines: result.output });
      }

      if (result.action === 'CLEAR') {
        this.send({ type: 'clear' });
        this.sendStatus();
        return;
      }

      if (result.action === 'QUIT') {
        this.send({ type: 'output', lines: [{ text: 'Goodbye.', cls: 'ok' }] });
        this.sendStatus();
        return;
      }

      if (result.action === 'BROWSE') {
        await this.sendGridData();
        return;
      }

      if (result.action === 'FORM_READY' && result.formFields) {
        this.pendingNodes = nodes.slice(i + 1);
        this.send({ type: 'form-open', fields: result.formFields });
        return;
      }

      if (result.action === 'DO_PRG' && result.prgName) {
        const safeName = result.prgName.replace(/[^a-zA-Z0-9_-]/g, '');
        const src = programStore.load(safeName);
        if (src === null) {
          this.send({ type: 'output', lines: [{ text: `Program not found: ${safeName}`, cls: 'error' }] });
        } else {
          await this.runCommand(src);
        }
        continue;
      }

      if (result.action === 'LIST_PROGRAMS') {
        const names = programStore.list();
        if (!names.length) {
          this.send({ type: 'output', lines: [{ text: '(No programs)', cls: 'info' }] });
        } else {
          this.send({ type: 'output', lines: names.map(n => ({ text: n, cls: 'info' })) });
        }
        continue;
      }

      if (result.action === 'EDIT_PRG' && result.prgName) {
        const safeName = result.prgName.replace(/[^a-zA-Z0-9_-]/g, '');
        const content = programStore.load(safeName) ?? '';
        this.send({ type: 'program-open', name: safeName, content });
        return;
      }
    }
    this.sendStatus();
  }

  private async sendGridData(): Promise<void> {
    const state = this.executor.state;
    if (!state.table) {
      this.send({ type: 'output', lines: [{ text: 'No table selected', cls: 'error' }] });
      return;
    }
    const where = state.filter ? ` WHERE ${state.filter}` : '';
    const rows = await this.bridge.query(
      `SELECT rowid as _rowid, * FROM ${q(state.table)}${where} LIMIT 2000`
    );
    const columns = await this.bridge.getStructure(state.table);
    this.send({ type: 'grid-open', table: state.table, filter: state.filter, columns, rows });
  }

  private sendStatus(): void {
    const s = this.executor.state;
    this.send({
      type: 'status',
      db: s.db,
      table: s.table,
      record: s.rowPtr,
      total: 0,
    });
  }
}

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
