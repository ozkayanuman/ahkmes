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

export type ControllerConnectionState = "UNKNOWN" | "CONNECTING" | "ONLINE" | "DEGRADED" | "OFFLINE";
export type ControllerMachineState = "UNKNOWN" | "IDLE" | "READY" | "RUNNING" | "FEED_HOLD" | "ALARM" | "STOPPED" | "OFFLINE";
export type ControllerObservationTrust = "SIMULATED" | "CONFIGURED" | "OBSERVED" | "CONTROLLER_VERIFIED";
export type ControllerCapability =
  | "CONNECTIVITY" | "MACHINE_STATE_READ" | "ACTIVE_PROGRAM_IDENTITY_READ" | "PROGRAM_CONTENT_READ"
  | "PROGRAM_CHECKSUM_READ" | "CYCLE_STATE_READ" | "ALARM_READ" | "FEED_OVERRIDE_READ"
  | "SPINDLE_STATE_READ" | "PART_COUNTER_READ" | "PROGRAM_TRANSFER" | "REMOTE_START";

/** Read-only controller evidence. It must never be translated into MES quantity
 * or lifecycle transitions by the connector. */
export interface ControllerObservation {
  connectionState: ControllerConnectionState;
  machineState: ControllerMachineState;
  trustLevel: ControllerObservationTrust;
  controllerTimestamp?: string;
  activeProgramIdentity?: string | null;
  activeProgramChecksum?: string | null;
  alarmCode?: string | null;
  alarmText?: string | null;
  partCounter?: number | null;
  connectionGeneration: number;
  capabilities: Partial<Record<ControllerCapability, boolean>>;
  raw?: Record<string, unknown>;
}

export interface MachineAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onEvent(cb: (event: MachineEvent) => void): void;
  /** Opsiyonel: Automation Gateway için tag okuma/keşif yeteneği. Desteklemeyen
   * adaptörler bu metodu implement etmeyebilir (ör. SimulatorAdapter). */
  readTags?(): Promise<TagReading[]>;
  /** Optional safe read-only controller contract. */
  readControllerObservation?(): Promise<ControllerObservation>;
  onConnectionState?(cb: (state: ControllerConnectionState, detail?: string) => void): void;
}
