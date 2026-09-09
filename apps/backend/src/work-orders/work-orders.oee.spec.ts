import { WorkOrdersService } from "./work-orders.service";

describe("WorkOrdersService.oee", () => {
  it("projects canonical work-order facts while preserving legacy response aliases", async () => {
    const canonical = {
      plannedTime: {},
      timeline: {},
      metrics: {
        facts: { goodCount: 90, scrapCount: 10 },
        quality: { value: 0.9 },
        performance: { value: 0.8 },
        availability: { value: 0.75 },
        oee: { value: 0.54 },
        dataQuality: "COMPLETE",
        issues: [],
      },
    };
    const calculator = { calculate: jest.fn().mockResolvedValue(canonical) };
    const service = new WorkOrdersService(
      { workOrder: { findFirst: jest.fn().mockResolvedValue({ id: "work-order-1" }) } } as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      calculator as never,
    );
    const context = {
      plantId: "plant-1",
      from: new Date("2026-08-26T05:00:00.000Z"),
      to: new Date("2026-08-26T09:00:00.000Z"),
      asOf: new Date("2026-08-26T09:00:00.000Z"),
    };

    await expect(service.oee("tenant-1", "work-order-1", context)).resolves.toMatchObject({
      workOrderId: "work-order-1",
      goodCount: 90,
      scrapCount: 10,
      quality: 0.9,
      performance: 0.8,
      availability: 0.75,
      oee: 0.54,
      dataQuality: "COMPLETE",
      canonical,
    });
    expect(calculator.calculate).toHaveBeenCalledWith({ tenantId: "tenant-1", workOrderId: "work-order-1", ...context });
  });
});
