import { SalesOrdersService } from "./sales-orders.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    salesOrder: { findFirst: jest.fn(), update: jest.fn() },
    ...overrides,
  };
  if (!prisma.$transaction) prisma.$transaction = jest.fn((cb: any) => cb(prisma));
  const outbox = { record: jest.fn() };
  const workOrders = { createWithRoute: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new SalesOrdersService(prisma as any, workOrders as any, outbox as any);
  return { service, prisma, outbox, workOrders };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function soFixture(overrides: any = {}) {
  return {
    id: "so1",
    soNo: "SIP-2026-0001",
    status: "OPEN",
    lines: [
      { id: "sol1", part: { id: "p1" }, quantity: "10", dueDate: new Date("2026-08-01"), workOrders: [], shippedQty: "0" },
      { id: "sol2", part: { id: "p2" }, quantity: "3", dueDate: new Date("2026-08-02"), workOrders: [{ id: "wo1" }], shippedQty: "0" },
    ],
    ...overrides,
  };
}

describe("SalesOrdersService.release", () => {
  it("OPEN değilse hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.salesOrder.findFirst.mockResolvedValue(soFixture({ status: "CLOSED" }));

    await expect(service.release("t1", "so1", {})).rejects.toThrow();
  });

  it("henüz üretime alınmamış satırlardan WorkOrder üretir, alınmışları skipler", async () => {
    const tx = { workOrder: { findFirst: jest.fn().mockResolvedValue(null) } };
    const { service, prisma, workOrders } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });
    workOrders.createWithRoute.mockResolvedValue({ id: "wo-new", woNo: "IE-2026-0001" });
    prisma.salesOrder.findFirst.mockResolvedValue(soFixture());

    const result = await service.release("t1", "so1", {});

    expect(workOrders.createWithRoute).toHaveBeenCalledWith(
      tx,
      "t1",
      expect.objectContaining({ salesOrderLineId: "sol1", partId: "p1", quantity: "10" }),
    );
    expect(result.workOrders).toHaveLength(1);
    expect(result.skippedLineIds).toEqual(["sol2"]);
  });

  it("tüm satırlar zaten üretime alınmışsa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.salesOrder.findFirst.mockResolvedValue(
      soFixture({
        lines: [{ id: "sol1", part: { id: "p1" }, quantity: "10", dueDate: new Date(), workOrders: [{ id: "wo1" }], shippedQty: "0" }],
      }),
    );

    await expect(service.release("t1", "so1", {})).rejects.toThrow();
  });
});

describe("SalesOrdersService.setStatus", () => {
  it("kısmen sevk edilmiş sipariş CANCELLED yapılamaz", async () => {
    const { service, prisma } = buildService();
    prisma.salesOrder.findFirst.mockResolvedValue(
      soFixture({ lines: [{ id: "sol1", shippedQty: "2", workOrders: [] }] }),
    );

    await expect(service.setStatus("t1", "so1", "CANCELLED")).rejects.toThrow();
    expect(prisma.salesOrder.update).not.toHaveBeenCalled();
  });

  it("hiç sevkiyat yoksa CANCELLED'a geçebilir", async () => {
    const { service, prisma } = buildService();
    prisma.salesOrder.findFirst.mockResolvedValue(soFixture());
    prisma.salesOrder.update.mockResolvedValue({ id: "so1", status: "CANCELLED" });

    const updated = await service.setStatus("t1", "so1", "CANCELLED");

    expect(updated.status).toBe("CANCELLED");
  });
});
