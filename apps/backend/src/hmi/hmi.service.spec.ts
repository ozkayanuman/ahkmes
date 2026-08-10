import { ConflictException } from "@nestjs/common";
import { HmiService } from "./hmi.service";

describe("HmiService", () => {
  const prisma = {
    workOrderOperation: { findMany: jest.fn() },
    productionRun: { findFirst: jest.fn() },
  };
  const production = { start: jest.fn(), complete: jest.fn() };
  const workOrders = { completeOperation: jest.fn() };
  const tooling = { getSetup: jest.fn() };
  const service = new HmiService(prisma as any, production as any, workOrders as any, tooling as any);

  beforeEach(() => jest.clearAllMocks());

  it("scopes the operation queue to the caller tenant", async () => {
    prisma.workOrderOperation.findMany.mockResolvedValue([]);

    await service.list("tenant-a", {});

    expect(prisma.workOrderOperation.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: "tenant-a", status: { in: ["PENDING", "IN_PROGRESS", "BLOCKED"] } }),
    }));
  });

  it("MES-OPERATOR-HMI-002: operasyon kuyruğu talimatın immutable snapshot'ını (instructionHtml) döndürür", async () => {
    prisma.workOrderOperation.findMany.mockResolvedValue([{
      id: "operation-a", workOrderId: "work-order-a", seq: 1, name: "Tornalama", status: "PENDING",
      completedQty: "0", scrapQty: "0", startedAt: null, completedAt: null,
      instructionHtml: "<p>talimat</p>",
      machine: null, ncProgram: null, toolRequirements: [], fixtureRequirements: [], setupVerifications: [],
      workOrder: { machine: null },
    }]);

    const rows = await service.list("tenant-a", {});

    expect(rows[0]).toMatchObject({ instructionHtml: "<p>talimat</p>" });
  });

  it("does not silently complete an in-progress operation when its active run is absent", async () => {
    (service as any).operation = jest.fn().mockResolvedValue({ id: "operation-a", workOrderId: "work-order-a", status: "IN_PROGRESS" });
    prisma.productionRun.findFirst.mockResolvedValue(null);

    await expect(service.complete("tenant-a", "user-a", "operation-a", { goodCount: 1, scrapCount: 0 })).rejects.toBeInstanceOf(ConflictException);
    expect(production.complete).not.toHaveBeenCalled();
    expect(workOrders.completeOperation).not.toHaveBeenCalled();
  });
});
