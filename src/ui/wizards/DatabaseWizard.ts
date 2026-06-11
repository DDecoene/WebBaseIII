import { WizardShell } from './WizardShell';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function openDatabaseWizard(run: (cmd: string) => void, onClose: () => void): void {
  let shell: WizardShell;
  const input = document.createElement('input');
  input.type = 'text';
  input.id = 'wz-db-name';

  const update = () => {
    const name = input.value.trim();
    if (!name) { shell.setPreview(null, ''); return; }
    if (!NAME_RE.test(name)) { shell.setPreview(null, 'Letters, digits and _ only; must not start with a digit.'); return; }
    shell.setPreview(`USE DATABASE ${name}`);
  };

  shell = new WizardShell(
    'New database',
    'Creates (or opens) a named SQLite database on the server.',
    { okLabel: 'Create database', onOk: () => { run(`USE DATABASE ${input.value.trim()}`); shell.close(); } },
    onClose,
  );
  shell.field('Database name', input);
  input.addEventListener('input', update);
  update();
  input.focus();
}
