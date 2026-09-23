import { OeeCockpitService } from "./oee-cockpit.service";

describe("OeeCockpitService", () => {
  it("returns canonical plant and machine OEE with optional CMMS, quality and MRP blockers", async () => {
    const prisma: any = {
      plant: { findFirst: jest.fn().mockResolvedValue({ id: "p1", name: "Plant" }) },
      machine: { findMany: jest.fn().mockResolvedValue([{ id: "m1", name: "CNC", lastStatus: "RUNNING", lastEventAt: new Date(), activeWorkOrder: { id: "wo-1", woNo: "WO-1", status: "IN_PRODUCTION" } }]) },
      maintenanceOrder: { findMany: jest.fn().mockResolvedValue([]) },
      qualityHold: { findMany: jest.fn().mockResolvedValue([]) },
      mrpException: { findMany: jest.fn().mockResolvedValue([]) },
      workOrder: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const canonicalCalculation = { metrics: { oee: { value: 0.5 }, dataQuality: "COMPLETE", facts: {}, issues: [] }, sources: [], timeline: {} };
    const calculation = {
      calculate: jest.fn().mockResolvedValue(canonicalCalculation),
      calculateForWorkOrders: jest.fn().mockResolvedValue(new Map([["wo-1", canonicalCalculation]])),
    };
    const service = new OeeCockpitService(prisma, calculation as any);
    const request = { tenantId: "t1", plantId: "p1", from: new Date("2026-08-26T08:00:00Z"), to: new Date("2026-08-26T12:00:00Z"), asOf: new Date("2026-08-26T12:00:00Z") };

    const result = await service.read(request);

    expect(result.summary.metrics.oee.value).toBe(0.5);
    expect(result.machines[0]).toMatchObject({ id: "m1", oee: { value: 0.5, dataQuality: "COMPLETE" } });
    expect(result.blockers).toEqual({ maintenance: [], qualityHolds: [], materialExceptions: [] });
    expect(result.workOrders.summary).toMatchObject({ openCount: 0, overdueCount: 0 });
    expect(calculation.calculateForWorkOrders).toHaveBeenCalledWith(request, ["wo-1"]);
  });

  it("keeps the manager WIP projection tenant and plant scoped, and labels it as current state", async () => {
    const findMany = jest.fn()
      .mockResolvedValueOnce([{ id: "machine-1", name: "CNC-1", lastStatus: "RUNNING", lastEventAt: null, activeWorkOrder: null }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: "wo-late", woNo: "WO-100", dueDate: new Date("2026-09-17T00:00:00.000Z"), quantity: { toNumber: () => 5 }, status: "IN_PRODUCTION", part: { id: "part-1", partNo: "P-100", name: "Kapak" }, operations: [{ status: "BLOCKED" }, { status: "IN_PROGRESS" }] },
        { id: "wo-wait", woNo: "WO-101", dueDate: new Date("2026-09-20T00:00:00.000Z"), quantity: { toNumber: () => 2 }, status: "WAITING_MATERIAL", part: { id: "part-2", partNo: "P-101", name: "Gövde" }, operations: [{ status: "BLOCKED" }] },
      ]);
    const prisma = {
      plant: { findFirst: jest.fn().mockResolvedValue({ id: "plant-1", name: "Ana Fabrika" }) },
      machine: { findMany }, maintenanceOrder: { findMany }, qualityHold: { findMany }, mrpException: { findMany }, workOrder: { findMany },
    };
    const calculation = { calculate: jest.fn().mockResolvedValue({ metrics: {}, sources: {}, timeline: [] }), calculateForWorkOrders: jest.fn().mockResolvedValue(new Map()) };
    const service = new OeeCockpitService(prisma as never, calculation as never);

    const result = await service.read({ tenantId: "tenant-1", plantId: "plant-1", from: new Date("2026-09-18T00:00:00.000Z"), to: new Date("2026-09-18T23:59:59.000Z"), asOf: new Date("2026-09-18T12:00:00.000Z") });

    expect(prisma.workOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ tenantId: "tenant-1", plantId: "plant-1" }) }));
    expect(result.workOrders.summary).toEqual({ openCount: 2, inProductionCount: 1, waitingMaterialCount: 1, overdueCount: 1, blockedOperationCount: 2 });
    expect(result.workOrders.overdue).toEqual([expect.objectContaining({ woNo: "WO-100", quantity: 5, blockedOperationCount: 1 })]);
    expect(result.context.workOrderStateAt).toBeInstanceOf(Date);
  });
});
