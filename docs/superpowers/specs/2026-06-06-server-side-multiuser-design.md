# WebBase-III Phase 2 — Server-Side Multi-User Architecture

**Date:** 2026-06-06  
**Status:** Approved  
**Scope:** Move interpreter + SQLite to a Node.js server; browser becomes a thin WebSocket terminal; multiple clients share one database.

---

## 1. Goals

- Any number of browsers can connect to one WebBase-III server and work against the same SQLite database(s)
- Each connection gets independent interpreter state (record pointer, current table, SET FILTER, variables)
- The terminal feel is unchanged — commands typed, output streamed back in real time
- Self-hosted: one `npm run serve` starts everything; no cloud dependency
- Dev workflow stays simple: `npm run dev` runs Vite + server concurrently

## 2. Non-Goals

- Authentication / RBAC — all connected clients have full access
- Cloud hosting or managed deployment
- Browser-local OPFS fallback — server storage replaces it entirely

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Node.js Server                      │
│                                                      │
│  HTTP :3000 (serves dist/)   WebSocket :3000/ws      │
│                                │                     │
│              ┌─────────────────┴──────────┐          │
│              │       SessionManager        │          │
│              │  (Map<ws, Session>)         │          │
│              └─────────────────┬──────────┘          │
│                                │                     │
│              ┌─────────────────▼──────────┐          │
│              │ Session (per WS connection) │          │
│              │  Lexer → Parser → Executor  │          │
│              │  owns: table, filter,       │          │
│              │         record ptr, vars    │          │
│              └─────────────────┬──────────┘          │
│                                │                     │
│              ┌─────────────────▼──────────┐          │
│              │   ServerDatabaseBridge      │          │
│              │   (better-sqlite3)          │          │
│              └─────────────────┬──────────┘          │
│                           ┌────▼────┐                │
│                           │.sqlite3 │                │
│                           └─────────┘                │
└─────────────────────────────────────────────────────┘
         ▲ WebSocket          ▲ WebSocket
   ┌─────┴──────┐     ┌──────┴─────┐
   │  Browser A │     │  Browser B │
   │  WsClient  │     │  WsClient  │
   │  Terminal  │     │  Terminal  │
   └────────────┘     └────────────┘
```

---

## 4. Server Internals

### 4.1 File structure

```
server/
  index.ts                  HTTP server + WebSocket upgrade handler
  Session.ts                One instance per WS connection
  SessionManager.ts         Map<WebSocket, Session>; lifecycle hooks
  ServerDatabaseBridge.ts   DatabaseBridge interface over better-sqlite3

src/
  interpreter/              UNCHANGED — shared by server at runtime
    Lexer.ts
    Parser.ts
    Executor.ts
  ws/
    WsClient.ts             NEW — browser WebSocket client
  terminal/
    Terminal.ts             ADAPTED — sends/receives via WsClient
  ui/
    Grid.ts                 ADAPTED — sends grid messages via WsClient
    FormLayout.ts           ADAPTED — sends form messages via WsClient
  db/
    DatabaseBridge.ts       REMOVED (replaced by ServerDatabaseBridge server-side)
    db.worker.ts            REMOVED
  main.ts                   ADAPTED — boots WsClient, passes to Terminal
```

### 4.2 ServerDatabaseBridge

Implements the same TypeScript interface as the current `DatabaseBridge` so `Executor` requires zero changes. Uses `better-sqlite3` (synchronous API — no promises needed server-side). All sessions share one `Database` instance per open SQLite file; `better-sqlite3` serializes writes automatically.

```ts
interface IDatabaseBridge {
  openDatabase(dbName: string): Promise<{ dbName: string; opfsAvailable: boolean }>;
  exec(sql: string, params?: unknown[]): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
  getTables(): Promise<string[]>;
  getStructure(tableName: string): Promise<ColInfo[]>;
  getRowCount(tableName: string, filter?: string): Promise<number>;
  tableExists(name: string): Promise<boolean>;
}
```

`ServerDatabaseBridge` wraps all methods in `Promise.resolve()` to satisfy the async interface.

### 4.3 Session

```ts
class Session {
  private ws: WebSocket;
  private bridge: ServerDatabaseBridge;
  private executor: Executor;

  constructor(ws: WebSocket) { ... }
  handleMessage(msg: ClientMessage): Promise<void>;
  send(msg: ServerMessage): void;
  close(): void;
}
```

The `Executor` is created with an output callback that calls `session.send({ type: "output", lines })`. Status updates (current db/table/record) are sent as `{ type: "status", ... }` messages after each command completes.

### 4.4 SessionManager

```ts
class SessionManager {
  private sessions = new Map<WebSocket, Session>();
  add(ws: WebSocket): Session;
  remove(ws: WebSocket): void;
  get(ws: WebSocket): Session | undefined;
}
```

### 4.5 index.ts

- Creates an `http.Server`
- Attaches a `ws.WebSocketServer` on the same server (path `/ws`)
- Serves `dist/` as static files for all other requests
- On WS connect: `sessionManager.add(ws)`
- On WS message: `session.handleMessage(JSON.parse(data))`
- On WS close: `sessionManager.remove(ws)`

### 4.6 Database file location

SQLite files are stored in `./data/<dbName>.sqlite3` relative to the server working directory. The directory is created on first use.

---

## 5. WebSocket Protocol

All messages are JSON objects with a required `type` field.

### 5.1 Client → Server

| type | fields | description |
|---|---|---|
| `command` | `text: string` | A W3Script command line |
| `input-response` | `value: string` | Answer to an `INPUT` prompt |
| `form-submit` | `values: Record<string, string>` | READ form submitted |
| `grid-edit` | `rowid: number, col: string, value: string` | Inline cell edit |
| `grid-delete` | `rowid: number` | Delete a row |
| `grid-new-row` | — | Append blank row |
| `grid-exit` | — | ESC from grid, return to terminal |

### 5.2 Server → Client

| type | fields | description |
|---|---|---|
| `output` | `lines: {text, cls}[]` | Terminal text lines to render |
| `status` | `db, table, record, total` | Status bar update |
| `input-request` | `prompt: string` | Pause terminal, show inline prompt |
| `grid-open` | `columns: ColInfo[], rows: Record[]` | Switch to grid view |
| `form-open` | `fields: FormField[]` | Switch to form view |
| `view-terminal` | — | Return to terminal view |
| `error` | `message: string` | Fatal session error |

Session identity is the WebSocket connection itself — no tokens required.

---

## 6. Frontend Changes

### 6.1 Removed

- `src/db/db.worker.ts`
- `src/db/DatabaseBridge.ts`
- `public/sqlite3.wasm`
- `@sqlite.org/sqlite-wasm` npm dependency
- SQLite worker import in `vite.config.ts`

### 6.2 Added

**`src/ws/WsClient.ts`**

- Connects to `ws://<host>/ws` (relative URL works for both dev proxy and production)
- Exposes `send(msg: ClientMessage): void`
- Exposes `on(type, handler)` for incoming message dispatch
- Reconnects automatically on close (1s delay, max 10 retries)
- Queues outgoing messages while connecting

### 6.3 Adapted

**`src/main.ts`**
- Creates `WsClient`, waits for connection, then creates `Terminal`
- Passes `WsClient` to `Terminal` instead of `Executor`

**`src/terminal/Terminal.ts`**
- `runCommand(text)` → `wsClient.send({ type: "command", text })`
- Incoming `output` lines → append to terminal output (same rendering as today)
- Incoming `status` → update status bar
- Incoming `input-request` → show inline input field, send `input-response` on enter
- Incoming `grid-open` → hand off to `Grid`
- Incoming `form-open` → hand off to `FormLayout`
- Incoming `view-terminal` → show terminal view, hide others

**`src/ui/Grid.ts`**
- Data comes from `grid-open` message instead of direct DB query
- Cell edits send `grid-edit` messages; no local DB calls
- Delete/new-row/exit send corresponding messages

**`src/ui/FormLayout.ts`**
- Form built from `form-open` fields
- Submit sends `form-submit`; cancel sends `grid-exit` (returns to terminal)

### 6.4 Vite dev proxy

```ts
// vite.config.ts addition
server: {
  proxy: {
    '/ws': { target: 'ws://localhost:3000', ws: true }
  }
}
```

---

## 7. New npm Scripts

```json
{
  "dev": "concurrently \"vite\" \"tsx watch server/index.ts\"",
  "serve": "vite build && tsx server/index.ts",
  "build": "tsc && vite build"
}
```

---

## 8. New Dependencies

| Package | Purpose |
|---|---|
| `better-sqlite3` | Native SQLite for Node.js |
| `@types/better-sqlite3` | TypeScript types |
| `ws` | WebSocket server |
| `@types/ws` | TypeScript types |
| `concurrently` | Run Vite + server in dev |
| `tsx` | Run TypeScript server files directly |

---

## 9. What Does Not Change

- `src/interpreter/Lexer.ts`, `Parser.ts`, `Executor.ts` — zero changes
- `src/styles/main.css` — zero changes
- `index.html` — zero changes
- All W3Script commands and BROWSE/form behavior — identical to Phase 1
- The terminal UI appearance and keyboard shortcuts

---

## 10. Out of Scope (Future)

- Authentication and per-user permissions
- Broadcast: pushing one user's output to all connected clients
- `.prg` program files
- INDEX ON, REPORT FORM
- CSV import/export
- PWA / offline mode
