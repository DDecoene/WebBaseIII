import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import { SessionManager } from './SessionManager.js';
import { seedDemoPrograms, seedDemoReports } from './DemoSeeder.js';

const PORT = Number(process.env.PORT ?? 3000);
const DIST_DIR = path.join(process.cwd(), 'dist');

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// demos/*.prg are the single source of truth — they overwrite store copies on every start
const seededDemos = seedDemoPrograms();
if (seededDemos.length) console.log(`Seeded demo programs: ${seededDemos.join(', ')}`);
const seededReports = seedDemoReports();
if (seededReports.length) console.log(`Seeded demo reports: ${seededReports.join(', ')}`);

const manager = new SessionManager();

const server = http.createServer((req, res) => {
  let urlPath = req.url?.split('?')[0] ?? '/';
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(DIST_DIR, urlPath);

  // Prevent path traversal
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA fallback — serve index.html for unknown paths
      fs.readFile(path.join(DIST_DIR, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(d2);
      });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  const session = manager.add(ws);
  console.log(`Client connected (${manager.size} total)`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      session.handleMessage(msg).catch((err: unknown) => {
        ws.send(JSON.stringify({ type: 'error', message: String(err) }));
      });
    } catch {
      // ignore malformed JSON
    }
  });

  ws.on('close', () => {
    manager.remove(ws);
    console.log(`Client disconnected (${manager.size} total)`);
  });
});

server.listen(PORT, () => {
  console.log(`WebBase-III server → http://localhost:${PORT}`);
});
