import { describe, expect, it, vi, beforeEach } from "vitest";
import { Connector } from "../src/core/connector";
import type { MachineAdapter, MachineEvent } from "../src/adapters/adapter.interface";

class FakeAdapter implements MachineAdapter {
  private cb: ((e: MachineEvent) => void) | null = null;
  connected = false;

  async connect() {
    this.connected = true;
  }
  async disconnect() {
    this.connected = false;
  }
  onEvent(cb: (e: MachineEvent) => void) {
    this.cb = cb;
  }
  emit(event: MachineEvent) {
    this.cb?.(event);
  }
}

function makeEvent(type: MachineEvent["type"] = "CYCLE_START"): MachineEvent {
  return { type, timestamp: new Date().toISOString() };
}

describe("Connector", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("adapter olayını normalize edip backend'e X-Machine-Key ile POST eder", async () => {
    const adapter = new FakeAdapter();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 201 });
    const connector = new Connector(
      adapter,
      { backendUrl: "http://backend.test", machineId: "m1", machineKey: "k1" },
      fetchMock as unknown as typeof fetch,
    );

    await connector.start();
    adapter.emit(makeEvent("CYCLE_START"));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://backend.test/machines/m1/telemetry");
    expect(init.headers["X-Machine-Key"]).toBe("k1");
    expect(JSON.parse(init.body).type).toBe("CYCLE_START");
  });

  it("backend hata döndürünce olayı kuyrukta tutup yeniden dener", async () => {
    const adapter = new FakeAdapter();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 201 });
    const connector = new Connector(
      adapter,
      { backendUrl: "http://backend.test", machineId: "m1", machineKey: "k1", retryDelayMs: 5 },
      fetchMock as unknown as typeof fetch,
    );

    await connector.start();
    adapter.emit(makeEvent("PART_COMPLETE"));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("409 (atanmış iş emri yok) yeniden denenmeden düşürülür", async () => {
    const adapter = new FakeAdapter();
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 409 });
    const connector = new Connector(
      adapter,
      { backendUrl: "http://backend.test", machineId: "m1", machineKey: "k1" },
      fetchMock as unknown as typeof fetch,
    );

    await connector.start();
    adapter.emit(makeEvent("CYCLE_START"));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Kısa bir bekleme sonrası hâlâ tek çağrı olmalı (kuyruktan düşürüldü, tekrar denenmedi)
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("kuyruk taşarsa en eski olay düşürülür", async () => {
    const adapter = new FakeAdapter();
    let resolveFirst: (() => void) | null = null;
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve({ ok: true, status: 201 });
        }),
    );
    const connector = new Connector(
      adapter,
      { backendUrl: "http://backend.test", machineId: "m1", machineKey: "k1", maxQueueSize: 2 },
      fetchMock as unknown as typeof fetch,
    );

    await connector.start();
    // İlk olay gönderilmeye çalışılırken (fetch pending) kuyruğa 3 olay daha eklenir → limit 2
    adapter.emit(makeEvent("CYCLE_START"));
    adapter.emit(makeEvent("PART_COMPLETE"));
    adapter.emit(makeEvent("PART_COMPLETE"));
    adapter.emit(makeEvent("CYCLE_END"));

    resolveFirst?.();
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));
  });
});
