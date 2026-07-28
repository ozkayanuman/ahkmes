export type MachineEventType = "CYCLE_START" | "CYCLE_END" | "PART_COMPLETE" | "ALARM" | "IDLE";

export interface MachineEvent {
  type: MachineEventType;
  timestamp: string;
  payload?: Record<string, unknown>;
  /** İdempotency: Connector kuyruğa alırken üretir, retry'lerde aynı kalır (bkz. core/connector.ts). */
  eventId?: string;
}

/** Automation Gateway: bir tag'in anlık okunmuş değeri (adı + string değer). */
export interface TagReading {
  name: string;
  value: string;
}

export interface MachineAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onEvent(cb: (event: MachineEvent) => void): void;
  /** Opsiyonel: Automation Gateway için tag okuma/keşif yeteneği. Desteklemeyen
   * adaptörler bu metodu implement etmeyebilir (ör. SimulatorAdapter). */
  readTags?(): Promise<TagReading[]>;
}
