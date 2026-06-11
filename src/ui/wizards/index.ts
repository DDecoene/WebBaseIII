import type { WsClient } from '../../ws/WsClient';
import type { Terminal } from '../../terminal/Terminal';
import type { Catalog } from '../../shared/types';
import type { WizardName } from '../Assistant';

export function openWizard(
  name: WizardName,
  arg: string | undefined,
  ws: WsClient,
  terminal: Terminal,
  getCatalog: () => Catalog,
  refresh: () => void,
): void {
  console.warn(`wizard not implemented yet: ${name}`, arg, ws, terminal, getCatalog, refresh);
}
