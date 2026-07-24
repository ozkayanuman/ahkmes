import type { MachineAdapter, MachineEvent } from "./adapter.interface";

export interface SimulatorConfig {
  /** Bir çevrimin (CYCLE_START → PART_COMPLETE → CYCLE_END) yaklaşık süresi. */
  cycleTimeMs: number;
  /** Her çevrimde alarm oluşma olasılığı (0-1). */
  alarmProbability?: number;
}

/** Gerçek donanım/protokol olmadan zinciri (connector → backend → web) uçtan uca test etmek için sahte olay üreticisi. */
export class SimulatorAdapter implements MachineAdapter {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private listeners: ((event: MachineEvent) => void)[] = [];
  private readonly cycleTimeMs: number;
  private readonly alarmProbability: number;

  constructor(config: SimulatorConfig) {
    this.cycleTimeMs = config.cycleTimeMs;
    this.alarmProbability = config.alarmProbability ?? 0;
  }

  async connect(): Promise<void> {
    this.scheduleCycle();
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  onEvent(cb: (event: MachineEvent) => void): void {
    this.listeners.push(cb);
  }

  private emit(type: MachineEvent["type"], payload?: Record<string, unknown>) {
    const event: MachineEvent = { type, timestamp: new Date().toISOString(), payload };
    for (const cb of this.listeners) cb(event);
  }

  private scheduleCycle() {
    this.emit("CYCLE_START");
    this.timer = setTimeout(() => {
      if (Math.random() < this.alarmProbability) {
        this.emit("ALARM", { message: "Simülasyon: eksen aşırı yük" });
      }
      this.emit("PART_COMPLETE");
      this.emit("CYCLE_END");
      this.timer = setTimeout(() => this.scheduleCycle(), this.cycleTimeMs / 4);
    }, this.cycleTimeMs);
  }
}
