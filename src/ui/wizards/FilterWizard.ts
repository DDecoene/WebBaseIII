import { WizardShell } from './WizardShell';
import type { Catalog } from '../../shared/types';

const OPS = ['==', '!=', '>', '<', '>=', '<='] as const;

export function quoteValue(raw: string): { val: string | null; err: string } {
  const v = raw.trim();
  if (!v) return { val: null, err: '' };
  if (/^-?\d+(\.\d+)?$/.test(v)) return { val: v, err: '' };
  if (v.includes('"')) return { val: null, err: 'Double quotes are not allowed in values.' };
  return { val: `"${v}"`, err: '' };
}

export function openFilterWizard(catalog: Catalog, run: (cmd: string) => void, onClose: () => void): void {
  let shell: WizardShell;

  const col = document.createElement('select');
  col.id = 'wz-filter-col';
  for (const c of catalog.columns) {
    const o = document.createElement('option');
    o.value = c.name; o.textContent = `${c.name} (${c.type})`;
    col.appendChild(o);
  }
  const op = document.createElement('select');
  op.id = 'wz-filter-op';
  for (const o of OPS) {
    const e = document.createElement('option');
    e.value = o; e.textContent = o;
    op.appendChild(e);
  }
  const val = document.createElement('input');
  val.type = 'text'; val.id = 'wz-filter-val';

  const update = () => {
    const { val: v, err } = quoteValue(val.value);
    if (!col.value || v === null) { shell.setPreview(null, err); return; }
    shell.setPreview(`SET FILTER TO ${col.value} ${op.value} ${v}`);
  };

  shell = new WizardShell(
    'Filter records',
    'Only rows matching the condition are shown by LIST, BROWSE, and reports. Use "Clear filter" to remove.',
    { okLabel: 'Apply filter', onOk: () => {
        const { val: v } = quoteValue(val.value);
        if (v !== null) { run(`SET FILTER TO ${col.value} ${op.value} ${v}`); shell.close(); }
      } },
    onClose,
  );
  shell.field('Column', col);
  shell.field('Operator', op);
  shell.field('Value', val);
  for (const el of [col, op, val]) el.addEventListener('input', update);
  update();
  val.focus();
}
