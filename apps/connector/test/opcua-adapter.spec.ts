import { describe, expect, it, vi, afterEach } from "vitest";
import { OpcuaAdapter } from "../src/adapters/opcua.adapter";
import { startOpcuaSimServer, type SimServerHandle } from "../src/sim-server/opcua-sim-server";
import type { MachineEvent } from "../src/adapters/adapter.interface";

// Gerçek makine/kontrolcü olmadan, kendi açık kaynak (node-opcua) sim sunucumuza
// karşı gerçek bir OPC-UA client-server el sıkışması ile uçtan uca doğrulanır.
describe("OpcuaAdapter (sim sunucusuna karşı entegrasyon)", () => {
  let server: SimServerHandle | null = null;
  let adapter: OpcuaAdapter | null = null;

  afterEach(async () => {
    await adapter?.disconnect().catch(() => undefined);
    await server?.shutdown().catch(() => undefined);
    adapter = null;
    server = null;
  }, 15_000);

  it(
    "sim sunucudaki CycleStatus/PartCount/AlarmMessage değişimlerini MachineEvent'e çevirir",
    async () => {
      server = await startOpcuaSimServer({ port: 4841, cycleTimeMs: 600, alarmProbability: 1 });
      adapter = new OpcuaAdapter({ endpointUrl: server.endpointUrl });

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
      expect(alarm?.payload?.message).toContain("Simülasyon (OPC-UA)");
    },
    20_000,
  );
});
