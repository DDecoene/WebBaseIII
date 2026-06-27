# Live multiuser data propagation — design

Date: 2026-06-27
Issue: [#11](https://github.com/DDecoene/WebBaseIII/issues/11)
Milestone: v1.1.0 — beyond parity

## Goal

When one session mutates a table, every other session currently viewing that
table in a BROWSE grid re-fetches and repaints automatically — no manual
re-query. Turns "technically multiuser" (one authoritative server, shared WAL
SQLite, isolated per-socket sessions) into a visible, demoable feature: type in
one browser window, watch another refresh.

## Decisions

- **Shared-handle close bug:** stop closing shared DBs. `closeDatabase()` only
  detaches the session; it never calls `db.close()` on the shared handle.
- **Relevance:** decided server-side. `SessionManager` only notifies sessions
  whose current view matches the changed `db`/`table`.
- **Refresh scope:** BROWSE grid only. Terminal `LIST` output stays a
  point-in-time snapshot.

## Architecture

### 1. Prereq fix — `ServerDatabaseBridge.closeDatabase()`

The `openDbs` map holds one `Database` instance per named DB, shared across all
sessions. Today `closeDatabase()` calls `this.db.close()` and deletes the entry,
yanking the handle out from under every other session. Fix: detach only.

```ts
async closeDatabase(): Promise<void> {
  // Shared handle stays open in openDbs for the process lifetime (WAL).
  this.db = null;
  this.currentDb = null;
}
```

Independent of the rest; lands first with its own regression test.

### 2. Mutation signal — bridge → session → manager

Every write routes through `ServerDatabaseBridge.exec()` (reads use `query()`).
That is the single chokepoint.

- Bridge gains an optional `onMutate?: () => void` hook, fired after each
  successful `exec()`.
- `Session` sets `bridge.onMutate` to mark a private `dirty` flag.
- After a command (or grid op) completes, if `dirty`, `Session` reads its
  current `executor.area.{db, table}` and calls a `notifyChange(db, table, self)`
  callback injected by `SessionManager` at construction — mirroring how the
  existing `send` callback is injected.

This covers every mutating path with no per-command bookkeeping: interpreter
`REPLACE` / `REPLACE ALL` / `APPEND` / `DELETE` / `DELETE ALL` / `PACK`, and the
`grid-edit` / `grid-delete` / `grid-new-row` message handlers — all run through
`exec()`.

`Session` exposes a small getter for the manager to read view state:

```ts
currentView(): { db: string | null; table: string | null } {
  const a = this.executor.area;
  return { db: a.db, table: a.table };
}
```

### 3. Fan-out — `SessionManager.broadcast(db, table, except)`

New method on `SessionManager`:

- Iterates `this.sessions`, skips the originator (`except`).
- Server-side filter: sends only to sessions whose `currentView()` matches the
  changed `db` and `table` (case-insensitive table compare, consistent with
  `tableExists`).
- Sends a new `ServerMessage`: `{ type: 'data-changed', db, table }`.
- Debounce/coalesce per `db|table` key (short window, ~50ms) so a burst such as
  `REPLACE ALL` over 500 rows produces one broadcast, not 500.

`SessionManager.add()` injects `notifyChange` into each `Session` (alongside
`send`); `notifyChange` calls `broadcast`.

### 4. Client — `WsClient` + `Grid`

- `WsClient` handles the `data-changed` message.
- If a `Grid` is currently open on the affected table, trigger the same refresh
  path as F5: re-fetch rows, repaint, preserve cursor position where possible.
- No effect when no grid is open or the open grid is a different table.
- Terminal output is unchanged.

## Components & boundaries

| Unit | Responsibility | Depends on |
|---|---|---|
| `ServerDatabaseBridge` | fire `onMutate` after writes; detach-only close | — |
| `Session` | dirty-tracking, `currentView()`, call `notifyChange` | bridge, executor |
| `SessionManager` | `broadcast()` with view filter + debounce | sessions, types |
| `src/shared/types.ts` | `data-changed` ServerMessage variant | — |
| `WsClient` | dispatch `data-changed` | types |
| `Grid` | refresh-in-place on remote change | WsClient |

## Testing

- Unit (`SessionManager`): `broadcast` only reaches sessions viewing the matching
  db/table; originator is skipped; debounce coalesces a burst into one send.
- Unit (`ServerDatabaseBridge`): after `closeDatabase()` on session A, session B's
  query on the same shared DB still succeeds (regression for the prereq bug).
- Playwright (extends `tests/multiarea.spec.ts` patterns): two browser contexts,
  both `USE customers` + `BROWSE`; edit a record in context 1; assert context 2's
  grid reflects the change without manual re-query.

## Implementation split (parallelizable)

- **A — prereq:** `closeDatabase` detach-only fix + bridge regression test.
  Independent; lands first.
- **B — server:** `data-changed` type, bridge `onMutate`, Session dirty-tracking
  + `currentView`, `SessionManager.broadcast` + debounce, unit tests.
- **C — client + e2e:** `WsClient` handler, `Grid` refresh, Playwright test.
  Depends on B's message type.

## Out of scope

- Named-user identity / "who's editing this" / optimistic-lock conflict warnings
  (follow-on issue candidate noted in #11).
- Terminal LIST live refresh.

## Definition of done

Follows CLAUDE.md ordered checklist: tests green → version bump (minor, toward
v1.1.0) → CHANGELOG → README → CLAUDE.md → screenshots if UI changed. Tag the
version per the git-tag-on-version-bump convention.
