import { Lexer } from '../interpreter/Lexer';
import { Parser } from '../interpreter/Parser';
import { Executor, ExecResult, FormField, OutputLine } from '../interpreter/Executor';
import { Grid } from '../ui/Grid';
import { FormLayout } from '../ui/FormLayout';

const HISTORY_LIMIT = 200;

// Block-opening keywords that require matching closer
const BLOCK_OPENERS: Record<string, string> = { IF: 'ENDIF', 'DO WHILE': 'ENDDO', 'DO': 'ENDDO' };
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

  private executor: Executor;
  private history: string[] = [];
  private histIdx = -1;
  private pendingBlock: string[] = [];
  private blockDepth = 0;
  private grid: Grid | null = null;
  private form: FormLayout | null = null;
  // Continuation resolve for READ command
  private readResolve: ((values: Map<string, string>) => void) | null = null;
  private readNodes: import('../interpreter/Parser').ASTNode[] = [];

  constructor(executor: Executor) {
    this.executor = executor;
    this.output    = document.getElementById('terminal-output')!;
    this.input     = document.getElementById('terminal-input') as HTMLInputElement;
    this.promptEl  = document.getElementById('terminal-prompt')!;
    this.statusDb  = document.getElementById('status-db')!;
    this.statusTable= document.getElementById('status-table')!;
    this.statusRecord= document.getElementById('status-record')!;
    this.termView  = document.getElementById('terminal-view')!;
    this.gridView  = document.getElementById('grid-view')!;
    this.formView  = document.getElementById('form-view')!;
  }

  mount() {
    this.input.addEventListener('keydown', this.handleInputKey.bind(this));
    document.addEventListener('click', () => { if (!this.grid && !this.form) this.input.focus(); });
    this.input.focus();
    this.printWelcome();
  }

  private handleInputKey(e: KeyboardEvent) {
    switch (e.key) {
      case 'Enter': e.preventDefault(); this.submit(); break;
      case 'ArrowUp':
        e.preventDefault();
        if (this.histIdx < this.history.length - 1) {
          this.histIdx++;
          this.input.value = this.history[this.history.length - 1 - this.histIdx];
          requestAnimationFrame(() => { this.input.selectionStart = this.input.selectionEnd = this.input.value.length; });
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

    // Block accumulation mode
    const upperLine = raw.toUpperCase().replace(/;.*$/, '').trim();
    if (this.blockDepth > 0) {
      this.pendingBlock.push(raw);
      const closeWord = upperLine.split(/\s+/)[0];
      if (BLOCK_CLOSERS.has(closeWord)) { this.blockDepth--; }
      else if (Object.keys(BLOCK_OPENERS).some(k => upperLine.startsWith(k))) { this.blockDepth++; }
      if (this.blockDepth === 0) {
        await this.executeBlock();
      } else {
        this.promptEl.textContent = '... ';
      }
      return;
    }

    // Detect block opener
    const firstWord = upperLine.split(/\s+/).slice(0, 2).join(' ');
    if (Object.keys(BLOCK_OPENERS).some(k => upperLine === k || upperLine.startsWith(k + ' '))) {
      this.pendingBlock = [raw];
      this.blockDepth = 1;
      this.promptEl.textContent = '... ';
      return;
    }

    void firstWord; // suppress lint

    await this.runCommand(raw);
  }

  private async executeBlock() {
    const src = this.pendingBlock.join('\n');
    this.pendingBlock = [];
    this.promptEl.textContent = '. ';
    await this.runCommand(src);
  }

  async runCommand(src: string) {
    try {
      const tokens = new Lexer(src).tokenize();
      const nodes  = new Parser(tokens).parse();
      await this.executeNodes(nodes);
    } catch (e: unknown) {
      this.printLine(`** ${e instanceof Error ? e.message : String(e)}`, 'error');
    }
    this.updateStatus();
  }

  private async executeNodes(nodes: import('../interpreter/Parser').ASTNode[]) {
    // Run nodes one by one so we can intercept READ mid-script
    for (let i = 0; i < nodes.length; i++) {
      const result = await this.executor.exec(nodes[i]);
      this.flushOutput(result);

      if (result.action === 'BROWSE') {
        this.openGrid();
        return;
      }
      if (result.action === 'CLEAR') {
        this.clearScreen();
        return;
      }
      if (result.action === 'QUIT') {
        this.printLine('Goodbye.', 'ok');
        return;
      }
      if (result.action === 'FORM_READY' && result.formFields) {
        // Remaining nodes will run after form submission
        const remaining = nodes.slice(i + 1);
        await this.openForm(result.formFields, remaining);
        return;
      }
    }
  }

  private flushOutput(r: ExecResult) {
    r.output.forEach(l => this.printLine(l.text, l.cls));
  }

  // ── Views ──────────────────────────────────────────────────────────────

  private openGrid() {
    const st = this.executor.state;
    if (!st.table) { this.printLine('No table selected — use: USE <tablename>', 'error'); return; }

    this.termView.classList.add('hidden');
    this.gridView.classList.remove('hidden');

    this.grid = new Grid({
      table: st.table,
      filter: st.filter,
      db: this.executor['db'] as import('../db/DatabaseBridge').DatabaseBridge,
      onExit: () => this.closeGrid(),
      onStatusChange: (m) => { this.statusRecord.textContent = m; },
    });
    this.grid.mount();
  }

  private closeGrid() {
    this.grid?.unmount();
    this.grid = null;
    this.gridView.classList.add('hidden');
    this.termView.classList.remove('hidden');
    this.input.focus();
    this.updateStatus();
    this.printLine('Returned from BROWSE', 'info');
  }

  private async openForm(fields: FormField[], remaining: import('../interpreter/Parser').ASTNode[]) {
    this.termView.classList.add('hidden');
    this.formView.classList.remove('hidden');

    this.form = new FormLayout(
      async (values) => {
        values.forEach((v, k) => this.executor.setVar(k, v));
        this.closeForm();
        await this.executeNodes(remaining);
        this.updateStatus();
      },
      () => {
        this.closeForm();
        this.printLine('READ cancelled', 'warn');
        this.updateStatus();
      }
    );
    this.form.render(fields, this.executor.state.vars);
  }

  private closeForm() {
    this.form?.unmount();
    this.form = null;
    this.formView.classList.add('hidden');
    this.termView.classList.remove('hidden');
    this.input.focus();
  }

  private clearScreen() {
    this.output.innerHTML = '';
    this.printLine('Screen cleared.', 'info');
  }

  // ── Output helpers ──────────────────────────────────────────────────────

  printLine(text: string, cls?: string) {
    const span = document.createElement('span');
    span.className = 't-line' + (cls ? ' ' + cls : '');
    span.textContent = text;
    this.output.appendChild(span);
    this.output.scrollTop = this.output.scrollHeight;
  }

  printLines(lines: OutputLine[]) {
    lines.forEach(l => this.printLine(l.text, l.cls));
  }

  private updateStatus() {
    const s = this.executor.state;
    this.statusDb.textContent    = s.db    ? `[ ${s.db} ]`    : '[ No DB ]';
    this.statusTable.textContent = s.table ? `[ ${s.table} ]` : '[ No Table ]';
  }

  private printWelcome() {
    const lines = [
      { text: '╔══════════════════════════════════════════════════╗', cls: 'hdr' },
      { text: '║          W e b B a s e - I I I   v 0.1          ║', cls: 'hdr' },
      { text: '╚══════════════════════════════════════════════════╝', cls: 'hdr' },
      { text: '' },
      { text: 'Browser-native dBASE III — powered by SQLite Wasm + OPFS', cls: 'info' },
      { text: 'Type HELP for a list of commands.', cls: 'info' },
      { text: '' },
      { text: 'Quick start:', cls: 'hdr' },
      { text: '  CREATE TABLE customers (name CHAR(40), phone CHAR(20), country CHAR(30))', cls: 'out' },
      { text: '  USE customers', cls: 'out' },
      { text: '  BROWSE', cls: 'out' },
      { text: '' },
    ];
    lines.forEach(l => this.printLine(l.text, l.cls));
  }
}
