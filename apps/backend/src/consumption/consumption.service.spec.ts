import { ConflictException, NotFoundException } from "@nestjs/common";
import { ConsumptionService } from "./consumption.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildTxMock(overrides: any = {}) {
  return {
    workOrder: { findFirst: jest.fn().mockResolvedValue({ id: "wo1", status: "IN_PRODUCTION" }) },
    material: { findFirst: jest.fn().mockResolvedValue({ id: "m1", lotTrackingRequired: false }) },
    part: { findFirst: jest.fn().mockResolvedValue({ id: "p1", lotTrackingRequired: false }) },
    lot: { findFirst: jest.fn().mockResolvedValue(null) },
    materialConsumption: {
      create: jest.fn().mockResolvedValue({ id: "mc1" }),
      update: jest.fn().mockResolvedValue({ id: "mc1", binId: "b1" }),
      findFirst: jest.fn().mockResolvedValue(null),
      delete: jest.fn(),
    },
    ...overrides,
  };
}

function buildService(tx: ReturnType<typeof buildTxMock>) {
  const prisma = { $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)) };
  const realtime = { emitToTenant: jest.fn() };
  const inventory = { record: jest.fn().mockResolvedValue({ binId: "b1" }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new ConsumptionService(prisma as any, realtime as any, inventory as any);
  return { service, prisma, realtime, inventory };
}

describe("ConsumptionService.create — Faz K polimorfik (Material/Part)", () => {
  it("Material tüketimi: mevcut davranış regresyonsuz — inventory.record itemType MATERIAL ile çağrılır", async () => {
    const tx = buildTxMock();
    const { service, inventory } = buildService(tx);

    await service.create("t1", "u1", {
      workOrderId: "wo1",
      itemType: "MATERIAL",
      itemId: "m1",
      type: "CONSUMED",
      quantity: 5,
    } as never);

    expect(inventory.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ itemType: "MATERIAL", itemId: "m1", quantityDelta: -5 }),
    );
  });

  it("Part tüketimi (alt montaj): inventory.record itemType PART ile çağrılır (PartStock düşer)", async () => {
    const tx = buildTxMock();
    const { service, inventory } = buildService(tx);

    await service.create("t1", "u1", {
      workOrderId: "wo1",
      itemType: "PART",
      itemId: "p1",
      type: "CONSUMED",
      quantity: 3,
    } as never);

    expect(tx.part.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "p1", tenantId: "t1" } }));
    expect(inventory.record).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ itemType: "PART", itemId: "p1", quantityDelta: -3 }),
    );
  });

  it("Part için lotTrackingRequired true ise lotId zorunlu", async () => {
    const tx = buildTxMock({
      part: { findFirst: jest.fn().mockResolvedValue({ id: "p1", lotTrackingRequired: true }) },
    });
    const { service } = buildService(tx);

    await expect(
      service.create("t1", "u1", {
        workOrderId: "wo1",
        itemType: "PART",
        itemId: "p1",
        type: "CONSUMED",
        quantity: 1,
      } as never),
    ).rejects.toThrow(ConflictException);
  });

  it("var olmayan Part 404 döner", async () => {
    const tx = buildTxMock({ part: { findFirst: jest.fn().mockResolvedValue(null) } });
    const { service } = buildService(tx);

    await expect(
      service.create("t1", "u1", {
        workOrderId: "wo1",
        itemType: "PART",
        itemId: "p-missing",
        type: "CONSUMED",
        quantity: 1,
      } as never),
    ).rejects.toThrow(NotFoundException);
  });

  it("RESERVED tipte stok düşmez (inventory.record çağrılmaz)", async () => {
    const tx = buildTxMock();
    const { service, inventory } = buildService(tx);

    await service.create("t1", "u1", {
      workOrderId: "wo1",
      itemType: "MATERIAL",
      itemId: "m1",
      type: "RESERVED",
      quantity: 5,
    } as never);

    expect(inventory.record).not.toHaveBeenCalled();
  });
});
