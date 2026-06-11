import { WizardShell } from './WizardShell';
import type { WsClient } from '../../ws/WsClient';
import type { Catalog, ReportDef } from '../../shared/types';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Type strings from SQLite PRAGMA include length, e.g. 'NUM(6)', 'CHAR(20)', 'INTEGER'
// Strip the paren suffix before checking.
const NUMERIC_BASES = new Set(['REAL', 'INTEGER', 'NUM', 'INT', 'NUMERIC', 'FLOAT', 'DOUBLE']);

function isNumericType(type: string): boolean {
  return NUMERIC_BASES.has(type.toUpperCase().replace(/\(.*$/, ''));
}

interface ColState {
  name: string;
  type: string;
  include: boolean;
  heading: string;
  width: number;
  total: boolean;
}

export function openReportWizard(
  catalog: Catalog,
  existingName: string | undefined,
  ws: WsClient,
  run: (cmd: string) => void,
  refresh: () => void,
  onClose: () => void,
): void {
  // Load existing definition when editing
  let def: Partial<ReportDef> = {};
  let repName = existingName ?? '';
  if (existingName) {
    const found = catalog.reports.find(r => r.name === existingName);
    if (found) { try { def = JSON.parse(found.content); } catch { def = {}; } }
  }

  const cols: ColState[] = catalog.columns.map(c => {
    const existing = def.columns?.find(dc => dc.field.toUpperCase() === c.name.toUpperCase());
    return {
      name: c.name, type: c.type,
      include: !!existing,
      heading: existing?.heading ?? c.name,
      width: existing?.width ?? 12,
      total: existing?.total ?? false,
    };
  });
  let title = def.title ?? '';
  let groupBy = def.groupBy ?? '';
  let step = 1;

  const buildDef = (): ReportDef => ({
    title,
    pageWidth: 80,
    columns: cols.filter(c => c.include).map(c => ({
      field: c.name, heading: c.heading, width: c.width, ...(c.total ? { total: true } : {}),
    })),
    ...(groupBy ? { groupBy } : {}),
  });

  const save = () => {
    ws.send({ type: 'save-program', name: `__report_${repName}`, content: JSON.stringify(buildDef(), null, 2) });
    refresh();
  };

  const render = () => {
    let collect: () => void = () => {};

    const shell = new WizardShell(
      existingName ? `Edit report: ${existingName}` : 'New report',
      `Step ${step} of 3 — ${step === 1 ? 'name & title' : step === 2 ? 'columns' : 'grouping & save'}`,
      step < 3
        ? { okLabel: 'Next →', onOk: () => { collect(); step++; render(); } }
        : {
            okLabel: 'Save',
            onOk: () => { collect(); save(); shell.close(); },
            extraLabel: 'Save & run',
            onExtra: () => { collect(); save(); shell.close(); run(`REPORT FORM ${repName}`); },
          },
      onClose,
    );

    if (step === 1) {
      const nameIn = document.createElement('input');
      nameIn.type = 'text'; nameIn.id = 'wz-rep-name'; nameIn.value = repName;
      nameIn.disabled = !!existingName;
      const titleIn = document.createElement('input');
      titleIn.type = 'text'; titleIn.id = 'wz-rep-title'; titleIn.value = title;
      shell.field('Report name', nameIn);
      shell.field('Title (printed at top)', titleIn);
      const update = () => {
        const ok = NAME_RE.test(nameIn.value.trim()) && titleIn.value.trim().length > 0;
        shell.setPreview(
          ok ? `(report "${nameIn.value.trim()}")` : null,
          nameIn.value.trim() && !NAME_RE.test(nameIn.value.trim()) ? 'Invalid report name.' : '',
        );
      };
      for (const el of [nameIn, titleIn]) el.addEventListener('input', update);
      collect = () => { repName = nameIn.value.trim(); title = titleIn.value.trim(); };
      update();
      nameIn.focus();
    }

    if (step === 2) {
      const inputs: {
        c: ColState;
        inc: HTMLInputElement;
        head: HTMLInputElement;
        width: HTMLInputElement;
        tot: HTMLInputElement;
      }[] = [];

      for (const c of cols) {
        const row = document.createElement('div');
        row.className = 'wz-row';

        const inc = document.createElement('input');
        inc.type = 'checkbox'; inc.className = 'wz-rep-include'; inc.checked = c.include;

        const name = document.createElement('span');
        name.textContent = c.name;
        name.style.minWidth = '110px';
        name.style.display = 'inline-block';

        const head = document.createElement('input');
        head.type = 'text'; head.value = c.heading;
        head.style.minWidth = '130px'; head.title = 'heading';

        const width = document.createElement('input');
        width.type = 'text'; width.value = String(c.width);
        width.style.minWidth = '44px'; width.style.width = '44px'; width.title = 'width';

        row.append(inc, name, head, width);

        // Keep checkbox indexes aligned: all columns get a .wz-rep-total checkbox.
        // Non-numeric ones are hidden+disabled.
        const tot = document.createElement('input');
        tot.type = 'checkbox'; tot.className = 'wz-rep-total';
        if (isNumericType(c.type)) {
          tot.checked = c.total;
          tot.title = 'total';
          const totLabel = document.createElement('span');
          totLabel.textContent = 'Σ'; totLabel.style.color = '#888';
          row.append(tot, totLabel);
        } else {
          tot.disabled = true;
          tot.style.visibility = 'hidden';
          row.append(tot);
        }

        shell.body.appendChild(row);
        inputs.push({ c, inc, head, width, tot });
      }

      const update = () => {
        const any = inputs.some(i => i.inc.checked);
        shell.setPreview(
          any ? `(columns: ${inputs.filter(i => i.inc.checked).map(i => i.c.name).join(', ')})` : null,
          any ? '' : 'Include at least one column.',
        );
      };
      for (const i of inputs) {
        for (const el of [i.inc, i.head, i.width, i.tot]) {
          el.addEventListener('input', update);
          el.addEventListener('change', update);
        }
      }
      collect = () => {
        for (const i of inputs) {
          i.c.include = i.inc.checked;
          i.c.heading = i.head.value.trim() || i.c.name;
          i.c.width = Math.max(1, parseInt(i.width.value, 10) || 12);
          i.c.total = i.tot.checked && !i.tot.disabled;
        }
      };
      update();
    }

    if (step === 3) {
      const group = document.createElement('select');
      group.id = 'wz-rep-group';
      const none = document.createElement('option');
      none.value = ''; none.textContent = '(no grouping)';
      group.appendChild(none);
      for (const c of cols.filter(c => c.include)) {
        const o = document.createElement('option');
        o.value = c.name; o.textContent = c.name;
        if (groupBy === c.name) o.selected = true;
        group.appendChild(o);
      }
      shell.field('Group by (subtotals on value change; set a matching index before running)', group);
      collect = () => { groupBy = group.value; };
      shell.setPreview(`REPORT FORM ${repName}`);
    }
  };

  render();
}
