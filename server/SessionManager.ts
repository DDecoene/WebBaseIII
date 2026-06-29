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
    const key = `${db} ${table.toLowerCase()}`;
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
