import { WorkOrdersService } from "./work-orders.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    workOrder: { findFirst: jest.fn().mockResolvedValue({ id: "wo1" }) },
    materialConsumption: { findMany: jest.fn().mockResolvedValue([]) },
    material: { findMany: jest.fn().mockResolvedValue([]) },
    productionRun: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  const realtime = { emitToTenant: jest.fn() };
  const service = new WorkOrdersService(prisma as any, realtime as any);
  return { service, prisma };
}

describe("WorkOrdersService.cost", () => {
  it("tüm maliyet verisi tanımlıysa partial bayrağı false, note yok", async () => {
    const { service, prisma } = buildService();
    prisma.materialConsumption.findMany.mockResolvedValue([
      { quantity: "10", itemType: "MATERIAL", itemId: "m1" },
    ]);
    prisma.material.findMany.mockResolvedValue([{ id: "m1", standardCost: "2.5" }]);
    prisma.productionRun.findMany.mockResolvedValue([
      {
        startedAt: new Date("2026-01-01T00:00:00Z"),
        endedAt: new Date("2026-01-01T02:00:00Z"),
        machine: { hourlyRate: "100" },
        operator: { hourlyRate: "50" },
      },
    ]);

    const result = await service.cost("t1", "wo1");

    expect(result.materialCost).toBe(25);
    expect(result.materialCostPartial).toBe(false);
    expect(result.machineCost).toBe(200);
    expect(result.machineCostPartial).toBe(false);
    expect(result.laborCost).toBe(100);
    expect(result.laborCostPartial).toBe(false);
    expect(result.totalCost).toBe(325);
    expect(result.note).toBeUndefined();
  });

  it("standardCost/hourlyRate eksikse partial bayrağı true ve note döner", async () => {
    const { service, prisma } = buildService();
    prisma.materialConsumption.findMany.mockResolvedValue([{ quantity: "10", itemType: "MATERIAL", itemId: "m1" }]);
    prisma.material.findMany.mockResolvedValue([{ id: "m1", standardCost: null }]);
    prisma.productionRun.findMany.mockResolvedValue([
      { startedAt: new Date(), endedAt: new Date(), machine: null, operator: { hourlyRate: null } },
    ]);

    const result = await service.cost("t1", "wo1");

    expect(result.materialCostPartial).toBe(true);
    expect(result.machineCostPartial).toBe(true);
    expect(result.laborCostPartial).toBe(true);
    expect(result.note).toContain("eksik");
  });
});
