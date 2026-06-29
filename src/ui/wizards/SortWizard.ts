import { WizardShell } from './WizardShell';
import type { Catalog } from '../../shared/types';

export function openSortWizard(catalog: Catalog, run: (cmd: string) => void, onClose: () => void): void {
  let shell: WizardShell;

  const field = document.createElement('select');
  field.id = 'wz-sort-field';
  for (const c of catalog.columns) {
    const o = document.createElement('option');
    o.value = c.name; o.textContent = `${c.name} (${c.type})`;
    field.appendChild(o);
  }
  const desc = document.createElement('input');
  desc.type = 'checkbox'; desc.id = 'wz-sort-desc';
  const target = document.createElement('input');
  target.type = 'text'; target.id = 'wz-sort-target';

  const build = (): string | null => {
    const t = target.value.trim();
    if (!field.value || !t) return null;
    return `SORT ON ${field.value}${desc.checked ? '/D' : ''} TO ${t}`;
  };
  const update = () => {
    const cmd = build();
    if (!cmd) { shell.setPreview(null, target.value.trim() ? 'Pick a field to sort on.' : 'Enter a name for the new table.'); return; }
    shell.setPreview(cmd);
  };

  shell = new WizardShell(
    'Sort to new table',
    'Writes a sorted copy of the current table (honouring the active filter) into a new table.',
    { okLabel: 'Sort', onOk: () => { const cmd = build(); if (cmd) { run(cmd); shell.close(); } } },
    onClose,
  );
  shell.field('Field', field);
  shell.field('Descending', desc);
  shell.field('New table', target);
  for (const el of [field, desc, target]) el.addEventListener('input', update);
  update();
  target.focus();
}
