import { DatabaseBridge } from '../db/DatabaseBridge';

export interface GridOptions {
  table: string;
  filter: string | null;
  db: DatabaseBridge;
  onExit: () => void;
  onStatusChange: (msg: string) => void;
}

interface Row { _rowid: number; [key: string]: unknown; }

export class Grid {
  private table: string;
  private filter: string | null;
  private db: DatabaseBridge;
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
    this.db = opts.db;
    this.onExit = opts.onExit;
    this.onStatus = opts.onStatusChange;

    this.container = document.getElementById('grid-scroll-container')!;
    this.thead = document.getElementById('grid-thead')!;
    this.tbody = document.getElementById('grid-tbody')!;
    this.info = document.getElementById('grid-info')!;

    this.boundKey = this.handleKey.bind(this);
  }

  async mount() {
    await this.loadData();
    this.render();
    document.addEventListener('keydown', this.boundKey, true);
    this.container.focus();
    this.scrollIntoView();
  }

  unmount() {
    document.removeEventListener('keydown', this.boundKey, true);
  }

  private async loadData() {
    const where = this.filter ? ` WHERE ${this.filter}` : '';
    const sql = `SELECT rowid as _rowid, * FROM "${this.table}"${where} LIMIT 2000`;
    const raw = await this.db.query(sql);
    this.rows = raw as Row[];
    this.cols = this.rows.length > 0
      ? Object.keys(this.rows[0]).filter(c => c !== '_rowid')
      : (await this.db.getStructure(this.table)).map(c => c.name);
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

    inp.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault(); e.stopPropagation();
        await this.commitEdit(inp.value);
        if (e.key === 'Tab') this.selectCell(ri, ci + 2);
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        this.cancelEdit();
      }
    });
  }

  private async commitEdit(val: string) {
    if (!this.editingCell) return;
    const { r, c } = this.editingCell;
    const colName = this.cols[c];
    const rowid = this.rows[r]._rowid;
    try {
      await this.db.exec(`UPDATE "${this.table}" SET "${colName}" = ? WHERE rowid = ?`, [val, rowid]);
      this.rows[r][colName] = val;
    } catch (e: unknown) {
      this.onStatus(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    this.editingCell = null;
    this.renderBody();
    this.refreshSelection();
  }

  private cancelEdit() {
    this.editingCell = null;
    this.renderBody();
    this.refreshSelection();
  }

  private async newRow() {
    const colDefs = await this.db.getStructure(this.table);
    const fields = colDefs.filter(c => !c.pk).map(c => `"${c.name}"`).join(', ');
    const vals = colDefs.filter(c => !c.pk).map(() => 'NULL').join(', ');
    if (fields) {
      await this.db.exec(`INSERT INTO "${this.table}" (${fields}) VALUES (${vals})`);
    } else {
      await this.db.exec(`INSERT INTO "${this.table}" DEFAULT VALUES`);
    }
    await this.loadData();
    this.selRow = this.rows.length - 1;
    this.renderBody();
    this.refreshSelection();
    this.scrollIntoView();
  }

  private async deleteRow() {
    if (!this.rows.length) return;
    const rowid = this.rows[this.selRow]._rowid;
    await this.db.exec(`DELETE FROM "${this.table}" WHERE rowid = ?`, [rowid]);
    await this.loadData();
    this.selRow = Math.min(this.selRow, this.rows.length - 1);
    this.renderBody();
    this.refreshSelection();
  }

  private handleKey(e: KeyboardEvent) {
    if (this.editingCell) return;

    switch (e.key) {
      case 'Escape': e.preventDefault(); this.onExit(); break;
      case 'F5':     e.preventDefault(); this.loadData().then(() => this.render()); break;
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
