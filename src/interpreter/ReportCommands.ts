import type { ExecResult } from './Executor.js';
import type { ReportDef, IDatabaseBridge, WorkArea, ClientSideEffect } from '../shared/types.js';
import { ReportRunner } from '../../server/ReportRunner.js';
import { reportStore } from '../../server/ReportStore.js';

export interface ReportCommandsHost {
  readonly area: WorkArea;
  readonly db: IDatabaseBridge;
  onSideEffect: ((e: ClientSideEffect) => void) | null;
}

const BLANK_REPORT = JSON.stringify({
  title: 'New Report',
  pageWidth: 80,
  columns: [
    { field: 'field1', heading: 'Heading 1', width: 20 },
    { field: 'field2', heading: 'Heading 2', width: 20, total: false }
  ],
  groupBy: '',
  pageHeader: '',
  pageFooter: 'Page {PAGE}'
}, null, 2);

const runner = new ReportRunner();

export class ReportCommands {
  constructor(private host: ReportCommandsHost) {}

  doCreateReport(name: string): ExecResult {
    const safeName = name.toLowerCase();
    const existing = reportStore.load(safeName) ?? BLANK_REPORT;
    return { output: [], action: 'EDIT_PRG', prgName: `__report_${safeName}`, prgContent: existing } as any;
  }

  doModifyReport(name: string): ExecResult {
    const safeName = name.toLowerCase();
    const content = reportStore.load(safeName) ?? BLANK_REPORT;
    return { output: [], action: 'EDIT_PRG', prgName: `__report_${safeName}`, prgContent: content } as any;
  }

  async doReportForm(name: string): Promise<ExecResult> {
    const safeName = name.toLowerCase();
    const json = reportStore.load(safeName);
    if (!json) return { output: [{ text: `** Report '${safeName}' not found`, cls: 'error' }] };
    if (!this.host.area.table) return { output: [{ text: '** No table open', cls: 'error' }] };

    let def: ReportDef;
    try {
      def = JSON.parse(json) as ReportDef;
    } catch (e) {
      return { output: [{ text: `** Invalid report definition: ${(e as Error).message}`, cls: 'error' }] };
    }

    const filter = this.host.area.filter;
    const sql = `SELECT * FROM ${JSON.stringify(this.host.area.table)}${filter ? ` WHERE ${filter}` : ''}`;
    const rows = await this.host.db.query(sql);
    const { ascii, html } = runner.run(def, rows);
    const lines = ascii.split('\n').map(text => ({ text }));
    // Emit the preview as a side-effect so it survives running inside a program
    // block (DO WHILE / DO CASE / IF), where the returned action would be lost.
    this.host.onSideEffect?.({ type: 'report-preview', html });
    return { output: lines };
  }

  doListReports(): ExecResult {
    const names = reportStore.list();
    if (!names.length) return { output: [{ text: '(No reports)', cls: 'info' }] };
    const out = [
      { text: 'Reports:', cls: 'hdr' as const },
      ...names.map(n => ({ text: `  ${n}` })),
    ];
    return { output: out };
  }

  doDeleteReport(name: string): ExecResult {
    const safeName = name.toLowerCase();
    reportStore.delete(safeName);
    return { output: [{ text: `Report deleted: ${safeName}`, cls: 'ok' }] };
  }
}
