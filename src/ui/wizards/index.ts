import type { WsClient } from '../../ws/WsClient';
import type { Terminal } from '../../terminal/Terminal';
import type { Catalog } from '../../shared/types';
import type { WizardName } from '../Assistant';
import { openDatabaseWizard } from './DatabaseWizard';
import { openTableWizard } from './TableWizard';
import { openFilterWizard } from './FilterWizard';
import { openIndexWizard } from './IndexWizard';
import { openSearchWizard } from './SearchWizard';

function showWizardView(): void {
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
  showWizardView();
  switch (name) {
    case 'database': return openDatabaseWizard(run, onClose);
    case 'table':    return openTableWizard(run, onClose);
    case 'filter':   return openFilterWizard(getCatalog(), run, onClose);
    case 'index':    return openIndexWizard(getCatalog(), run, onClose);
    case 'search':   return openSearchWizard(getCatalog(), run, onClose);
    default:
      console.warn(`wizard not implemented yet: ${name}`, arg, ws, getCatalog);
      onClose();
  }
}
