import { DeliveryService } from "./delivery.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    $transaction: jest.fn(),
    ...overrides,
  };
  const realtime = { emitToTenant: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new DeliveryService(prisma as any, realtime as any);
  return { service, prisma, realtime };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function soFixture(overrides: any = {}) {
  return {
    id: "so1",
    status: "OPEN",
    lines: [
      { id: "sol1", partId: "p1", quantity: "10", shippedQty: "2", part: { id: "p1", partNo: "P-1" } },
    ],
    ...overrides,
  };
}

function buildTx(overrides: Record<string, unknown> = {}) {
  return {
    salesOrder: { findFirst: jest.fn().mockResolvedValue(soFixture()) },
    delivery: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "dlv1", dlvNo: "SEV-2026-0001" }),
    },
    salesOrderLine: { update: jest.fn().mockResolvedValue({}) },
    partStock: {
      findFirst: jest.fn().mockResolvedValue({ id: "ps1", qty: "10" }),
      update: jest.fn().mockResolvedValue({}),
    },
    ...overrides,
  };
}

describe("DeliveryService.create", () => {
  it("OPEN olmayan sipariş için sevkiyat reddedilir", async () => {
    const tx = buildTx({ salesOrder: { findFirst: jest.fn().mockResolvedValue(soFixture({ status: "CLOSED" })) } });
    const { service } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });

    await expect(
      service.create("t1", "u1", { salesOrderId: "so1", lines: [{ salesOrderLineId: "sol1", qty: 1 }] }),
    ).rejects.toThrow();
    expect(tx.delivery.create).not.toHaveBeenCalled();
  });

  it("sipariş miktarını aşan sevkiyat reddedilir", async () => {
    const tx = buildTx();
    const { service } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });

    await expect(
      service.create("t1", "u1", { salesOrderId: "so1", lines: [{ salesOrderLineId: "sol1", qty: 9 }] }),
    ).rejects.toThrow();
    expect(tx.delivery.create).not.toHaveBeenCalled();
  });

  it("yetersiz stokta transaction geri alınır", async () => {
    const tx = buildTx({ partStock: { findFirst: jest.fn().mockResolvedValue({ id: "ps1", qty: "3" }), update: jest.fn() } });
    const { service } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });

    await expect(
      service.create("t1", "u1", { salesOrderId: "so1", lines: [{ salesOrderLineId: "sol1", qty: 5 }] }),
    ).rejects.toThrow();
    expect(tx.partStock.update).not.toHaveBeenCalled();
  });

  it("başarılı sevkiyat: PartStock düşer, shippedQty artar", async () => {
    const tx = buildTx();
    const { service, realtime } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });

    const result = await service.create("t1", "u1", {
      salesOrderId: "so1",
      lines: [{ salesOrderLineId: "sol1", qty: 5 }],
    });

    expect(tx.salesOrderLine.update).toHaveBeenCalledWith({
      where: { id: "sol1" },
      data: { shippedQty: { increment: 5 } },
    });
    expect(tx.partStock.update).toHaveBeenCalledWith({
      where: { id: "ps1" },
      data: { qty: { decrement: 5 } },
    });
    expect(result.id).toBe("dlv1");
    expect(realtime.emitToTenant).toHaveBeenCalledWith("t1", "delivery.created", {
      id: "dlv1",
      salesOrderId: "so1",
    });
  });
});
