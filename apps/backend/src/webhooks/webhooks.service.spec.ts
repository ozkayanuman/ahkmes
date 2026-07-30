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
  beforeEach(() => {
    mockStatusCode = 200;
    mockRequestError = null;
    httpsRequestMock.mockClear();
  });

  it("sadece eşleşen aktif abonelikleri çağırır, pinlenmiş IP'ye bağlanır ve lastStatus'u günceller", async () => {
    const { service, prisma } = buildService();
    prisma.webhookSubscription.findMany.mockResolvedValue([
      { id: "w1", url: "https://example.com/hook", secret: null },
    ]);
    prisma.webhookSubscription.update.mockResolvedValue({});

    service.dispatch("t1", "workorder.updated", { id: "wo1" });
    // dispatch fire-and-forget — bir sonraki microtask'a kadar bekle
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(prisma.webhookSubscription.findMany).toHaveBeenCalledWith({
      where: { tenantId: "t1", isActive: true, OR: [{ event: "workorder.updated" }, { event: "*" }] },
    });
    // DNS'in ikinci kez çözülmemesi için bağlantı doğrulanmış IP'ye pinlenir,
    // Host header orijinal hostname'i taşır (TLS SNI + sertifika için).
    expect(httpsRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "93.184.216.34", headers: expect.objectContaining({ Host: "example.com" }) }),
      expect.any(Function),
    );
    expect(prisma.webhookSubscription.update).toHaveBeenCalledWith({
      where: { id: "w1" },
      data: { lastTriggeredAt: expect.any(Date), lastStatus: "success" },
    });
  });

  it("istek hata fırlatırsa lastStatus 'failed' olur, dispatch kendisi throw etmez", async () => {
    const { service, prisma } = buildService();
    prisma.webhookSubscription.findMany.mockResolvedValue([
      { id: "w1", url: "https://example.com/hook", secret: null },
    ]);
    prisma.webhookSubscription.update.mockResolvedValue({});
    mockRequestError = new Error("network down");

    expect(() => service.dispatch("t1", "workorder.updated", {})).not.toThrow();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(prisma.webhookSubscription.update).toHaveBeenCalledWith({
      where: { id: "w1" },
      data: { lastTriggeredAt: expect.any(Date), lastStatus: "failed" },
    });
  });

  it("3xx yönlendirme yanıtı 'failed' sayılır (yönlendirme hiç izlenmez)", async () => {
    const { service, prisma } = buildService();
    prisma.webhookSubscription.findMany.mockResolvedValue([
      { id: "w1", url: "https://example.com/hook", secret: null },
    ]);
    prisma.webhookSubscription.update.mockResolvedValue({});
    mockStatusCode = 302;

    service.dispatch("t1", "workorder.updated", {});
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(prisma.webhookSubscription.update).toHaveBeenCalledWith({
      where: { id: "w1" },
      data: { lastTriggeredAt: expect.any(Date), lastStatus: "failed" },
    });
  });
});
