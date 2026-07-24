export type MachineEventType = "CYCLE_START" | "CYCLE_END" | "PART_COMPLETE" | "ALARM" | "IDLE";

export interface MachineEvent {
  type: MachineEventType;
  timestamp: string;
  payload?: Record<string, unknown>;
}

export interface MachineAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onEvent(cb: (event: MachineEvent) => void): void;
}
