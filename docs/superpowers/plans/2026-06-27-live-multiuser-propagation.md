# Live Multiuser Data Propagation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When one session mutates a table, every other session currently BROWSE-ing that same table re-fetches and repaints automatically — no manual re-query.

**Architecture:** A per-session SQLite write goes through `ServerDatabaseBridge.exec()`, which fires an `onMutate` hook. `Session` marks itself dirty and, after the message finishes, calls a `notifyChange` callback that `SessionManager` injected. `SessionManager.broadcast()` fans a new `data-changed` message out to every *other* session whose current view matches the changed db+table (server-side filter), debounced per table. The browser, on `data-changed`, triggers the same refresh path as F5 if a matching grid is open.

**Tech Stack:** TypeScript (server + browser), better-sqlite3 (WAL), `ws` WebSocket server, Vitest (unit/integration), Playwright (e2e).

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `server/ServerDatabaseBridge.ts` | Modify | Detach-only `closeDatabase`; fire `onMutate` after `exec` |
| `src/shared/types.ts` | Modify | Add `data-changed` `ServerMessage` variant |
| `server/Session.ts` | Modify | Dirty-tracking via `onMutate`; `currentView()`; call injected `notifyChange` |
| `server/SessionManager.ts` | Modify | Inject `notifyChange`; `broadcast()` with view filter + debounce |
| `src/terminal/Terminal.ts` | Modify | Handle `data-changed` → `grid-refresh` if matching grid open |
| `src/ui/Grid.ts` | Modify | Expose `tableName` getter |
| `tests/ServerDatabaseBridge.test.ts` | Modify | Regression: shared handle survives a peer's close |
| `tests/Propagation.test.ts` | Create | broadcast filters by view, skips originator, coalesces |
| `tests/propagation.spec.ts` | Create | Playwright: two contexts, edit one, other refreshes |

---

## Task A — Prereq: stop closing shared DB handles

**Files:**
- Modify: `server/ServerDatabaseBridge.ts:35-44`
- Test: `tests/ServerDatabaseBridge.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the `describe('ServerDatabaseBridge', …)` block in `tests/ServerDatabaseBridge.test.ts`:

```ts
it('keeps the shared handle usable after another session closes it', async () => {
  const a = new ServerDatabaseBridge();
  const b = new ServerDatabaseBridge();
  await a.openDatabase(TEST_DB);
  await b.openDatabase(TEST_DB);            // same shared handle
  await a.exec('CREATE TABLE IF NOT EXISTS shared_t (id INTEGER)');

  await a.closeDatabase();                  // A leaves

  // B must still work — previously this threw "The database connection is not open"
  await expect(b.query('SELECT COUNT(*) AS n FROM shared_t')).resolves.toBeDefined();
  await b.closeDatabase();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ServerDatabaseBridge.test.ts -t "keeps the shared handle usable"`
Expected: FAIL — B's query throws because A called `db.close()` on the shared handle and deleted it from `openDbs`.

- [ ] **Step 3: Make `closeDatabase` detach-only**

Replace `server/ServerDatabaseBridge.ts` lines 35-44 (the whole `closeDatabase` method) with:

```ts
  async closeDatabase(): Promise<void> {
    // The handle in `openDbs` is shared across all sessions, so we must NOT
    // close it here — that would break every other session using the same DB.
    // WAL handles stay open for the process lifetime; just detach this session.
    this.db = null;
    this.currentDb = null;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ServerDatabaseBridge.test.ts`
Expected: PASS — all existing bridge tests plus the new one. (The `afterEach` still deletes the `.sqlite3` files; the open handle does not prevent unlink on this platform, and tests use unique-enough names.)

- [ ] **Step 5: Commit**

```bash
git add server/ServerDatabaseBridge.ts tests/ServerDatabaseBridge.test.ts
git commit -m "fix: stop closing shared DB handle on session close (#11)"
```

---

## Task B — Server: mutation signal + broadcast

### Task B1: `data-changed` message type

**Files:**
- Modify: `src/shared/types.ts:127`

- [ ] **Step 1: Add the variant**

In `src/shared/types.ts`, the `ServerMessage` union ends at line 127 with `| { type: 'catalog'; catalog: Catalog };`. Change that line to add the new variant before the closing semicolon:

```ts
  | { type: 'catalog'; catalog: Catalog }
  | { type: 'data-changed'; db: string; table: string };
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: add data-changed ServerMessage variant (#11)"
```

### Task B2: Bridge `onMutate` hook

**Files:**
- Modify: `server/ServerDatabaseBridge.ts` (class body + `exec`)
- Test: `tests/ServerDatabaseBridge.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/ServerDatabaseBridge.test.ts`:

```ts
it('fires onMutate after a successful exec, not after a query', async () => {
  const calls: number[] = [];
  await bridge.openDatabase(TEST_DB);
  bridge.onMutate = () => calls.push(1);
  await bridge.exec('CREATE TABLE m (id INTEGER)');
  await bridge.exec('INSERT INTO m (id) VALUES (1)');
  await bridge.query('SELECT * FROM m');     // must NOT fire onMutate
  expect(calls.length).toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ServerDatabaseBridge.test.ts -t "fires onMutate"`
Expected: FAIL — `onMutate` does not exist on the bridge.

- [ ] **Step 3: Implement the hook**

In `server/ServerDatabaseBridge.ts`, add a public field to the class (next to `currentDb`, around line 23):

```ts
  public onMutate: (() => void) | null = null;
```

Then change `exec` (lines 46-49) to fire it after a successful run:

```ts
  async exec(sql: string, params?: unknown[]): Promise<void> {
    if (!this.db) throw new Error('No database open — run: USE <tablename>');
    this.db.prepare(sql).run(...(params ?? []));
    this.onMutate?.();
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/ServerDatabaseBridge.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/ServerDatabaseBridge.ts tests/ServerDatabaseBridge.test.ts
git commit -m "feat: fire onMutate hook after bridge writes (#11)"
```

### Task B3: Session dirty-tracking, `currentView`, `notifyChange`

**Files:**
- Modify: `server/Session.ts:11-22` (fields + constructor), `handleMessage` (lines 24-171)

- [ ] **Step 1: Add the constructor param, dirty flag, and view getter**

In `server/Session.ts`, change the constructor (lines 19-22) to accept an optional notifier and wire the bridge hook:

```ts
  private dirty = false;

  constructor(
    private send: (msg: ServerMessage) => void,
    private notifyChange?: (db: string, table: string) => void,
  ) {
    this.bridge = new ServerDatabaseBridge();
    this.executor = new Executor(this.bridge, indexStore);
    this.bridge.onMutate = () => { this.dirty = true; };
  }

  /** The db + table this session is currently looking at (for relevance filtering). */
  currentView(): { db: string | null; table: string | null } {
    const a = this.executor.area;
    return { db: a.db, table: a.table };
  }
```

(Leave the existing `private dirty`-adjacent fields — `pendingContinuation`, `pendingFromProgram` — as they are.)

- [ ] **Step 2: Flush the dirty flag after every handled message**

In `server/Session.ts`, wrap the body of `handleMessage`. The method currently is `try { switch … } catch (err) { … }` (lines 25-170). Add a `finally` that fans out a change exactly once per message:

```ts
  async handleMessage(msg: ClientMessage): Promise<void> {
    try {
      switch (msg.type) {
        // … unchanged cases …
      }
    } catch (err: unknown) {
      this.send({ type: 'output', lines: [{ text: `** Error: ${err instanceof Error ? err.message : String(err)}`, cls: 'error' }] });
    } finally {
      if (this.dirty) {
        this.dirty = false;
        const { db, table } = this.currentView();
        if (db && table) this.notifyChange?.(db, table);
      }
    }
  }
```

(Do not change any `case` bodies — they already route writes through `bridge.exec`, which now sets `dirty`.)

- [ ] **Step 3: Verify it compiles and existing tests pass**

Run: `npx tsc --noEmit && npx vitest run tests/Session.test.ts`
Expected: PASS — `makeSession()` constructs `new Session(send)` with no notifier, so `notifyChange?.` is a no-op and behavior is unchanged.

- [ ] **Step 4: Commit**

```bash
git add server/Session.ts
git commit -m "feat: Session dirty-tracking + currentView + notifyChange hook (#11)"
```

### Task B4: `SessionManager.broadcast` with view filter + debounce

**Files:**
- Modify: `server/SessionManager.ts`
- Test: `tests/Propagation.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/Propagation.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionManager } from '../server/SessionManager';
import fs from 'fs';
import path from 'path';

// Minimal fake WebSocket: SessionManager only uses .OPEN, .readyState, .send.
function fakeWs() {
  const sent: any[] = [];
  return {
    OPEN: 1,
    readyState: 1,
    send: (s: string) => sent.push(JSON.parse(s)),
    sent,
  } as any;
}

const DB = 'test_prop_db';

afterEach(() => {
  const dataDir = path.join(process.cwd(), 'data');
  if (fs.existsSync(dataDir)) {
    fs.readdirSync(dataDir)
      .filter(f => f.toLowerCase().startsWith('test_prop_db'))
      .forEach(f => fs.unlinkSync(path.join(dataDir, f)));
  }
});

describe('SessionManager live propagation', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('notifies a peer viewing the same table, skips the originator, coalesces a burst', async () => {
    const mgr = new SessionManager();
    const wsA = fakeWs();
    const wsB = fakeWs();
    const a = mgr.add(wsA);
    const b = mgr.add(wsB);

    // Both sessions open the same db + table.
    for (const s of [a, b]) {
      await s.handleMessage({ type: 'command', text: `USE DATABASE ${DB}` });
    }
    await a.handleMessage({ type: 'command', text: 'CREATE TABLE t (id INTEGER, name TEXT)' });
    for (const s of [a, b]) {
      await s.handleMessage({ type: 'command', text: 'USE t' });
    }

    wsA.sent.length = 0;
    wsB.sent.length = 0;

    // A mutates twice in quick succession.
    await a.handleMessage({ type: 'command', text: "APPEND BLANK" });
    await a.handleMessage({ type: 'command', text: "APPEND BLANK" });

    vi.advanceTimersByTime(60);  // flush debounce window

    const aChanges = wsA.sent.filter(m => m.type === 'data-changed');
    const bChanges = wsB.sent.filter(m => m.type === 'data-changed');
    expect(aChanges.length).toBe(0);                       // originator skipped
    expect(bChanges.length).toBe(1);                       // burst coalesced to one
    expect(bChanges[0]).toMatchObject({ db: DB, table: 't' });
  });

  it('does NOT notify a peer viewing a different table', async () => {
    const mgr = new SessionManager();
    const wsA = fakeWs();
    const wsB = fakeWs();
    const a = mgr.add(wsA);
    const b = mgr.add(wsB);
    for (const s of [a, b]) {
      await s.handleMessage({ type: 'command', text: `USE DATABASE ${DB}` });
    }
    await a.handleMessage({ type: 'command', text: 'CREATE TABLE t1 (id INTEGER)' });
    await a.handleMessage({ type: 'command', text: 'CREATE TABLE t2 (id INTEGER)' });
    await a.handleMessage({ type: 'command', text: 'USE t1' });
    await b.handleMessage({ type: 'command', text: 'USE t2' });

    wsB.sent.length = 0;
    await a.handleMessage({ type: 'command', text: 'APPEND BLANK' });
    vi.advanceTimersByTime(60);

    expect(wsB.sent.filter(m => m.type === 'data-changed').length).toBe(0);
  });
});
```

> Note: this test assumes `APPEND BLANK` is the blank-insert command. If the codebase uses `APPEND RECORD` (per CLAUDE.md command table), use that exact text in both places instead — verify against `src/interpreter/Executor.ts` before running.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/Propagation.test.ts`
Expected: FAIL — `mgr.add` does not inject a notifier and `broadcast` does not exist, so no `data-changed` messages are sent.

- [ ] **Step 3: Implement `broadcast` + debounce + injection**

Replace the whole contents of `server/SessionManager.ts` with:

```ts
import type { WebSocket } from 'ws';
import { Session } from './Session.js';
import type { ServerMessage } from '../src/shared/types.js';

const DEBOUNCE_MS = 50;

export class SessionManager {
  private sessions = new Map<WebSocket, Session>();
  // Coalesce rapid changes to the same db|table into a single broadcast.
  private pending = new Map<string, ReturnType<typeof setTimeout>>();

  add(ws: WebSocket): Session {
    const send = (msg: ServerMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    const session = new Session(send, (db, table) => this.broadcast(db, table, ws));
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

  /** Fan a data-changed out to every OTHER session currently viewing db+table. */
  broadcast(db: string, table: string, except: WebSocket): void {
    const key = `${db} ${table.toLowerCase()}`;
    const existing = this.pending.get(key);
    if (existing) clearTimeout(existing);
    this.pending.set(key, setTimeout(() => {
      this.pending.delete(key);
      for (const [ws, session] of this.sessions) {
        if (ws === except) continue;
        if (ws.readyState !== ws.OPEN) continue;
        const view = session.currentView();
        if (view.db === db && view.table?.toLowerCase() === table.toLowerCase()) {
          ws.send(JSON.stringify({ type: 'data-changed', db, table } as ServerMessage));
        }
      }
    }, DEBOUNCE_MS));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/Propagation.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Run the full server suite for regressions**

Run: `npx vitest run`
Expected: PASS — all existing tests still green.

- [ ] **Step 6: Commit**

```bash
git add server/SessionManager.ts tests/Propagation.test.ts
git commit -m "feat: SessionManager.broadcast data-changed with view filter + debounce (#11)"
```

---

## Task C — Client: refresh grid on remote change

### Task C1: Grid exposes its table name

**Files:**
- Modify: `src/ui/Grid.ts`

- [ ] **Step 1: Add a public getter**

In `src/ui/Grid.ts`, add right after the `unmount()` method (around line 86):

```ts
  get tableName(): string {
    return this.table;
  }
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: PASS.

### Task C2: Terminal reacts to `data-changed`

**Files:**
- Modify: `src/terminal/Terminal.ts` (alongside the other `ws.on(...)` handlers, near line 68)

- [ ] **Step 1: Register the handler**

In `src/terminal/Terminal.ts`, just after the existing `ws.on('grid-open', …)` block (ends ~line 71), add:

```ts
    ws.on('data-changed', (msg) => {
      const m = msg as any;
      // Only refresh if we're currently BROWSE-ing the affected table.
      if (this.grid && this.grid.tableName.toLowerCase() === String(m.table).toLowerCase()) {
        this.ws.send({ type: 'grid-refresh' });
      }
    });
```

This reuses the exact F5 path: the server answers `grid-refresh` with a `grid-open` carrying this client's own filtered rows, and the mounted `Grid` repaints in place (preserving selection).

- [ ] **Step 2: Verify it compiles and unit suite passes**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/ui/Grid.ts src/terminal/Terminal.ts
git commit -m "feat: refresh BROWSE grid on remote data-changed (#11)"
```

### Task C3: Playwright end-to-end acceptance

**Files:**
- Create: `tests/propagation.spec.ts`

- [ ] **Step 1: Write the e2e test**

Create `tests/propagation.spec.ts`, following the two-context pattern (study `tests/multiarea.spec.ts` for the exact selectors/helpers this repo uses for sending REPL commands and reading the grid; adapt the helpers below to match):

```ts
import { test, expect, type Page } from '@playwright/test';

// Send a REPL command. Adapt the selector to match tests/multiarea.spec.ts.
async function cmd(page: Page, text: string) {
  const input = page.locator('#terminal-input');
  await input.fill(text);
  await input.press('Enter');
  await page.waitForTimeout(150);
}

test('edit in one client refreshes another client BROWSE-ing the same table', async ({ browser }) => {
  const db = `e2e_prop_${Date.now()}`;
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  await a.goto('/');
  await b.goto('/');

  // A sets up the data.
  await cmd(a, `USE DATABASE ${db}`);
  await cmd(a, 'CREATE TABLE people (name CHARACTER)');
  await cmd(a, "APPEND BLANK");
  await cmd(a, "REPLACE name WITH 'Ada'");

  // Both BROWSE the same table.
  await cmd(a, 'USE people');
  await cmd(b, `USE DATABASE ${db}`);
  await cmd(b, 'USE people');
  await cmd(a, 'BROWSE');
  await cmd(b, 'BROWSE');

  // A edits a cell value via a REPLACE from a second nothing... instead edit through the grid is hard;
  // drive the change from a fresh command session in context A is simplest:
  await cmd(a, "REPLACE name WITH 'Grace'");

  // B's grid must show the new value without any manual re-query.
  await expect(ctxB === ctxB ? b.locator('#grid-tbody') : b.locator('#grid-tbody'))
    .toContainText('Grace', { timeout: 3000 });

  await ctxA.close();
  await ctxB.close();
});
```

> The exact REPL input selector, the grid body selector (`#grid-tbody` is used by `Grid.ts`), and how `BROWSE` is entered must be confirmed against `tests/multiarea.spec.ts` and `tests/integration.spec.ts`. Keep the *assertion* — context B's grid contains the value written by context A — and adapt the mechanics.

- [ ] **Step 2: Run the e2e (requires dev server)**

Run (in one terminal): `npm run dev`
Run (in another): `npx playwright test tests/propagation.spec.ts`
Expected: PASS — context B's grid shows `Grace` within the timeout.

- [ ] **Step 3: Commit**

```bash
git add tests/propagation.spec.ts
git commit -m "test: e2e two-client live propagation (#11)"
```

---

## Task D — Definition of done (per CLAUDE.md, in order)

- [ ] **Step 1: Full test suite green**

Run: `npm test`
Expected: PASS (all Vitest). Then `npx playwright test` with dev server up.

- [ ] **Step 2: Bump version**

In `package.json`, change `"version": "0.7.0"` to `"version": "0.8.0"` (minor — completed sub-project toward v1.1.0).

- [ ] **Step 3: CHANGELOG.md**

Add an entry under a new `## [0.8.0]` heading:

```markdown
### Added
- Live multiuser data propagation: when one session mutates a table, other
  sessions BROWSE-ing that same table refresh automatically (`data-changed`
  broadcast, server-side view filtering, debounced).

### Fixed
- `closeDatabase` no longer closes the SQLite handle shared across sessions —
  one user closing a DB no longer breaks everyone else's queries.
```

- [ ] **Step 4: README.md**

Add a short "Live multiuser" note to the feature list / multi-work-area section describing that concurrent edits propagate to other viewers.

- [ ] **Step 5: CLAUDE.md**

Note the propagation feature: mention `data-changed` in the WS message shapes area and `SessionManager.broadcast` in the architecture map; mark a roadmap line for v1.1.0 live propagation.

- [ ] **Step 6: Commit docs + version**

```bash
git add package.json CHANGELOG.md README.md CLAUDE.md
git commit -m "chore: v0.8.0 — live multiuser propagation (#11)"
```

- [ ] **Step 7: Tag the version (git-tag-on-version-bump convention)**

After merge to main, tag the merge commit:

```bash
git tag v0.8.0
git push origin v0.8.0
```

---

## Self-review notes

- **Spec coverage:** prereq fix (Task A) ✓; `data-changed` type (B1) ✓; bridge `onMutate` (B2) ✓; Session dirty + `currentView` + `notifyChange` (B3) ✓; `broadcast` view-filter + debounce (B4) ✓; client grid refresh (C1/C2) ✓; unit + e2e tests (B4/C3) ✓; out-of-scope items untouched ✓.
- **Type consistency:** `onMutate: (() => void) | null`, `notifyChange?: (db, table) => void`, `currentView(): {db, table}`, `broadcast(db, table, except)`, `data-changed` payload `{ db, table }`, `Grid.tableName` — all names used identically across tasks.
- **Open verification points flagged inline:** exact blank-append command (`APPEND BLANK` vs `APPEND RECORD`) and Playwright selectors must be confirmed against existing tests before running — called out at each use site.
```