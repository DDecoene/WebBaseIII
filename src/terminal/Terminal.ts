import { WsClient } from '../ws/WsClient';
import { Grid } from '../ui/Grid';
import { FormLayout } from '../ui/FormLayout';
import type { OutputLine, FormField } from '../shared/types';

const HISTORY_LIMIT = 200;

const BLOCK_OPENERS: Record<string, string> = { IF: 'ENDIF', 'DO WHILE': 'ENDDO', DO: 'ENDDO' };
const BLOCK_CLOSERS = new Set(['ENDIF', 'ENDDO', 'ELSE']);

export class Terminal {
  private output: HTMLElement;
  private input: HTMLInputElement;
  private promptEl: HTMLElement;
  private statusDb: HTMLElement;
  private statusTable: HTMLElement;
  private statusRecord: HTMLElement;
  private termView: HTMLElement;
  private gridView: HTMLElement;
  private formView: HTMLElement;

  private ws: WsClient;
  private history: string[] = [];
  private histIdx = -1;
  private pendingBlock: string[] = [];
  private blockDepth = 0;
  private grid: Grid | null = null;
  private form: FormLayout | null = null;

  constructor(ws: WsClient) {
    this.ws = ws;

    this.output      = document.getElementById('terminal-output')!;
    this.input       = document.getElementById('terminal-input') as HTMLInputElement;
    this.promptEl    = document.getElementById('terminal-prompt')!;
    this.statusDb    = document.getElementById('status-db')!;
    this.statusTable = document.getElementById('status-table')!;
    this.statusRecord= document.getElementById('status-record')!;
    this.termView    = document.getElementById('terminal-view')!;
    this.gridView    = document.getElementById('grid-view')!;
    this.formView    = document.getElementById('form-view')!;

    ws.on('output', (msg) => {
      (msg as any).lines.forEach((l: OutputLine) => this.printLine(l.text, l.cls));
    });

    ws.on('status', (msg) => {
      const m = msg as any;
      this.statusDb.textContent     = m.db    ? `[ ${m.db} ]`    : '[ No DB ]';
      this.statusTable.textContent  = m.table ? `[ ${m.table} ]` : '[ No Table ]';
      this.statusRecord.textContent = m.total ? `${m.record}/${m.total}` : '';
    });

    ws.on('clear', () => {
      this.output.innerHTML = '';
    });

    ws.on('grid-open', (msg) => {
      const m = msg as any;
      this.openGrid(m.table, m.filter, m.columns, m.rows);
    });

    ws.on('form-open', (msg) => {
      const m = msg as any;
      this.openForm(m.fields);
    });

    ws.on('view-terminal', () => {
      this.showTerminal();
    });

    ws.on('error', (msg) => {
      this.printLine(`** ${(msg as any).message}`, 'error');
    });
  }

  mount() {
    this.input.addEventListener('keydown', this.handleInputKey.bind(this));
    document.addEventListener('click', (e) => {
      if (!this.grid && !this.form) {
        const sel = window.getSelection();
        if (sel && sel.toString().length > 0) return;
        const target = e.target as Element;
        if (target.closest('#terminal-output')) return;
        this.input.focus();
      }
    });
    this.input.focus();
    this.printWelcome();
  }

  private handleInputKey(e: KeyboardEvent) {
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        void this.submit();
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (this.histIdx < this.history.length - 1) {
          this.histIdx++;
          this.input.value = this.history[this.history.length - 1 - this.histIdx];
          requestAnimationFrame(() => {
            this.input.selectionStart = this.input.selectionEnd = this.input.value.length;
          });
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (this.histIdx > 0) {
          this.histIdx--;
          this.input.value = this.history[this.history.length - 1 - this.histIdx];
        } else if (this.histIdx === 0) {
          this.histIdx = -1;
          this.input.value = '';
        }
        break;
    }
  }

  private async submit() {
    const raw = this.input.value.trim();
    this.input.value = '';
    this.histIdx = -1;
    if (!raw) return;

    if (this.history[this.history.length - 1] !== raw) {
      this.history.push(raw);
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
    }

    this.printLine(`. ${raw}`, 'echo');

    const upperLine = raw.toUpperCase().replace(/;.*$/, '').trim();

    if (this.blockDepth > 0) {
      this.pendingBlock.push(raw);
      const closeWord = upperLine.split(/\s+/)[0];
      if (BLOCK_CLOSERS.has(closeWord)) this.blockDepth--;
      else if (Object.keys(BLOCK_OPENERS).some(k => upperLine.startsWith(k))) this.blockDepth++;
      if (this.blockDepth === 0) {
        this.flushBlock();
      } else {
        this.promptEl.textContent = '... ';
      }
      return;
    }

    if (Object.keys(BLOCK_OPENERS).some(k => upperLine === k || upperLine.startsWith(k + ' '))) {
      this.pendingBlock = [raw];
      this.blockDepth = 1;
      this.promptEl.textContent = '... ';
      return;
    }

    this.ws.send({ type: 'command', text: raw });
  }

  private flushBlock() {
    const src = this.pendingBlock.join('\n');
    this.pendingBlock = [];
    this.promptEl.textContent = '. ';
    this.ws.send({ type: 'command', text: src });
  }

  // ── Views ──────────────────────────────────────────────────────────────

  private openGrid(table: string, filter: string | null, columns: any[], rows: any[]) {
    this.termView.classList.add('hidden');
    this.gridView.classList.remove('hidden');

    this.grid = new Grid({
      table,
      filter,
      columns,
      rows,
      ws: this.ws,
      onExit: () => this.closeGrid(),
      onStatusChange: (m) => { this.statusRecord.textContent = m; },
    });
    this.grid.mount();
  }

  private closeGrid() {
    this.grid?.unmount();
    this.grid = null;
    this.gridView.classList.add('hidden');
    this.showTerminal();
    this.printLine('Returned from BROWSE', 'info');
  }

  private openForm(fields: FormField[]) {
    this.termView.classList.add('hidden');
    this.formView.classList.remove('hidden');

    this.form = new FormLayout(
      (values) => {
        const obj: Record<string, string> = {};
        values.forEach((v, k) => { obj[k] = v; });
        this.ws.send({ type: 'form-submit', values: obj });
        this.closeForm();
      },
      () => {
        this.ws.send({ type: 'grid-exit' });
        this.closeForm();
        this.printLine('READ cancelled', 'warn');
      }
    );
    this.form.render(fields, new Map());
  }

  private closeForm() {
    this.form?.unmount();
    this.form = null;
    this.formView.classList.add('hidden');
    this.showTerminal();
  }

  showTerminal() {
    this.termView.classList.remove('hidden');
    this.gridView.classList.add('hidden');
    this.formView.classList.add('hidden');
    this.input.focus();
  }

  // ── Output helpers ─────────────────────────────────────────────────────

  printLine(text: string, cls?: string) {
    const span = document.createElement('span');
    span.className = 't-line' + (cls ? ' ' + cls : '');
    span.textContent = text;
    this.output.appendChild(span);
    this.output.scrollTop = this.output.scrollHeight;
  }

  private printWelcome() {
    [
      { text: '╔══════════════════════════════════════════════════╗', cls: 'hdr' },
      { text: '║          W e b B a s e - I I I   v 0.2          ║', cls: 'hdr' },
      { text: '╚══════════════════════════════════════════════════╝', cls: 'hdr' },
      { text: 'Server-powered dBASE III — multi-user SQLite backend', cls: 'info' },
      { text: 'Type HELP for a list of commands.', cls: 'info' },
      { text: '' },
      { text: 'Quick start:', cls: 'hdr' },
      { text: '  CREATE TABLE customers (name CHAR(40), phone CHAR(20), country CHAR(30))', cls: 'out' },
      { text: '  USE customers', cls: 'out' },
      { text: '  BROWSE', cls: 'out' },
      { text: '' },
    ].forEach(l => this.printLine(l.text, l.cls));
  }
}
