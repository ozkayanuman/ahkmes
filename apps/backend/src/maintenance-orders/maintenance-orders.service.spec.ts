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
      findUnique: jest.fn(),
      update: jest.fn(),
    },
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

  it("geçerli durum geçişi kabul edilir (PLANNED → IN_PROGRESS)", async () => {
    const { service, prisma } = buildService();
    prisma.maintenanceOrder.findFirst.mockResolvedValue({ id: "mo1", status: "PLANNED" });
    prisma.maintenanceOrder.update.mockResolvedValue({ id: "mo1", status: "IN_PROGRESS" });

    const updated = await service.setStatus("t1", "mo1", "IN_PROGRESS");

    expect(updated.status).toBe("IN_PROGRESS");
  });
});

describe("MaintenanceOrdersService.complete", () => {
  it("PLANNED durumdayken tamamlanamaz (önce IN_PROGRESS gerekir)", async () => {
    const { service, prisma } = buildService();
    prisma.maintenanceOrder.findFirst.mockResolvedValue({ id: "mo1", status: "PLANNED", notes: null });

    await expect(service.complete("t1", "mo1", {})).rejects.toThrow();
  });

  it("IN_PROGRESS durumdan tamamlanır, completedAt set edilir", async () => {
    const { service, prisma, outbox } = buildService();
    prisma.maintenanceOrder.findFirst.mockResolvedValue({ id: "mo1", status: "IN_PROGRESS", notes: null });
    prisma.maintenanceOrder.update.mockResolvedValue({ id: "mo1", status: "COMPLETED" });

    const updated = await service.complete("t1", "mo1", { notes: "Yağ değişimi yapıldı" });

    expect(prisma.maintenanceOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED", notes: "Yağ değişimi yapıldı" }),
      }),
    );
    expect(updated.status).toBe("COMPLETED");
    expect(outbox.record).toHaveBeenCalledWith(prisma, "t1", "maintenanceorder", "mo1", "maintenanceorder.updated", {
      id: "mo1",
      status: "COMPLETED",
    });
  });

  it("PREVENTIVE emir tamamlanınca Machine.lastPmRuntimeHours anlık runtimeHours'a eşitlenir", async () => {
    const { service, prisma } = buildService();
    prisma.maintenanceOrder.findFirst.mockResolvedValue({
      id: "mo1",
      tenantId: "t1",
      machineId: "m1",
      type: "PREVENTIVE",
      status: "IN_PROGRESS",
      notes: null,
    });
    prisma.maintenanceOrder.update.mockResolvedValue({ id: "mo1", status: "COMPLETED" });
    prisma.machine.findUnique.mockResolvedValue({ id: "m1", runtimeHours: "150" });

    await service.complete("t1", "mo1", {});

    expect(prisma.machine.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { lastPmRuntimeHours: "150" },
    });
  });

  it("CORRECTIVE emir tamamlanınca Machine.lastPmRuntimeHours dokunulmaz", async () => {
    const { service, prisma } = buildService();
    prisma.maintenanceOrder.findFirst.mockResolvedValue({
      id: "mo1",
      tenantId: "t1",
      machineId: "m1",
      type: "CORRECTIVE",
      status: "IN_PROGRESS",
      notes: null,
    });
    prisma.maintenanceOrder.update.mockResolvedValue({ id: "mo1", status: "COMPLETED" });

    await service.complete("t1", "mo1", {});

    expect(prisma.machine.update).not.toHaveBeenCalled();
  });
});

describe("MaintenanceOrdersService.predictiveCheck", () => {
  it("eşiği aşan makine için açık PREVENTIVE emir yoksa yenisini oluşturur ve bildirir", async () => {
    const { service, prisma, notifications } = buildService();
    prisma.machine.findMany.mockResolvedValue([
      { id: "m1", name: "CNC-1", runtimeHours: "120", lastPmRuntimeHours: "0", pmIntervalHours: "100" },
    ]);
    prisma.maintenanceOrder.findFirst.mockResolvedValue(null);

    const result = await service.predictiveCheck("t1", "u1");

    expect(result).toEqual({ checked: 1, due: 1, created: 1, orders: ["mo1"] });
    expect(prisma.maintenanceOrder.create).toHaveBeenCalled();
    expect(notifications.notifyRoles).toHaveBeenCalledWith(
      "t1",
      ["ADMIN", "FOREMAN"],
      expect.objectContaining({ type: "PREDICTIVE_MAINTENANCE_DUE" }),
    );
  });

  it("eşiği aşan makine için zaten açık PREVENTIVE emir varsa mükerrer oluşturmaz", async () => {
    const { service, prisma, notifications } = buildService();
    prisma.machine.findMany.mockResolvedValue([
      { id: "m1", name: "CNC-1", runtimeHours: "120", lastPmRuntimeHours: "0", pmIntervalHours: "100" },
    ]);
    prisma.maintenanceOrder.findFirst.mockResolvedValue({ id: "existing" });

    const result = await service.predictiveCheck("t1", "u1");

    expect(result).toEqual({ checked: 1, due: 1, created: 0, orders: [] });
    expect(prisma.maintenanceOrder.create).not.toHaveBeenCalled();
    expect(notifications.notifyRoles).not.toHaveBeenCalled();
  });

  it("eşik aşılmamışsa makine due listesine girmez", async () => {
    const { service, prisma } = buildService();
    prisma.machine.findMany.mockResolvedValue([
      { id: "m1", name: "CNC-1", runtimeHours: "50", lastPmRuntimeHours: "0", pmIntervalHours: "100" },
    ]);

    const result = await service.predictiveCheck("t1", "u1");

    expect(result).toEqual({ checked: 1, due: 0, created: 0, orders: [] });
  });
});
