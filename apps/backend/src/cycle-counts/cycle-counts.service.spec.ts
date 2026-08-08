import { CycleCountsService } from "./cycle-counts.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = { bin: { findFirst: jest.fn().mockResolvedValue({ id: "bin1" }) }, cycleCount: { findFirst: jest.fn() }, $transaction: jest.fn(), ...overrides };
  const inventory = { record: jest.fn().mockResolvedValue({ id: "im1" }) };
  const outbox = { record: jest.fn() };
  const service = new CycleCountsService(prisma as any, inventory as any, outbox as any);
  return { service, prisma, inventory, outbox };
}

describe("CycleCountsService", () => {
  it("sayım oluştururken sistem miktarı ve farkı kaydeder", async () => {
    const tx = {
      stockBalance: { findFirst: jest.fn().mockResolvedValue({ id: "sb1", qty: "8" }) },
      cycleCount: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockResolvedValue({ id: "cc1" }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit1" }) },
    };
    const { service } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });
    await service.create("t1", "u1", { binId: "bin1", lines: [{ itemType: "MATERIAL", itemId: "m1", countedQty: 5 }] });
    expect(tx.cycleCount.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ lines: { create: [expect.objectContaining({ systemQty: 8, varianceQty: -3 })] } }) }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: "t1", userId: "u1", entity: "cycle-counts", entityId: "cc1", action: "CREATE" }) }));
  });

  it("post sırasında sayım farkı kadar immutable hareket üretir", async () => {
    const tx = {
      cycleCount: {
        findFirst: jest.fn().mockResolvedValue({ id: "cc1", status: "OPEN", postedAt: null, binId: "bin1", countedById: "u1", lines: [{ id: "ccl1", itemType: "MATERIAL", itemId: "m1", lotId: null, countedQty: "5" }] }),
        update: jest.fn().mockResolvedValue({ id: "cc1", status: "POSTED", postedAt: new Date("2026-08-02T10:00:00.000Z") }),
      },
      stockBalance: { findFirst: jest.fn().mockResolvedValue({ id: "sb1", qty: "8" }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit1" }) },
    };
    const { service, inventory } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });
    await service.post("t1", "poster1", "cc1");
    expect(inventory.record).toHaveBeenCalledWith(tx, expect.objectContaining({ movementType: "CYCLE_COUNT_ADJUSTMENT", quantityDelta: -3, binId: "bin1", createdById: "poster1" }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tenantId: "t1", userId: "poster1", entity: "cycle-counts", entityId: "cc1", action: "STATUS_CHANGE" }) }));
  });
});
