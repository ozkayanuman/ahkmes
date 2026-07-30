import { WebhooksService } from "./webhooks.service";

// dispatch() her teslimde gerçek DNS çözümlemesi yapıyor (SSRF/rebinding
// koruması) — testlerin gerçek ağa çıkmaması için mock'lanır, varsayılan
// olarak public bir IP döner.
jest.mock("node:dns/promises", () => ({
  lookup: jest.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    webhookSubscription: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    ...overrides,
  };
  const service = new WebhooksService(prisma as any);
  return { service, prisma };
}

describe("WebhooksService.create", () => {
  it("yerel/özel ağ URL'i reddedilir (SSRF guard)", () => {
    const { service } = buildService();
    expect(() => service.create("t1", "u1", { url: "http://localhost:3000/x", event: "*", isActive: true })).toThrow();
    expect(() =>
      service.create("t1", "u1", { url: "http://192.168.1.5/x", event: "*", isActive: true }),
    ).toThrow();
    expect(() => service.create("t1", "u1", { url: "http://10.0.0.5/x", event: "*", isActive: true })).toThrow();
  });

  it("geçerli public URL kabul edilir", () => {
    const { service, prisma } = buildService();
    prisma.webhookSubscription.create.mockResolvedValue({ id: "w1" });

    service.create("t1", "u1", { url: "https://example.com/hook", event: "workorder.updated", isActive: true });

    expect(prisma.webhookSubscription.create).toHaveBeenCalled();
  });
});

describe("WebhooksService.dispatch", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("sadece eşleşen aktif abonelikleri çağırır ve lastStatus'u günceller", async () => {
    const { service, prisma } = buildService();
    prisma.webhookSubscription.findMany.mockResolvedValue([
      { id: "w1", url: "https://example.com/hook", secret: null },
    ]);
    prisma.webhookSubscription.update.mockResolvedValue({});
    const fetchMock = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;

    service.dispatch("t1", "workorder.updated", { id: "wo1" });
    // dispatch fire-and-forget — bir sonraki microtask'a kadar bekle
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(prisma.webhookSubscription.findMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", isActive: true, OR: [{ event: "workorder.updated" }, { event: "*" }] },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/hook",
      expect.objectContaining({ method: "POST" }),
    );
    expect(prisma.webhookSubscription.update).toHaveBeenCalledWith({
      where: { id: "w1" },
      data: { lastTriggeredAt: expect.any(Date), lastStatus: "success" },
    });
  });

  it("fetch hata fırlatırsa lastStatus 'failed' olur, dispatch kendisi throw etmez", async () => {
    const { service, prisma } = buildService();
    prisma.webhookSubscription.findMany.mockResolvedValue([
      { id: "w1", url: "https://example.com/hook", secret: null },
    ]);
    prisma.webhookSubscription.update.mockResolvedValue({});
    global.fetch = jest.fn().mockRejectedValue(new Error("network down")) as unknown as typeof fetch;

    expect(() => service.dispatch("t1", "workorder.updated", {})).not.toThrow();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(prisma.webhookSubscription.update).toHaveBeenCalledWith({
      where: { id: "w1" },
      data: { lastTriggeredAt: expect.any(Date), lastStatus: "failed" },
    });
  });
});
