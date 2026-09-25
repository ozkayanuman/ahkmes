import { SchedulingService } from "./scheduling.service";

describe("SchedulingService.capacity", () => {
  function build() {
    const machineFindMany = jest.fn();
    const workOrderFindMany = jest.fn();
    const calendarFindFirst = jest.fn().mockResolvedValue(null);
    const prisma: any = {
      machine: { findMany: machineFindMany },
      workOrder: { findMany: workOrderFindMany },
      plantProductionCalendar: { findFirst: calendarFindFirst },
    };
    const shiftWindowsForProductionDate = jest.fn();
    const productionCalendar: any = { shiftWindowsForProductionDate };
    return { service: new SchedulingService(prisma, productionCalendar), machineFindMany, workOrderFindMany, calendarFindFirst, shiftWindowsForProductionDate };
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

  it("bir tesisin aktif vardiya takvimi varsa statik dailyCapacityMinutes yerine gerçek vardiya dakikasını (molalar düşülerek) kullanır", async () => {
    const { service, machineFindMany, workOrderFindMany, calendarFindFirst, shiftWindowsForProductionDate } = build();
    machineFindMany.mockResolvedValue([{ id: "m1", name: "VMC-1", dailyCapacityMinutes: 480, plantId: "plant-1" }]);
    workOrderFindMany.mockResolvedValue([
      {
        plannedStartDate: new Date("2026-08-10"),
        plannedEndDate: new Date("2026-08-10"),
        operations: [{ machineId: "m1", standardMinutes: 100 }],
      },
    ]);
    calendarFindFirst.mockResolvedValue({ id: "cal-1" });
    shiftWindowsForProductionDate.mockResolvedValue([
      {
        start: new Date("2026-08-10T08:00:00.000Z"),
        end: new Date("2026-08-10T16:00:00.000Z"),
        breaks: [{ isValidWithinShift: true, start: new Date("2026-08-10T12:00:00.000Z"), end: new Date("2026-08-10T12:30:00.000Z") }],
      },
    ]);

    const result = await service.capacity("tenant-1", new Date("2026-08-10"), new Date("2026-08-10"));

    // 8 saat vardiya (480 dk) - 30 dk mola = 450 dk gerçek kapasite, statik 480 değil.
    expect(result).toEqual([
      { machineId: "m1", machineName: "VMC-1", date: "2026-08-10", loadMinutes: 100, capacityMinutes: 450, overloaded: false },
    ]);
    expect(shiftWindowsForProductionDate).toHaveBeenCalledWith("tenant-1", "plant-1", "2026-08-10");
  });

  it("tesisin aktif takvimi yoksa statik dailyCapacityMinutes'a geri düşer, takvim sorgusu atmaz", async () => {
    const { service, machineFindMany, workOrderFindMany, calendarFindFirst, shiftWindowsForProductionDate } = build();
    machineFindMany.mockResolvedValue([{ id: "m1", name: "VMC-1", dailyCapacityMinutes: 480, plantId: "plant-1" }]);
    workOrderFindMany.mockResolvedValue([
      {
        plannedStartDate: new Date("2026-08-10"),
        plannedEndDate: new Date("2026-08-10"),
        operations: [{ machineId: "m1", standardMinutes: 100 }],
      },
    ]);
    calendarFindFirst.mockResolvedValue(null);

    const result = await service.capacity("tenant-1", new Date("2026-08-10"), new Date("2026-08-10"));

    expect(result).toEqual([
      { machineId: "m1", machineName: "VMC-1", date: "2026-08-10", loadMinutes: 100, capacityMinutes: 480, overloaded: false },
    ]);
    expect(shiftWindowsForProductionDate).not.toHaveBeenCalled();
  });

  it("tesisin takvimi var ama o gün hiç vardiya yoksa (tatil/hafta sonu) kapasiteyi 0 sayar, statik değere geri düşmez", async () => {
    const { service, machineFindMany, workOrderFindMany, calendarFindFirst, shiftWindowsForProductionDate } = build();
    machineFindMany.mockResolvedValue([{ id: "m1", name: "VMC-1", dailyCapacityMinutes: 480, plantId: "plant-1" }]);
    workOrderFindMany.mockResolvedValue([
      {
        plannedStartDate: new Date("2026-08-10"),
        plannedEndDate: new Date("2026-08-10"),
        operations: [{ machineId: "m1", standardMinutes: 50 }],
      },
    ]);
    calendarFindFirst.mockResolvedValue({ id: "cal-1" });
    shiftWindowsForProductionDate.mockResolvedValue([]);

    const result = await service.capacity("tenant-1", new Date("2026-08-10"), new Date("2026-08-10"));

    expect(result).toEqual([
      { machineId: "m1", machineName: "VMC-1", date: "2026-08-10", loadMinutes: 50, capacityMinutes: 0, overloaded: true },
    ]);
  });
});

describe("SchedulingService.bottlenecks", () => {
  function build() {
    const machineFindMany = jest.fn();
    const workOrderFindMany = jest.fn();
    const prisma: any = {
      machine: { findMany: machineFindMany },
      workOrder: { findMany: workOrderFindMany },
      plantProductionCalendar: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const productionCalendar: any = { shiftWindowsForProductionDate: jest.fn() };
    return { service: new SchedulingService(prisma, productionCalendar), machineFindMany, workOrderFindMany };
  }

  it("yalnızca en az bir gün aşan makineleri, toplam aşım süresine göre azalan sırada döner", async () => {
    const { service, machineFindMany, workOrderFindMany } = build();
    machineFindMany.mockResolvedValue([
      { id: "m1", name: "VMC-1", dailyCapacityMinutes: 100 },
      { id: "m2", name: "VMC-2", dailyCapacityMinutes: 100 },
    ]);
    workOrderFindMany.mockResolvedValue([
      { plannedStartDate: new Date("2026-08-10"), plannedEndDate: new Date("2026-08-11"), operations: [{ machineId: "m1", standardMinutes: 240 }] }, // 120/gün, 2 gün aşım
      { plannedStartDate: new Date("2026-08-10"), plannedEndDate: new Date("2026-08-10"), operations: [{ machineId: "m2", standardMinutes: 110 }] }, // 1 gün, küçük aşım
    ]);

    const result = await service.bottlenecks("tenant-1", new Date("2026-08-10"), new Date("2026-08-11"));

    expect(result).toEqual([
      { machineId: "m1", machineName: "VMC-1", overloadedDays: 2, totalLoadMinutes: 240, totalCapacityMinutes: 200, totalOverloadMinutes: 40, utilization: 1.2 },
      { machineId: "m2", machineName: "VMC-2", overloadedDays: 1, totalLoadMinutes: 110, totalCapacityMinutes: 100, totalOverloadMinutes: 10, utilization: 1.1 },
    ]);
  });

  it("hiç aşan gün yoksa boş dizi döner", async () => {
    const { service, machineFindMany, workOrderFindMany } = build();
    machineFindMany.mockResolvedValue([{ id: "m1", name: "VMC-1", dailyCapacityMinutes: 480 }]);
    workOrderFindMany.mockResolvedValue([
      { plannedStartDate: new Date("2026-08-10"), plannedEndDate: new Date("2026-08-10"), operations: [{ machineId: "m1", standardMinutes: 100 }] },
    ]);

    const result = await service.bottlenecks("tenant-1", new Date("2026-08-10"), new Date("2026-08-10"));

    expect(result).toEqual([]);
  });
});
