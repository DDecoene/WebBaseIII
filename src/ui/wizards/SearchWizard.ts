import { WizardShell } from './WizardShell';
import { quoteValue } from './FilterWizard';
import type { Catalog } from '../../shared/types';

export function openSearchWizard(catalog: Catalog, run: (cmd: string) => void, onClose: () => void): void {
  let shell: WizardShell;

  const idx = document.createElement('select');
  idx.id = 'wz-search-idx';
  for (const i of catalog.indexes) {
    const o = document.createElement('option');
    o.value = i.tag;
    o.textContent = `${i.tag} (${i.expression})${i.active ? ' — active' : ''}`;
    if (i.active) o.selected = true;
    idx.appendChild(o);
  }
  const val = document.createElement('input');
  val.type = 'text'; val.id = 'wz-search-val';

  const update = () => {
    if (!catalog.indexes.length) { shell.setPreview(null, 'No indexes on this table — create one first.'); return; }
    const { val: v, err } = quoteValue(val.value);
    if (v === null) { shell.setPreview(null, err); return; }
    shell.setPreview(`SET INDEX TO ${idx.value}\nSEEK ${v}`);
  };

  shell = new WizardShell(
    'Find record',
    'Activates the chosen index, then SEEKs the value (exact match on the index expression).',
    { okLabel: 'Find', onOk: () => {
        const { val: v } = quoteValue(val.value);
        if (v !== null && catalog.indexes.length) {
          run(`SET INDEX TO ${idx.value}`);
          run(`SEEK ${v}`);
          shell.close();
        }
      } },
    onClose,
  );
  shell.field('Index', idx);
  shell.field('Value', val);
  for (const el of [idx, val]) el.addEventListener('input', update);
  update();
  val.focus();
}
