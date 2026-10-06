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

describe("SchedulingService.capacity — MRP II operasyon pencereleri", () => {
  it("operasyonun kendi plannedStartAt/plannedEndAt penceresi varsa yükü iş emri penceresi yerine ona dağıtır", async () => {
    const prisma: any = {
      machine: { findMany: jest.fn().mockResolvedValue([{ id: "m1", name: "VMC-1", dailyCapacityMinutes: 480, plantId: null }]) },
      workOrder: {
        findMany: jest.fn().mockResolvedValue([
          {
            plannedStartDate: new Date("2026-08-10"),
            plannedEndDate: new Date("2026-08-13"),
            operations: [{ machineId: "m1", standardMinutes: 100, plannedStartAt: new Date("2026-08-12T05:00:00Z"), plannedEndAt: new Date("2026-08-12T07:00:00Z") }],
          },
        ]),
      },
      plantProductionCalendar: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const service = new SchedulingService(prisma, { shiftWindowsForProductionDate: jest.fn() } as any);

    const result = await service.capacity("tenant-1", new Date("2026-08-10"), new Date("2026-08-13"));

    expect(result).toEqual([{ machineId: "m1", machineName: "VMC-1", date: "2026-08-12", loadMinutes: 100, capacityMinutes: 480, overloaded: false }]);
  });
});

describe("SchedulingService.runFiniteSchedule", () => {
  const H = new Date("2026-10-12T05:00:00.000Z");

  function build(opts: { calendar?: boolean } = {}) {
    const machineFindMany = jest.fn().mockResolvedValue([
      { id: "m1", name: "VMC-1", plantId: "p1", dailyCapacityMinutes: 480 },
      { id: "m2", name: "VMC-2", plantId: null, dailyCapacityMinutes: null },
    ]);
    const workOrderFindMany = jest.fn().mockResolvedValue([
      {
        id: "wo1", woNo: "WO-1", priority: 5, dueDate: new Date("2026-10-13T00:00:00Z"), createdAt: new Date("2026-10-01"), quantity: 10,
        operations: [
          { id: "op1", seq: 1, name: "Kaba", machineId: "m1", standardMinutes: 60, status: "PENDING", completedQty: 0, scrapQty: 0 },
          { id: "op2", seq: 2, name: "Finiş", machineId: "m2", standardMinutes: 30, status: "PENDING", completedQty: 0, scrapQty: 0 },
        ],
      },
      {
        id: "wo2", woNo: "WO-2", priority: 1, dueDate: new Date("2026-10-20T00:00:00Z"), createdAt: new Date("2026-10-02"), quantity: 4,
        operations: [{ id: "op3", seq: 1, name: "Tornalama", machineId: "m1", standardMinutes: 100, status: "IN_PROGRESS", completedQty: 2, scrapQty: 0 }],
      },
    ]);
    const calendarFindFirst = jest.fn().mockResolvedValue(opts.calendar ? { id: "cal" } : null);
    const shiftWindowsForProductionDate = jest.fn().mockImplementation(async (_t: string, _p: string, day: string) => {
      if (day !== "2026-10-12") return [];
      return [{
        start: new Date(`${day}T05:00:00.000Z`), end: new Date(`${day}T14:00:00.000Z`),
        breaks: [{ isValidWithinShift: true, start: new Date(`${day}T09:00:00.000Z`), end: new Date(`${day}T09:30:00.000Z`) }],
      }];
    });
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      schedulingRun: { create: jest.fn().mockResolvedValue({ id: "run-1" }) },
      workOrderOperation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }), update: jest.fn().mockResolvedValue({}) },
      workOrder: { update: jest.fn().mockResolvedValue({}) },
    };
    const prisma: any = {
      machine: { findMany: machineFindMany },
      workOrder: { findMany: workOrderFindMany },
      plantProductionCalendar: { findFirst: calendarFindFirst },
      $transaction: jest.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    };
    const service = new SchedulingService(prisma, { shiftWindowsForProductionDate } as any);
    return { service, prisma, tx, shiftWindowsForProductionDate };
  }

  it("simülasyon (commit:false) hiçbir şey yazmaz; çalışan operasyonun kalan süresi tamamlanan adetten düşülür", async () => {
    const { service, prisma, tx } = build();

    const result = await service.runFiniteSchedule("tenant-1", "user-1", { horizonStart: H, horizonDays: 3, dispatchRule: "EDD", commit: false });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.schedulingRun.create).not.toHaveBeenCalled();
    expect(result.runId).toBeNull();
    expect(result.committed).toBe(false);
    // op3 is live: 100' × (1 − 2/4) = 50', pinned at the horizon start on m1 (fallback 08:00 Istanbul = 05:00Z).
    const op3 = result.operations.find((o) => o.operationId === "op3")!;
    expect(op3.pinned).toBe(true);
    expect(op3.minutes).toBe(50);
    expect(op3.start).toEqual(H);
    // op1 then follows on m1; op2 has no capacity (m2 has neither calendar nor dailyCapacity).
    const op1 = result.operations.find((o) => o.operationId === "op1")!;
    expect(op1.start).toEqual(op3.end);
    expect(result.unscheduled).toEqual([expect.objectContaining({ operationId: "op2", reason: "NO_MACHINE_CAPACITY" })]);
    expect(result.summary).toEqual({ workOrders: 2, scheduledOps: 2, unscheduledOps: 1, lateWorkOrders: 0, machines: 1 });
  });

  it("commit:true tek transaction içinde tenant kilidi alır, SchedulingRun yazar, planlanan pencereleri ve bayat pencereleri günceller", async () => {
    const { service, tx } = build();

    const result = await service.runFiniteSchedule("tenant-1", "user-1", { horizonStart: H, horizonDays: 3, dispatchRule: "EDD", commit: true });

    expect(result.runId).toBe("run-1");
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.schedulingRun.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: "tenant-1", createdById: "user-1", dispatchRule: "EDD", committed: true, scheduledOps: 2, unscheduledOps: 1 }),
    }));
    expect(tx.workOrderOperation.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ workOrderId: { in: ["wo1", "wo2"] }, id: { notIn: expect.arrayContaining(["op1", "op3"]) } }),
      data: { plannedStartAt: null, plannedEndAt: null, schedulingRunId: null },
    }));
    expect(tx.workOrderOperation.update).toHaveBeenCalledTimes(2);
    expect(tx.workOrderOperation.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "op1" }, data: expect.objectContaining({ schedulingRunId: "run-1" }),
    }));
    expect(tx.workOrder.update).toHaveBeenCalledTimes(2);
  });

  it("tesisin aktif takvimi varsa makine pencereleri vardiya/mola yapısından türetilir, statik kapasite kullanılmaz", async () => {
    const { service, shiftWindowsForProductionDate } = build({ calendar: true });

    const result = await service.runFiniteSchedule("tenant-1", "user-1", { horizonStart: H, horizonDays: 2, dispatchRule: "FIFO", commit: false });

    expect(shiftWindowsForProductionDate).toHaveBeenCalledWith("tenant-1", "p1", "2026-10-12");
    // Only 2026-10-12 has shifts: 05:00–09:00Z then 09:30–14:00Z. The live op3 (50') is pinned at 05:00–05:50Z,
    // so op1 follows at 05:50–06:50Z inside the first shift window.
    const op1 = result.operations.find((o) => o.operationId === "op1")!;
    expect(op1.start).toEqual(new Date("2026-10-12T05:50:00.000Z"));
    expect(op1.end).toEqual(new Date("2026-10-12T06:50:00.000Z"));
  });
});
