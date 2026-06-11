import { WizardShell } from './WizardShell';
import type { Catalog } from '../../shared/types';

const TAG_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function normalizeExpr(raw: string): string {
  return raw.trim().replace(/[\r\n]+/g, ' ');
}

export function openIndexWizard(catalog: Catalog, run: (cmd: string) => void, onClose: () => void): void {
  let shell: WizardShell;

  const expr = document.createElement('input');
  expr.type = 'text'; expr.id = 'wz-index-expr';
  expr.placeholder = catalog.columns[0]?.name ?? 'column or expression';

  const tag = document.createElement('input');
  tag.type = 'text'; tag.id = 'wz-index-tag';

  const update = () => {
    const e = normalizeExpr(expr.value);
    const t = tag.value.trim();
    if (!e || !t) { shell.setPreview(null, ''); return; }
    if (!TAG_RE.test(t)) { shell.setPreview(null, 'Invalid tag name.'); return; }
    shell.setPreview(`INDEX ON ${e} TO ${t}`);
  };

  shell = new WizardShell(
    'New index',
    'Index on a column or expression — e.g. NAME or UPPER(NAME). The new index becomes active.',
    { okLabel: 'Create index', onOk: () => {
        run(`INDEX ON ${normalizeExpr(expr.value)} TO ${tag.value.trim()}`); shell.close();
      } },
    onClose,
  );
  shell.field('Expression', expr);
  shell.field('Tag (index name)', tag);
  for (const el of [expr, tag]) el.addEventListener('input', update);
  update();
  expr.focus();
}
