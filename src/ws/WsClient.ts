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
