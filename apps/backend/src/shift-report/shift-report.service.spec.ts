import { ShiftReportService } from "./shift-report.service";

describe("ShiftReportService", () => {
  it("projects each plant-calendar shift from the canonical OEE calculation at one cutoff", async () => {
    const calendar = {
      shiftWindowsForProductionDate: jest.fn().mockResolvedValue([
        { id: "shift-day", code: "DAY", name: "Day", start: new Date("2026-08-27T08:00:00.000Z"), end: new Date("2026-08-27T16:00:00.000Z") },
      ]),
    };
    const calculation = {
      calculate: jest.fn().mockResolvedValue({
        timeline: { durationByBucket: { UNPLANNED_BREAKDOWN: 30 * 60, QUALITY_HOLD: 0, PLANNED_MAINTENANCE: 0, MATERIAL_SHORTAGE: 0, SETUP_CHANGEOVER: 0, OPERATOR_RESOURCE_PAUSE: 0, OTHER_PLANNED: 0, OTHER_UNPLANNED: 0 } },
        metrics: { facts: { goodCount: 9, scrapCount: 1 }, quality: { value: 0.9 }, performance: { value: 0.8 }, availability: { value: 0.75 }, oee: { value: 0.54 }, dataQuality: "COMPLETE", issues: [] },
      }),
    };
    const service = new ShiftReportService(calendar as never, calculation as never);
    const request = { tenantId: "tenant-1", plantId: "plant-1", productionDate: "2026-08-27", asOf: new Date("2026-08-27T12:00:00.000Z") };

    await expect(service.report(request)).resolves.toEqual([
      expect.objectContaining({ shift: "DAY", label: "Day", goodCount: 9, scrapCount: 1, downtimeSeconds: 30 * 60, oee: 0.54 }),
    ]);
    expect(calculation.calculate).toHaveBeenCalledWith({
      tenantId: "tenant-1", plantId: "plant-1", from: new Date("2026-08-27T08:00:00.000Z"), to: new Date("2026-08-27T16:00:00.000Z"), asOf: new Date("2026-08-27T12:00:00.000Z"),
    });
  });
});
