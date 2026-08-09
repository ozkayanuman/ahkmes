import { SchedulingService } from "./scheduling.service";

describe("SchedulingService.capacity", () => {
  function build() {
    const machineFindMany = jest.fn();
    const workOrderFindMany = jest.fn();
    const prisma: any = {
      machine: { findMany: machineFindMany },
      workOrder: { findMany: workOrderFindMany },
    };
    return { service: new SchedulingService(prisma), machineFindMany, workOrderFindMany };
  }

  it("kapasitesi olmayan bir tenant için boş dizi döner (Prisma'ya WO sorgusu atmadan)", async () => {
    const { service, machineFindMany, workOrderFindMany } = build();
    machineFindMany.mockResolvedValue([]);

    const result = await service.capacity("tenant-1", new Date("2026-08-10"), new Date("2026-08-11"));

    expect(result).toEqual([]);
    expect(workOrderFindMany).not.toHaveBeenCalled();
  });

  it("bir iş emrinin toplam standart süresini planlanan pencereye eşit dağıtır", async () => {
    const { service, machineFindMany, workOrderFindMany } = build();
    machineFindMany.mockResolvedValue([{ id: "m1", name: "VMC-1", dailyCapacityMinutes: 480 }]);
    workOrderFindMany.mockResolvedValue([
      {
        plannedStartDate: new Date("2026-08-10"),
        plannedEndDate: new Date("2026-08-11"),
        operations: [{ machineId: "m1", standardMinutes: 100 }],
      },
    ]);

    const result = await service.capacity("tenant-1", new Date("2026-08-10"), new Date("2026-08-11"));

    expect(result).toEqual([
      { machineId: "m1", machineName: "VMC-1", date: "2026-08-10", loadMinutes: 50, capacityMinutes: 480, overloaded: false },
      { machineId: "m1", machineName: "VMC-1", date: "2026-08-11", loadMinutes: 50, capacityMinutes: 480, overloaded: false },
    ]);
  });

  it("dailyCapacityMinutes girilmemiş makineye atanmış operasyonları hesaba katmaz", async () => {
    const { service, machineFindMany, workOrderFindMany } = build();
    machineFindMany.mockResolvedValue([{ id: "m1", name: "VMC-1", dailyCapacityMinutes: 480 }]);
    workOrderFindMany.mockResolvedValue([
      {
        plannedStartDate: new Date("2026-08-10"),
        plannedEndDate: new Date("2026-08-10"),
        operations: [
          { machineId: "m1", standardMinutes: 60 },
          { machineId: "m2-no-capacity", standardMinutes: 999 },
        ],
      },
    ]);

    const result = await service.capacity("tenant-1", new Date("2026-08-10"), new Date("2026-08-10"));

    expect(result).toEqual([
      { machineId: "m1", machineName: "VMC-1", date: "2026-08-10", loadMinutes: 60, capacityMinutes: 480, overloaded: false },
    ]);
  });

  it("günlük yük kapasiteyi aşarsa overloaded:true işaretler", async () => {
    const { service, machineFindMany, workOrderFindMany } = build();
    machineFindMany.mockResolvedValue([{ id: "m1", name: "VMC-1", dailyCapacityMinutes: 480 }]);
    workOrderFindMany.mockResolvedValue([
      {
        plannedStartDate: new Date("2026-08-10"),
        plannedEndDate: new Date("2026-08-10"),
        operations: [{ machineId: "m1", standardMinutes: 500 }],
      },
    ]);

    const result = await service.capacity("tenant-1", new Date("2026-08-10"), new Date("2026-08-10"));

    expect(result).toEqual([
      { machineId: "m1", machineName: "VMC-1", date: "2026-08-10", loadMinutes: 500, capacityMinutes: 480, overloaded: true },
    ]);
  });

  it("standardMinutes veya machineId eksik operasyonları sessizce atlar", async () => {
    const { service, machineFindMany, workOrderFindMany } = build();
    machineFindMany.mockResolvedValue([{ id: "m1", name: "VMC-1", dailyCapacityMinutes: 480 }]);
    workOrderFindMany.mockResolvedValue([
      {
        plannedStartDate: new Date("2026-08-10"),
        plannedEndDate: new Date("2026-08-10"),
        operations: [{ machineId: "m1", standardMinutes: null }, { machineId: null, standardMinutes: 50 }],
      },
    ]);

    const result = await service.capacity("tenant-1", new Date("2026-08-10"), new Date("2026-08-10"));

    expect(result).toEqual([]);
  });
});
