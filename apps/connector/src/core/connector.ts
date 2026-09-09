import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { MachineAdapter, MachineEvent } from "../adapters/adapter.interface";
import { DurableEventQueue, MemoryEventQueue } from "./durable-event-queue";

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
  /** Edge diskinde kalıcı event kuyruğu; verilmezse makineye özgü yerel dosya kullanılır. */
  durableQueuePath?: string;
  /** Operasyon denetimi için yalnızca 127.0.0.1 üzerinde açılan HTTP portu. */
  healthPort?: number;
  adapter?: "simulator" | "opcua" | "m80" | "fanuc";
  statusIntervalMs?: number;
  observationPollIntervalMs?: number;
  observationHeartbeatMs?: number;
}

export interface ConnectorStatus {
  startedAt: string;
  connected: boolean;
  queueDepth: number;
  acceptedEvents: number;
  deliveredEvents: number;
  tagPollSuccesses: number;
  tagPollFailures: number;
  lastDeliveryAt?: string;
  lastSuccessfulCommunicationAt?: string;
  lastError?: string;
  lastErrorCategory?: "CONNECTION" | "BACKEND_DELIVERY" | "CONFIGURATION" | "ADAPTER" | "UNKNOWN";
}

type Fetch = typeof fetch;

/** Adapter olaylarını normalize edip backend'e gönderir; bağlantı kopukluğunda kuyruğa alıp üstel backoff ile yeniden dener. */
export class Connector {
  private readonly queue: DurableEventQueue | MemoryEventQueue;
  private draining = false;
  private readonly maxQueueSize: number;
  private readonly retryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private readonly tagPollIntervalMs: number;
  private tagPollTimer: ReturnType<typeof setInterval> | null = null;
  private healthServer: Server | null = null;
  private readonly startedAt = new Date().toISOString();
  private connected = false;
  private acceptedEvents = 0;
  private deliveredEvents = 0;
  private tagPollSuccesses = 0;
  private tagPollFailures = 0;
  private lastDeliveryAt: string | undefined;
  private lastSuccessfulCommunicationAt: string | undefined;
  private lastError: string | undefined;
  private lastErrorCategory: ConnectorStatus["lastErrorCategory"];
  private statusTimer: ReturnType<typeof setInterval> | null = null;
  private observationTimer: ReturnType<typeof setInterval> | null = null;
  private readonly observationPollIntervalMs: number;
  private readonly observationHeartbeatMs: number;
  private lastObservationSignature: string | undefined;
  private lastObservationSentAt = 0;

  constructor(
    private readonly adapter: MachineAdapter,
    private readonly config: ConnectorConfig,
    private readonly httpFetch: Fetch = fetch,
  ) {
    this.maxQueueSize = config.maxQueueSize ?? 500;
    this.retryDelayMs = config.retryDelayMs ?? 1000;
    this.maxRetryDelayMs = config.maxRetryDelayMs ?? 30_000;
    this.tagPollIntervalMs = config.tagPollIntervalMs ?? 0;
    this.observationPollIntervalMs = config.observationPollIntervalMs ?? 2_000;
    this.observationHeartbeatMs = config.observationHeartbeatMs ?? 30_000;
    this.queue = config.durableQueuePath ? new DurableEventQueue(config.durableQueuePath) : new MemoryEventQueue();
  }

  async start(): Promise<void> {
    await this.queue.load();
    this.adapter.onEvent((event) => this.enqueue(event));
    this.adapter.onConnectionState?.((state, detail) => {
      this.connected = state === "ONLINE";
      if (state !== "ONLINE") {
        this.lastError = detail;
        this.lastErrorCategory = "CONNECTION";
      }
      if (this.config.adapter) void this.reportStatus(this.connected ? "CONNECTED" : state === "CONNECTING" ? "RECONNECTING" : "DISCONNECTED");
      if (this.adapter.readControllerObservation) void this.pollControllerObservation(true);
    });
    await this.startHealthServer();
    await this.adapter.connect();
    this.connected = true;
    this.lastSuccessfulCommunicationAt = new Date().toISOString();
    if (this.config.adapter) {
      void this.reportStatus("CONNECTED");
      this.statusTimer = setInterval(() => void this.reportStatus(this.connected ? "CONNECTED" : "DISCONNECTED"), this.config.statusIntervalMs ?? 30_000);
    }
    if (this.queue.length > 0 && !this.draining) {
      this.draining = true;
      void this.drain();
    }

    if (this.adapter.readTags && this.tagPollIntervalMs > 0) {
      this.tagPollTimer = setInterval(() => void this.pollTags(), this.tagPollIntervalMs);
    }
    if (this.adapter.readControllerObservation) {
      await this.pollControllerObservation(true);
      this.observationTimer = setInterval(() => void this.pollControllerObservation(), this.observationPollIntervalMs);
    }
  }

  async stop(): Promise<void> {
    if (this.tagPollTimer) clearInterval(this.tagPollTimer);
    if (this.statusTimer) clearInterval(this.statusTimer);
    if (this.observationTimer) clearInterval(this.observationTimer);
    this.tagPollTimer = null;
    this.statusTimer = null;
    this.observationTimer = null;
    await this.adapter.disconnect();
    this.connected = false;
    if (this.config.adapter) await this.reportStatus("DISCONNECTED");
    if (this.healthServer) {
      await new Promise<void>((resolve, reject) => this.healthServer!.close((error) => error ? reject(error) : resolve()));
      this.healthServer = null;
    }
  }

  getStatus(): ConnectorStatus {
    return {
      startedAt: this.startedAt,
      connected: this.connected,
      queueDepth: this.queue.length,
      acceptedEvents: this.acceptedEvents,
      deliveredEvents: this.deliveredEvents,
      tagPollSuccesses: this.tagPollSuccesses,
      tagPollFailures: this.tagPollFailures,
      ...(this.lastDeliveryAt ? { lastDeliveryAt: this.lastDeliveryAt } : {}),
      ...(this.lastSuccessfulCommunicationAt ? { lastSuccessfulCommunicationAt: this.lastSuccessfulCommunicationAt } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
      ...(this.lastErrorCategory ? { lastErrorCategory: this.lastErrorCategory } : {}),
    };
  }

  private async startHealthServer(): Promise<void> {
    const port = this.config.healthPort ?? 0;
    if (port === 0) return;
    this.healthServer = createServer((request, response) => {
      const status = this.getStatus();
      if (request.url === "/health") {
        response.writeHead(status.connected ? 200 : 503, { "Content-Type": "application/json" });
        response.end(JSON.stringify(status));
        return;
      }
      if (request.url === "/metrics") {
        response.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
        response.end([
          "# HELP ahkmes_connector_queue_depth Number of events awaiting backend delivery.",
          "# TYPE ahkmes_connector_queue_depth gauge",
          `ahkmes_connector_queue_depth ${status.queueDepth}`,
          "# HELP ahkmes_connector_events_delivered_total Events successfully delivered to the backend.",
          "# TYPE ahkmes_connector_events_delivered_total counter",
          `ahkmes_connector_events_delivered_total ${status.deliveredEvents}`,
          "# HELP ahkmes_connector_tag_poll_failures_total Failed tag polling requests.",
          "# TYPE ahkmes_connector_tag_poll_failures_total counter",
          `ahkmes_connector_tag_poll_failures_total ${status.tagPollFailures}`,
          "",
        ].join("\n"));
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve, reject) => {
      this.healthServer!.once("error", reject);
      this.healthServer!.listen(port, "127.0.0.1", () => {
        this.healthServer!.off("error", reject);
        resolve();
      });
    });
  }

  /** Automation Gateway: tag değerleri "en son değer yeter" karakterinde — kayıp
   * toleranslı, olay kuyruğunun aksine retry/backoff uygulanmaz. */
  private async pollTags(): Promise<void> {
    if (!this.adapter.readTags) return;
    try {
      const readings = await this.adapter.readTags();
      if (readings.length === 0) return;
      const response = await this.httpFetch(`${this.config.backendUrl}/machines/${this.config.machineId}/tag-values`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Machine-Key": this.config.machineKey },
        body: JSON.stringify({ values: readings.map((r) => ({ tagName: r.name, value: r.value })) }),
      });
      if (!response.ok) throw new Error(`tag-values HTTP ${response.status}`);
      this.tagPollSuccesses += 1;
    } catch (error) {
      this.tagPollFailures += 1;
      this.lastError = error instanceof Error ? error.message : "tag polling failed";
      this.lastErrorCategory = "ADAPTER";
      // Bir sonraki pollde tekrar denenir.
    }
  }

  private async pollControllerObservation(force = false): Promise<void> {
    if (!this.adapter.readControllerObservation) return;
    try {
      const observation = await this.adapter.readControllerObservation();
      const signature = JSON.stringify({
        connectionState: observation.connectionState,
        machineState: observation.machineState,
        program: observation.activeProgramIdentity ?? null,
        alarm: observation.alarmCode ?? observation.alarmText ?? null,
        partCounter: observation.partCounter ?? null,
        generation: observation.connectionGeneration,
      });
      const now = Date.now();
      if (!force && signature === this.lastObservationSignature && now - this.lastObservationSentAt < this.observationHeartbeatMs) return;
      const response = await this.httpFetch(`${this.config.backendUrl}/machines/${this.config.machineId}/controller-observation`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Machine-Key": this.config.machineKey },
        body: JSON.stringify({ ...observation, idempotencyKey: `${this.config.machineId}:${observation.connectionGeneration}:${randomUUID()}` }),
      });
      if (!response.ok) throw new Error(`controller-observation HTTP ${response.status}`);
      this.lastObservationSignature = signature;
      this.lastObservationSentAt = now;
      if (observation.connectionState === "ONLINE") this.lastSuccessfulCommunicationAt = new Date().toISOString();
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "controller observation failed";
      this.lastErrorCategory = "ADAPTER";
    }
  }

  private async enqueue(event: MachineEvent): Promise<void> {
    // eventId retry'ler boyunca aynı kuyruk öğesinde korunur — backend aynı
    // olayın ikinci kez işlenmesini bu id ile engeller (idempotency).
    if (!event.eventId) event.eventId = randomUUID();
    await this.queue.push(event, this.maxQueueSize);
    this.acceptedEvents += 1;
    // Kuyruk diske yazıldığı için `push` asenkrondur. Birden fazla adapter olayı
    // arka arkaya gelirse yalnızca ilk çağrı drain hakkını almalıdır; aksi halde
    // aynı öğe iki paralel HTTP isteğine konu olabilir.
    if (!this.draining) {
      this.draining = true;
      void this.drain();
    }
  }

  private async drain(): Promise<void> {
    let delay = this.retryDelayMs;
    try {
      while (this.queue.peek()) {
        const event = this.queue.peek()!;
        const ok = await this.send(event);
        if (ok) {
          await this.queue.shift();
          this.deliveredEvents += 1;
          this.lastDeliveryAt = new Date().toISOString();
          this.lastSuccessfulCommunicationAt = this.lastDeliveryAt;
          this.lastError = undefined;
          this.lastErrorCategory = undefined;
          delay = this.retryDelayMs;
        } else {
          await new Promise((r) => setTimeout(r, delay));
          delay = Math.min(delay * 2, this.maxRetryDelayMs);
        }
      }
    } finally {
      this.draining = false;
      // Drain biterken yeni bir olay kuyruğa girmiş olabilir. Olayı kaybetmeden
      // tek tüketici ilkesini koruyarak yeni turu başlat.
      if (this.queue.peek() && !this.draining) {
        this.draining = true;
        void this.drain();
      }
    }
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
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "telemetry delivery failed";
      this.lastErrorCategory = "BACKEND_DELIVERY";
      return false;
    }
  }

  private async reportStatus(connectionState: "CONNECTED" | "DISCONNECTED" | "RECONNECTING" | "ERROR") {
    try {
      const response = await this.httpFetch(`${this.config.backendUrl}/machines/${this.config.machineId}/connector-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Machine-Key": this.config.machineKey },
        body: JSON.stringify({
          adapter: this.config.adapter ?? "simulator",
          connectionState,
          lastSuccessfulCommunicationAt: this.lastSuccessfulCommunicationAt,
          lastErrorCategory: this.lastErrorCategory,
          reconnecting: connectionState === "RECONNECTING",
          configurationValid: true,
        }),
      });
      if (!response.ok) throw new Error(`connector-status HTTP ${response.status}`);
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : "connector status delivery failed";
      this.lastErrorCategory = "BACKEND_DELIVERY";
    }
  }
}
