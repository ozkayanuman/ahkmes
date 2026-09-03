import net from "node:net";
import type { ControllerConnectionState, ControllerObservation, MachineAdapter, MachineEvent, TagReading } from "./adapter.interface";
import {
  DataType,
  decodeCharValue,
  decodeGetDataReply,
  decodeLongValue,
  DEFAULT_ITEM_ADDRESSES,
  encodeGetDataRequest,
  parseM80Address,
  totalFrameSize,
  type DataTypeValue,
} from "./m80-protocol";

export interface M80TagConfig {
  name: string;
  /** "section:subSection" veya "section:subSection:char" — bkz. `parseM80Address`. */
  address: string;
}

export interface M80ItemAddress {
  section: number;
  subSection: number;
}

export interface M80AdapterConfig {
  host: string;
  port: number;
  systemNo?: number;
  pollIntervalMs?: number;
  /** Okuma bağlantısı beklenmedik biçimde kapanırsa yeniden bağlanma gecikmesi. */
  reconnectDelayMs?: number;
  /** Section/subSection numaraları placeholder'dır — gerçek M80 "Custom API Variables
   * List" dokümanı (BNP-C3072-xxx) netleşince buradan (veya config'den) güncellenmeli. */
  cycleStatusItem?: M80ItemAddress;
  partCountItem?: M80ItemAddress;
  alarmMessageItem?: M80ItemAddress;
  /** Explicit Custom API program variable. It is absent until the customer
   * supplies a controller-specific read-only address. */
  programIdentityItem?: M80ItemAddress;
  requestTimeoutMs?: number;
  /** Automation Gateway: web'de tanımlanan, elle girilen tag listesi — M80'de
   * otomatik keşif yok (Custom API Variables List elimizde olmadığı için). */
  tags?: M80TagConfig[];
}

const DEFAULTS = {
  systemNo: 1,
  pollIntervalMs: 500,
  reconnectDelayMs: 2_000,
  cycleStatusItem: DEFAULT_ITEM_ADDRESSES.cycleStatus,
  partCountItem: DEFAULT_ITEM_ADDRESSES.partCount,
  alarmMessageItem: DEFAULT_ITEM_ADDRESSES.alarmMessage,
};

// CycleStatus: 0=IDLE, 1=RUNNING, 2=ALARM — OpcuaAdapter ile aynı sözleşme.
const IDLE = 0;
const RUNNING = 1;
const ALARM = 2;

/**
 * Mitsubishi M80 için ham TCP soketi üzerinden (Custom API / EZSocket-GIOP ailesi,
 * bkz. `m80-protocol.ts`) veri okuyan adapter. Gerçek donanımda subscribe/push
 * mekanizması netleşmediği için polling kullanır; edge-detection mantığı
 * `OpcuaAdapter` ile birebir aynıdır (yalnızca veri kaynağı farklı).
 *
 * DİKKAT: `m80-protocol.ts`'teki kablo formatı gerçek M80'de doğrulanmadı — bu
 * adapter şu an yalnızca kendi `m80-sim-server`'ımıza karşı test edilebilir.
 */
export class M80Adapter implements MachineAdapter {
  private socket: net.Socket | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private listeners: ((event: MachineEvent) => void)[] = [];
  private recvBuffer = Buffer.alloc(0);
  private nextRequestId = 1;
  private pending = new Map<number, { resolve: (data: Buffer) => void; reject: (err: Error) => void }>();

  private lastCycleStatus: number | null = null;
  private lastPartCount: number | null = null;
  private lastAlarmMessage = "";

  private readonly systemNo: number;
  private readonly pollIntervalMs: number;
  private readonly reconnectDelayMs: number;
  private readonly cycleStatusItem: M80ItemAddress;
  private readonly partCountItem: M80ItemAddress;
  private readonly alarmMessageItem: M80ItemAddress;
  private readonly programIdentityItem: M80ItemAddress | undefined;
  private readonly requestTimeoutMs: number;
  private connectionGeneration = 0;
  private connectionListeners: ((state: ControllerConnectionState, detail?: string) => void)[] = [];

  constructor(private readonly config: M80AdapterConfig) {
    this.systemNo = config.systemNo ?? DEFAULTS.systemNo;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULTS.pollIntervalMs;
    this.reconnectDelayMs = config.reconnectDelayMs ?? DEFAULTS.reconnectDelayMs;
    this.cycleStatusItem = config.cycleStatusItem ?? DEFAULTS.cycleStatusItem;
    this.partCountItem = config.partCountItem ?? DEFAULTS.partCountItem;
    this.alarmMessageItem = config.alarmMessageItem ?? DEFAULTS.alarmMessageItem;
    this.programIdentityItem = config.programIdentityItem;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 3_000;
  }

  async connect(): Promise<void> {
    this.stopped = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.connectionChanged("CONNECTING");
    await this.openSocket();
    this.startPolling();
  }

  private async openSocket(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: this.config.host, port: this.config.port });
      socket.once("connect", () => { this.connectionGeneration += 1; this.connectionChanged("ONLINE"); resolve(); });
      socket.once("error", (err) => reject(err));
      socket.on("data", (chunk) => this.onData(chunk));
      // İlk bağlantı hatası `once` dinleyicisiyle connect() çağrısına döner;
      // sonraki socket hataları ise close olayıyla kontrollü reconnect'e gider.
      socket.on("error", () => undefined);
      socket.on("close", () => this.handleSocketClosed(socket));
      this.socket = socket;
    });
  }

  private startPolling() {
    this.pollTimer = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const { reject } of this.pending.values()) reject(new Error("Bağlantı kapatıldı"));
    this.pending.clear();
    await new Promise<void>((resolve) => {
      if (!this.socket) return resolve();
      this.socket.end(() => resolve());
    }).catch(() => undefined);
    this.socket = null;
    this.connectionChanged("OFFLINE", "connector stopped");
  }

  private handleSocketClosed(socket: net.Socket) {
    if (this.socket !== socket) return;
    this.socket = null;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    for (const { reject } of this.pending.values()) reject(new Error("M80 bağlantısı kesildi"));
    this.pending.clear();
    this.connectionChanged("OFFLINE", "socket closed");
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.reconnect();
    }, this.reconnectDelayMs);
  }

  private async reconnect() {
    if (this.stopped || this.socket) return;
    try {
      await this.openSocket();
      this.startPolling();
    } catch {
      this.socket = null;
      this.scheduleReconnect();
    }
  }

  onEvent(cb: (event: MachineEvent) => void): void {
    this.listeners.push(cb);
  }

  onConnectionState(cb: (state: ControllerConnectionState, detail?: string) => void): void {
    this.connectionListeners.push(cb);
  }

  /** Automation Gateway: sadece config'de elle tanımlı tag'leri okur (keşif yok). */
  async readTags(): Promise<TagReading[]> {
    const readings: TagReading[] = [];
    for (const tag of this.config.tags ?? []) {
      const parsed = parseM80Address(tag.address);
      if (!parsed) continue;
      try {
        const raw = await this.readItem({ section: parsed.section, subSection: parsed.subSection }, parsed.dataType);
        const value = parsed.dataType === DataType.CHAR ? decodeCharValue(raw) : String(decodeLongValue(raw));
        readings.push({ name: tag.name, value });
      } catch {
        // Tek bir tag okunamazsa diğerleri etkilenmez; bir sonraki pollde tekrar denenir.
      }
    }
    return readings;
  }

  async readControllerObservation(): Promise<ControllerObservation> {
    if (!this.socket) return this.observation("OFFLINE", "OFFLINE", { error: "socket-not-connected" });
    try {
      const reads: Promise<Buffer>[] = [
        this.readItem(this.cycleStatusItem, DataType.LONG),
        this.readItem(this.partCountItem, DataType.LONG),
        this.readItem(this.alarmMessageItem, DataType.CHAR),
      ];
      if (this.programIdentityItem) reads.push(this.readItem(this.programIdentityItem, DataType.CHAR));
      const [cycleStatusRaw, partCountRaw, alarmMessageRaw, programRaw] = await Promise.all(reads);
      const cycleStatus = decodeLongValue(cycleStatusRaw);
      const partCounter = decodeLongValue(partCountRaw);
      const alarmText = decodeCharValue(alarmMessageRaw) || null;
      const activeProgramIdentity = programRaw ? decodeCharValue(programRaw).trim() || null : null;
      const machineState = cycleStatus === RUNNING ? "RUNNING" : cycleStatus === ALARM ? "ALARM" : cycleStatus === IDLE ? "IDLE" : "UNKNOWN";
      return this.observation("ONLINE", machineState, { cycleStatus, partCounter, alarmText, activeProgramIdentity });
    } catch (error) {
      return this.observation("DEGRADED", "UNKNOWN", { error: error instanceof Error ? error.message : "M80 read failed" });
    }
  }

  private emit(type: MachineEvent["type"], payload?: Record<string, unknown>) {
    const event: MachineEvent = { type, timestamp: new Date().toISOString(), payload };
    for (const cb of this.listeners) cb(event);
  }

  private observation(connectionState: ControllerObservation["connectionState"], machineState: ControllerObservation["machineState"], raw: Record<string, unknown>): ControllerObservation {
    return {
      connectionState,
      machineState,
      trustLevel: "OBSERVED",
      connectionGeneration: this.connectionGeneration,
      activeProgramIdentity: typeof raw.activeProgramIdentity === "string" ? raw.activeProgramIdentity : null,
      alarmText: typeof raw.alarmText === "string" ? raw.alarmText : null,
      partCounter: typeof raw.partCounter === "number" ? raw.partCounter : null,
      capabilities: {
        CONNECTIVITY: true,
        MACHINE_STATE_READ: true,
        CYCLE_STATE_READ: true,
        ALARM_READ: true,
        PART_COUNTER_READ: true,
        ACTIVE_PROGRAM_IDENTITY_READ: Boolean(this.programIdentityItem),
        PROGRAM_CONTENT_READ: false,
        PROGRAM_CHECKSUM_READ: false,
        FEED_OVERRIDE_READ: false,
        SPINDLE_STATE_READ: false,
        PROGRAM_TRANSFER: false,
        REMOTE_START: false,
      },
      raw,
    };
  }

  private connectionChanged(state: ControllerConnectionState, detail?: string) {
    for (const listener of this.connectionListeners) listener(state, detail);
  }

  private onData(chunk: Buffer) {
    this.recvBuffer = Buffer.concat([this.recvBuffer, chunk]);
    for (;;) {
      const size = totalFrameSize(this.recvBuffer);
      if (size === null) return;
      const frame = this.recvBuffer.subarray(0, size);
      this.recvBuffer = this.recvBuffer.subarray(size);

      const reply = decodeGetDataReply(frame);
      const pending = this.pending.get(reply.requestId);
      if (!pending) continue;
      this.pending.delete(reply.requestId);
      if (reply.isError) {
        pending.reject(new Error(`M80 GetData hatası (requestId=${reply.requestId})`));
      } else {
        pending.resolve(reply.data);
      }
    }
  }

  private readItem(item: M80ItemAddress, dataType: DataTypeValue): Promise<Buffer> {
    if (!this.socket) return Promise.reject(new Error("Bağlantı yok"));
    const requestId = this.nextRequestId++;
    const frame = encodeGetDataRequest({
      requestId,
      section: item.section,
      subSection: item.subSection,
      systemNo: this.systemNo,
      axisNo: 0,
      dataType,
    });

    return new Promise<Buffer>((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.pending.delete(requestId)) reject(new Error("M80 read timeout"));
      }, this.requestTimeoutMs);
      this.pending.set(requestId, {
        resolve: (data) => { clearTimeout(timeout); resolve(data); },
        reject: (error) => { clearTimeout(timeout); reject(error); },
      });
      this.socket?.write(frame, (err) => {
        if (err) {
          this.pending.delete(requestId);
          clearTimeout(timeout);
          reject(err);
        }
      });
    });
  }

  private async poll(): Promise<void> {
    try {
      const observation = await this.readControllerObservation();
      if (observation.connectionState !== "ONLINE") return;
      const raw = observation.raw ?? {};
      this.onAlarmMessageChanged(String(raw.alarmText ?? ""));
      this.onPartCountChanged(Number(raw.partCounter));
      this.onCycleStatusChanged(Number(raw.cycleStatus));
    } catch {
      // Tek bir poll turu başarısız olursa bir sonraki interval'da tekrar denenir;
      // `Connector` katmanı zaten backend'e giden event'ler için retry uyguluyor.
    }
  }

  private onAlarmMessageChanged(message: string) {
    this.lastAlarmMessage = message;
  }

  private onCycleStatusChanged(status: number) {
    const prev = this.lastCycleStatus;
    this.lastCycleStatus = status;
    if (prev === status) return;

    if (status === RUNNING && prev !== RUNNING) {
      this.emit("CYCLE_START");
    } else if (status === ALARM) {
      this.emit("ALARM", { message: this.lastAlarmMessage || "Alarm" });
    } else if (status === IDLE && (prev === RUNNING || prev === ALARM)) {
      this.emit("CYCLE_END");
    } else if (status === IDLE && prev === null) {
      this.emit("IDLE");
    }
  }

  private onPartCountChanged(count: number) {
    const prev = this.lastPartCount;
    this.lastPartCount = count;
    if (prev !== null && count > prev) {
      this.emit("PART_COMPLETE");
    }
  }
}
