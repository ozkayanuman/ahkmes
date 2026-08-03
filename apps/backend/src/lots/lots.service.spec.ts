import { LotsService } from "./lots.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    lot: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    material: { findFirst: jest.fn().mockResolvedValue({ id: "material1", certificateRequired: false }) },
    auditLog: { create: jest.fn().mockResolvedValue({ id: "audit1" }) },
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
});
