import { LotsService } from "./lots.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    lot: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    material: { findFirst: jest.fn().mockResolvedValue({ id: "material1", certificateRequired: false }) },
    supplier: { findFirst: jest.fn().mockResolvedValue({ id: "supplier1", tenantId: "tenant1" }) },
    incomingLotInspection: { create: jest.fn(), findMany: jest.fn() },
    supplierLotReturn: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn() },
    materialConsumption: { findMany: jest.fn().mockResolvedValue([]) },
    deliveryLine: { findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: "audit1" }) },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $transaction: jest.fn((fn) => fn(prisma)),
    ...overrides,
  };
  return { service: new LotsService(prisma), prisma };
}

describe("LotsService acceptance audit", () => {
  it("writes the acceptance decision and its audit trail in one transaction", async () => {
    const { service, prisma } = buildService();
    const pendingLot = {
      id: "lot1",
      tenantId: "tenant1",
      itemType: "MATERIAL",
      itemId: "material1",
      certificateNo: "COC-1",
      acceptanceStatus: "PENDING",
    };
    prisma.lot.findFirst.mockResolvedValue(pendingLot);
    prisma.lot.update.mockResolvedValue({ ...pendingLot, acceptanceStatus: "ACCEPTED" });

    await service.decideAcceptance("tenant1", "user1", "lot1", { status: "ACCEPTED", note: "Incoming inspection passed" });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: "tenant1",
        userId: "user1",
        entity: "lots",
        entityId: "lot1",
        action: "STATUS_CHANGE",
      }),
    }));
  });

  it("persists an immutable incoming-inspection decision alongside the lot acceptance", async () => {
    const { service, prisma } = buildService();
    const pendingLot = {
      id: "lot1",
      tenantId: "tenant1",
      itemType: "MATERIAL",
      itemId: "material1",
      certificateNo: "COC-1",
      acceptanceStatus: "PENDING",
    };
    prisma.lot.findFirst.mockResolvedValue(pendingLot);
    prisma.lot.update.mockResolvedValue({ ...pendingLot, acceptanceStatus: "QUARANTINED" });
    prisma.incomingLotInspection.create.mockResolvedValue({ id: "incoming-inspection-1" });

    await service.decideAcceptance("tenant1", "user1", "lot1", { status: "QUARANTINED", note: "Boyutsal kontrol bekliyor" });

    expect(prisma.incomingLotInspection.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        tenantId: "tenant1",
        lotId: "lot1",
        decision: "QUARANTINED",
        note: "Boyutsal kontrol bekliyor",
        inspectedById: "user1",
      }),
    }));
  });

  it("lists the incoming-inspection decision history in tenant scope", async () => {
    const { service, prisma } = buildService();
    prisma.lot.findFirst.mockResolvedValue({ id: "lot1", tenantId: "tenant1" });
    prisma.incomingLotInspection.findMany.mockResolvedValue([{ id: "incoming-inspection-1" }]);

    await expect(service.incomingInspectionHistory("tenant1", "lot1")).resolves.toEqual([{ id: "incoming-inspection-1" }]);
    expect(prisma.incomingLotInspection.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { tenantId: "tenant1", lotId: "lot1" },
    }));
  });

  it("records one immutable supplier return only for a rejected material lot", async () => {
    const { service, prisma } = buildService();
    const rejectedLot = { id: "lot1", tenantId: "tenant1", itemType: "MATERIAL", itemId: "material1", acceptanceStatus: "REJECTED" };
    prisma.lot.findFirst.mockResolvedValue(rejectedLot);
    prisma.supplierLotReturn.findFirst.mockResolvedValue(null);
    prisma.supplierLotReturn.create.mockResolvedValue({ id: "supplier-return-1" });

    await service.recordSupplierLotReturn("tenant1", "user1", "lot1", { supplierId: "supplier1", quantity: 12.5, shipmentReference: "IR-2026-001", reason: "Giriş muayenesinde uygunsuz bulundu" });

    expect(prisma.supplierLotReturn.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: "tenant1", lotId: "lot1", supplierId: "supplier1", quantity: 12.5, shipmentReference: "IR-2026-001", returnedById: "user1" }),
    }));
  });

  it("rejects a supplier return for a lot that has not received a final rejection", async () => {
    const { service, prisma } = buildService();
    prisma.lot.findFirst.mockResolvedValue({ id: "lot1", tenantId: "tenant1", itemType: "MATERIAL", itemId: "material1", acceptanceStatus: "QUARANTINED" });

    await expect(service.recordSupplierLotReturn("tenant1", "user1", "lot1", { supplierId: "supplier1", quantity: 12.5, shipmentReference: "IR-2026-001", reason: "Erken iade denemesi" })).rejects.toThrow("Yalnızca reddedilmiş malzeme lotu tedarikçiye iade edilebilir");
    expect(prisma.supplierLotReturn.create).not.toHaveBeenCalled();
  });
});

describe("LotsService customer delivery trace", () => {
  it("returns the customer delivery chain for a shipped part lot", async () => {
    const { service, prisma } = buildService();
    prisma.lot.findFirst.mockResolvedValue({ id: "lot1", tenantId: "tenant1", itemType: "MATERIAL", itemId: "material1" });
    prisma.deliveryLine.findMany.mockResolvedValue([{ id: "delivery-line-1", qty: "2", customerReturnLines: [{ customerReturn: { rmaNo: "RMA-2026-0001", status: "RECEIVED", receivedAt: new Date() } }], delivery: { id: "delivery-1", dlvNo: "SEV-2026-0001", shippedDate: new Date(), deliveredAt: new Date(), carrierName: "Kargo", trackingReference: "TRK-1", salesOrder: { soNo: "SO-1", customer: { id: "customer-1", name: "Müşteri" } } } }]);

    const trace = await service.trace("tenant1", "lot1");

    expect(trace.forward.customerDeliveries).toHaveLength(1);
    expect((trace.forward.customerDeliveries[0] as any).customerReturnLines[0].customerReturn.rmaNo).toBe("RMA-2026-0001");
    expect(prisma.deliveryLine.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: "tenant1", lotId: "lot1" } }));
  });
});
