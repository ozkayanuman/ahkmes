import { randomUUID } from "node:crypto";
import type { MachineAdapter, MachineEvent } from "../adapters/adapter.interface";

export interface ConnectorConfig {
  backendUrl: string;
  machineId: string;
  machineKey: string;
  maxQueueSize?: number;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
  /** Automation Gateway: adapter `readTags()` destekliyorsa bu aralıkla poll edilip
   * `/tag-values`'e gönderilir. 0/undefined ise tag polling kapalıdır. */
  tagPollIntervalMs?: number;
}

type Fetch = typeof fetch;

/** Adapter olaylarını normalize edip backend'e gönderir; bağlantı kopukluğunda kuyruğa alıp üstel backoff ile yeniden dener. */
export class Connector {
  private queue: MachineEvent[] = [];
  private draining = false;
  private readonly maxQueueSize: number;
  private readonly retryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly tagPollIntervalMs: number;
  private tagPollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly adapter: MachineAdapter,
    private readonly config: ConnectorConfig,
    private readonly httpFetch: Fetch = fetch,
  ) {
    this.maxQueueSize = config.maxQueueSize ?? 500;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
    this.maxRetryDelayMs = config.maxRetryDelayMs ?? 30_000;
    this.tagPollIntervalMs = config.tagPollIntervalMs ?? 0;
  }

  async start(): Promise<void> {
    this.adapter.onEvent((event) => this.enqueue(event));
    await this.adapter.connect();

    if (this.adapter.readTags && this.tagPollIntervalMs > 0) {
      this.tagPollTimer = setInterval(() => void this.pollTags(), this.tagPollIntervalMs);
    }
  }

  async stop(): Promise<void> {
    if (this.tagPollTimer) clearInterval(this.tagPollTimer);
    this.tagPollTimer = null;
    await this.adapter.disconnect();
  }

  /** Automation Gateway: tag değerleri "en son değer yeter" karakterinde — kayıp
   * toleranslı, olay kuyruğunun aksine retry/backoff uygulanmaz. */
  private async pollTags(): Promise<void> {
    if (!this.adapter.readTags) return;
    try {
      const readings = await this.adapter.readTags();
      if (readings.length === 0) return;
      await this.httpFetch(`${this.config.backendUrl}/machines/${this.config.machineId}/tag-values`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Machine-Key": this.config.machineKey },
        body: JSON.stringify({ values: readings.map((r) => ({ tagName: r.name, value: r.value })) }),
      });
    } catch {
      // Bir sonraki pollde tekrar denenir.
    }
  }

  private enqueue(event: MachineEvent): void {
    // eventId retry'ler boyunca aynı kuyruk öğesinde korunur — backend aynı
    // olayın ikinci kez işlenmesini bu id ile engeller (idempotency).
    if (!event.eventId) event.eventId = randomUUID();
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
          body: JSON.stringify({
            type: event.type,
            timestamp: event.timestamp,
            payload: event.payload,
            eventId: event.eventId,
          }),
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
