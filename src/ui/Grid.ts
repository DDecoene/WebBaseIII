import type { WsClient } from '../ws/WsClient';
import type { ColInfo } from '../shared/types';

export interface GridOptions {
  table: string;
  filter: string | null;
  columns: ColInfo[];
  rows: Record<string, unknown>[];
  ws: WsClient;
  onExit: () => void;
  onStatusChange: (msg: string) => void;
}

interface Row { _rowid: number; [key: string]: unknown; }

export class Grid {
  private table: string;
  private filter: string | null;
  private ws: WsClient;
  private onExit: () => void;
  private onStatus: (m: string) => void;

  private rows: Row[] = [];
  private cols: string[] = [];
  private selRow = 0;
  private selCol = 1;
  private editingCell: { r: number; c: number } | null = null;

  private container: HTMLElement;
  private thead: HTMLElement;
  private tbody: HTMLElement;
  private info: HTMLElement;

  private boundKey: (e: KeyboardEvent) => void;

  constructor(opts: GridOptions) {
    this.table = opts.table;
    this.filter = opts.filter;
    this.ws = opts.ws;
    this.onExit = opts.onExit;
    this.onStatus = opts.onStatusChange;

    this.rows = opts.rows as Row[];
    this.cols = this.rows.length > 0
      ? Object.keys(this.rows[0]).filter(c => c !== '_rowid')
      : opts.columns.map(c => c.name);

    this.container = document.getElementById('grid-scroll-container')!;
    this.thead = document.getElementById('grid-thead')!;
    this.tbody = document.getElementById('grid-tbody')!;
    this.info = document.getElementById('grid-info')!;

    this.boundKey = this.handleKey.bind(this);
  }

  mount() {
    this.render();
    document.addEventListener('keydown', this.boundKey, true);

    this.ws.on('grid-open', (msg) => {
      const m = msg as any;
      this.rows = m.rows as Row[];
      this.cols = this.rows.length > 0
        ? Object.keys(this.rows[0]).filter((c: string) => c !== '_rowid')
        : m.columns.map((c: ColInfo) => c.name);
      this.selRow = Math.min(this.selRow, Math.max(0, this.rows.length - 1));
      this.render();
    });

    this.container.focus();
    this.scrollIntoView();
  }

  unmount() {
    document.removeEventListener('keydown', this.boundKey, true);
  }

  private render() {
    this.info.textContent = `BROWSE: ${this.table}   ${this.rows.length} record(s)${this.filter ? '  [FILTER: ' + this.filter + ']' : ''}`;
    this.renderHeader();
    this.renderBody();
  }

  private renderHeader() {
    this.thead.innerHTML = '';
    const tr = document.createElement('tr');
    const th0 = document.createElement('th');
    th0.className = 'rn'; th0.textContent = '#';
    tr.appendChild(th0);
    this.cols.forEach(c => {
      const th = document.createElement('th');
      th.textContent = c;
      th.title = c;
      tr.appendChild(th);
    });
    this.thead.appendChild(tr);
  }

  private renderBody() {
    this.tbody.innerHTML = '';
    this.rows.forEach((row, ri) => {
      const tr = document.createElement('tr');
      tr.dataset.ri = String(ri);
      if (ri === this.selRow) tr.classList.add('sel');

      const td0 = document.createElement('td');
      td0.className = 'rn'; td0.textContent = String(ri + 1);
      tr.appendChild(td0);

      this.cols.forEach((c, ci) => {
        const td = document.createElement('td');
        td.dataset.ri = String(ri);
        td.dataset.ci = String(ci);
        td.textContent = String(row[c] ?? '');
        td.title = String(row[c] ?? '');
        if (ri === this.selRow && ci === this.selCol - 1) td.classList.add('active-cell');
        td.addEventListener('click', () => this.selectCell(ri, ci + 1));
        td.addEventListener('dblclick', () => { this.selectCell(ri, ci + 1); this.startEdit(); });
        tr.appendChild(td);
      });

      this.tbody.appendChild(tr);
    });
  }

  private selectCell(ri: number, ci: number) {
    this.selRow = Math.max(0, Math.min(this.rows.length - 1, ri));
    this.selCol = Math.max(1, Math.min(this.cols.length, ci));
    this.refreshSelection();
    this.scrollIntoView();
  }

  private refreshSelection() {
    this.tbody.querySelectorAll('tr').forEach((tr, ri) => {
      tr.classList.toggle('sel', ri === this.selRow);
    });
    this.tbody.querySelectorAll('td.active-cell').forEach(td => td.classList.remove('active-cell'));
    const td = this.tbody.querySelector<HTMLElement>(`td[data-ri="${this.selRow}"][data-ci="${this.selCol - 1}"]`);
    if (td) td.classList.add('active-cell');
    this.onStatus(`Row ${this.selRow + 1}/${this.rows.length}  Col: ${this.cols[this.selCol - 1] ?? ''}`);
  }

  private scrollIntoView() {
    const tr = this.tbody.querySelector<HTMLElement>(`tr[data-ri="${this.selRow}"]`);
    tr?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private startEdit() {
    if (!this.rows.length || this.editingCell) return;
    const ri = this.selRow; const ci = this.selCol - 1;
    const td = this.tbody.querySelector<HTMLTableCellElement>(`td[data-ri="${ri}"][data-ci="${ci}"]`);
    if (!td) return;

    const colName = this.cols[ci];
    const cur = String(this.rows[ri][colName] ?? '');
    td.classList.add('editing'); td.classList.remove('active-cell');
    const inp = document.createElement('input');
    inp.className = 'cell-ed'; inp.value = cur;
    td.textContent = '';
    td.appendChild(inp);
    inp.focus(); inp.select();
    this.editingCell = { r: ri, c: ci };

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        this.commitEdit(inp.value);
        if (e.key === 'Tab') this.selectCell(ri, ci + 2);
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        this.cancelEdit();
      }
    });
  }

  private commitEdit(newValue: string) {
    if (!this.editingCell) return;
    const { r, c } = this.editingCell;
    const row = this.rows[r];
    this.ws.send({ type: 'grid-edit', rowid: row._rowid as number, col: this.cols[c], value: newValue });
    row[this.cols[c]] = newValue;
    this.editingCell = null;
    this.renderBody();
    this.refreshSelection();
  }

  private cancelEdit() {
    this.editingCell = null;
    this.renderBody();
    this.refreshSelection();
  }

  private newRow() {
    this.ws.send({ type: 'grid-new-row' });
  }

  private deleteRow() {
    const row = this.rows[this.selRow];
    if (!row) return;
    this.ws.send({ type: 'grid-delete', rowid: row._rowid as number });
  }

  private handleKey(e: KeyboardEvent) {
    if (this.editingCell) return;

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        this.ws.send({ type: 'grid-exit' });
        this.onExit();
        break;
      case 'F5':
        e.preventDefault();
        this.ws.send({ type: 'grid-refresh' });
        break;
      case 'ArrowDown':
        e.preventDefault();
        this.selectCell(this.selRow + 1, this.selCol);
        break;
      case 'ArrowUp':
        e.preventDefault();
        this.selectCell(this.selRow - 1, this.selCol);
        break;
      case 'ArrowRight':
        e.preventDefault();
        this.selectCell(this.selRow, this.selCol + 1);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        this.selectCell(this.selRow, this.selCol - 1);
        break;
      case 'Tab':
        e.preventDefault();
        if (e.shiftKey) this.selectCell(this.selRow, this.selCol - 1);
        else this.selectCell(this.selRow, this.selCol + 1);
        break;
      case 'Enter':
      case 'F2':
        e.preventDefault(); this.startEdit(); break;
      case 'n':
        if (e.ctrlKey) { e.preventDefault(); this.newRow(); }
        break;
      case 'Delete':
        if (!e.ctrlKey) { e.preventDefault(); this.deleteRow(); }
        break;
      case 'Home':
        e.preventDefault();
        this.selectCell(0, this.selCol);
        break;
      case 'End':
        e.preventDefault();
        this.selectCell(this.rows.length - 1, this.selCol);
        break;
      case 'PageDown':
        e.preventDefault();
        this.selectCell(Math.min(this.selRow + 20, this.rows.length - 1), this.selCol);
        break;
      case 'PageUp':
        e.preventDefault();
        this.selectCell(Math.max(this.selRow - 20, 0), this.selCol);
        break;
    }
  }
}
