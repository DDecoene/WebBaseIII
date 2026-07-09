import { WsClient } from '../ws/WsClient';
import type { Catalog } from '../shared/types';

export type WizardName = 'database' | 'table' | 'filter' | 'index' | 'search' | 'report' | 'sort' | 'aggregate';

export interface AssistantHost {
  run(cmd: string): void;
  openWizard(name: WizardName, arg?: string): void;
}

type PickerSource = 'databases' | 'tables' | 'indexes' | 'reports' | 'programs';

interface ActionDef {
  label: string;
  needs?: 'db' | 'table';
  command?: string;                 // immediate single command
  commands?: string[];              // immediate sequence
  wizard?: WizardName;
  picker?: PickerSource;
  pickerExtra?: string;             // synthetic first entry, e.g. "(natural order)"
  onPick?: (name: string, host: AssistantHost) => void;
  confirm?: (name: string) => string | null;  // returns confirm() text, null = no confirm
  onRun?: (host: AssistantHost, table: string | null) => void;  // immediate, dynamic command
}

const CATEGORIES: { name: string; actions: ActionDef[] }[] = [
  { name: 'Database', actions: [
    { label: 'Open database…', picker: 'databases', onPick: (n, h) => h.run(`USE DATABASE ${n}`) },
    { label: 'New database…', wizard: 'database' },
  ]},
  { name: 'Tables', actions: [
    { label: 'Open table…', needs: 'db', picker: 'tables', onPick: (n, h) => h.run(`USE ${n}`) },
    { label: 'New table…', needs: 'db', wizard: 'table' },
    { label: 'Structure', needs: 'table', command: 'LIST STRUCTURE' },
    { label: 'Modify structure…', needs: 'db', picker: 'tables',
      onPick: (n, h) => { h.run(`USE ${n}`); h.run('MODIFY STRUCTURE'); } },
    { label: 'Drop table…', needs: 'db', picker: 'tables',
      confirm: n => `Drop table ${n}? This permanently deletes the table and all its data.`,
      onPick: (n, h) => h.run(`DROP TABLE ${n}`) },
    { label: 'Pack database', needs: 'table', command: 'PACK',
      confirm: () => 'VACUUM rewrites the database file to reclaim space. Continue?' },
  ]},
  { name: 'Data', actions: [
    { label: 'Browse', needs: 'table', command: 'BROWSE' },
    { label: 'Add record', needs: 'table', commands: ['APPEND RECORD', 'BROWSE'] },
    { label: 'Filter…', needs: 'table', wizard: 'filter' },
    { label: 'Clear filter', needs: 'table', command: 'SET FILTER TO' },
    { label: 'Export to CSV', needs: 'table', onRun: (h, t) => { if (t) h.run(`COPY TO ${t}.csv`); } },
    { label: 'Import from CSV', needs: 'table', onRun: (h, t) => { if (t) h.run(`APPEND FROM ${t}.csv`); } },
    { label: 'Sort to new table…', needs: 'table', wizard: 'sort' },
    { label: 'Sum / Average…', needs: 'table', wizard: 'aggregate' },
  ]},
  { name: 'Search', actions: [
    { label: 'Set index…', needs: 'table', picker: 'indexes', pickerExtra: '(natural order)',
      onPick: (n, h) => h.run(n === '(natural order)' ? 'SET INDEX TO' : `SET INDEX TO ${n}`) },
    { label: 'New index…', needs: 'table', wizard: 'index' },
    { label: 'Find record…', needs: 'table', wizard: 'search' },
    { label: 'Reindex', needs: 'table', command: 'REINDEX' },
  ]},
  { name: 'Reports', actions: [
    { label: 'Run report…', needs: 'table', picker: 'reports', onPick: (n, h) => h.run(`REPORT FORM ${n}`) },
    { label: 'New report…', needs: 'table', wizard: 'report' },
    { label: 'Edit report…', needs: 'table', picker: 'reports', onPick: (n, h) => h.openWizard('report', n) },
  ]},
  { name: 'Programs', actions: [
    { label: 'Run CRM demo', command: 'DO crm' },
    { label: 'Run Inventory demo', command: 'DO inventory' },
    { label: 'Run Overtime demo', command: 'DO overtime' },
    { label: 'Run program…', picker: 'programs', onPick: (n, h) => h.run(`DO ${n}`) },
    { label: 'Edit program…', picker: 'programs', onPick: (n, h) => h.run(`EDIT ${n}`) },
  ]},
];

export class Assistant {
  private el: HTMLElement;
  private catalog: Catalog = { databases: [], tables: [], columns: [], indexes: [], reports: [], programs: [] };
  private hasDb = false;
  private hasTable = false;
  private activeTable: string | null = null;
  private openPicker: string | null = null;   // label of the action whose picker is expanded

  constructor(private ws: WsClient, private host: AssistantHost) {
    this.el = document.getElementById('assistant-sidebar')!;
    ws.on('catalog', (msg) => {
      this.catalog = (msg as any).catalog;
      this.render();
    });
    ws.on('status', (msg) => {
      const m = msg as any;
      const changed = this.hasDb !== !!m.db || this.hasTable !== !!m.table;
      this.hasDb = !!m.db;
      this.hasTable = !!m.table;
      this.activeTable = m.table ?? null;
      if (changed) this.refresh();
    });
    this.render();
    this.refresh();
  }

  /** Re-request the catalog (server processes WS messages in order, so a
      catalog-request sent after a command reflects post-command state). */
  refresh() {
    this.ws.send({ type: 'catalog-request' });
  }

  /** Used by host: run a command, then refresh pickers. */
  runAndRefresh(cmd: string) {
    this.host.run(cmd);
    this.refresh();
  }

  latestCatalog(): Catalog {
    return this.catalog;
  }

  private pickerItems(src: PickerSource): string[] {
    switch (src) {
      case 'databases': return this.catalog.databases;
      case 'tables':    return this.catalog.tables.map(t => t.name);
      case 'indexes':   return this.catalog.indexes.map(i => i.tag);
      case 'reports':   return this.catalog.reports.map(r => r.name);
      case 'programs':  return this.catalog.programs.filter(p => !p.startsWith('__'));
    }
  }

  private actionEnabled(a: ActionDef): boolean {
    if (a.needs === 'db') return this.hasDb;
    if (a.needs === 'table') return this.hasTable;
    return true;
  }

  private render() {
    const collapsed = this.el.classList.contains('collapsed');
    this.el.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'as-header';
    header.textContent = collapsed ? '»' : 'Assistant  «';
    header.addEventListener('click', () => {
      this.el.classList.toggle('collapsed');
      this.render();
    });
    this.el.appendChild(header);
    if (collapsed) return;

    for (const cat of CATEGORIES) {
      const catEl = document.createElement('div');
      catEl.className = 'as-cat';
      catEl.textContent = cat.name;
      this.el.appendChild(catEl);

      for (const a of cat.actions) {
        const el = document.createElement('div');
        el.className = 'as-action' + (this.actionEnabled(a) ? '' : ' disabled');
        el.textContent = a.label;
        el.addEventListener('click', () => this.activate(a));
        this.el.appendChild(el);

        if (a.picker && this.openPicker === a.label) {
          const items = this.pickerItems(a.picker);
          const all = a.pickerExtra ? [a.pickerExtra, ...items] : items;
          if (!all.length) {
            const empty = document.createElement('div');
            empty.className = 'as-empty';
            empty.textContent = '(none)';
            this.el.appendChild(empty);
          }
          for (const item of all) {
            const pick = document.createElement('div');
            pick.className = 'as-pick';
            pick.textContent = item;
            pick.addEventListener('click', () => {
              this.openPicker = null;
              if (a.confirm) {
                const text = a.confirm(item);
                if (text && !window.confirm(text)) { this.render(); return; }
              }
              a.onPick!(item, this.hostWithRefresh());
              this.render();
            });
            this.el.appendChild(pick);
          }
        }
      }
    }
  }

  private hostWithRefresh(): AssistantHost {
    return {
      run: (cmd) => { this.host.run(cmd); this.refresh(); },
      openWizard: (name, arg) => this.host.openWizard(name, arg),
    };
  }

  private activate(a: ActionDef) {
    if (!this.actionEnabled(a)) return;
    if (a.picker) {
      this.openPicker = this.openPicker === a.label ? null : a.label;
      this.render();
      return;
    }
    this.openPicker = null;
    if (a.confirm) {
      const text = a.confirm(this.activeTable ?? '');
      if (text && !window.confirm(text)) { this.render(); return; }
    }
    if (a.command) { this.host.run(a.command); this.refresh(); }
    if (a.commands) { for (const c of a.commands) this.host.run(c); this.refresh(); }
    if (a.onRun) a.onRun(this.hostWithRefresh(), this.activeTable);
    if (a.wizard) this.host.openWizard(a.wizard);
    this.render();
  }
}
