import { DeliveryService } from "./delivery.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = { $transaction: jest.fn(), ...overrides };
  const inventory = { record: jest.fn().mockResolvedValue({ id: "im1" }) };
  const outbox = { record: jest.fn() };
  const service = new DeliveryService(prisma as any, inventory as any, outbox as any);
  return { service, prisma, inventory, outbox };
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
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({
        id: "dlv1", dlvNo: "SEV-2026-0001", lines: [{ id: "dl1", salesOrderLine: { id: "sol1" } }],
      }),
    },
    salesOrderLine: { update: jest.fn().mockResolvedValue({}) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: "audit1" }) },
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
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
    const { service, inventory } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });
    await service.create("t1", "u1", { salesOrderId: "so1", lines: [{ salesOrderLineId: "sol1", qty: 5, binId: "bin1" }] });
    expect(tx.salesOrderLine.update).toHaveBeenCalledWith({ where: { id: "sol1" }, data: { shippedQty: { increment: 5 } } });
    expect(inventory.record).toHaveBeenCalledWith(tx, expect.objectContaining({ movementType: "DELIVERY", itemType: "PART", itemId: "p1", quantityDelta: -5, binId: "bin1" }));
  });

  it("aynı sipariş satırını iki kez göndererek toplam miktar aşımını reddeder", async () => {
    const tx = buildTx();
    const { service } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });
    await expect(service.create("t1", "u1", { salesOrderId: "so1", lines: [{ salesOrderLineId: "sol1", qty: 5 }, { salesOrderLineId: "sol1", qty: 4 }] })).rejects.toThrow();
    expect(tx.delivery.create).not.toHaveBeenCalled();
  });
});

describe("DeliveryService.confirmDelivery", () => {
  it("teslim kanıtını bir kez yazar, audit ve outbox kaydı üretir", async () => {
    const tx = buildTx();
    const dispatched = { id: "dlv1", deliveredAt: null, deliveryProofReference: null, lines: [] };
    const confirmed = { ...dispatched, deliveredAt: new Date("2026-09-23T09:00:00.000Z"), deliveryProofReference: "POD-42" };
    tx.delivery.findFirst.mockResolvedValueOnce(dispatched).mockResolvedValueOnce(confirmed);
    const { service, outbox } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });
    await expect(service.confirmDelivery("t1", "u1", "dlv1", { proofReference: "POD-42", deliveredAt: confirmed.deliveredAt })).resolves.toEqual(confirmed);
    expect(tx.delivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "dlv1", tenantId: "t1", deliveredAt: null } }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entity: "delivery", action: "STATUS_CHANGE" }) }));
    expect(outbox.record).toHaveBeenCalledWith(tx, "t1", "delivery", "dlv1", "delivery.updated", expect.any(Object));
  });

  it("daha önce onaylanmış teslimatın kanıtını değiştirmeyi reddeder", async () => {
    const tx = buildTx();
    tx.delivery.findFirst.mockResolvedValue({ id: "dlv1", deliveredAt: new Date(), deliveryProofReference: "POD-1", lines: [] });
    const { service } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });
    await expect(service.confirmDelivery("t1", "u1", "dlv1", { proofReference: "POD-2" })).rejects.toThrow("zaten teslim alındı");
    expect(tx.delivery.updateMany).not.toHaveBeenCalled();
  });
});
