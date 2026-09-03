import { MaintenanceOrdersService } from "./maintenance-orders.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    maintenanceOrder: {
      findFirst: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: "mo1", bakNo: "BAK-1" }),
      update: jest.fn(),
    },
    machine: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    maintenanceBreakdown: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "bd1" }),
      update: jest.fn(),
    },
    downtimeEvent: {
      create: jest.fn().mockResolvedValue({ id: "dt1" }),
      updateMany: jest.fn(),
    },
    machineMaintenanceStateEvent: {
      create: jest.fn().mockResolvedValue({ id: "st1" }),
    },
    returnToServiceEvent: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "rts1" }),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: "audit1" }),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
    $executeRaw: jest.fn().mockResolvedValue(0),
    ...overrides,
  };
  prisma.$transaction = jest.fn((cb: any) => cb(prisma));
  const outbox = { record: jest.fn() };
  const notifications = { notifyRoles: jest.fn() };
  const service = new MaintenanceOrdersService(prisma as any, notifications as any, outbox as any);
  return { service, prisma, outbox, notifications };
}

describe("MaintenanceOrdersService.setStatus", () => {
  it("geçersiz durum geçişi reddedilir (PLANNED → COMPLETED)", async () => {
    const { service, prisma } = buildService();
    prisma.maintenanceOrder.findFirst.mockResolvedValue({ id: "mo1", status: "PLANNED" });

    await expect(service.setStatus("t1", "mo1", "COMPLETED")).rejects.toThrow();
    expect(prisma.maintenanceOrder.update).not.toHaveBeenCalled();
  });

  it("geçerli durum geçişi kabul edilir (RELEASED → IN_PROGRESS)", async () => {
    const { service, prisma } = buildService();
    prisma.maintenanceOrder.findFirst.mockResolvedValue({ id: "mo1", status: "RELEASED", createdById: "u1" });
    prisma.maintenanceOrder.update.mockResolvedValue({ id: "mo1", status: "IN_PROGRESS" });

    const updated = await service.setStatus("t1", "mo1", "IN_PROGRESS");

    expect(updated.status).toBe("IN_PROGRESS");
  });
});

describe("MaintenanceOrdersService.complete", () => {
  it("PLANNED durumdayken tamamlanamaz (önce IN_PROGRESS gerekir)", async () => {
    const { service, prisma } = buildService();
    prisma.maintenanceOrder.findFirst.mockResolvedValue({ id: "mo1", status: "PLANNED", notes: null, tasks: [], breakdown: null });

    await expect(service.complete("t1", "mo1", {})).rejects.toThrow();
  });

  it("IN_PROGRESS durumdan tamamlanır, completedAt set edilir", async () => {
    const { service, prisma, outbox } = buildService();
    prisma.maintenanceOrder.findFirst.mockResolvedValue({ id: "mo1", status: "IN_PROGRESS", notes: null, tasks: [], breakdown: null, createdById: "u1" });
    prisma.maintenanceOrder.update.mockResolvedValue({ id: "mo1", status: "COMPLETED" });

    const updated = await service.complete("t1", "mo1", { notes: "Yağ değişimi yapıldı" });

    expect(prisma.maintenanceOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED", completionNotes: "Yağ değişimi yapıldı" }),
      }),
    );
    expect(updated.status).toBe("COMPLETED");
    expect(outbox.record).not.toHaveBeenCalled();
  });

  it("required görev tamamlanmadan kapanamaz", async () => {
    const { service, prisma } = buildService();
    prisma.maintenanceOrder.findFirst.mockResolvedValue({
      id: "mo1",
      status: "IN_PROGRESS",
      notes: null,
      breakdown: null,
      tasks: [{ id: "task1", required: true, completed: false }],
      createdById: "u1",
    });

    await expect(service.complete("t1", "mo1", {})).rejects.toThrow(/REQUIRED_MAINTENANCE_TASKS_INCOMPLETE/);
    expect(prisma.maintenanceOrder.update).not.toHaveBeenCalled();
  });

  it("breakdown bağlı emir, resolution/remedy/disposition olmadan kapanamaz", async () => {
    const { service, prisma } = buildService();
    prisma.maintenanceOrder.findFirst.mockResolvedValue({
      id: "mo1",
      status: "IN_PROGRESS",
      notes: null,
      tasks: [],
      breakdown: { id: "bd1" },
      createdById: "u1",
    });

    await expect(service.complete("t1", "mo1", {})).rejects.toThrow(/BREAKDOWN_CLOSURE_DATA_REQUIRED/);
  });
});

describe("MaintenanceOrdersService.predictiveCheck", () => {
  it("V1'de meter-based PM otomatik iş emri üretmez — sadece raporlar (METER_BASED_PM_NOT_INCLUDED_IN_V1)", async () => {
    const { service, prisma, notifications } = buildService();
    prisma.machine.findMany.mockResolvedValue([
      { id: "m1", name: "CNC-1", runtimeHours: "120", lastPmRuntimeHours: "0", pmIntervalHours: "100" },
    ]);

    const result = await service.predictiveCheck("t1", "u1");

    expect(result).toEqual({ checked: 1, due: 1, created: 0, orders: [], qualification: "METER_BASED_PM_NOT_INCLUDED_IN_V1" });
    expect(prisma.maintenanceOrder.create).not.toHaveBeenCalled();
    expect(notifications.notifyRoles).not.toHaveBeenCalled();
  });

  it("eşik aşılmamışsa makine due listesine girmez", async () => {
    const { service, prisma } = buildService();
    prisma.machine.findMany.mockResolvedValue([
      { id: "m1", name: "CNC-1", runtimeHours: "50", lastPmRuntimeHours: "0", pmIntervalHours: "100" },
    ]);

    const result = await service.predictiveCheck("t1", "u1");

    expect(result).toEqual({ checked: 1, due: 0, created: 0, orders: [], qualification: "METER_BASED_PM_NOT_INCLUDED_IN_V1" });
  });
});

describe("MaintenanceOrdersService CNC-V1-07R contracts", () => {
  it("declares a breakdown through the canonical service boundary", async () => {
    const { service, prisma } = buildService();
    prisma.machine.findFirst.mockResolvedValue({ id: "m1", plantId: "p1", maintenanceState: "AVAILABLE" });

    const result = await service.declareBreakdown("t1", "u1", {
      machineId: "m1",
      failureStartedAt: new Date(),
      description: "Spindle stopped",
      priority: "HIGH",
      productionImpact: "PRODUCTION_STOPPED",
      idempotencyKey: "breakdown:m1:one",
    });

    expect(result).toBeDefined();
    expect(prisma.maintenanceBreakdown.create).toHaveBeenCalled();
    expect(prisma.downtimeEvent.create).toHaveBeenCalled();
    expect(prisma.machineMaintenanceStateEvent.create).toHaveBeenCalled();
  });

  it("keeps return-to-service separate from maintenance work-order completion", async () => {
    const { service, prisma } = buildService();
    prisma.maintenanceOrder.findFirst.mockResolvedValue({
      id: "mo1",
      status: "IN_PROGRESS",
      tasks: [],
      breakdown: null,
      machineId: "m1",
    });
    prisma.maintenanceOrder.update.mockResolvedValue({ id: "mo1", status: "COMPLETED" });

    await service.complete("t1", "u1", "mo1", {
      completionNotes: "Repair completed",
      remedy: "Replaced bearing",
      machineDisposition: "KEEP_OUT_OF_SERVICE",
      idempotencyKey: "complete:mo1:one",
    });

    expect(prisma.machineMaintenanceStateEvent.create).not.toHaveBeenCalled();
    expect(service.returnToService).toBeDefined();
  });
});
