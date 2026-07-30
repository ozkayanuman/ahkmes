import { EnergyService } from "./energy.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    machine: { findFirst: jest.fn().mockResolvedValue({ id: "m1" }) },
    energyReading: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest.fn(),
    },
    productionRun: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  const service = new EnergyService(prisma as any);
  return { service, prisma };
}

describe("EnergyService.create", () => {
  it("makine bulunamazsa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.machine.findFirst.mockResolvedValue(null);

    await expect(service.create("t1", "u1", { machineId: "m1", kwh: 10 })).rejects.toThrow();
  });
});

describe("EnergyService.summary", () => {
  it("makine bazında kwh toplar, goodCount ile kwhPerPart hesaplar", async () => {
    const { service, prisma } = buildService();
    prisma.energyReading.findMany.mockResolvedValue([
      { machineId: "m1", kwh: "10", machine: { id: "m1", name: "CNC-1" } },
      { machineId: "m1", kwh: "5", machine: { id: "m1", name: "CNC-1" } },
    ]);
    prisma.productionRun.findMany.mockResolvedValue([
      { machineId: "m1", goodCount: 30 },
      { machineId: "m1", goodCount: 20 },
    ]);

    const result = await service.summary("t1");

    expect(result.machines).toHaveLength(1);
    expect(result.machines[0].kwh).toBe(15);
    expect(result.machines[0].goodCount).toBe(50);
    expect(result.machines[0].kwhPerPart).toBe(0.3);
    expect(result.totalKwh).toBe(15);
  });

  it("goodCount 0 ise kwhPerPart null döner (sahte bölme yapılmaz)", async () => {
    const { service, prisma } = buildService();
    prisma.energyReading.findMany.mockResolvedValue([
      { machineId: "m1", kwh: "10", machine: { id: "m1", name: "CNC-1" } },
    ]);
    prisma.productionRun.findMany.mockResolvedValue([]);

    const result = await service.summary("t1");

    expect(result.machines[0].kwhPerPart).toBeNull();
  });
});
