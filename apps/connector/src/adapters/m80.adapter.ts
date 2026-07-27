import net from "node:net";
import type { MachineAdapter, MachineEvent, TagReading } from "./adapter.interface";
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
  /** Section/subSection numaraları placeholder'dır — gerçek M80 "Custom API Variables
   * List" dokümanı (BNP-C3072-xxx) netleşince buradan (veya config'den) güncellenmeli. */
  cycleStatusItem?: M80ItemAddress;
  partCountItem?: M80ItemAddress;
  alarmMessageItem?: M80ItemAddress;
  /** Automation Gateway: web'de tanımlanan, elle girilen tag listesi — M80'de
   * otomatik keşif yok (Custom API Variables List elimizde olmadığı için). */
  tags?: M80TagConfig[];
}

const DEFAULTS = {
  systemNo: 1,
  pollIntervalMs: 500,
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
  private listeners: ((event: MachineEvent) => void)[] = [];
  private recvBuffer = Buffer.alloc(0);
  private nextRequestId = 1;
  private pending = new Map<number, { resolve: (data: Buffer) => void; reject: (err: Error) => void }>();

  private lastCycleStatus: number | null = null;
  private lastPartCount: number | null = null;
  private lastAlarmMessage = "";

  private readonly systemNo: number;
  private readonly pollIntervalMs: number;
  private readonly cycleStatusItem: M80ItemAddress;
  private readonly partCountItem: M80ItemAddress;
  private readonly alarmMessageItem: M80ItemAddress;

  constructor(private readonly config: M80AdapterConfig) {
    this.systemNo = config.systemNo ?? DEFAULTS.systemNo;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULTS.pollIntervalMs;
    this.cycleStatusItem = config.cycleStatusItem ?? DEFAULTS.cycleStatusItem;
    this.partCountItem = config.partCountItem ?? DEFAULTS.partCountItem;
    this.alarmMessageItem = config.alarmMessageItem ?? DEFAULTS.alarmMessageItem;
  }

  async connect(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: this.config.host, port: this.config.port });
      socket.once("connect", () => resolve());
      socket.once("error", (err) => reject(err));
      socket.on("data", (chunk) => this.onData(chunk));
      this.socket = socket;
    });

    this.pollTimer = setInterval(() => void this.poll(), this.pollIntervalMs);
  }

  async disconnect(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = null;
    for (const { reject } of this.pending.values()) reject(new Error("Bağlantı kapatıldı"));
    this.pending.clear();
    await new Promise<void>((resolve) => {
      if (!this.socket) return resolve();
      this.socket.end(() => resolve());
    }).catch(() => undefined);
    this.socket = null;
  }

  onEvent(cb: (event: MachineEvent) => void): void {
    this.listeners.push(cb);
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

  private emit(type: MachineEvent["type"], payload?: Record<string, unknown>) {
    const event: MachineEvent = { type, timestamp: new Date().toISOString(), payload };
    for (const cb of this.listeners) cb(event);
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
      this.pending.set(requestId, { resolve, reject });
      this.socket?.write(frame, (err) => {
        if (err) {
          this.pending.delete(requestId);
          reject(err);
        }
      });
    });
  }

  private async poll(): Promise<void> {
    try {
      const [cycleStatusRaw, partCountRaw, alarmMessageRaw] = await Promise.all([
        this.readItem(this.cycleStatusItem, DataType.LONG),
        this.readItem(this.partCountItem, DataType.LONG),
        this.readItem(this.alarmMessageItem, DataType.CHAR),
      ]);

      this.onAlarmMessageChanged(decodeCharValue(alarmMessageRaw));
      this.onPartCountChanged(decodeLongValue(partCountRaw));
      this.onCycleStatusChanged(decodeLongValue(cycleStatusRaw));
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
