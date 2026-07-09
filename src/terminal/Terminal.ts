import { WsClient } from '../ws/WsClient';
import { Grid } from '../ui/Grid';
import { FormLayout } from '../ui/FormLayout';
import { ProgramEditor } from '../ui/ProgramEditor';
import { ReportPreview } from '../ui/ReportPreview';
import type { OutputLine, FormField } from '../shared/types';

const HISTORY_LIMIT = 200;

const BLOCK_OPENERS: Record<string, string> = { IF: 'ENDIF', 'DO WHILE': 'ENDDO' };
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
  private editorView: HTMLElement;
  private reportView: HTMLElement;
  private wizardView: HTMLElement;

  private ws: WsClient;
  private history: string[] = [];
  private histIdx = -1;
  private pendingBlock: string[] = [];
  private blockDepth = 0;
  private grid: Grid | null = null;
  private form: FormLayout | null = null;
  private editor: ProgramEditor | null = null;
  private report: ReportPreview | null = null;

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
    this.editorView  = document.getElementById('editor-view')!;
    this.reportView  = document.getElementById('report-preview-view')!;
    this.wizardView  = document.getElementById('wizard-view')!;

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
      this.openGrid(m.table, m.filter, m.columns, m.columnTypes, m.rows);
    });

    ws.on('data-changed', (msg) => {
      const m = msg as any;
      // Only refresh if we're currently BROWSE-ing the affected table.
      if (this.grid && this.grid.tableName.toLowerCase() === String(m.table).toLowerCase()) {
        this.ws.send({ type: 'grid-refresh' });
      }
    });

    ws.on('csv-download', (msg) => {
      const m = msg as any;
      const blob = new Blob([m.content], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = m.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    ws.on('csv-upload-open', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.csv,text/csv';
      input.style.display = 'none';
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        input.remove();
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { // keep in sync with MAX_IMPORT_BYTES in src/shared/csv.ts
          this.printLine(`** ${file.name} is ${(file.size / 1048576).toFixed(1)} MB; the limit is 5 MB.`, 'error');
          return;
        }
        const reader = new FileReader();
        reader.onload = () => this.ws.send({ type: 'csv-upload', filename: file.name, content: String(reader.result ?? '') });
        reader.readAsText(file);
      });
      document.body.appendChild(input);
      input.click();
    });

    ws.on('form-open', (msg) => {
      const m = msg as any;
      this.openForm(m.fields);
    });

    ws.on('view-terminal', () => {
      this.showTerminal();
    });

    ws.on('program-open', (msg) => {
      const m = msg as any;
      this.openEditor(m.name, m.content);
    });

    ws.on('report-preview', (msg) => {
      const m = msg as any;
      this.openReport(m.html);
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

  private openGrid(table: string, filter: string | null, columns: any[], columnTypes: any, rows: any[]) {
    this.termView.classList.add('hidden');
    this.gridView.classList.remove('hidden');

    this.grid = new Grid({
      table,
      filter,
      columns,
      columnTypes: columnTypes ?? {},
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

  private openEditor(name: string, content: string) {
    if (!this.editor) {
      this.editor = new ProgramEditor(this.ws, () => {
        this.editor = null;
        this.showTerminal();
      });
    }
    this.termView.classList.add('hidden');
    this.editorView.classList.remove('hidden');
    this.editor.open(name, content);
  }

  private openReport(html: string) {
    if (!this.report) {
      this.report = new ReportPreview(() => {
        this.report = null;
        this.showTerminal();
      });
    }
    this.termView.classList.add('hidden');
    this.reportView.classList.remove('hidden');
    this.report.show(html);
  }

  private closeReport() {
    this.report?.hide();
    this.report = null;
    this.reportView.classList.add('hidden');
    this.showTerminal();
  }

  /** Tear down whatever main-area view is currently active and return to terminal state.
   *  Called by the wizard dispatcher before opening a wizard so views never double-stack. */
  closeActiveView() {
    if (this.grid) {
      this.grid.unmount();
      this.grid = null;
      this.gridView.classList.add('hidden');
    }
    if (this.form) {
      this.form.unmount();
      this.form = null;
      this.formView.classList.add('hidden');
    }
    if (this.editor) {
      // Remove the editor's key listener without triggering its onClose callback.
      this.editor.unmount();
      this.editor = null;
    }
    if (this.report) {
      // Hide the report view/iframe without triggering its onClose callback.
      this.reportView.classList.add('hidden');
      (document.getElementById('report-iframe') as HTMLIFrameElement | null)?.setAttribute('srcdoc', '');
      this.report = null;
    }
  }

  showTerminal() {
    this.termView.classList.remove('hidden');
    this.gridView.classList.add('hidden');
    this.formView.classList.add('hidden');
    this.editorView.classList.add('hidden');
    this.reportView.classList.add('hidden');
    this.wizardView.classList.add('hidden');
    this.input.focus();
  }

  /** Submit a command exactly as if the user typed it: echo + send. Used by the Assistant.
      Single statements only — bypasses block accumulation and keyboard history. */
  runCommand(raw: string) {
    this.printLine(`. ${raw}`, 'echo');
    this.ws.send({ type: 'command', text: raw });
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
      { text: `║        W e b B a s e - I I I   v ${__APP_VERSION__}        ║`, cls: 'hdr' },
      { text: '╚══════════════════════════════════════════════════╝', cls: 'hdr' },
      { text: 'Server-powered dBASE III — multi-user SQLite backend', cls: 'info' },
      { text: 'Type HELP for a list of commands.', cls: 'info' },
      { text: '' },
      { text: 'Quick start:', cls: 'hdr' },
      { text: '  CREATE TABLE customers (name CHAR(40), phone CHAR(20), country CHAR(30))', cls: 'out' },
      { text: '  USE customers', cls: 'out' },
      { text: '  BROWSE', cls: 'out' },
      { text: '' },
      { text: 'Try a full example app:', cls: 'hdr' },
      { text: '  DO crm         — a working mini-CRM (companies, contacts, deals)', cls: 'out' },
      { text: '  DO inventory   — a working stock manager (categories, products, movements)', cls: 'out' },
      { text: '  These are complete, editable programs — EDIT crm to build your own.', cls: 'info' },
      { text: '' },
    ].forEach(l => this.printLine(l.text, l.cls));
  }
}
