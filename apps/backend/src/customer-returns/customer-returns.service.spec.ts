import { CustomerReturnsService } from "./customer-returns.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const tx: any = {
    delivery: { findFirst: jest.fn().mockResolvedValue({ id: "delivery-1", deliveredAt: new Date(), lines: [{ id: "delivery-line-1", qty: "2", lotId: "lot-1", salesOrderLine: { partId: "part-1" } }] }) },
    customerReturn: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() },
    warehouse: { findFirst: jest.fn().mockResolvedValue({ id: "warehouse-1" }), create: jest.fn() },
    bin: { findFirst: jest.fn().mockResolvedValue({ id: "quarantine-1" }), create: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({ id: "audit-1" }) },
    outboxEvent: { create: jest.fn().mockResolvedValue({ id: "event-1" }) },
    ...overrides,
  };
  const prisma = { $transaction: jest.fn((fn) => fn(tx)) };
  const inventory = { record: jest.fn().mockResolvedValue({ id: "movement-1" }) };
  const outbox = { record: jest.fn().mockResolvedValue({ id: "event-1" }) };
  return { service: new CustomerReturnsService(prisma as any, inventory as any, outbox as any), tx, inventory, outbox };
}

describe("CustomerReturnsService", () => {
  it("scopes a sales-order RMA list through its deliveries and tenant", async () => {
    const { service, tx } = buildService();
    tx.customerReturn.findMany = jest.fn().mockResolvedValue([]);
    // findAll is read-only and uses PrismaService directly in production; this
    // focused assertion documents the nested sales-order filter.
    const prisma = { customerReturn: tx.customerReturn };
    const readService = new CustomerReturnsService(prisma as any, {} as any, {} as any);
    await readService.findAll("tenant-1", { salesOrderId: "sales-order-1" });
    expect(tx.customerReturn.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-1", delivery: { salesOrderId: "sales-order-1" } }) }));
  });

  it("rejects an RMA before delivery has proof of receipt", async () => {
    const { service, tx } = buildService();
    tx.delivery.findFirst.mockResolvedValue({ id: "delivery-1", deliveredAt: null, lines: [] });
    await expect(service.create("tenant-1", "user-1", { deliveryId: "delivery-1", reason: "Hasar", lines: [{ deliveryLineId: "delivery-line-1", qty: 1 }] })).rejects.toThrow("Teslim alması doğrulanmamış");
    expect(tx.customerReturn.create).not.toHaveBeenCalled();
  });

  it("receives an authorized RMA only into the quarantine bin", async () => {
    const { service, tx, inventory, outbox } = buildService();
    const authorized = { id: "rma-1", rmaNo: "RMA-2026-0001", reason: "Hasar", status: "AUTHORIZED", lines: [{ id: "return-line-1", qty: "2", deliveryLine: { lotId: "lot-1", salesOrderLine: { partId: "part-1" } } }] };
    tx.customerReturn.findFirst.mockResolvedValue(authorized);
    tx.customerReturn.update.mockResolvedValue({ ...authorized, status: "RECEIVED", receivedAt: new Date() });

    await service.receive("tenant-1", "user-1", "rma-1", {});

    expect(inventory.record).toHaveBeenCalledWith(tx, expect.objectContaining({ movementType: "CUSTOMER_RETURN", itemType: "PART", itemId: "part-1", binId: "quarantine-1", lotId: "lot-1", quantityDelta: 2 }));
    expect(tx.customerReturn.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "RECEIVED", receivedById: "user-1" }) }));
    expect(outbox.record).toHaveBeenCalledWith(tx, "tenant-1", "customer-return", "rma-1", "stock.updated", expect.any(Object));
  });

  it("does not receive an RMA twice", async () => {
    const { service, tx, inventory } = buildService();
    tx.customerReturn.findFirst.mockResolvedValue({ id: "rma-1", status: "RECEIVED", lines: [] });
    await expect(service.receive("tenant-1", "user-1", "rma-1", {})).rejects.toThrow("Yalnızca yetkilendirilmiş");
    expect(inventory.record).not.toHaveBeenCalled();
  });

  it("cancels only an unreceived RMA and records the cancellation reason", async () => {
    const { service, tx, outbox } = buildService();
    tx.customerReturn.findFirst.mockResolvedValue({ id: "rma-1", status: "AUTHORIZED" });
    tx.customerReturn.update.mockResolvedValue({ id: "rma-1", status: "CANCELLED" });
    await service.cancel("tenant-1", "user-1", "rma-1", { reason: "Müşteri talebi geri çekti" });
    expect(tx.customerReturn.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "CANCELLED" } }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "STATUS_CHANGE", after: expect.objectContaining({ reason: "Müşteri talebi geri çekti" }) }) }));
    expect(outbox.record).toHaveBeenCalledWith(tx, "tenant-1", "customer-return", "rma-1", "customerreturn.updated", expect.any(Object));
  });
});
