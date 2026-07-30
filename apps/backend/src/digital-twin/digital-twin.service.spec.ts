import { DigitalTwinService } from "./digital-twin.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    machine: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), update: jest.fn() },
    machineConnection: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), delete: jest.fn(), findFirst: jest.fn() },
    productionRun: { findMany: jest.fn().mockResolvedValue([]) },
    machineStatusEvent: { findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    energyReading: { groupBy: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  const service = new DigitalTwinService(prisma as any);
  return { service, prisma };
}

describe("DigitalTwinService.layout", () => {
  it("makine listesine bugünkü OEE/enerji/açık alarm metriklerini ekler", async () => {
    const { service, prisma } = buildService();
    prisma.machine.findMany.mockResolvedValue([
      { id: "m1", name: "CNC-1", model: "X", controller: null, isActive: true, lastStatus: null, lastEventAt: null, posX: 0, posY: 0, runtimeHours: "150.5", activeWorkOrder: null },
    ]);
    prisma.productionRun.findMany.mockResolvedValue([
      {
        machineId: "m1",
        goodCount: 8,
        scrapCount: 2,
        startedAt: new Date(Date.now() - 3600_000),
        endedAt: new Date(),
        workOrder: { part: { idealCycleTimeSec: 360 } }, // 8*360=2880s ideal vs 3600s runtime -> performance 0.8
      },
    ]);
    prisma.energyReading.groupBy.mockResolvedValue([{ machineId: "m1", _sum: { kwh: 12.5 } }]);
    prisma.machineStatusEvent.groupBy.mockResolvedValue([{ machineId: "m1", _count: { _all: 2 } }]);

    const result = await service.layout("t1");

    const m = result.machines[0] as unknown as {
      runtimeHours: number;
      goodCountToday: number;
      scrapCountToday: number;
      energyTodayKwh: number;
      openAlarmCount: number;
      oeeToday: number | null;
    };
    expect(m.runtimeHours).toBe(150.5);
    expect(m.goodCountToday).toBe(8);
    expect(m.scrapCountToday).toBe(2);
    expect(m.energyTodayKwh).toBe(12.5);
    expect(m.openAlarmCount).toBe(2);
    expect(m.oeeToday).not.toBeNull();
    // quality 0.8 * performance 0.8 * availability 1 = 0.64
    expect(m.oeeToday).toBeCloseTo(0.64, 2);
  });

  it("bugün üretim koşusu yoksa oeeToday null, sayaçlar sıfır döner", async () => {
    const { service, prisma } = buildService();
    prisma.machine.findMany.mockResolvedValue([
      { id: "m1", name: "CNC-1", model: "X", controller: null, isActive: true, lastStatus: null, lastEventAt: null, posX: 0, posY: 0, runtimeHours: "0", activeWorkOrder: null },
    ]);

    const result = await service.layout("t1");
    const m = result.machines[0] as unknown as { oeeToday: number | null; energyTodayKwh: number; openAlarmCount: number };

    expect(m.oeeToday).toBeNull();
    expect(m.energyTodayKwh).toBe(0);
    expect(m.openAlarmCount).toBe(0);
  });

  it("hiç makine yoksa boş dizi döner, ekstra sorgu atılmaz", async () => {
    const { service, prisma } = buildService();
    prisma.machine.findMany.mockResolvedValue([]);

    const result = await service.layout("t1");

    expect(result.machines).toEqual([]);
    expect(prisma.productionRun.findMany).not.toHaveBeenCalled();
  });
});
