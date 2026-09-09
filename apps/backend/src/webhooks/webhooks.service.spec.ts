import { EventEmitter } from "node:events";
import { WebhooksService } from "./webhooks.service";

// dispatch() her teslimde gerçek DNS çözümlemesi yapıyor (SSRF/rebinding
// koruması) — testlerin gerçek ağa çıkmaması için mock'lanır, varsayılan
// olarak public bir IP döner.
jest.mock("node:dns/promises", () => ({
  lookup: jest.fn().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]),
}));

// deliverOne artık global fetch değil, pinlenmiş IP'ye node:https request
// kullanıyor (TOCTOU düzeltmesi) — bu modülü mock'luyoruz.
let mockStatusCode = 200;
let mockRequestError: Error | null = null;
const httpsRequestMock = jest.fn((_opts: unknown, callback: (res: unknown) => void) => {
  const req = new EventEmitter() as EventEmitter & { write: jest.Mock; end: jest.Mock; destroy: jest.Mock };
  req.write = jest.fn();
  req.end = jest.fn(() => {
    if (mockRequestError) {
      queueMicrotask(() => req.emit("error", mockRequestError));
      return;
    }
    const res = new EventEmitter() as EventEmitter & { statusCode: number; resume: jest.Mock };
    res.statusCode = mockStatusCode;
    res.resume = jest.fn();
    queueMicrotask(() => callback(res));
  });
  req.destroy = jest.fn();
  return req;
});
jest.mock("node:https", () => ({ request: (...args: unknown[]) => httpsRequestMock(...(args as [unknown, () => void])) }));

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
    webhookDeliveryEvent: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
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

describe("WebhooksService delivery outbox", () => {
  const delivery = {
    id: "d1",
    tenantId: "t1",
    subscriptionId: "w1",
    event: "workorder.updated",
    payload: { event: "workorder.updated", tenantId: "t1", payload: { id: "wo1" }, timestamp: "2026-08-01T00:00:00.000Z" },
    attempts: 0,
  };

  beforeEach(() => {
    mockStatusCode = 200;
    mockRequestError = null;
    httpsRequestMock.mockClear();
  });

  it("eşleşen aktif abonelikler için değişmez olay zarfını kalıcı kuyruğa ekler", async () => {
    const { service, prisma } = buildService();
    prisma.webhookSubscription.findMany.mockResolvedValue([{ id: "w1" }]);

    service.dispatch("t1", "workorder.updated", { id: "wo1" }, "event-1");
    await new Promise((r) => setImmediate(r));

    expect(prisma.webhookSubscription.findMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", isActive: true, OR: [{ event: "workorder.updated" }, { event: "*" }] },
    });
    expect(prisma.webhookDeliveryEvent.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ tenantId: "t1", subscriptionId: "w1", eventId: "event-1", event: "workorder.updated" })],
      skipDuplicates: true,
    });
  });

  it("claimed olayı pinlenmiş IP'ye teslim eder ve DELIVERED işaretler", async () => {
    const { service, prisma } = buildService();
    prisma.webhookDeliveryEvent.findMany.mockResolvedValue([delivery]);
    prisma.webhookDeliveryEvent.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.webhookDeliveryEvent.findUnique.mockResolvedValue(delivery);
    prisma.webhookSubscription.findFirst.mockResolvedValue({ id: "w1", url: "https://example.com/hook", secret: null });
    prisma.webhookSubscription.update.mockResolvedValue({});
    prisma.webhookDeliveryEvent.update.mockResolvedValue({});

    await service.processPending();

    expect(httpsRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "93.184.216.34", headers: expect.objectContaining({ Host: "example.com" }) }),
      expect.any(Function),
    );
    expect(prisma.webhookDeliveryEvent.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({ status: "DELIVERED", attempts: 1, lockedUntil: null }),
    });
  });

  it("başarısız teslimi backoff ile PENDING'e geri koyar", async () => {
    const { service, prisma } = buildService();
    prisma.webhookDeliveryEvent.findMany.mockResolvedValue([delivery]);
    prisma.webhookDeliveryEvent.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });
    prisma.webhookDeliveryEvent.findUnique.mockResolvedValue(delivery);
    prisma.webhookSubscription.findFirst.mockResolvedValue({ id: "w1", url: "https://example.com/hook", secret: null });
    prisma.webhookSubscription.update.mockResolvedValue({});
    prisma.webhookDeliveryEvent.update.mockResolvedValue({});
    mockRequestError = new Error("network down");

    await service.processPending();

    expect(prisma.webhookDeliveryEvent.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: expect.objectContaining({ status: "PENDING", attempts: 1, lockedUntil: null, lastError: "Teslim başarısız" }),
    });
  });
});
