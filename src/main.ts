import './styles/main.css';
import { DatabaseBridge } from './db/DatabaseBridge';
import { Executor } from './interpreter/Executor';
import { Terminal } from './terminal/Terminal';

async function boot() {
  const bridge = new DatabaseBridge();

  const statusEl = document.createElement('span');
  statusEl.className = 't-line info';
  statusEl.textContent = 'Initialising SQLite Wasm engine…';
  document.getElementById('terminal-output')?.appendChild(statusEl);

  const { opfsAvailable } = await bridge.waitReady();

  statusEl.textContent = opfsAvailable
    ? 'SQLite Wasm ready — OPFS persistent storage available.'
    : 'SQLite Wasm ready — OPFS not available, using in-memory storage.';
  statusEl.className = 't-line ' + (opfsAvailable ? 'ok' : 'warn');

  const executor = new Executor(bridge);
  const terminal = new Terminal(executor);
  terminal.mount();
}

boot().catch(err => {
  const out = document.getElementById('terminal-output');
  if (out) {
    const el = document.createElement('span');
    el.className = 't-line error';
    el.textContent = `Fatal boot error: ${err instanceof Error ? err.message : String(err)}`;
    out.appendChild(el);
  }
  console.error('WebBase-III boot error:', err);
});
