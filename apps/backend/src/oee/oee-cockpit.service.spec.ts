import { OeeCockpitService } from "./oee-cockpit.service";

describe("OeeCockpitService", () => {
  it("returns canonical plant and machine OEE with optional CMMS, quality and MRP blockers", async () => {
    const prisma: any = {
      plant: { findFirst: jest.fn().mockResolvedValue({ id: "p1", name: "Plant" }) },
      machine: { findMany: jest.fn().mockResolvedValue([{ id: "m1", name: "CNC", lastStatus: "RUNNING", lastEventAt: new Date(), activeWorkOrder: { id: "wo-1", woNo: "WO-1", status: "IN_PROGRESS" } }]) },
      maintenanceOrder: { findMany: jest.fn().mockResolvedValue([]) },
      qualityHold: { findMany: jest.fn().mockResolvedValue([]) },
      mrpException: { findMany: jest.fn().mockResolvedValue([]) },
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
    expect(calculation.calculateForWorkOrders).toHaveBeenCalledWith(request, ["wo-1"]);
  });
});
