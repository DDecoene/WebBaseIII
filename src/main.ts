import './styles/main.css';
import { WsClient } from './ws/WsClient';
import { Terminal } from './terminal/Terminal';

async function boot() {
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
