import { WizardShell } from './WizardShell';
import type { Catalog } from '../../shared/types';

const NUMERIC = /INT|REAL|NUM|DEC|FLOAT|DOUB/i;

export function openAggregateWizard(catalog: Catalog, run: (cmd: string) => void, onClose: () => void): void {
  let shell: WizardShell;

  const op = document.createElement('select');
  op.id = 'wz-agg-op';
  for (const o of ['SUM', 'AVERAGE']) {
    const e = document.createElement('option');
    e.value = o; e.textContent = o === 'SUM' ? 'Sum' : 'Average';
    op.appendChild(e);
  }
  const field = document.createElement('select');
  field.id = 'wz-agg-field';
  const numeric = catalog.columns.filter(c => NUMERIC.test(c.type));
  for (const c of numeric) {
    const o = document.createElement('option');
    o.value = c.name; o.textContent = `${c.name} (${c.type})`;
    field.appendChild(o);
  }

  const update = () => {
    if (!numeric.length) { shell.setPreview(null, 'This table has no numeric fields to total.'); return; }
    shell.setPreview(`${op.value} ${field.value}`);
  };

  shell = new WizardShell(
    'Sum / Average',
    'Totals or averages a numeric field over the current table (honours the active filter).',
    { okLabel: 'Compute', onOk: () => { if (numeric.length) { run(`${op.value} ${field.value}`); shell.close(); } } },
    onClose,
  );
  shell.field('Operation', op);
  shell.field('Field', field);
  for (const el of [op, field]) el.addEventListener('input', update);
  update();
}
