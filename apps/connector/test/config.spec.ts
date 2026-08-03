import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

describe("loadConfig", () => {
  const required = { MACHINE_ID: "machine-1", MACHINE_KEY: "key-1" };

  it("loopback sağlık portunu yükler", () => {
    expect(loadConfig({ ...required, HEALTH_PORT: "9464" }).healthPort).toBe(9464);
  });

  it("geçersiz backend URL ve sağlık portunu reddeder", () => {
    expect(() => loadConfig({ ...required, BACKEND_URL: "ftp://edge" })).toThrow("HTTP(S)");
    expect(() => loadConfig({ ...required, HEALTH_PORT: "70000" })).toThrow("HEALTH_PORT");
  });
});
