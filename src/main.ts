import './styles/main.css';
import { WsClient } from './ws/WsClient';
import { Terminal } from './terminal/Terminal';
import { Assistant } from './ui/Assistant';
import { openWizard, openModStructWizard } from './ui/wizards';

async function boot() {
  const versionEl = document.getElementById('status-version');
  if (versionEl) versionEl.textContent = `v${__APP_VERSION__}`;

  const ws = new WsClient();

  const statusEl = document.createElement('span');
  statusEl.className = 't-line info';
  statusEl.textContent = 'Connecting to WebBase-III server…';
  document.getElementById('terminal-output')?.appendChild(statusEl);

  await ws.waitReady();

  statusEl.textContent = 'Connected.';
  statusEl.className = 't-line ok';

  const terminal = new Terminal(ws);
  terminal.mount();

  const assistant = new Assistant(ws, {
    run: (cmd) => terminal.runCommand(cmd),
    openWizard: (name, arg) => openWizard(name, arg, ws, terminal, () => assistant.latestCatalog(), () => assistant.refresh()),
  });

  ws.on('modstruct-open', (msg) => {
    const m = msg as any;
    terminal.closeActiveView();
    document.getElementById('terminal-view')!.classList.add('hidden');
    document.getElementById('wizard-view')!.classList.remove('hidden');
    openModStructWizard(
      m.table,
      m.columns,
      (cmd: string) => { terminal.runCommand(cmd); assistant.refresh(); },
      () => terminal.showTerminal(),
    );
  });
}

boot().catch(err => {
  const out = document.getElementById('terminal-output');
  if (out) {
    const el = document.createElement('span');
    el.className = 't-line error';
    el.textContent = `Fatal: ${err instanceof Error ? err.message : String(err)}`;
    out.appendChild(el);
  }
  console.error('WebBase-III boot error:', err);
});
