import type { MachineAdapter, MachineEvent } from "../adapters/adapter.interface";

export interface ConnectorConfig {
  backendUrl: string;
  machineId: string;
  machineKey: string;
  maxQueueSize?: number;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
}

type Fetch = typeof fetch;

/** Adapter olaylarını normalize edip backend'e gönderir; bağlantı kopukluğunda kuyruğa alıp üstel backoff ile yeniden dener. */
export class Connector {
  private queue: MachineEvent[] = [];
  private draining = false;
  private readonly maxQueueSize: number;
  private readonly retryDelayMs: number;
  private readonly maxRetryDelayMs: number;

  constructor(
    private readonly adapter: MachineAdapter,
    private readonly config: ConnectorConfig,
    private readonly httpFetch: Fetch = fetch,
  ) {
    this.maxQueueSize = config.maxQueueSize ?? 500;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
    this.maxRetryDelayMs = config.maxRetryDelayMs ?? 30_000;
  }

  async start(): Promise<void> {
    this.adapter.onEvent((event) => this.enqueue(event));
    await this.adapter.connect();
  }

  async stop(): Promise<void> {
    await this.adapter.disconnect();
  }

  private enqueue(event: MachineEvent): void {
    this.queue.push(event);
    if (this.queue.length > this.maxQueueSize) this.queue.shift();
    if (!this.draining) void this.drain();
  }

  private async drain(): Promise<void> {
    this.draining = true;
    let delay = this.retryDelayMs;
    while (this.queue.length > 0) {
      const event = this.queue[0];
      const ok = await this.send(event);
      if (ok) {
        this.queue.shift();
        delay = this.retryDelayMs;
      } else {
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, this.maxRetryDelayMs);
      }
    }
    this.draining = false;
  }

  private async send(event: MachineEvent): Promise<boolean> {
    try {
      const res = await this.httpFetch(
        `${this.config.backendUrl}/machines/${this.config.machineId}/telemetry`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Machine-Key": this.config.machineKey,
          },
          body: JSON.stringify({ type: event.type, timestamp: event.timestamp, payload: event.payload }),
        },
      );
      // 409 (atanmış iş emri yok) kalıcı bir hata — yeniden denenmeden düşürülür.
      if (res.status === 409) return true;
      return res.ok;
    } catch {
      return false;
    }
  }
}
