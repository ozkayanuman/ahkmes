import { DeliveryService } from "./delivery.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = { $transaction: jest.fn(), ...overrides };
  const realtime = { emitToTenant: jest.fn() };
  const inventory = { record: jest.fn().mockResolvedValue({ id: "im1" }) };
  const service = new DeliveryService(prisma as any, realtime as any, inventory as any);
  return { service, prisma, realtime, inventory };
}

function buildTx() {
  return {
    salesOrder: {
      findFirst: jest.fn().mockResolvedValue({
        id: "so1", status: "OPEN",
        lines: [{ id: "sol1", partId: "p1", quantity: "10", shippedQty: "2", part: { id: "p1", partNo: "P-1" } }],
      }),
    },
    delivery: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: "dlv1", dlvNo: "SEV-2026-0001", lines: [{ id: "dl1", salesOrderLine: { id: "sol1" } }],
      }),
    },
    salesOrderLine: { update: jest.fn().mockResolvedValue({}) },
  };
}

describe("DeliveryService.create", () => {
  it("sipariş miktarını aşan sevkiyatı reddeder", async () => {
    const tx = buildTx();
    const { service } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });
    await expect(service.create("t1", "u1", { salesOrderId: "so1", lines: [{ salesOrderLineId: "sol1", qty: 9 }] })).rejects.toThrow();
    expect(tx.delivery.create).not.toHaveBeenCalled();
  });

  it("sevkiyat için immutable stok hareketi ve shippedQty üretir", async () => {
    const tx = buildTx();
    const { service, inventory, realtime } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });
    await service.create("t1", "u1", { salesOrderId: "so1", lines: [{ salesOrderLineId: "sol1", qty: 5, binId: "bin1" }] });
    expect(tx.salesOrderLine.update).toHaveBeenCalledWith({ where: { id: "sol1" }, data: { shippedQty: { increment: 5 } } });
    expect(inventory.record).toHaveBeenCalledWith(tx, expect.objectContaining({ movementType: "DELIVERY", itemType: "PART", itemId: "p1", quantityDelta: -5, binId: "bin1" }));
    expect(realtime.emitToTenant).toHaveBeenCalledWith("t1", "delivery.created", { id: "dlv1", salesOrderId: "so1" });
  });
});
