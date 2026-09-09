import { aggregateOeeFacts, calculateOeeFromCanonicalSources, calculateOeeMetrics, OeeCalculationService } from "./oee-calculation.service";
import type { OeeComponentFacts } from "./oee-calculation.service";

function facts(overrides: Partial<OeeComponentFacts> = {}): OeeComponentFacts {
  return {
    plannedProductionTimeSeconds: 3_600,
    runTimeSeconds: 2_700,
    idealProductionTimeSeconds: 2_160,
    totalCount: 100,
    goodCount: 90,
    scrapCount: 10,
    reworkCount: 0,
    ...overrides,
  };
}

describe("calculateOeeMetrics", () => {
  it("calculates explainable Availability, Performance, Quality and OEE", () => {
    const result = calculateOeeMetrics(facts());

    expect(result.availability).toEqual({ value: 0.75, numerator: 2_700, denominator: 3_600 });
    expect(result.performance).toEqual({ value: 0.8, numerator: 2_160, denominator: 2_700 });
    expect(result.quality).toEqual({ value: 0.9, numerator: 90, denominator: 100 });
    expect(result.oee.value).toBeCloseTo(0.54, 10);
    expect(result.dataQuality).toBe("COMPLETE");
    expect(result.issues).toEqual([]);
  });

  it("does not turn missing planned-time evidence into Availability 100%", () => {
    const result = calculateOeeMetrics(facts({ plannedProductionTimeSeconds: null }));

    expect(result.availability.value).toBeNull();
    expect(result.oee.value).toBeNull();
    expect(result.dataQuality).toBe("INSUFFICIENT_DATA");
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MISSING_PLANNED_PRODUCTION_TIME" })]));
  });

  it("does not turn a missing immutable standard into Performance 100%", () => {
    const result = calculateOeeMetrics(facts({ idealProductionTimeSeconds: null }));

    expect(result.performance.value).toBeNull();
    expect(result.oee.value).toBeNull();
    expect(result.dataQuality).toBe("MISSING_STANDARD");
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MISSING_IDEAL_CYCLE_STANDARD" })]));
  });

  it("preserves Performance above 100% and reports the anomaly", () => {
    const result = calculateOeeMetrics(facts({ plannedProductionTimeSeconds: 100, runTimeSeconds: 100, idealProductionTimeSeconds: 125 }));

    expect(result.performance.value).toBe(1.25);
    expect(result.oee.value).toBeGreaterThan(1);
    expect(result.dataQuality).toBe("PARTIAL");
    expect(result.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "PERFORMANCE_ABOVE_EXPECTED" })]));
  });

  it("keeps measured zero Quality distinct from unavailable Quality", () => {
    const measuredZero = calculateOeeMetrics(facts({ goodCount: 0, scrapCount: 100 }));
    const unavailable = calculateOeeMetrics(facts({ totalCount: 0, goodCount: 0, scrapCount: 0, idealProductionTimeSeconds: 0 }));

    expect(measuredZero.quality.value).toBe(0);
    expect(measuredZero.oee.value).toBe(0);
    expect(unavailable.quality.value).toBeNull();
    expect(unavailable.oee.value).toBeNull();
  });

  it("keeps rework separate from first-pass total quantity", () => {
    const result = calculateOeeMetrics(facts({ totalCount: 100, goodCount: 90, scrapCount: 10, reworkCount: 12 }));

    expect(result.facts.totalCount).toBe(100);
    expect(result.facts.reworkCount).toBe(12);
    expect(result.quality.denominator).toBe(100);
  });
});

describe("aggregateOeeFacts", () => {
  it("aggregates component numerators and denominators instead of averaging machine percentages", () => {
    const machineA = facts({ plannedProductionTimeSeconds: 100, runTimeSeconds: 100, idealProductionTimeSeconds: 100, totalCount: 100, goodCount: 100, scrapCount: 0 });
    const machineB = facts({ plannedProductionTimeSeconds: 900, runTimeSeconds: 450, idealProductionTimeSeconds: 225, totalCount: 450, goodCount: 450, scrapCount: 0 });
    const aggregate = calculateOeeMetrics(aggregateOeeFacts([machineA, machineB]));

    expect(aggregate.facts.plannedProductionTimeSeconds).toBe(1_000);
    expect(aggregate.facts.runTimeSeconds).toBe(550);
    expect(aggregate.facts.idealProductionTimeSeconds).toBe(325);
    expect(aggregate.availability.value).toBeCloseTo(0.55, 10);
    expect(aggregate.performance.value).toBeCloseTo(325 / 550, 10);
    expect(aggregate.oee.value).toBeCloseTo(0.325, 10);
    expect(aggregate.oee.value).not.toBeCloseTo((1 + 0.25) / 2, 10);
  });

  it("does not silently exclude a machine whose immutable standard is missing", () => {
    const aggregate = calculateOeeMetrics(aggregateOeeFacts([facts(), facts({ idealProductionTimeSeconds: null })]));

    expect(aggregate.performance.value).toBeNull();
    expect(aggregate.oee.value).toBeNull();
    expect(aggregate.dataQuality).toBe("MISSING_STANDARD");
  });
});

describe("calculateOeeFromCanonicalSources", () => {
  it("derives OEE from immutable plan, execution and quantity evidence without ProductionRun wall-clock time", () => {
    const at = (value: string) => new Date(value);

    const result = calculateOeeFromCanonicalSources({
      from: at("2026-08-26T08:00:00.000Z"),
      to: at("2026-08-26T12:00:00.000Z"),
      asOf: at("2026-08-26T12:00:00.000Z"),
      scheduleIntervals: [{ id: "wo-1", start: at("2026-08-26T08:00:00.000Z"), end: at("2026-08-26T12:00:00.000Z") }],
      shiftIntervals: [{ id: "shift-1", start: at("2026-08-26T08:00:00.000Z"), end: at("2026-08-26T12:00:00.000Z") }],
      scheduledExclusions: [],
      plannedDowntime: [],
      operations: [{ id: "op-1", idealCycleTimeSec: 120 }],
      executionEvents: [
        { id: "start", operationId: "op-1", eventType: "START", reasonCode: null, createdAt: at("2026-08-26T08:00:00.000Z") },
        { id: "pause", operationId: "op-1", eventType: "PAUSE", reasonCode: "OPERATOR_BREAK", createdAt: at("2026-08-26T10:00:00.000Z") },
        { id: "resume", operationId: "op-1", eventType: "RESUME", reasonCode: null, createdAt: at("2026-08-26T10:30:00.000Z") },
        { id: "complete", operationId: "op-1", eventType: "COMPLETE", reasonCode: null, createdAt: at("2026-08-26T12:00:00.000Z") },
      ],
      reports: [{ id: "report-1", operationId: "op-1", goodQty: 100, scrapQty: 0, reworkQty: 0 }],
    });

    expect(result.plannedTime.plannedProductionTimeSeconds).toBe(4 * 3_600);
    expect(result.timeline.durationByBucket.RUNNING).toBe(3.5 * 3_600);
    expect(result.timeline.durationByBucket.OPERATOR_RESOURCE_PAUSE).toBe(30 * 60);
    expect(result.metrics.availability.value).toBeCloseTo(0.875, 10);
    expect(result.metrics.performance.value).toBeCloseTo(12_000 / 12_600, 10);
    expect(result.metrics.quality.value).toBe(1);
    expect(result.metrics.oee.value).toBeCloseTo(5 / 6, 10);
  });
});

describe("OeeCalculationService", () => {
  it("loads multiple work-order projections from one snapshot without repeating source reads", async () => {
    const at = (value: string) => new Date(value);
    const tx = {
      workOrder: { findMany: jest.fn().mockResolvedValue([
        { id: "wo-1", plannedStartDate: at("2026-08-26T08:00:00.000Z"), plannedEndDate: at("2026-08-26T12:00:00.000Z"), operations: [{ id: "op-1", idealCycleTimeSec: 60 }] },
        { id: "wo-2", plannedStartDate: at("2026-08-26T08:00:00.000Z"), plannedEndDate: at("2026-08-26T12:00:00.000Z"), operations: [{ id: "op-2", idealCycleTimeSec: 60 }] },
      ]) },
      productionExecutionEvent: { findMany: jest.fn().mockResolvedValue([]) },
      productionReport: { findMany: jest.fn().mockResolvedValue([]) },
      downtimeEvent: { findMany: jest.fn().mockResolvedValue([]) },
      qualityHold: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const prisma = { $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)) };
    const calendar = { shiftWindowsForProductionDate: jest.fn().mockResolvedValue([{
      id: "shift-1", start: at("2026-08-26T08:00:00.000Z"), end: at("2026-08-26T12:00:00.000Z"), breaks: [],
    }]) };
    const service = new OeeCalculationService(prisma as never, calendar as never);
    const request = { tenantId: "tenant-1", plantId: "plant-1", from: at("2026-08-26T08:00:00.000Z"), to: at("2026-08-26T12:00:00.000Z"), asOf: at("2026-08-26T12:00:00.000Z") };

    const result = await service.calculateForWorkOrders(request, ["wo-1", "wo-2"]);

    expect([...result.keys()]).toEqual(["wo-1", "wo-2"]);
    expect(tx.workOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: ["wo-1", "wo-2"] } }) }));
    expect(tx.productionExecutionEvent.findMany).toHaveBeenCalledTimes(1);
    expect(tx.productionReport.findMany).toHaveBeenCalledTimes(1);
    expect(tx.downtimeEvent.findMany).toHaveBeenCalledTimes(1);
    expect(tx.qualityHold.findMany).toHaveBeenCalledTimes(1);
  });

  it("loads canonical plan, calendar, execution and report facts inside one repeatable-read snapshot", async () => {
    const at = (value: string) => new Date(value);
    const tx = {
      workOrder: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "wo-1",
            plannedStartDate: at("2026-08-26T08:00:00.000Z"),
            plannedEndDate: at("2026-08-26T12:00:00.000Z"),
            operations: [{ id: "op-1", idealCycleTimeSec: { toNumber: () => 120 } }],
          },
        ]),
      },
      productionExecutionEvent: {
        findMany: jest.fn().mockResolvedValue([
          { id: "start", operationId: "op-1", type: "START", reasonCode: null, createdAt: at("2026-08-26T08:00:00.000Z") },
          { id: "complete", operationId: "op-1", type: "COMPLETE", reasonCode: null, createdAt: at("2026-08-26T12:00:00.000Z") },
        ]),
      },
      productionReport: {
        findMany: jest.fn().mockResolvedValue([
          { id: "report-1", operationId: "op-1", goodQty: { toNumber: () => 100 }, scrapQty: { toNumber: () => 0 }, reworkQty: { toNumber: () => 0 } },
        ]),
      },
      downtimeEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "downtime-1",
            startedAt: at("2026-08-26T09:00:00.000Z"),
            endedAt: at("2026-08-26T10:00:00.000Z"),
            source: "ALARM",
            ownership: "MES",
            maintenanceCategory: null,
            reason: { id: "reason-1", code: "SPINDLE", label: "Spindle failure", category: "UNPLANNED", lossCategory: "UNPLANNED_BREAKDOWN" },
          },
        ]),
      },
      qualityHold: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "hold-1",
            workOrderId: "wo-1",
            operationId: "op-1",
            lotId: null,
            inspectionLotId: null,
            quantity: { toNumber: () => 100 },
            reason: "Inspection failed",
            source: "INSPECTION_LOT",
            status: "RELEASED",
            createdAt: at("2026-08-26T09:30:00.000Z"),
            releasedAt: at("2026-08-26T10:30:00.000Z"),
          },
        ]),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const calendar = {
      shiftWindowsForProductionDate: jest.fn().mockResolvedValue([
        {
          id: "shift-1",
          start: at("2026-08-26T08:00:00.000Z"),
          end: at("2026-08-26T12:00:00.000Z"),
          breaks: [{ id: "break-1", start: at("2026-08-26T10:00:00.000Z"), end: at("2026-08-26T10:15:00.000Z"), isValidWithinShift: true }],
        },
      ]),
    };

    const service = new OeeCalculationService(prisma as never, calendar as never);
    const result = await service.calculate({
      tenantId: "tenant-1",
      plantId: "plant-1",
      from: at("2026-08-26T08:00:00.000Z"),
      to: at("2026-08-26T12:00:00.000Z"),
      asOf: at("2026-08-26T12:00:00.000Z"),
    });

    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({ isolationLevel: "RepeatableRead" }));
    expect(tx.workOrder.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ tenantId: "tenant-1", plantId: "plant-1" }),
    }));
    expect(tx.productionExecutionEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ createdAt: { lte: at("2026-08-26T12:00:00.000Z") } }),
    }));
    expect(tx.downtimeEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workOrderId: { in: ["wo-1"] }, startedAt: { lt: at("2026-08-26T12:00:00.000Z") } }),
    }));
    expect(tx.qualityHold.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workOrderId: { in: ["wo-1"] }, createdAt: { lte: at("2026-08-26T12:00:00.000Z") } }),
    }));
    expect(calendar.shiftWindowsForProductionDate).toHaveBeenCalledWith("tenant-1", "plant-1", "2026-08-26", tx);
    expect(result.timeline.durationByBucket.UNPLANNED_BREAKDOWN).toBe(60 * 60);
    expect(result.timeline.durationByBucket.QUALITY_HOLD).toBe(15 * 60);
    expect(result.metrics.availability.value).toBeCloseTo(9_000 / 13_500, 10);
    expect(result.metrics.performance.value).toBeCloseTo(100 * 120 / 9_000, 10);
    expect(result.plannedTime.scheduledNonProductionSeconds).toBe(15 * 60);
  });
});
