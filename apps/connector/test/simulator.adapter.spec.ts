import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SimulatorAdapter } from "../src/adapters/simulator.adapter";
import type { MachineEvent } from "../src/adapters/adapter.interface";

describe("SimulatorAdapter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bağlanınca CYCLE_START → PART_COMPLETE → CYCLE_END sırasıyla üretir", async () => {
    const adapter = new SimulatorAdapter({ cycleTimeMs: 1000, alarmProbability: 0 });
    const events: MachineEvent[] = [];
    adapter.onEvent((e) => events.push(e));

    await adapter.connect();
    expect(events.map((e) => e.type)).toEqual(["CYCLE_START"]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(events.map((e) => e.type)).toEqual(["CYCLE_START", "PART_COMPLETE", "CYCLE_END"]);

    await adapter.disconnect();
  });

  it("disconnect sonrası yeni olay üretmez", async () => {
    const adapter = new SimulatorAdapter({ cycleTimeMs: 1000 });
    const events: MachineEvent[] = [];
    adapter.onEvent((e) => events.push(e));

    await adapter.connect();
    await adapter.disconnect();
    const countAfterDisconnect = events.length;

    await vi.advanceTimersByTimeAsync(5000);
    expect(events.length).toBe(countAfterDisconnect);
  });

  it("alarmProbability=1 iken her çevrimde ALARM üretir", async () => {
    const adapter = new SimulatorAdapter({ cycleTimeMs: 1000, alarmProbability: 1 });
    const events: MachineEvent[] = [];
    adapter.onEvent((e) => events.push(e));

    await adapter.connect();
    await vi.advanceTimersByTimeAsync(1000);
    expect(events.map((e) => e.type)).toEqual(["CYCLE_START", "ALARM", "PART_COMPLETE", "CYCLE_END"]);

    await adapter.disconnect();
  });
});
