import { DigitalTwinService } from "./digital-twin.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    machine: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn(), update: jest.fn() },
    machineConnection: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), delete: jest.fn(), findFirst: jest.fn() },
    machineStatusEvent: { groupBy: jest.fn().mockResolvedValue([]) },
    energyReading: { groupBy: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
  const calculation = {
    calculate: jest.fn().mockResolvedValue({
      metrics: { facts: { goodCount: 8, scrapCount: 2 }, oee: { value: 0.64 } },
    }),
  };
  const service = new DigitalTwinService(prisma as any, calculation as any);
  return { service, prisma, calculation };
}

const context = {
  plantId: "p1",
  from: new Date("2026-08-26T08:00:00Z"),
  to: new Date("2026-08-26T12:00:00Z"),
  asOf: new Date("2026-08-26T12:00:00Z"),
};

describe("DigitalTwinService.layout", () => {
  it("adds canonical OEE while retaining energy and open-alarm presentation facts", async () => {
    const { service, prisma, calculation } = buildService();
    prisma.machine.findMany.mockResolvedValue([
      { id: "m1", name: "CNC-1", model: "X", controller: null, isActive: true, plantId: "p1", lastStatus: null, lastEventAt: null, posX: 0, posY: 0, runtimeHours: "150.5", activeWorkOrder: { id: "wo-1", woNo: "WO-1", status: "IN_PROGRESS" } },
    ]);
    prisma.energyReading.groupBy.mockResolvedValue([{ machineId: "m1", _sum: { kwh: 12.5 } }]);
    prisma.machineStatusEvent.groupBy.mockResolvedValue([{ machineId: "m1", _count: { _all: 2 } }]);

    const result = await service.layout("t1", context);
    const machine = result.machines[0] as unknown as { runtimeHours: number; goodCountToday: number; scrapCountToday: number; energyTodayKwh: number; openAlarmCount: number; oeeToday: number | null };

    expect(machine).toMatchObject({ runtimeHours: 150.5, goodCountToday: 8, scrapCountToday: 2, energyTodayKwh: 12.5, openAlarmCount: 2, oeeToday: 0.64 });
    expect(calculation.calculate).toHaveBeenCalledWith({ tenantId: "t1", ...context, workOrderId: "wo-1" });
  });

  it("keeps zero counts distinct from unavailable OEE when a machine has no active work order", async () => {
    const { service, prisma, calculation } = buildService();
    prisma.machine.findMany.mockResolvedValue([
      { id: "m1", name: "CNC-1", model: "X", controller: null, isActive: true, plantId: "p1", lastStatus: null, lastEventAt: null, posX: 0, posY: 0, runtimeHours: "0", activeWorkOrder: null },
    ]);

    const result = await service.layout("t1", context);
    expect(result.machines[0]).toMatchObject({ oeeToday: null, goodCountToday: 0, scrapCountToday: 0, energyTodayKwh: 0, openAlarmCount: 0 });
    expect(calculation.calculate).not.toHaveBeenCalled();
  });

  it("calculates a shared active work order only once", async () => {
    const { service, prisma, calculation } = buildService();
    prisma.machine.findMany.mockResolvedValue(["m1", "m2"].map((id) => ({
      id, name: id, model: "X", controller: null, isActive: true, plantId: "p1", lastStatus: null, lastEventAt: null, posX: 0, posY: 0, runtimeHours: "0", activeWorkOrder: { id: "wo-1", woNo: "WO-1", status: "IN_PROGRESS" },
    })));

    await service.layout("t1", context);
    expect(calculation.calculate).toHaveBeenCalledTimes(1);
  });

  it("does not issue dependent queries when the plant has no machines", async () => {
    const { service, prisma } = buildService();
    const result = await service.layout("t1", context);
    expect(result.machines).toEqual([]);
    expect(prisma.energyReading.groupBy).not.toHaveBeenCalled();
  });
});
