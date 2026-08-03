import { describe, expect, it, vi, afterEach } from "vitest";
import { M80Adapter } from "../src/adapters/m80.adapter";
import { startM80SimServer, type M80SimServerHandle } from "../src/sim-server/m80-sim-server";
import type { MachineEvent } from "../src/adapters/adapter.interface";

// Gerçek M80 olmadan, kendi TCP sim sunucumuza karşı gerçek bir socket bağlantısıyla
// (GIOP/EZSocket çerçevesi üzerinden) uçtan uca doğrulanır.
describe("M80Adapter (sim sunucusuna karşı entegrasyon)", () => {
  let server: M80SimServerHandle | null = null;
  let adapter: M80Adapter | null = null;

  afterEach(async () => {
    await adapter?.disconnect().catch(() => undefined);
    await server?.shutdown().catch(() => undefined);
    adapter = null;
    server = null;
  }, 15_000);

  it(
    "sim sunucudaki cycleStatus/partCount/alarmMessage değişimlerini MachineEvent'e çevirir",
    async () => {
      server = await startM80SimServer({ port: 6830, cycleTimeMs: 600, alarmProbability: 1 });
      adapter = new M80Adapter({ host: "127.0.0.1", port: 6830, pollIntervalMs: 50 });

      const events: MachineEvent[] = [];
      adapter.onEvent((e) => events.push(e));
      await adapter.connect();

      await vi.waitFor(() => expect(events.some((e) => e.type === "CYCLE_START")).toBe(true), {
        timeout: 5000,
        interval: 50,
      });
      await vi.waitFor(() => expect(events.some((e) => e.type === "PART_COMPLETE")).toBe(true), {
        timeout: 5000,
        interval: 50,
      });
      await vi.waitFor(() => expect(events.some((e) => e.type === "ALARM")).toBe(true), {
        timeout: 5000,
        interval: 50,
      });
      await vi.waitFor(() => expect(events.some((e) => e.type === "CYCLE_END")).toBe(true), {
        timeout: 5000,
        interval: 50,
      });

      const alarm = events.find((e) => e.type === "ALARM");
      expect(alarm?.payload?.message).toContain("Simülasyon (M80)");
    },
    20_000,
  );

  it("readTags() config'de tanımlı tag'leri okur", async () => {
    server = await startM80SimServer({ port: 6832, cycleTimeMs: 10_000, alarmProbability: 0 });
    adapter = new M80Adapter({
      host: "127.0.0.1",
      port: 6832,
      tags: [
        { name: "CycleStatus", address: "1:1" },
        { name: "AlarmMessage", address: "12:1:char" },
        { name: "Bilinmeyen", address: "99:99" },
      ],
    });
    await adapter.connect();

    const readings = await adapter.readTags!();
    const byName = Object.fromEntries(readings.map((r) => [r.name, r.value]));
    // Sim sunucu başlar başlamaz senkron olarak RUNNING(1)'e geçiyor (scheduleCycle).
    expect(byName.CycleStatus).toBe("1");
    expect(byName.AlarmMessage).toBe("");
    expect(byName.Bilinmeyen).toBeUndefined();
  }, 10_000);

  it("disconnect sonrası poll durur ve yeni event üretilmez", async () => {
    server = await startM80SimServer({ port: 6831, cycleTimeMs: 400, alarmProbability: 0 });
    adapter = new M80Adapter({ host: "127.0.0.1", port: 6831, pollIntervalMs: 50 });

    const events: MachineEvent[] = [];
    adapter.onEvent((e) => events.push(e));
    await adapter.connect();

    await vi.waitFor(() => expect(events.length).toBeGreaterThan(0), { timeout: 3000, interval: 50 });
    await adapter.disconnect();
    const countAfterDisconnect = events.length;

    await new Promise((r) => setTimeout(r, 300));
    expect(events.length).toBe(countAfterDisconnect);
  }, 10_000);

  it("read-only pilot bağlantısı kesilip tekrar açıldığında tag okumaya güvenle döner", async () => {
    server = await startM80SimServer({ port: 6833, cycleTimeMs: 10_000, alarmProbability: 0 });
    adapter = new M80Adapter({
      host: "127.0.0.1",
      port: 6833,
      tags: [{ name: "PartCount", address: "1:2" }],
    });
    await adapter.connect();
    expect((await adapter.readTags!())[0]).toMatchObject({ name: "PartCount", value: "0" });

    await adapter.disconnect();
    await adapter.connect();
    expect((await adapter.readTags!())[0]).toMatchObject({ name: "PartCount", value: "0" });
  }, 10_000);

  it("simüle edilmiş ağ kesintisinden sonra read-only bağlantıyı otomatik kurar", async () => {
    server = await startM80SimServer({ port: 6834, cycleTimeMs: 10_000, alarmProbability: 0 });
    adapter = new M80Adapter({
      host: "127.0.0.1",
      port: 6834,
      reconnectDelayMs: 20,
      pollIntervalMs: 20,
      tags: [{ name: "PartCount", address: "1:2" }],
    });
    await adapter.connect();
    expect((await adapter.readTags!())[0]).toMatchObject({ name: "PartCount", value: "0" });

    server.disconnectClients();

    await vi.waitFor(
      async () => expect((await adapter!.readTags!())[0]).toMatchObject({ name: "PartCount", value: "0" }),
      { timeout: 3_000, interval: 25 },
    );
  }, 10_000);
});
