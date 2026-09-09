import { OeeService } from "./oee.service";

describe("OeeService", () => {
  it("delegates an explicit calculation context to the canonical calculation authority", async () => {
    const result = { metrics: { oee: { value: 0.75 } } };
    const calculation = { calculate: jest.fn().mockResolvedValue(result) };
    const service = new OeeService(calculation as never);
    const request = {
      tenantId: "tenant-1",
      plantId: "plant-1",
      from: new Date("2026-08-26T05:00:00.000Z"),
      to: new Date("2026-08-26T09:00:00.000Z"),
      asOf: new Date("2026-08-26T09:00:00.000Z"),
    };

    await expect(service.calculate(request)).resolves.toBe(result);
    expect(calculation.calculate).toHaveBeenCalledWith(request);
  });

  it("projects daily trend from the supplied canonical context without querying other plants", async () => {
    const canonical = {
      timeline: {
        durationByBucket: {
          SCHEDULED_NON_PRODUCTION: 0,
          PLANNED_MAINTENANCE: 0,
          UNPLANNED_BREAKDOWN: 30 * 60,
          QUALITY_HOLD: 0,
          MATERIAL_SHORTAGE: 0,
          SETUP_CHANGEOVER: 0,
          OPERATOR_RESOURCE_PAUSE: 0,
          OTHER_PLANNED: 0,
          OTHER_UNPLANNED: 0,
          RUNNING: 90 * 60,
          IDLE_STOPPED: 0,
        },
        segments: [],
      },
      metrics: {
        facts: {
          plannedProductionTimeSeconds: 120 * 60,
          runTimeSeconds: 90 * 60,
          idealProductionTimeSeconds: 72 * 60,
          totalCount: 10,
          goodCount: 9,
          scrapCount: 1,
          reworkCount: 0,
        },
        quality: { value: 0.9 },
        performance: { value: 0.8 },
        availability: { value: 0.75 },
        oee: { value: 0.54 },
      },
      sources: [],
    };
    const calculation = { calculate: jest.fn().mockResolvedValue(canonical) };
    const service = new OeeService(calculation as never);
    const request = {
      tenantId: "tenant-1",
      plantId: "plant-1",
      from: new Date("2026-08-27T00:00:00.000Z"),
      to: new Date("2026-08-27T12:00:00.000Z"),
      asOf: new Date("2026-08-27T12:00:00.000Z"),
    };

    const trend = await service.trend(request);
    expect(trend).toEqual([
      expect.objectContaining({
        date: "2026-08-27",
        goodCount: 9,
        scrapCount: 1,
        downtimeSeconds: 30 * 60,
        quality: 0.9,
        performance: 0.8,
        availability: 0.75,
      }),
    ]);
    expect(trend[0]?.oee).toBeCloseTo(0.54, 10);
    expect(calculation.calculate).toHaveBeenCalledWith(request);
  });

  it("projects downtime Pareto from the supplied canonical context and source provenance", async () => {
    const source = { id: "downtime:tool-break", sourceType: "DOWNTIME_EVENT", bucket: "UNPLANNED_BREAKDOWN", start: new Date("2026-08-27T08:00:00.000Z"), end: new Date("2026-08-27T08:30:00.000Z"), provenance: { reasonLabel: "Tool break" } };
    const canonical = {
      timeline: {
        durationByBucket: {},
        segments: [{ bucket: "UNPLANNED_BREAKDOWN", durationSeconds: 30 * 60, sourceIds: [source.id] }],
      },
      metrics: { facts: { totalCount: 0, goodCount: 0, scrapCount: 0, runTimeSeconds: 0 } },
      sources: [source],
    };
    const calculation = { calculate: jest.fn().mockResolvedValue(canonical) };
    const service = new OeeService(calculation as never);
    const request = {
      tenantId: "tenant-1",
      plantId: "plant-1",
      from: new Date("2026-08-27T00:00:00.000Z"),
      to: new Date("2026-08-27T12:00:00.000Z"),
      asOf: new Date("2026-08-27T12:00:00.000Z"),
    };

    await expect(service.downtimePareto(request)).resolves.toEqual([
      { reason: "Tool break", totalSeconds: 30 * 60, count: 1 },
    ]);
  });
});
