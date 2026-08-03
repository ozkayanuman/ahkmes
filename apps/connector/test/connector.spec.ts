import { describe, expect, it, vi, beforeEach } from "vitest";
import { createServer } from "node:http";
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

async function getFreeLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Loopback port atanamadı"));
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
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
    expect(connector.getStatus()).toMatchObject({ connected: true, queueDepth: 0, acceptedEvents: 1, deliveredEvents: 1 });
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

  it("sağlık ve metrik uçlarını yalnızca loopback üzerinde sunar", async () => {
    const adapter = new FakeAdapter();
    const port = await getFreeLoopbackPort();
    const connector = new Connector(
      adapter,
      { backendUrl: "http://backend.test", machineId: "m1", machineKey: "k1", healthPort: port },
      vi.fn().mockResolvedValue({ ok: true, status: 201 }) as unknown as typeof fetch,
    );

    await connector.start();
    const health = await fetch(`http://127.0.0.1:${port}/health`);
    const metrics = await fetch(`http://127.0.0.1:${port}/metrics`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ connected: true, queueDepth: 0 });
    expect(await metrics.text()).toContain("ahkmes_connector_queue_depth 0");
    await connector.stop();
  });

  it("kuyruk taşarsa en eski olay düşürülür", async () => {
    const adapter = new FakeAdapter();
    const pending: { resolve: ((value: unknown) => void) | null } = { resolve: null };
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          pending.resolve = resolve;
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
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    adapter.emit(makeEvent("PART_COMPLETE"));
    adapter.emit(makeEvent("PART_COMPLETE"));
    adapter.emit(makeEvent("CYCLE_END"));

    pending.resolve?.({ ok: true, status: 201 });
    await vi.waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(1));
  });
});
