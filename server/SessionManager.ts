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
