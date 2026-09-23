import { CostingService } from "./costing.service";

function build(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    $transaction: jest.fn((callback: (tx: unknown) => unknown) => callback(prisma)),
    workOrder: { findFirst: jest.fn().mockResolvedValue({ id: "wo-1" }) },
    workOrderCostBaseline: { findFirst: jest.fn() },
    materialConsumption: { findMany: jest.fn().mockResolvedValue([]) },
    productionRun: { findMany: jest.fn().mockResolvedValue([]) },
    productionReport: { findMany: jest.fn().mockResolvedValue([]) },
    reworkRequirement: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  return { prisma, service: new CostingService(prisma) };
}

const baseline = {
  id: "baseline-1", rateCardId: "card-1", rateCardRevision: 2, currency: "TRY", capturedAt: new Date("2026-09-01T00:00:00Z"), dataQuality: "COMPLETE", issues: [],
  plannedMaterialCost: "20", plannedMachineCost: "100", plannedLaborCost: "50", plannedTotalCost: "170",
  lines: [],
  rateCard: { lines: [{ kind: "MATERIAL", targetId: "mat-1", rate: "2" }, { kind: "MACHINE", targetId: "machine-1", rate: "100" }, { kind: "LABOR", targetId: "DEFAULT", rate: "50" }] },
};

describe("CostingService.calculate", () => {
  it("uses pinned rates and caps an open production run at the explicit cutoff", async () => {
    const { prisma, service } = build();
    prisma.workOrderCostBaseline.findFirst.mockResolvedValue(baseline);
    prisma.materialConsumption.findMany.mockResolvedValue([{ itemType: "MATERIAL", itemId: "mat-1", quantity: "3" }]);
    prisma.productionRun.findMany.mockResolvedValue([{ id: "run-1", operationId: "op-1", machineId: "machine-1", startedAt: new Date("2026-09-02T08:00:00Z"), endedAt: null }]);
    prisma.productionReport.findMany.mockResolvedValue([{ goodQty: "2", scrapQty: "1", reworkQty: "0" }]);

    const result = await service.calculate("tenant-1", "wo-1", new Date("2026-09-02T10:00:00Z"));

    expect(result.actual).toEqual({ material: 6, machine: 200, labor: 100, total: 306 });
    expect(result.variance.total).toBe(136);
    expect(result.unitCost).toBe(153);
    expect(result.output).toEqual({ goodQty: 2, scrapQty: 1, reworkQty: 0 });
    expect(result.dataQuality).toBe("COMPLETE");
  });

  it("keeps missing pinned rates visible instead of treating them as zero", async () => {
    const { prisma, service } = build();
    prisma.workOrderCostBaseline.findFirst.mockResolvedValue({ ...baseline, dataQuality: "PARTIAL", issues: [{ code: "MISSING_MACHINE_RATE", message: "planned missing" }], rateCard: { lines: [{ kind: "LABOR", targetId: "DEFAULT", rate: "50" }] } });
    prisma.materialConsumption.findMany.mockResolvedValue([{ itemType: "PART", itemId: "part-1", quantity: "1" }]);
    prisma.productionRun.findMany.mockResolvedValue([{ id: "run-1", operationId: "op-1", machineId: "machine-1", startedAt: new Date("2026-09-02T08:00:00Z"), endedAt: new Date("2026-09-02T09:00:00Z") }]);

    const result = await service.calculate("tenant-1", "wo-1", new Date("2026-09-02T10:00:00Z"));

    expect(result.actual.material).toBeNull();
    expect(result.actual.machine).toBeNull();
    expect(result.actual.labor).toBe(50);
    expect(result.actual.total).toBeNull();
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining(["UNPRICED_ACTUAL_PART", "MISSING_ACTUAL_MACHINE_RATE"]));
  });

  it("returns an explicit baseline issue for historical orders", async () => {
    const { prisma, service } = build();
    prisma.workOrderCostBaseline.findFirst.mockResolvedValue(null);

    const result = await service.calculate("tenant-1", "wo-legacy", new Date("2026-09-02T10:00:00Z"));

    expect(result.dataQuality).toBe("PARTIAL");
    expect(result.issues[0].code).toBe("MISSING_RELEASED_COST_BASELINE");
    expect(result.actual.total).toBeNull();
  });
});

describe("CostingService.captureBaseline", () => {
  it("captures a partial, explicit baseline when an effective card is missing", async () => {
    let capturedData: Record<string, unknown>;
    const { prisma, service } = build({
      costRateCard: { findFirst: jest.fn().mockResolvedValue(null) },
      workOrderCostBaseline: {
        create: jest.fn().mockImplementation(({ data }) => { capturedData = data; return Promise.resolve({ id: "baseline-1" }); }),
        findUniqueOrThrow: jest.fn().mockImplementation(() => Promise.resolve({ id: "baseline-1", dataQuality: capturedData.dataQuality, lines: [] })),
      },
      workOrderCostBaselineLine: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    });

    const baseline = await service.captureBaseline(prisma, "tenant-1", "user-1", {
      workOrderId: "wo-1",
      plantId: "plant-1",
      capturedAt: new Date("2026-09-02T10:00:00Z"),
      materialRequirements: [{ itemType: "MATERIAL", itemId: "mat-1", requiredQty: "3", unit: "EA", snapshotLine: { itemId: "mat-1" } }],
      operations: [{ id: "op-1", seq: 10, name: "Freze", machineId: "machine-1", standardMinutes: "60" }],
    });

    expect(baseline.dataQuality).toBe("PARTIAL");
    expect(prisma.workOrderCostBaseline.create.mock.calls[0][0].data.issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "MISSING_RELEASED_RATE_CARD" })]));
    expect(prisma.workOrderCostBaseline.create.mock.calls[0][0].data.plannedTotalCost).toBeNull();
  });

  it("pins planned material, machine and labor amounts from the released card", async () => {
    const card = { id: "card-1", revision: 4, currency: "TRY", lines: [{ kind: "MATERIAL", targetId: "mat-1", rate: "2" }, { kind: "MACHINE", targetId: "machine-1", rate: "120" }, { kind: "LABOR", targetId: "DEFAULT", rate: "60" }] };
    let capturedData: Record<string, unknown>;
    const { prisma, service } = build({
      costRateCard: { findFirst: jest.fn().mockResolvedValue(card) },
      workOrderCostBaseline: {
        create: jest.fn().mockImplementation(({ data }) => { capturedData = data; return Promise.resolve({ id: "baseline-1" }); }),
        findUniqueOrThrow: jest.fn().mockImplementation(() => Promise.resolve({ id: "baseline-1", dataQuality: capturedData.dataQuality, lines: [] })),
      },
      workOrderCostBaselineLine: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    });

    const baseline = await service.captureBaseline(prisma, "tenant-1", "user-1", {
      workOrderId: "wo-1", plantId: "plant-1", capturedAt: new Date("2026-09-02T10:00:00Z"),
      materialRequirements: [{ itemType: "MATERIAL", itemId: "mat-1", requiredQty: "3", unit: "EA", snapshotLine: { itemId: "mat-1" } }],
      operations: [{ id: "op-1", seq: 10, name: "Freze", machineId: "machine-1", standardMinutes: "60" }],
    });

    const data = prisma.workOrderCostBaseline.create.mock.calls[0][0].data;
    expect(baseline.dataQuality).toBe("COMPLETE");
    expect(Number(data.plannedMaterialCost)).toBe(6);
    expect(Number(data.plannedMachineCost)).toBe(120);
    expect(Number(data.plannedLaborCost)).toBe(60);
    expect(Number(data.plannedTotalCost)).toBe(186);
  });
});
