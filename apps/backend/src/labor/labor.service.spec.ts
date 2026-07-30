import { LaborService } from "./labor.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    productionRun: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  const service = new LaborService(prisma as any);
  return { service, prisma };
}

describe("LaborService.summary", () => {
  it("aynı operatörün birden fazla koşusunu toplar, hourlyRate varsa maliyet hesaplar", async () => {
    const { service, prisma } = buildService();
    prisma.productionRun.findMany.mockResolvedValue([
      {
        operatorId: "op1",
        operator: { id: "op1", name: "Ali", department: "Üretim", hourlyRate: "50" },
        startedAt: new Date("2026-01-01T00:00:00Z"),
        endedAt: new Date("2026-01-01T02:00:00Z"),
        goodCount: 10,
        scrapCount: 1,
      },
      {
        operatorId: "op1",
        operator: { id: "op1", name: "Ali", department: "Üretim", hourlyRate: "50" },
        startedAt: new Date("2026-01-01T03:00:00Z"),
        endedAt: new Date("2026-01-01T04:00:00Z"),
        goodCount: 5,
        scrapCount: 0,
      },
    ]);

    const result = await service.summary("t1");

    expect(result.operators).toHaveLength(1);
    expect(result.operators[0].hours).toBe(3);
    expect(result.operators[0].goodCount).toBe(15);
    expect(result.operators[0].scrapCount).toBe(1);
    expect(result.operators[0].laborCost).toBe(150);
    expect(result.operators[0].laborCostPartial).toBe(false);
    expect(result.totalHours).toBe(3);
    expect(result.totalLaborCost).toBe(150);
  });

  it("hourlyRate tanımsızsa partial işaretler, maliyete katmaz", async () => {
    const { service, prisma } = buildService();
    prisma.productionRun.findMany.mockResolvedValue([
      {
        operatorId: "op2",
        operator: { id: "op2", name: "Veli", department: null, hourlyRate: null },
        startedAt: new Date("2026-01-01T00:00:00Z"),
        endedAt: new Date("2026-01-01T01:00:00Z"),
        goodCount: 2,
        scrapCount: 0,
      },
    ]);

    const result = await service.summary("t1");

    expect(result.operators[0].laborCost).toBe(0);
    expect(result.operators[0].laborCostPartial).toBe(true);
  });

  it("farklı operatörleri ayrı satırlarda döner, saate göre azalan sıralar", async () => {
    const { service, prisma } = buildService();
    prisma.productionRun.findMany.mockResolvedValue([
      {
        operatorId: "op1",
        operator: { id: "op1", name: "Ali", department: null, hourlyRate: null },
        startedAt: new Date("2026-01-01T00:00:00Z"),
        endedAt: new Date("2026-01-01T01:00:00Z"),
        goodCount: 1,
        scrapCount: 0,
      },
      {
        operatorId: "op2",
        operator: { id: "op2", name: "Veli", department: null, hourlyRate: null },
        startedAt: new Date("2026-01-01T00:00:00Z"),
        endedAt: new Date("2026-01-01T03:00:00Z"),
        goodCount: 1,
        scrapCount: 0,
      },
    ]);

    const result = await service.summary("t1");

    expect(result.operators.map((o) => o.operatorId)).toEqual(["op2", "op1"]);
  });
});
