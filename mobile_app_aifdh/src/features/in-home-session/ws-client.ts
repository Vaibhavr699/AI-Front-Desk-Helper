import type { WsClientMessage, WsServerMessage } from "./types";

type Listener = (message: WsServerMessage) => void;
type StatusListener = (status: WsStatus) => void;

export type WsStatus = "idle" | "connecting" | "open" | "closed" | "error";

export class InHomeWsClient {
  private url: string;
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private status: WsStatus = "idle";
  private retries = 0;
  private maxRetries = 5;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;

  constructor(url: string) {
    this.url = url;
  }

  connect(): void {
    if (this.ws && this.status !== "closed" && this.status !== "error") return;
    this.intentionallyClosed = false;
    this.setStatus("connecting");

    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.retries = 0;
      this.setStatus("open");
    };

    ws.onmessage = (event) => {
      let parsed: WsServerMessage | null = null;
      try {
        const raw = typeof event.data === "string" ? event.data : "";
        if (raw) parsed = JSON.parse(raw) as WsServerMessage;
      } catch {
        return;
      }
      if (!parsed) return;
      this.listeners.forEach((l) => l(parsed));
    };

    ws.onerror = () => {
      this.setStatus("error");
    };

    ws.onclose = () => {
      this.setStatus("closed");
      this.ws = null;
      if (!this.intentionallyClosed && this.retries < this.maxRetries) {
        const delay = Math.min(15_000, 500 * 2 ** this.retries);
        this.retries += 1;
        this.retryTimer = setTimeout(() => this.connect(), delay);
      }
    };
  }

  send(message: WsClientMessage): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
      return true;
    }
    return false;
  }

  sendBinary(buffer: ArrayBufferLike): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(buffer);
      return true;
    }
    return false;
  }

  close(): void {
    this.intentionallyClosed = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.close();
      } catch {}
      this.ws = null;
    }
    this.setStatus("closed");
  }

  on(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  getStatus(): WsStatus {
    return this.status;
  }

  private setStatus(next: WsStatus): void {
    if (this.status === next) return;
    this.status = next;
    this.statusListeners.forEach((l) => l(next));
  }
}
