# Server-Side Multi-User Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the W3Script interpreter and SQLite database to a Node.js server; replace the browser-side Wasm engine with a WebSocket client; multiple browsers can connect and share the same database.

**Architecture:** A Node.js HTTP+WebSocket server hosts the interpreter (Lexer → Parser → Executor) and SQLite (via `better-sqlite3`). Each browser connection gets its own `Session` with independent interpreter state but shares the same SQLite file(s). The browser is a thin terminal UI that sends command strings and renders output lines received over WebSocket.

**Tech Stack:** Node.js, TypeScript, `better-sqlite3`, `ws`, `tsx`, `concurrently`, `vitest`

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `server/index.ts` | HTTP static server + WebSocket upgrade handler |
| Create | `server/Session.ts` | One per WS connection — runs interpreter, streams output |
| Create | `server/SessionManager.ts` | Map\<WebSocket, Session\> lifecycle |
| Create | `server/ServerDatabaseBridge.ts` | `IDatabaseBridge` over `better-sqlite3` |
| Create | `src/shared/types.ts` | Shared TS types: `IDatabaseBridge`, WS message shapes, `ColInfo`, `FormField`, `OutputLine` |
| Create | `src/ws/WsClient.ts` | Browser WebSocket client — connect, queue, dispatch |
| Create | `tsconfig.server.json` | TypeScript config for Node server (no DOM lib) |
| Modify | `src/interpreter/Executor.ts` | Change `DatabaseBridge` import → `IDatabaseBridge` from shared types |
| Modify | `src/terminal/Terminal.ts` | Replace `Executor` with `WsClient`; handle all incoming message types |
| Modify | `src/ui/Grid.ts` | Replace `DatabaseBridge` with `WsClient`; data from server, edits via WS |
| Modify | `src/main.ts` | Boot `WsClient` instead of `DatabaseBridge` + worker |
| Modify | `vite.config.ts` | Add `/ws` proxy, remove `@sqlite.org/sqlite-wasm` exclusion |
| Modify | `package.json` | New scripts (`dev`, `serve`), new deps, remove postinstall |
| Modify | `tsconfig.json` | Add `server/` to include |
| Delete | `src/db/DatabaseBridge.ts` | Replaced by `ServerDatabaseBridge` server-side |
| Delete | `src/db/db.worker.ts` | No longer needed |
| Delete | `public/sqlite3.wasm` | No longer needed |
| Delete | `scripts/copy-wasm.cjs` | No longer needed |
| Create | `data/.gitkeep` | Persist data/ directory in git |
| Modify | `.gitignore` | Add `data/*.sqlite3`, `dist/` |
| Create | `tests/ServerDatabaseBridge.test.ts` | Unit tests for bridge |
| Create | `tests/Session.test.ts` | Unit tests for Session message handling |

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install server and test dependencies**

```bash
npm install better-sqlite3 ws
npm install --save-dev @types/better-sqlite3 @types/ws @types/node tsx concurrently vitest
```

- [ ] **Step 2: Verify installation**

```bash
node -e "require('better-sqlite3'); console.log('ok')"
```
Expected output: `ok`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add server dependencies (better-sqlite3, ws, tsx, concurrently, vitest)"
```

---

## Task 2: Add Server TypeScript Config

**Files:**
- Create: `tsconfig.server.json`
- Modify: `tsconfig.json`

The root `tsconfig.json` uses `"lib": ["ES2022", "DOM", "DOM.Iterable"]` and `"moduleResolution": "bundler"` — both wrong for Node server code. A separate config handles the server.

- [ ] **Step 1: Create `tsconfig.server.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist-server",
    "rootDir": "."
  },
  "include": ["server", "src/interpreter", "src/shared"]
}
```

- [ ] **Step 2: Update `tsconfig.json` to include `src/shared`**

The root tsconfig only includes `src/` already, which covers `src/shared/`. No change needed there. Verify `src/shared` is inside `src/`:

```bash
echo "src/shared is inside src/ — covered by existing include"
```

- [ ] **Step 3: Commit**

```bash
git add tsconfig.server.json
git commit -m "chore: add server TypeScript config"
```

---

## Task 3: Create Shared Types

**Files:**
- Create: `src/shared/types.ts`

All types shared between server and browser — the interface the Executor accepts, WebSocket message shapes, and re-exported value types.

- [ ] **Step 1: Write `src/shared/types.ts`**

```typescript
// Shared between server (Session, ServerDatabaseBridge) and browser (WsClient, Terminal)

export interface ColInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: unknown;
  pk: number;
}

export interface FormField {
  row: number;
  col: number;
  label: string;
  varName: string;
}

export interface OutputLine {
  text: string;
  cls?: string;
}

// The interface Executor accepts — implemented by both DatabaseBridge (old) and ServerDatabaseBridge (new)
export interface IDatabaseBridge {
  opfsAvailable: boolean;
  currentDb: string | null;
  openDatabase(dbName: string): Promise<{ dbName: string; opfsAvailable: boolean }>;
  closeDatabase(): Promise<void>;
  exec(sql: string, params?: unknown[]): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  getTables(): Promise<string[]>;
  getStructure(tableName: string): Promise<ColInfo[]>;
  getRowCount(tableName: string, filter?: string): Promise<number>;
  tableExists(name: string): Promise<boolean>;
}

// ── WebSocket message types ────────────────────────────────────────────────

// Client → Server
export type ClientMessage =
  | { type: 'command'; text: string }
  | { type: 'input-response'; value: string }
  | { type: 'form-submit'; values: Record<string, string> }
  | { type: 'grid-edit'; rowid: number; col: string; value: string }
  | { type: 'grid-delete'; rowid: number }
  | { type: 'grid-new-row' }
  | { type: 'grid-refresh' }
  | { type: 'grid-exit' };

// Server → Client
export type ServerMessage =
  | { type: 'output'; lines: OutputLine[] }
  | { type: 'status'; db: string | null; table: string | null; record: number; total: number }
  | { type: 'input-request'; prompt: string }
  | { type: 'grid-open'; table: string; filter: string | null; columns: ColInfo[]; rows: Record<string, unknown>[] }
  | { type: 'form-open'; fields: FormField[] }
  | { type: 'view-terminal' }
  | { type: 'clear' }
  | { type: 'error'; message: string };
```

- [ ] **Step 2: Verify it parses**

```bash
npx tsc --noEmit --project tsconfig.server.json 2>&1 | head -20
```

Expected: no errors (or only errors about files we haven't created yet — that's fine at this stage).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add shared WebSocket message types and IDatabaseBridge interface"
```

---

## Task 4: Update Executor to Use IDatabaseBridge

**Files:**
- Modify: `src/interpreter/Executor.ts`

Executor currently imports `DatabaseBridge` (a concrete class). Change it to accept `IDatabaseBridge` (the interface) so `ServerDatabaseBridge` can be used server-side without importing browser-only code.

- [ ] **Step 1: Update the import and constructor type in `Executor.ts`**

Replace the first line:
```typescript
import { DatabaseBridge } from '../db/DatabaseBridge';
```
With:
```typescript
import { IDatabaseBridge, OutputLine, FormField } from '../shared/types';
```

Remove the existing `OutputLine` and `FormField` type declarations from `Executor.ts` (lines defining them as `export type OutputLine = ...` and `export interface FormField ...`) — they now live in shared types. Keep `ExecResult` and `State` in `Executor.ts`.

Add a re-export so existing imports of `OutputLine`/`FormField` from `Executor` still work:
```typescript
export type { OutputLine, FormField } from '../shared/types';
```

Change the constructor parameter type:
```typescript
constructor(private db: IDatabaseBridge) {
```

- [ ] **Step 2: Verify the browser build still works**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: errors only about the deleted `DatabaseBridge` import in `Terminal.ts` (which we haven't updated yet). The Executor itself should be clean.

- [ ] **Step 3: Commit**

```bash
git add src/interpreter/Executor.ts src/shared/types.ts
git commit -m "refactor: Executor accepts IDatabaseBridge interface instead of concrete class"
```

---

## Task 5: Create ServerDatabaseBridge

**Files:**
- Create: `server/ServerDatabaseBridge.ts`
- Create: `tests/ServerDatabaseBridge.test.ts`

Implements `IDatabaseBridge` using `better-sqlite3`. All sessions share DB instances via a module-level map.

- [ ] **Step 1: Write the failing test**

Create `tests/ServerDatabaseBridge.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ServerDatabaseBridge } from '../server/ServerDatabaseBridge';
import fs from 'fs';
import path from 'path';

const TEST_DB = 'test_bridge_db';
const DATA_DIR = path.join(process.cwd(), 'data');
const DB_PATH = path.join(DATA_DIR, `${TEST_DB}.sqlite3`);

describe('ServerDatabaseBridge', () => {
  let bridge: ServerDatabaseBridge;

  beforeEach(() => {
    bridge = new ServerDatabaseBridge();
  });

  afterEach(async () => {
    await bridge.closeDatabase();
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  });

  it('opens a database and returns dbName', async () => {
    const result = await bridge.openDatabase(TEST_DB);
    expect(result.dbName).toBe(TEST_DB);
    expect(result.opfsAvailable).toBe(false);
  });

  it('creates a table and queries it', async () => {
    await bridge.openDatabase(TEST_DB);
    await bridge.exec('CREATE TABLE t (name TEXT, age INTEGER)');
    await bridge.exec('INSERT INTO t VALUES (?, ?)', ['Alice', 30]);
    const rows = await bridge.query('SELECT * FROM t');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: 'Alice', age: 30 });
  });

  it('returns table names', async () => {
    await bridge.openDatabase(TEST_DB);
    await bridge.exec('CREATE TABLE employees (id INTEGER PRIMARY KEY)');
    const tables = await bridge.getTables();
    expect(tables).toContain('employees');
  });

  it('returns row count with and without filter', async () => {
    await bridge.openDatabase(TEST_DB);
    await bridge.exec('CREATE TABLE t (v INTEGER)');
    await bridge.exec("INSERT INTO t VALUES (1)");
    await bridge.exec("INSERT INTO t VALUES (2)");
    await bridge.exec("INSERT INTO t VALUES (3)");
    expect(await bridge.getRowCount('t')).toBe(3);
    expect(await bridge.getRowCount('t', 'v > 1')).toBe(2);
  });

  it('detects table existence', async () => {
    await bridge.openDatabase(TEST_DB);
    await bridge.exec('CREATE TABLE exists_table (id INTEGER)');
    expect(await bridge.tableExists('exists_table')).toBe(true);
    expect(await bridge.tableExists('no_such_table')).toBe(false);
  });

  it('throws when exec called with no open database', async () => {
    await expect(bridge.exec('SELECT 1')).rejects.toThrow('No database open');
  });
});
```

- [ ] **Step 2: Add vitest config to `package.json`**

Add to `package.json` (under `"scripts"`):
```json
"test": "vitest run --config vitest.config.ts"
```

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 3: Run the test — expect it to fail with "Cannot find module"**

```bash
npm test 2>&1 | tail -20
```

Expected: `Error: Cannot find module '../server/ServerDatabaseBridge'`

- [ ] **Step 4: Create `server/ServerDatabaseBridge.ts`**

```typescript
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import type { IDatabaseBridge, ColInfo } from '../src/shared/types.js';

const DATA_DIR = path.join(process.cwd(), 'data');

// Shared across sessions — one Database instance per named DB file
const openDbs = new Map<string, Database.Database>();

function getDb(dbName: string): Database.Database {
  if (!openDbs.has(dbName)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const db = new Database(path.join(DATA_DIR, `${dbName}.sqlite3`));
    db.pragma('journal_mode = WAL');
    openDbs.set(dbName, db);
  }
  return openDbs.get(dbName)!;
}

export class ServerDatabaseBridge implements IDatabaseBridge {
  public opfsAvailable = false;
  public currentDb: string | null = null;
  private db: Database.Database | null = null;

  async openDatabase(dbName: string): Promise<{ dbName: string; opfsAvailable: boolean }> {
    this.db = getDb(dbName);
    this.currentDb = dbName;
    return { dbName, opfsAvailable: false };
  }

  async closeDatabase(): Promise<void> {
    this.db = null;
    this.currentDb = null;
  }

  async exec(sql: string, params?: unknown[]): Promise<void> {
    if (!this.db) throw new Error('No database open — run: USE <tablename>');
    this.db.prepare(sql).run(...(params ?? []));
  }

  async query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]> {
    if (!this.db) throw new Error('No database open — run: USE <tablename>');
    return this.db.prepare(sql).all(...(params ?? [])) as Record<string, unknown>[];
  }

  async getTables(): Promise<string[]> {
    if (!this.db) return [];
    const rows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];
    return rows.map(r => r.name);
  }

  async getStructure(tableName: string): Promise<ColInfo[]> {
    if (!this.db) return [];
    return this.db
      .prepare(`PRAGMA table_info(${JSON.stringify(tableName)})`)
      .all() as ColInfo[];
  }

  async getRowCount(tableName: string, filter?: string): Promise<number> {
    if (!this.db) return 0;
    const where = filter ? ` WHERE ${filter}` : '';
    const row = this.db
      .prepare(`SELECT COUNT(*) as n FROM ${JSON.stringify(tableName)}${where}`)
      .get() as { n: number };
    return Number(row?.n ?? 0);
  }

  async tableExists(name: string): Promise<boolean> {
    const tables = await this.getTables();
    return tables.map(t => t.toLowerCase()).includes(name.toLowerCase());
  }
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
npm test 2>&1 | tail -20
```

Expected: all 6 tests pass.

- [ ] **Step 6: Create `data/.gitkeep` and update `.gitignore`**

```bash
mkdir -p data && touch data/.gitkeep
```

If `.gitignore` doesn't exist, create it. Add these lines:
```
data/*.sqlite3
dist/
dist-server/
node_modules/
```

- [ ] **Step 7: Commit**

```bash
git add server/ServerDatabaseBridge.ts tests/ServerDatabaseBridge.test.ts vitest.config.ts data/.gitkeep .gitignore package.json
git commit -m "feat: add ServerDatabaseBridge with better-sqlite3 and unit tests"
```

---

## Task 6: Create SessionManager and Session

**Files:**
- Create: `server/SessionManager.ts`
- Create: `server/Session.ts`
- Create: `tests/Session.test.ts`

`Session` owns an `Executor` instance, handles incoming WS messages, and streams output back. `SessionManager` tracks active sessions.

- [ ] **Step 1: Write failing Session tests**

Create `tests/Session.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { Session } from '../server/Session';
import type { ServerMessage } from '../src/shared/types.js';

function makeSession() {
  const sent: ServerMessage[] = [];
  const send = vi.fn((msg: ServerMessage) => sent.push(msg));
  const session = new Session(send);
  return { session, sent, send };
}

describe('Session', () => {
  it('processes a HELP command and returns output lines', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'command', text: 'HELP' });
    const outputMsg = sent.find(m => m.type === 'output');
    expect(outputMsg).toBeDefined();
    expect((outputMsg as any).lines.length).toBeGreaterThan(5);
  });

  it('returns status after a command', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'command', text: 'HELP' });
    const statusMsg = sent.find(m => m.type === 'status');
    expect(statusMsg).toBeDefined();
  });

  it('sends error output for unknown command', async () => {
    const { session, sent } = makeSession();
    await session.handleMessage({ type: 'command', text: 'FOOBAR XYZ' });
    const outputMsg = sent.find(m => m.type === 'output') as any;
    expect(outputMsg).toBeDefined();
    // UNKNOWN nodes produce a warn line
    const hasWarn = outputMsg.lines.some((l: any) => l.cls === 'warn' || l.cls === 'error');
    expect(hasWarn).toBe(true);
  });

  it('sends grid-open when BROWSE issued after USE', async () => {
    const { session, sent } = makeSession();
    // Create an in-memory table first via command
    await session.handleMessage({ type: 'command', text: 'CREATE TABLE t (name TEXT)' });
    await session.handleMessage({ type: 'command', text: 'USE t' });
    sent.length = 0;
    await session.handleMessage({ type: 'command', text: 'BROWSE' });
    const gridMsg = sent.find(m => m.type === 'grid-open');
    expect(gridMsg).toBeDefined();
  });
});
```

- [ ] **Step 2: Run — expect failure (module not found)**

```bash
npm test 2>&1 | tail -10
```

Expected: `Cannot find module '../server/Session'`

- [ ] **Step 3: Create `server/SessionManager.ts`**

```typescript
import type { WebSocket } from 'ws';
import { Session } from './Session.js';
import type { ServerMessage } from '../src/shared/types.js';

export class SessionManager {
  private sessions = new Map<WebSocket, Session>();

  add(ws: WebSocket): Session {
    const session = new Session((msg: ServerMessage) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    });
    this.sessions.set(ws, session);
    return session;
  }

  remove(ws: WebSocket): void {
    this.sessions.delete(ws);
  }

  get(ws: WebSocket): Session | undefined {
    return this.sessions.get(ws);
  }

  get size(): number {
    return this.sessions.size;
  }
}
```

- [ ] **Step 4: Create `server/Session.ts`**

```typescript
import { Lexer } from '../src/interpreter/Lexer.js';
import { Parser } from '../src/interpreter/Parser.js';
import { Executor } from '../src/interpreter/Executor.js';
import type { ASTNode } from '../src/interpreter/Parser.js';
import { ServerDatabaseBridge } from './ServerDatabaseBridge.js';
import type { ClientMessage, ServerMessage, OutputLine, FormField } from '../src/shared/types.js';

export class Session {
  private bridge: ServerDatabaseBridge;
  private executor: Executor;
  private pendingNodes: ASTNode[] | null = null;

  constructor(private send: (msg: ServerMessage) => void) {
    this.bridge = new ServerDatabaseBridge();
    this.executor = new Executor(this.bridge);
  }

  async handleMessage(msg: ClientMessage): Promise<void> {
    try {
      switch (msg.type) {
        case 'command':
          await this.runCommand(msg.text);
          break;

        case 'form-submit':
          if (this.pendingNodes !== null) {
            for (const [k, v] of Object.entries(msg.values)) {
              this.executor.setVar(k, v);
            }
            const remaining = this.pendingNodes;
            this.pendingNodes = null;
            await this.executeNodes(remaining);
          }
          break;

        case 'grid-edit': {
          const { rowid, col, value } = msg;
          const table = this.executor.state.table;
          if (table) {
            await this.bridge.exec(
              `UPDATE ${q(table)} SET ${q(col)} = ? WHERE rowid = ?`,
              [value, rowid]
            );
          }
          break;
        }

        case 'grid-delete': {
          const table = this.executor.state.table;
          if (table) {
            await this.bridge.exec(
              `DELETE FROM ${q(table)} WHERE rowid = ?`,
              [msg.rowid]
            );
            await this.sendGridData();
          }
          break;
        }

        case 'grid-new-row': {
          const table = this.executor.state.table;
          if (table) {
            const cols = await this.bridge.getStructure(table);
            const fields = cols.filter(c => !c.pk);
            if (fields.length) {
              const names = fields.map(c => q(c.name)).join(', ');
              const vals = fields.map(() => 'NULL').join(', ');
              await this.bridge.exec(`INSERT INTO ${q(table)} (${names}) VALUES (${vals})`);
            } else {
              await this.bridge.exec(`INSERT INTO ${q(table)} DEFAULT VALUES`);
            }
            await this.sendGridData();
          }
          break;
        }

        case 'grid-refresh':
          await this.sendGridData();
          break;

        case 'grid-exit':
          this.send({ type: 'view-terminal' });
          this.sendStatus();
          break;
      }
    } catch (err: unknown) {
      this.send({ type: 'output', lines: [{ text: `** Error: ${err instanceof Error ? err.message : String(err)}`, cls: 'error' }] });
    }
  }

  private async runCommand(src: string): Promise<void> {
    let nodes: ASTNode[];
    try {
      const tokens = new Lexer(src).tokenize();
      nodes = new Parser(tokens).parse();
    } catch (err: unknown) {
      this.send({ type: 'output', lines: [{ text: `** Parse error: ${err instanceof Error ? err.message : String(err)}`, cls: 'error' }] });
      return;
    }
    await this.executeNodes(nodes);
  }

  private async executeNodes(nodes: ASTNode[]): Promise<void> {
    for (let i = 0; i < nodes.length; i++) {
      const result = await this.executor.exec(nodes[i]);

      if (result.output.length > 0) {
        this.send({ type: 'output', lines: result.output });
      }

      if (result.action === 'CLEAR') {
        this.send({ type: 'clear' });
        this.sendStatus();
        return;
      }

      if (result.action === 'QUIT') {
        this.send({ type: 'output', lines: [{ text: 'Goodbye.', cls: 'ok' }] });
        this.sendStatus();
        return;
      }

      if (result.action === 'BROWSE') {
        await this.sendGridData();
        return;
      }

      if (result.action === 'FORM_READY' && result.formFields) {
        this.pendingNodes = nodes.slice(i + 1);
        this.send({ type: 'form-open', fields: result.formFields });
        return;
      }
    }
    this.sendStatus();
  }

  private async sendGridData(): Promise<void> {
    const state = this.executor.state;
    if (!state.table) {
      this.send({ type: 'output', lines: [{ text: 'No table selected', cls: 'error' }] });
      return;
    }
    const where = state.filter ? ` WHERE ${state.filter}` : '';
    const rows = await this.bridge.query(
      `SELECT rowid as _rowid, * FROM ${q(state.table)}${where} LIMIT 2000`
    );
    const columns = await this.bridge.getStructure(state.table);
    this.send({ type: 'grid-open', table: state.table, filter: state.filter, columns, rows });
  }

  private sendStatus(): void {
    const s = this.executor.state;
    this.send({
      type: 'status',
      db: s.db,
      table: s.table,
      record: s.rowPtr,
      total: 0,
    });
  }
}

function q(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}
```

- [ ] **Step 5: Run tests — expect pass**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests pass (both ServerDatabaseBridge and Session suites).

- [ ] **Step 6: Commit**

```bash
git add server/Session.ts server/SessionManager.ts tests/Session.test.ts
git commit -m "feat: add Session and SessionManager with unit tests"
```

---

## Task 7: Create Server Entry Point

**Files:**
- Create: `server/index.ts`

HTTP server that serves the built frontend from `dist/` and handles WebSocket connections.

- [ ] **Step 1: Create `server/index.ts`**

```typescript
import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import { SessionManager } from './SessionManager.js';

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
        session['send']({ type: 'error', message: String(err) });
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
```

- [ ] **Step 2: Test-run the server manually (requires built frontend — skip frontend for now)**

```bash
npx tsx server/index.ts &
sleep 1 && curl -s http://localhost:3000/ | head -5 || echo "dist/ not built yet — expected"
kill %1
```

Expected: either `dist/ not built yet — expected` or an HTML response. Either is fine at this stage.

- [ ] **Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat: add Node.js HTTP+WebSocket server entry point"
```

---

## Task 8: Update Package Scripts and Vite Config

**Files:**
- Modify: `package.json`
- Modify: `vite.config.ts`

- [ ] **Step 1: Update `package.json` scripts and remove postinstall**

Replace the entire `"scripts"` block and update `"dependencies"`:

```json
{
  "name": "webbase-iii",
  "version": "0.2.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "concurrently \"vite\" \"tsx watch server/index.ts\"",
    "build": "tsc --noEmit && vite build",
    "serve": "npm run build && tsx server/index.ts",
    "test": "vitest run --config vitest.config.ts"
  },
  "devDependencies": {
    "@types/better-sqlite3": "...",
    "@types/node": "...",
    "@types/ws": "...",
    "concurrently": "...",
    "tsx": "...",
    "typescript": "^5.4.5",
    "vite": "^5.2.12",
    "vitest": "..."
  },
  "dependencies": {
    "better-sqlite3": "...",
    "ws": "..."
  }
}
```

> **Note:** Keep the exact version strings that were written by `npm install` in Task 1 — do not replace with `"..."`. Only update the `scripts` block and remove the `postinstall` entry and `@sqlite.org/sqlite-wasm` from dependencies.

- [ ] **Step 2: Update `vite.config.ts`**

Replace the entire file:

```typescript
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true,
      },
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
```

(Removes `optimizeDeps.exclude` for sqlite-wasm and the `worker.format` setting — no longer needed.)

- [ ] **Step 3: Verify Vite config parses**

```bash
npx vite --version
```

Expected: version printed without error.

- [ ] **Step 4: Commit**

```bash
git add package.json vite.config.ts
git commit -m "chore: update scripts for concurrent dev server + WS proxy, remove sqlite-wasm"
```

---

## Task 9: Create WsClient

**Files:**
- Create: `src/ws/WsClient.ts`

The browser-side WebSocket manager. Connects to `/ws`, queues messages while connecting, dispatches incoming messages by type, auto-reconnects.

- [ ] **Step 1: Create `src/ws/WsClient.ts`**

```typescript
import type { ClientMessage, ServerMessage } from '../shared/types';

type Handler<T extends ServerMessage = ServerMessage> = (msg: T) => void;

export class WsClient {
  private ws!: WebSocket;
  private handlers = new Map<string, Handler[]>();
  private queue: ClientMessage[] = [];
  private _connected = false;
  private retries = 0;
  private readonly MAX_RETRIES = 10;

  constructor() {
    this.connect();
  }

  private connect(): void {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.ws = new WebSocket(`${proto}//${location.host}/ws`);

    this.ws.onopen = () => {
      this._connected = true;
      this.retries = 0;
      for (const msg of this.queue) {
        this.ws.send(JSON.stringify(msg));
      }
      this.queue = [];
    };

    this.ws.onmessage = (e: MessageEvent) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data as string) as ServerMessage;
      } catch {
        return;
      }
      const handlers = this.handlers.get(msg.type) ?? [];
      for (const h of handlers) {
        h(msg as never);
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      if (this.retries < this.MAX_RETRIES) {
        this.retries++;
        setTimeout(() => this.connect(), 1000);
      }
    };

    this.ws.onerror = () => {
      // onclose fires after onerror — reconnect handled there
    };
  }

  send(msg: ClientMessage): void {
    if (this._connected && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  on<T extends ServerMessage>(type: T['type'], handler: (msg: T) => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type)!.push(handler as Handler);
  }

  waitReady(): Promise<void> {
    if (this._connected) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (this._connected) resolve();
        else setTimeout(check, 100);
      };
      check();
    });
  }

  get connected(): boolean {
    return this._connected;
  }
}
```

- [ ] **Step 2: Verify TypeScript is happy**

```bash
npx tsc --noEmit 2>&1 | grep -v "db.worker\|DatabaseBridge\|db/db" | head -20
```

Expected: errors only relating to the files we haven't updated yet (`Terminal.ts`, `main.ts`, `Grid.ts`).

- [ ] **Step 3: Commit**

```bash
git add src/ws/WsClient.ts
git commit -m "feat: add browser WebSocket client (WsClient)"
```

---

## Task 10: Refactor main.ts

**Files:**
- Modify: `src/main.ts`

Boot `WsClient` instead of `DatabaseBridge` + worker. Pass `WsClient` to `Terminal`.

- [ ] **Step 1: Replace `src/main.ts`**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
git add src/main.ts
git commit -m "refactor: main.ts boots WsClient instead of SQLite worker"
```

---

## Task 11: Refactor Terminal.ts

**Files:**
- Modify: `src/terminal/Terminal.ts`

Replace `Executor` with `WsClient`. All command execution becomes a `send`. All output comes from incoming WS messages.

- [ ] **Step 1: Replace `src/terminal/Terminal.ts`**

```typescript
import { WsClient } from '../ws/WsClient';
import { Grid } from '../ui/Grid';
import { FormLayout } from '../ui/FormLayout';
import type { OutputLine, FormField } from '../shared/types';

const HISTORY_LIMIT = 200;

const BLOCK_OPENERS: Record<string, string> = { IF: 'ENDIF', 'DO WHILE': 'ENDDO', DO: 'ENDDO' };
const BLOCK_CLOSERS = new Set(['ENDIF', 'ENDDO', 'ELSE']);

export class Terminal {
  private output: HTMLElement;
  private input: HTMLInputElement;
  private promptEl: HTMLElement;
  private statusDb: HTMLElement;
  private statusTable: HTMLElement;
  private statusRecord: HTMLElement;
  private termView: HTMLElement;
  private gridView: HTMLElement;
  private formView: HTMLElement;

  private ws: WsClient;
  private history: string[] = [];
  private histIdx = -1;
  private pendingBlock: string[] = [];
  private blockDepth = 0;
  private grid: Grid | null = null;
  private form: FormLayout | null = null;

  constructor(ws: WsClient) {
    this.ws = ws;

    this.output     = document.getElementById('terminal-output')!;
    this.input      = document.getElementById('terminal-input') as HTMLInputElement;
    this.promptEl   = document.getElementById('terminal-prompt')!;
    this.statusDb   = document.getElementById('status-db')!;
    this.statusTable= document.getElementById('status-table')!;
    this.statusRecord= document.getElementById('status-record')!;
    this.termView   = document.getElementById('terminal-view')!;
    this.gridView   = document.getElementById('grid-view')!;
    this.formView   = document.getElementById('form-view')!;

    ws.on('output', (msg) => {
      (msg as any).lines.forEach((l: OutputLine) => this.printLine(l.text, l.cls));
    });

    ws.on('status', (msg) => {
      const m = msg as any;
      this.statusDb.textContent    = m.db    ? `[ ${m.db} ]`    : '[ No DB ]';
      this.statusTable.textContent = m.table ? `[ ${m.table} ]` : '[ No Table ]';
      this.statusRecord.textContent = m.total ? `${m.record}/${m.total}` : '';
    });

    ws.on('clear', () => {
      this.output.innerHTML = '';
    });

    ws.on('grid-open', (msg) => {
      const m = msg as any;
      this.openGrid(m.table, m.filter, m.columns, m.rows);
    });

    ws.on('form-open', (msg) => {
      const m = msg as any;
      this.openForm(m.fields);
    });

    ws.on('view-terminal', () => {
      this.showTerminal();
    });

    ws.on('error', (msg) => {
      this.printLine(`** ${(msg as any).message}`, 'error');
    });
  }

  mount() {
    this.input.addEventListener('keydown', this.handleInputKey.bind(this));
    document.addEventListener('click', () => {
      if (!this.grid && !this.form) this.input.focus();
    });
    this.input.focus();
    this.printWelcome();
  }

  private handleInputKey(e: KeyboardEvent) {
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        void this.submit();
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (this.histIdx < this.history.length - 1) {
          this.histIdx++;
          this.input.value = this.history[this.history.length - 1 - this.histIdx];
          requestAnimationFrame(() => {
            this.input.selectionStart = this.input.selectionEnd = this.input.value.length;
          });
        }
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (this.histIdx > 0) {
          this.histIdx--;
          this.input.value = this.history[this.history.length - 1 - this.histIdx];
        } else if (this.histIdx === 0) {
          this.histIdx = -1;
          this.input.value = '';
        }
        break;
    }
  }

  private async submit() {
    const raw = this.input.value.trim();
    this.input.value = '';
    this.histIdx = -1;
    if (!raw) return;

    if (this.history[this.history.length - 1] !== raw) {
      this.history.push(raw);
      if (this.history.length > HISTORY_LIMIT) this.history.shift();
    }

    this.printLine(`. ${raw}`, 'echo');

    const upperLine = raw.toUpperCase().replace(/;.*$/, '').trim();

    if (this.blockDepth > 0) {
      this.pendingBlock.push(raw);
      const closeWord = upperLine.split(/\s+/)[0];
      if (BLOCK_CLOSERS.has(closeWord)) this.blockDepth--;
      else if (Object.keys(BLOCK_OPENERS).some(k => upperLine.startsWith(k))) this.blockDepth++;
      if (this.blockDepth === 0) {
        this.flushBlock();
      } else {
        this.promptEl.textContent = '... ';
      }
      return;
    }

    if (Object.keys(BLOCK_OPENERS).some(k => upperLine === k || upperLine.startsWith(k + ' '))) {
      this.pendingBlock = [raw];
      this.blockDepth = 1;
      this.promptEl.textContent = '... ';
      return;
    }

    this.ws.send({ type: 'command', text: raw });
  }

  private flushBlock() {
    const src = this.pendingBlock.join('\n');
    this.pendingBlock = [];
    this.promptEl.textContent = '. ';
    this.ws.send({ type: 'command', text: src });
  }

  // ── Views ──────────────────────────────────────────────────────────────

  private openGrid(table: string, filter: string | null, columns: any[], rows: any[]) {
    this.termView.classList.add('hidden');
    this.gridView.classList.remove('hidden');

    this.grid = new Grid({
      table,
      filter,
      columns,
      rows,
      ws: this.ws,
      onExit: () => this.closeGrid(),
      onStatusChange: (m) => { this.statusRecord.textContent = m; },
    });
    this.grid.mount();
  }

  private closeGrid() {
    this.grid?.unmount();
    this.grid = null;
    this.gridView.classList.add('hidden');
    this.showTerminal();
    this.printLine('Returned from BROWSE', 'info');
  }

  private openForm(fields: FormField[]) {
    this.termView.classList.add('hidden');
    this.formView.classList.remove('hidden');

    this.form = new FormLayout(
      (values) => {
        const obj: Record<string, string> = {};
        values.forEach((v, k) => { obj[k] = v; });
        this.ws.send({ type: 'form-submit', values: obj });
        this.closeForm();
      },
      () => {
        this.ws.send({ type: 'grid-exit' });
        this.closeForm();
        this.printLine('READ cancelled', 'warn');
      }
    );
    this.form.render(fields, new Map());
  }

  private closeForm() {
    this.form?.unmount();
    this.form = null;
    this.formView.classList.add('hidden');
    this.showTerminal();
  }

  showTerminal() {
    this.termView.classList.remove('hidden');
    this.gridView.classList.add('hidden');
    this.formView.classList.add('hidden');
    this.input.focus();
  }

  // ── Output helpers ─────────────────────────────────────────────────────

  printLine(text: string, cls?: string) {
    const span = document.createElement('span');
    span.className = 't-line' + (cls ? ' ' + cls : '');
    span.textContent = text;
    this.output.appendChild(span);
    this.output.scrollTop = this.output.scrollHeight;
  }

  private printWelcome() {
    [
      { text: '╔══════════════════════════════════════════════════╗', cls: 'hdr' },
      { text: '║          W e b B a s e - I I I   v 0.2          ║', cls: 'hdr' },
      { text: '╚══════════════════════════════════════════════════╝', cls: 'hdr' },
      { text: 'Server-powered dBASE III — multi-user SQLite backend', cls: 'info' },
      { text: 'Type HELP for a list of commands.', cls: 'info' },
      { text: '' },
      { text: 'Quick start:', cls: 'hdr' },
      { text: '  CREATE TABLE customers (name CHAR(40), phone CHAR(20), country CHAR(30))', cls: 'out' },
      { text: '  USE customers', cls: 'out' },
      { text: '  BROWSE', cls: 'out' },
      { text: '' },
    ].forEach(l => this.printLine(l.text, l.cls));
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/terminal/Terminal.ts
git commit -m "refactor: Terminal sends commands via WsClient, renders server output"
```

---

## Task 12: Refactor Grid.ts

**Files:**
- Modify: `src/ui/Grid.ts`

Replace `DatabaseBridge` with `WsClient`. Data arrives pre-loaded (from `grid-open` message). Edits send WS messages instead of calling bridge directly.

- [ ] **Step 1: Read the current Grid.ts fully before editing**

```bash
wc -l src/ui/Grid.ts
```

Then read it to understand all DB call sites before replacing.

- [ ] **Step 2: Replace the `GridOptions` interface and constructor at the top of `Grid.ts`**

Replace:
```typescript
import { DatabaseBridge } from '../db/DatabaseBridge';

export interface GridOptions {
  table: string;
  filter: string | null;
  db: DatabaseBridge;
  onExit: () => void;
  onStatusChange: (msg: string) => void;
}
```

With:
```typescript
import type { WsClient } from '../ws/WsClient';
import type { ColInfo } from '../shared/types';

export interface GridOptions {
  table: string;
  filter: string | null;
  columns: ColInfo[];
  rows: Record<string, unknown>[];
  ws: WsClient;
  onExit: () => void;
  onStatusChange: (msg: string) => void;
}
```

- [ ] **Step 3: Update the class fields**

Replace in `Grid` class:
```typescript
  private db: DatabaseBridge;
```
With:
```typescript
  private ws: WsClient;
  private cols: string[] = [];
```

Remove the existing `private cols: string[] = [];` line if it exists elsewhere in the class (there may already be one — unify to a single declaration).

Update constructor to:
```typescript
  constructor(opts: GridOptions) {
    this.table = opts.table;
    this.filter = opts.filter;
    this.ws = opts.ws;
    this.onExit = opts.onExit;
    this.onStatus = opts.onStatusChange;

    // Pre-loaded data from server
    this.rows = opts.rows as Row[];
    this.cols = opts.rows.length > 0
      ? Object.keys(opts.rows[0]).filter(c => c !== '_rowid')
      : opts.columns.map(c => c.name);

    this.container = document.getElementById('grid-scroll-container')!;
    this.thead = document.getElementById('grid-thead')!;
    this.tbody = document.getElementById('grid-tbody')!;
    this.info = document.getElementById('grid-info')!;

    this.boundKey = this.handleKey.bind(this);
  }
```

- [ ] **Step 4: Replace `mount()` — remove async data load**

Replace:
```typescript
  async mount() {
    await this.loadData();
    this.render();
    document.addEventListener('keydown', this.boundKey, true);
    this.container.focus();
    this.scrollIntoView();
  }
```
With:
```typescript
  mount() {
    this.render();
    document.addEventListener('keydown', this.boundKey, true);

    // When server sends refreshed data (after delete/new-row)
    this.ws.on('grid-open', (msg) => {
      const m = msg as any;
      this.rows = m.rows as Row[];
      this.cols = this.rows.length > 0
        ? Object.keys(this.rows[0]).filter((c: string) => c !== '_rowid')
        : m.columns.map((c: ColInfo) => c.name);
      this.selRow = Math.min(this.selRow, Math.max(0, this.rows.length - 1));
      this.render();
    });

    this.container.focus();
    this.scrollIntoView();
  }
```

- [ ] **Step 5: Remove `loadData()` method entirely** (it called `this.db.query` and `this.db.getStructure`)

Delete the entire `private async loadData()` method from the file.

- [ ] **Step 6: Update cell save to use WsClient**

Find the method that saves a cell edit (it calls `this.db.exec` with an UPDATE). It will look something like:
```typescript
await this.db.exec(`UPDATE ... SET ... WHERE rowid = ?`, [...]);
```

Replace that with:
```typescript
this.ws.send({ type: 'grid-edit', rowid: row._rowid as number, col: this.cols[this.selCol], value: newValue });
```

Also update the local `row` object for immediate visual feedback:
```typescript
row[this.cols[this.selCol]] = newValue;
```

- [ ] **Step 7: Update delete row to use WsClient**

Find the delete key handler (calls `this.db.exec` with DELETE). Replace with:
```typescript
const row = this.rows[this.selRow];
if (!row) return;
this.ws.send({ type: 'grid-delete', rowid: row._rowid as number });
// Server will respond with grid-open (refreshed data)
```

- [ ] **Step 8: Update new row (Ctrl+N) to use WsClient**

Find the new row handler (calls `this.db.exec` with INSERT). Replace with:
```typescript
this.ws.send({ type: 'grid-new-row' });
// Server will respond with grid-open (refreshed data)
```

- [ ] **Step 9: Update F5 (refresh) to use WsClient**

Find the F5 handler (calls `this.loadData()` then `this.render()`). Replace with:
```typescript
this.ws.send({ type: 'grid-refresh' });
```

- [ ] **Step 10: Update ESC handler to use WsClient**

Find the ESC handler (calls `this.onExit()`). Keep calling `this.onExit()` but also send:
```typescript
this.ws.send({ type: 'grid-exit' });
this.onExit();
```

- [ ] **Step 11: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors, or only errors from `FormLayout.ts` (next task).

- [ ] **Step 12: Commit**

```bash
git add src/ui/Grid.ts
git commit -m "refactor: Grid sends edits via WsClient, data loaded from server"
```

---

## Task 13: Update FormLayout.ts Import

**Files:**
- Modify: `src/ui/FormLayout.ts`

`FormLayout` imports `FormField` from `Executor`. It should now import from `shared/types`.

- [ ] **Step 1: Update import in `FormLayout.ts`**

Replace:
```typescript
import { FormField } from '../interpreter/Executor';
```
With:
```typescript
import type { FormField } from '../shared/types';
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/FormLayout.ts
git commit -m "refactor: FormLayout imports FormField from shared types"
```

---

## Task 14: Remove Old Files

**Files:**
- Delete: `src/db/DatabaseBridge.ts`
- Delete: `src/db/db.worker.ts`
- Delete: `public/sqlite3.wasm`
- Delete: `scripts/copy-wasm.cjs`

- [ ] **Step 1: Delete the old browser-side DB files**

```bash
rm src/db/DatabaseBridge.ts src/db/db.worker.ts
rm public/sqlite3.wasm
rm scripts/copy-wasm.cjs
rmdir src/db 2>/dev/null || true
rmdir scripts 2>/dev/null || true
```

- [ ] **Step 2: Remove `@sqlite.org/sqlite-wasm` from package.json dependencies**

Edit `package.json` and remove the `"@sqlite.org/sqlite-wasm"` line from `"dependencies"`.

- [ ] **Step 3: Verify full TypeScript check passes**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 4: Run tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove SQLite Wasm browser files and dependency"
```

---

## Task 15: Integration Smoke Test

Verify the whole stack works end-to-end: server runs, browser connects, commands execute, BROWSE works.

- [ ] **Step 1: Build the frontend**

```bash
npm run build 2>&1 | tail -15
```

Expected: `✓ built in ...ms` with no errors.

- [ ] **Step 2: Start the server**

```bash
npx tsx server/index.ts &
sleep 1
```

Expected: `WebBase-III server → http://localhost:3000`

- [ ] **Step 3: Verify static serving**

```bash
curl -s http://localhost:3000/ | grep -c "WebBase-III"
```

Expected: `1` or more (the HTML title is in the response).

- [ ] **Step 4: Open browser and run through smoke test**

Open `http://localhost:3000` in a browser. Run these commands in order, verifying each produces sensible output:

```
CREATE TABLE smoke (name CHAR(40), value INTEGER)
USE smoke
APPEND RECORD
REPLACE ALL name WITH "test", value WITH 42
LIST
BROWSE
```

In BROWSE: verify the row appears. Edit the `name` cell. Press ESC. Run `LIST` again — verify the edit persisted.

Open a **second browser tab** to `http://localhost:3000`. Run `USE smoke` then `LIST` — verify it sees the same data as the first tab.

- [ ] **Step 5: Stop background server**

```bash
kill %1 2>/dev/null || true
```

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "feat: Phase 2 complete — server-side multi-user WebBase-III"
```

---

## Appendix: Dev Workflow After This Plan

```bash
# Development (hot-reload frontend + server)
npm run dev
# → Vite on :5173, server on :3000, WS proxied through Vite

# Production
npm run serve
# → Builds frontend, starts server on :3000

# Tests
npm test
```

Database files are stored in `./data/<name>.sqlite3` relative to the working directory.
