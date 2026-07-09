import { WizardShell } from './WizardShell';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TYPES = ['CHAR', 'NUM', 'INT', 'DATE', 'TIME', 'LOGICAL', 'MEMO'] as const;
const NEEDS_LEN = new Set(['CHAR', 'NUM']);
const OPTIONAL_LEN = new Set(['TIME']);

interface ColRow { name: HTMLInputElement; type: HTMLSelectElement; len: HTMLInputElement; }

export function openTableWizard(run: (cmd: string) => void, onClose: () => void): void {
  let shell: WizardShell;
  const rows: ColRow[] = [];

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.id = 'wz-table-name';

  const colsWrap = document.createElement('div');

  const buildCommand = (): { cmd: string | null; err: string } => {
    const table = nameInput.value.trim();
    if (!table) return { cmd: null, err: '' };
    if (!NAME_RE.test(table)) return { cmd: null, err: 'Invalid table name.' };
    const cols: string[] = [];
    for (const r of rows) {
      const n = r.name.value.trim();
      if (!n) continue;                       // blank rows are skipped
      if (!NAME_RE.test(n)) return { cmd: null, err: `Invalid column name: ${n}` };
      const t = r.type.value;
      if (t === 'NUM') {
        // Accept a plain width ("8") or a precision,scale pair ("8,2").
        const raw = r.len.value.trim();
        const m = raw.match(/^(\d+)\s*(?:,\s*(\d+))?$/);
        if (!m) return { cmd: null, err: `Length required for ${n} (NUM) — e.g. 8 or 8,2` };
        const p = parseInt(m[1], 10);
        if (!p || p < 1) return { cmd: null, err: `Length required for ${n} (NUM)` };
        if (m[2] === undefined) { cols.push(`${n} NUM(${p})`); continue; }
        const s = parseInt(m[2], 10);
        if (s >= p) return { cmd: null, err: `Scale must be smaller than precision for ${n} (NUM)` };
        cols.push(`${n} NUM(${p},${s})`);
      } else if (NEEDS_LEN.has(t)) {
        const len = parseInt(r.len.value, 10);
        if (!len || len < 1) return { cmd: null, err: `Length required for ${n} (${t})` };
        cols.push(`${n} ${t}(${len})`);
      } else if (OPTIONAL_LEN.has(t)) {
        const raw = r.len.value.trim();
        if (raw) {
          const len = parseInt(raw, 10);
          if (!len || len < 1) return { cmd: null, err: `Invalid granularity for ${n} (${t})` };
          cols.push(`${n} ${t}(${len})`);
        } else {
          cols.push(`${n} ${t}`);
        }
      } else {
        cols.push(`${n} ${t}`);
      }
    }
    if (!cols.length) return { cmd: null, err: 'At least one column.' };
    return { cmd: `CREATE TABLE ${table} (${cols.join(', ')})`, err: '' };
  };

  const update = () => {
    const { cmd, err } = buildCommand();
    shell.setPreview(cmd, err);
  };

  const addRow = () => {
    const row = document.createElement('div');
    row.className = 'wz-row';
    const name = document.createElement('input');
    name.type = 'text'; name.className = 'wz-col-name'; name.placeholder = 'column'; name.style.minWidth = '140px';
    const type = document.createElement('select');
    type.className = 'wz-col-type';
    for (const t of TYPES) {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      type.appendChild(o);
    }
    const len = document.createElement('input');
    len.type = 'text'; len.className = 'wz-col-len'; len.placeholder = 'len'; len.title = 'CHAR: length · NUM: width or precision,scale (8,2) · TIME: minute granularity'; len.style.minWidth = '56px'; len.style.width = '56px';
    row.append(name, type, len);
    colsWrap.appendChild(row);
    rows.push({ name, type, len });
    for (const el of [name, type, len]) el.addEventListener('input', update);
  };

  shell = new WizardShell(
    'New table',
    'Define columns; blank rows are ignored. CHAR needs a length, NUM a width or precision,scale (8 or 8,2); TIME takes an optional minute-granularity (e.g. 15).',
    { okLabel: 'Create table', onOk: () => {
        const { cmd } = buildCommand();
        if (cmd) { run(cmd); shell.close(); }
      } },
    onClose,
  );
  shell.field('Table name', nameInput);
  shell.field('Columns', colsWrap);
  const addBtn = document.createElement('button');
  addBtn.className = 'secondary';
  addBtn.textContent = '+ add column';
  addBtn.addEventListener('click', addRow);
  shell.body.appendChild(addBtn);

  addRow(); addRow(); addRow();
  nameInput.addEventListener('input', update);
  update();
  nameInput.focus();
}
