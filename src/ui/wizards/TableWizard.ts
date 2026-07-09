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
      if (NEEDS_LEN.has(t)) {
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
    len.type = 'text'; len.className = 'wz-col-len'; len.placeholder = 'len'; len.style.minWidth = '50px'; len.style.width = '50px';
    row.append(name, type, len);
    colsWrap.appendChild(row);
    rows.push({ name, type, len });
    for (const el of [name, type, len]) el.addEventListener('input', update);
  };

  shell = new WizardShell(
    'New table',
    'Define columns; blank rows are ignored. CHAR and NUM need a length; TIME takes an optional minute-granularity (e.g. 15).',
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
