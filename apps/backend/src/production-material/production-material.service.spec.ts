import { ProductionMaterialService } from "./production-material.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const requirement = {
    id: "requirement1",
    tenantId: "tenant1",
    itemType: "MATERIAL",
    itemId: "material1",
    status: "OPEN",
    requiredQty: 10,
    reservedQty: 0,
    issuedQty: 0,
    consumedQty: 0,
    returnedQty: 0,
    scrappedQty: 0,
    workOrderId: "wo1",
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prisma: any = {
    productionMaterialReservation: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: "reservation1" }),
      update: jest.fn().mockResolvedValue({}),
    },
    productionMaterialRequirement: {
      findFirst: jest.fn().mockResolvedValue(requirement),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(requirement),
    },
    productionMaterialTransaction: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
    material: {
      findFirst: jest.fn().mockResolvedValue({ id: "material1", tenantId: "tenant1", lotTrackingRequired: true }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    materialSerialNumber: { findMany: jest.fn().mockResolvedValue([]), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    part: { findMany: jest.fn().mockResolvedValue([]) },
    lot: { findFirst: jest.fn().mockResolvedValue({ id: "lot1", tenantId: "tenant1", itemType: "MATERIAL", itemId: "material1" }) },
    qualityHold: { findFirst: jest.fn().mockResolvedValue(null) },
    stockBalance: { findFirst: jest.fn().mockResolvedValue({ id: "balance1", qty: 10 }) },
    maintenanceSpareReservation: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: "audit1" }) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn((fn) => fn(prisma)),
    ...overrides,
  };
  const inventory = { record: jest.fn() };
  const outbox = { record: jest.fn() };
  return { service: new ProductionMaterialService(prisma, inventory as never, outbox as never), prisma, inventory, outbox };
}

describe("ProductionMaterialService lot-tracked reservations", () => {
  it("enriches HMI material requirements with tenant-scoped item identity", async () => {
    const { service, prisma } = buildService();
    prisma.productionMaterialRequirement.findMany.mockResolvedValue([{ id: "requirement1", itemType: "MATERIAL", itemId: "material1" }]);
    prisma.material.findMany.mockResolvedValue([{ id: "material1", code: "RAW-001", name: "Çelik çubuk", unit: "KG", lotTrackingRequired: true }]);

    await expect(service.requirements("tenant1", "wo1")).resolves.toEqual([
      expect.objectContaining({ item: { id: "material1", code: "RAW-001", name: "Çelik çubuk", unit: "KG", lotTrackingRequired: true } }),
    ]);
    expect(prisma.material.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "tenant1", id: { in: ["material1"] } } }));
  });

  it("rejects a reservation without a lot for a lot-tracked material", async () => {
    const { service, prisma } = buildService();

    await expect(service.reserve("tenant1", "user1", {
      requirementId: "requirement1", binId: "bin1", quantity: 5, idempotencyKey: "lot-required-001",
    })).rejects.toThrow("Lot-tracked material requires a lot selection");

    expect(prisma.productionMaterialReservation.create).not.toHaveBeenCalled();
  });

  it("rejects a selected lot that belongs to another stock item", async () => {
    const { service, prisma } = buildService();
    prisma.lot.findFirst.mockResolvedValue(null);

    await expect(service.reserve("tenant1", "user1", {
      requirementId: "requirement1", binId: "bin1", lotId: "foreign-lot", quantity: 5, idempotencyKey: "foreign-lot-001",
    })).rejects.toThrow("Selected lot was not found for material");

    expect(prisma.productionMaterialReservation.create).not.toHaveBeenCalled();
  });

  it("does not let an issue override its reservation lot", async () => {
    const { service, prisma, inventory } = buildService();
    prisma.productionMaterialReservation.findFirst
      .mockResolvedValueOnce({ id: "reservation1", requirementId: "requirement1", binId: "bin1", lotId: "lot1", quantity: 5, issuedQty: 0 });

    await expect(service.execute("tenant1", "user1", "issue", {
      requirementId: "requirement1", reservationId: "reservation1", lotId: "other-lot", quantity: 5, idempotencyKey: "issue-lot-match-001",
    })).rejects.toThrow("Issue lot does not match reservation");

    expect(inventory.record).not.toHaveBeenCalled();
  });

  it("reserves each selected material serial atomically for a serial-tracked material", async () => {
    const { service, prisma } = buildService();
    prisma.material.findFirst.mockResolvedValue({ id: "material1", tenantId: "tenant1", lotTrackingRequired: true, serialTrackingRequired: true });
    prisma.materialSerialNumber.findMany.mockResolvedValue([{ id: "serial1", lotId: "lot1" }, { id: "serial2", lotId: "lot1" }]);
    prisma.materialSerialNumber.updateMany.mockResolvedValue({ count: 2 });
    await service.reserve("tenant1", "user1", { requirementId: "requirement1", binId: "bin1", lotId: "lot1", materialSerialIds: ["serial1", "serial2"], quantity: 2, idempotencyKey: "serial-reserve-001" });
    expect(prisma.materialSerialNumber.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "RESERVED", reservationId: "reservation1" } }));
  });

  it("issues only serials reserved by the selected reservation", async () => {
    const { service, prisma, inventory } = buildService();
    prisma.material.findFirst.mockResolvedValue({ id: "material1", tenantId: "tenant1", lotTrackingRequired: true, serialTrackingRequired: true });
    prisma.productionMaterialReservation.findFirst.mockResolvedValue({ id: "reservation1", requirementId: "requirement1", binId: "bin1", lotId: "lot1", quantity: 2, issuedQty: 0 });
    prisma.materialSerialNumber.findMany.mockResolvedValue([{ id: "serial1" }, { id: "serial2" }]);
    prisma.materialSerialNumber.updateMany.mockResolvedValue({ count: 2 });
    prisma.productionMaterialTransaction.create.mockResolvedValue({ id: "event1", binId: "bin1", lotId: "lot1", reasonCode: null });
    await service.execute("tenant1", "user1", "issue", { requirementId: "requirement1", reservationId: "reservation1", quantity: 2, materialSerialIds: ["serial1", "serial2"], idempotencyKey: "serial-issue-001" });
    expect(prisma.materialSerialNumber.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "ISSUED" } }));
    expect(inventory.record).toHaveBeenCalled();
  });

  it("consumes only issued serials and marks their terminal state", async () => {
    const { service, prisma } = buildService();
    prisma.productionMaterialRequirement.findFirst.mockResolvedValue({ id: "requirement1", tenantId: "tenant1", itemType: "MATERIAL", itemId: "material1", issuedQty: 2, consumedQty: 0, returnedQty: 0, scrappedQty: 0 });
    prisma.material.findFirst.mockResolvedValue({ id: "material1", serialTrackingRequired: true });
    prisma.materialSerialNumber.findMany.mockResolvedValue([{ id: "serial1" }, { id: "serial2" }]);
    prisma.materialSerialNumber.updateMany.mockResolvedValue({ count: 2 });
    prisma.productionMaterialTransaction.create.mockResolvedValue({ id: "event1", binId: null, lotId: "lot1", reasonCode: null });
    await service.execute("tenant1", "user1", "consume", { requirementId: "requirement1", quantity: 2, materialSerialIds: ["serial1", "serial2"], idempotencyKey: "serial-consume-001" });
    expect(prisma.materialSerialNumber.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "CONSUMED" } }));
  });

  it("releases reserved serials when an unissued reservation is cancelled", async () => {
    const { service, prisma } = buildService();
    prisma.productionMaterialReservation.findFirst.mockResolvedValue({ id: "reservation1", issuedQty: 0, quantity: 2, status: "OPEN", requirementId: "requirement1", requirement: { id: "requirement1", itemType: "MATERIAL", itemId: "material1", reservedQty: 2, workOrderId: "wo1" } });
    prisma.material.findFirst.mockResolvedValue({ id: "material1", serialTrackingRequired: true });
    await service.cancelReservation("tenant1", "user1", "reservation1");
    expect(prisma.materialSerialNumber.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "AVAILABLE", reservationId: null } }));
  });
});
