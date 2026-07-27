import {
  AttributeIds,
  ClientMonitoredItem,
  ClientSession,
  ClientSubscription,
  DataValue,
  MessageSecurityMode,
  NodeClass,
  OPCUAClient,
  SecurityPolicy,
  TimestampsToReturn,
  type OPCUAClientOptions,
} from "node-opcua";
import type { MachineAdapter, MachineEvent, TagReading } from "./adapter.interface";

export interface OpcuaAdapterConfig {
  endpointUrl: string;
  /** Node ID'ler marka/kontrolcüden bağımsız olarak env'den yapılandırılabilir. */
  cycleStatusNodeId?: string;
  partCountNodeId?: string;
  alarmMessageNodeId?: string;
  securityMode?: MessageSecurityMode;
  securityPolicy?: SecurityPolicy;
}

const DEFAULTS = {
  cycleStatusNodeId: "ns=1;s=CycleStatus",
  partCountNodeId: "ns=1;s=PartCount",
  alarmMessageNodeId: "ns=1;s=AlarmMessage",
};

// CycleStatus: 0=IDLE, 1=RUNNING, 2=ALARM — sunucu/marka bağımsız basit sözleşme.
const IDLE = 0;
const RUNNING = 1;
const ALARM = 2;

/**
 * Referans "gerçek protokol" adapter'ı: OPC-UA sunucusuna client olarak bağlanır,
 * CycleStatus/PartCount/AlarmMessage node'larına subscribe olur ve değişimleri
 * MachineEvent'e çevirir. Node ID'ler config'den geldiği için marka bağımsızdır —
 * gerçek bir CNC kontrolcüsünün OPC-UA sunucusuna (umati/CNC companion spec) veya
 * bu paketteki açık kaynak sim sunucusuna aynı şekilde bağlanabilir.
 */
export class OpcuaAdapter implements MachineAdapter {
  private client: OPCUAClient | null = null;
  private session: ClientSession | null = null;
  private subscription: ClientSubscription | null = null;
  private listeners: ((event: MachineEvent) => void)[] = [];
  private lastCycleStatus: number | null = null;
  private lastPartCount: number | null = null;
  private lastAlarmMessage = "";
  private readonly nodeIds: Required<Omit<OpcuaAdapterConfig, "endpointUrl" | "securityMode" | "securityPolicy">>;

  constructor(private readonly config: OpcuaAdapterConfig) {
    this.nodeIds = {
      cycleStatusNodeId: config.cycleStatusNodeId ?? DEFAULTS.cycleStatusNodeId,
      partCountNodeId: config.partCountNodeId ?? DEFAULTS.partCountNodeId,
      alarmMessageNodeId: config.alarmMessageNodeId ?? DEFAULTS.alarmMessageNodeId,
    };
  }

  async connect(): Promise<void> {
    const clientOptions: OPCUAClientOptions = {
      endpointMustExist: false,
      securityMode: this.config.securityMode ?? MessageSecurityMode.None,
      securityPolicy: this.config.securityPolicy ?? SecurityPolicy.None,
    };
    this.client = OPCUAClient.create(clientOptions);
    await this.client.connect(this.config.endpointUrl);
    this.session = await this.client.createSession();

    this.subscription = ClientSubscription.create(this.session, {
      requestedPublishingInterval: 250,
      requestedLifetimeCount: 100,
      requestedMaxKeepAliveCount: 10,
      maxNotificationsPerPublish: 50,
      publishingEnabled: true,
      priority: 10,
    });

    this.monitor(this.nodeIds.alarmMessageNodeId, (dv) => {
      this.lastAlarmMessage = String(dv.value.value ?? "");
    });
    this.monitor(this.nodeIds.partCountNodeId, (dv) => this.onPartCountChanged(Number(dv.value.value)));
    this.monitor(this.nodeIds.cycleStatusNodeId, (dv) => this.onCycleStatusChanged(Number(dv.value.value)));
  }

  async disconnect(): Promise<void> {
    await this.subscription?.terminate().catch(() => undefined);
    await this.session?.close().catch(() => undefined);
    await this.client?.disconnect().catch(() => undefined);
    this.subscription = null;
    this.session = null;
    this.client = null;
  }

  onEvent(cb: (event: MachineEvent) => void): void {
    this.listeners.push(cb);
  }

  /**
   * Automation Gateway: address space'i (ObjectsFolder = "i=85", standart OPC-UA
   * well-known ID) iki seviye gezip bulduğu tüm Variable node'larının anlık
   * değerini döner. Marka/cihaz bağımsız gerçek "tag keşfi" — M80Adapter'ın aksine
   * burada elle tanımlı bir tag listesine ihtiyaç yok.
   */
  async readTags(): Promise<TagReading[]> {
    if (!this.session) return [];
    const readings: TagReading[] = [];
    const rootBrowse = await this.session.browse("i=85");
    for (const ref of rootBrowse.references ?? []) {
      const childBrowse = await this.session.browse(ref.nodeId.toString());
      for (const child of childBrowse.references ?? []) {
        if (child.nodeClass !== NodeClass.Variable) continue;
        const nodeIdStr = child.nodeId.toString();
        const dv = await this.session!.read({ nodeId: nodeIdStr, attributeId: AttributeIds.Value });
        readings.push({ name: child.browseName.name ?? nodeIdStr, value: String(dv.value?.value ?? "") });
      }
    }
    return readings;
  }

  private monitor(nodeId: string, onChanged: (dataValue: DataValue) => void) {
    if (!this.subscription) return;
    const item = ClientMonitoredItem.create(
      this.subscription,
      { nodeId, attributeId: AttributeIds.Value },
      { samplingInterval: 100, discardOldest: true, queueSize: 10 },
      TimestampsToReturn.Both,
    );
    item.on("changed", onChanged);
  }

  private emit(type: MachineEvent["type"], payload?: Record<string, unknown>) {
    const event: MachineEvent = { type, timestamp: new Date().toISOString(), payload };
    for (const cb of this.listeners) cb(event);
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
