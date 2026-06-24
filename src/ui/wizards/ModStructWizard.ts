import { WizardShell } from './WizardShell';
import type { ColInfo } from '../../shared/types';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TYPES = ['CHAR', 'NUM', 'INT', 'DATE', 'LOGICAL', 'MEMO'] as const;

// Map an existing SQLite storage type back to a W3Script type for the picker.
function w3type(sqlType: string): string {
  const t = (sqlType || '').toUpperCase();
  if (t.includes('INT')) return 'INT';
  if (t.includes('REAL') || t.includes('NUM') || t.includes('FLOA') || t.includes('DOUB') || t.includes('DEC')) return 'NUM';
  return 'CHAR';
}

interface Row {
  origName: string;        // '' for newly-added rows
  origType: string;        // W3Script type at load time
  name: HTMLInputElement;
  type: HTMLSelectElement;
  drop: HTMLInputElement;  // checkbox: mark for deletion
}

export function openModStructWizard(
  table: string,
  columns: ColInfo[],
  run: (cmd: string) => void,
  onClose: () => void,
): void {
  let shell: WizardShell;
  const rows: Row[] = [];
  const colsWrap = document.createElement('div');

  const buildCommands = (): { cmds: string[]; err: string } => {
    const cmds: string[] = [];
    const seen = new Set<string>();
    for (const r of rows) {
      const newName = r.name.value.trim();
      if (r.origName && r.drop.checked) {            // existing row marked dropped
        cmds.push(`ALTER TABLE ${table} DROP ${r.origName}`);
        continue;
      }
      if (!newName) {
        if (r.origName) return { cmds: [], err: `Column name required for ${r.origName}` };
        continue;                                     // blank new row → ignore
      }
      if (!NAME_RE.test(newName)) return { cmds: [], err: `Invalid column name: ${newName}` };
      if (seen.has(newName.toUpperCase())) return { cmds: [], err: `Duplicate column: ${newName}` };
      seen.add(newName.toUpperCase());
      const newType = r.type.value;
      if (!r.origName) {                              // brand new column
        cmds.push(`ALTER TABLE ${table} ADD ${newName} ${newType}`);
        continue;
      }
      if (newName.toUpperCase() !== r.origName.toUpperCase()) {
        cmds.push(`ALTER TABLE ${table} RENAME ${r.origName} TO ${newName}`);
      }
      if (newType !== r.origType) {
        cmds.push(`ALTER TABLE ${table} ALTER ${newName} ${newType}`);
      }
    }
    return { cmds, err: '' };
  };

  const update = () => {
    const { cmds, err } = buildCommands();
    shell.setPreview(cmds.length ? cmds.join('\n') : null, err);
  };

  const addRow = (col?: ColInfo) => {
    const wrap = document.createElement('div');
    wrap.className = 'wz-row';
    const name = document.createElement('input');
    name.type = 'text'; name.className = 'wz-col-name'; name.placeholder = 'column';
    name.style.minWidth = '140px';
    name.value = col?.name ?? '';
    const type = document.createElement('select');
    type.className = 'wz-col-type';
    const startType = col ? w3type(col.type) : 'CHAR';
    for (const t of TYPES) {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      if (t === startType) o.selected = true;
      type.appendChild(o);
    }
    const drop = document.createElement('input');
    drop.type = 'checkbox'; drop.title = 'drop this column';
    const dropLabel = document.createElement('label');
    dropLabel.append(drop, document.createTextNode(' drop'));
    if (!col) dropLabel.style.visibility = 'hidden';   // new rows can't be "dropped"
    wrap.append(name, type, dropLabel);
    colsWrap.appendChild(wrap);
    rows.push({ origName: col?.name ?? '', origType: startType, name, type, drop });
    for (const el of [name, type, drop]) el.addEventListener('input', update);
    drop.addEventListener('change', update);
  };

  shell = new WizardShell(
    `Modify structure — ${table}`,
    'Rename or retype columns in place, tick "drop" to remove one, or add new columns. Changes that touch a column drop the table\'s indexes (rebuild with INDEX ON).',
    { okLabel: 'Apply changes', onOk: () => {
        const { cmds } = buildCommands();
        for (const c of cmds) run(c);
        shell.close();
      } },
    onClose,
  );
  shell.field('Columns', colsWrap);
  for (const c of columns) addRow(c);
  const addBtn = document.createElement('button');
  addBtn.className = 'secondary';
  addBtn.textContent = '+ add column';
  addBtn.addEventListener('click', () => { addRow(); });
  shell.field('', addBtn);
  update();
}
