import type { WsClient } from '../../ws/WsClient';
import type { Terminal } from '../../terminal/Terminal';
import type { Catalog } from '../../shared/types';
import type { WizardName } from '../Assistant';
import { openDatabaseWizard } from './DatabaseWizard';
import { openTableWizard } from './TableWizard';
import { openFilterWizard } from './FilterWizard';
import { openIndexWizard } from './IndexWizard';
import { openSearchWizard } from './SearchWizard';
import { openReportWizard } from './ReportWizard';

function showWizardView(terminal: Terminal): void {
  // Tear down any active main-area view (grid, form, editor, report) before opening
  // the wizard so views never double-stack and orphaned key listeners are removed.
  terminal.closeActiveView();
  document.getElementById('terminal-view')!.classList.add('hidden');
  document.getElementById('wizard-view')!.classList.remove('hidden');
}

export function openWizard(
  name: WizardName,
  arg: string | undefined,
  ws: WsClient,
  terminal: Terminal,
  getCatalog: () => Catalog,
  refresh: () => void,
): void {
  const run = (cmd: string) => { terminal.runCommand(cmd); refresh(); };
  const onClose = () => terminal.showTerminal();
  // If a form/grid was suspended (e.g. a DO program paused at READ/BROWSE),
  // showWizardView tears it down client-side; tell the server to abandon the
  // orphaned continuation so a later form-submit can't misfire it.
  ws.send({ type: 'abort-suspended' });
  showWizardView(terminal);
  switch (name) {
    case 'database': return openDatabaseWizard(run, onClose);
    case 'table':    return openTableWizard(run, onClose);
    case 'filter':   return openFilterWizard(getCatalog(), run, onClose);
    case 'index':    return openIndexWizard(getCatalog(), run, onClose);
    case 'search':   return openSearchWizard(getCatalog(), run, onClose);
    case 'report':   return openReportWizard(getCatalog(), arg, ws, run, refresh, onClose);
  }
}
