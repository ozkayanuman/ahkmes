import { describe, expect, it, vi } from "vitest";
import { fetchBackendConnectorConfig } from "../src/backend-config";

describe("fetchBackendConnectorConfig", () => {
  it("başarılı yanıtta connectorType/connectorConfig döner", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ connectorType: "OPC_UA", connectorConfig: { endpointUrl: "opc.tcp://x:4840" } }),
    });
    const result = await fetchBackendConnectorConfig("http://backend", "m1", "key1", mockFetch as never);
    expect(result).toEqual({ connectorType: "OPC_UA", connectorConfig: { endpointUrl: "opc.tcp://x:4840" } });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://backend/machines/m1/connector-config",
      expect.objectContaining({ headers: { "X-Machine-Key": "key1" } }),
    );
  });

  it("başarısız yanıtta null döner", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false });
    const result = await fetchBackendConnectorConfig("http://backend", "m1", "key1", mockFetch as never);
    expect(result).toBeNull();
  });

  it("ağ hatasında null döner (bağlantı yoksa connector çökmemeli)", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
    const result = await fetchBackendConnectorConfig("http://backend", "m1", "key1", mockFetch as never);
    expect(result).toBeNull();
  });
});
