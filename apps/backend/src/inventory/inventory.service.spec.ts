import { InventoryMovementType } from "@prisma/client";
import { InventoryService } from "./inventory.service";

describe("InventoryService audit boundary", () => {
  it("writes the immutable movement audit row through the caller transaction", async () => {
    const tx = {
      material: {
        findFirst: jest.fn().mockResolvedValue({ id: "material1" }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      part: { findFirst: jest.fn() },
      lot: { findFirst: jest.fn() },
      bin: { findFirst: jest.fn().mockResolvedValue({ id: "bin1" }) },
      warehouse: { findFirst: jest.fn(), create: jest.fn() },
      partStock: { upsert: jest.fn() },
      $queryRaw: jest.fn().mockResolvedValue([{ qty: 5 }]),
      inventoryMovement: { create: jest.fn().mockResolvedValue({ id: "movement1", quantityDelta: 5 }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: "audit1" }) },
    };
    const service = new InventoryService({} as never);

    await service.record(tx as never, {
      tenantId: "tenant1",
      itemType: "MATERIAL",
      itemId: "material1",
      quantityDelta: 5,
      movementType: InventoryMovementType.PURCHASE_RECEIPT,
      sourceType: "TEST",
      sourceId: "source1",
      binId: "bin1",
      createdById: "user1",
    });

    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: "tenant1",
        userId: "user1",
        entity: "inventory-movements",
        entityId: "movement1",
        action: "CREATE",
      }),
    }));
    expect(tx.material.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "material1", tenantId: "tenant1" },
    }));
  });
});
