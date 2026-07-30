import { MaintenanceOrdersService } from "./maintenance-orders.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    maintenanceOrder: { findFirst: jest.fn(), update: jest.fn() },
    ...overrides,
  };
  const realtime = { emitToTenant: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new MaintenanceOrdersService(prisma as any, realtime as any);
  return { service, prisma, realtime };
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
    const { service, prisma, realtime } = buildService();
    prisma.maintenanceOrder.findFirst.mockResolvedValue({ id: "mo1", status: "IN_PROGRESS", notes: null });
    prisma.maintenanceOrder.update.mockResolvedValue({ id: "mo1", status: "COMPLETED" });

    const updated = await service.complete("t1", "mo1", { notes: "Yağ değişimi yapıldı" });

    expect(prisma.maintenanceOrder.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "COMPLETED", notes: "Yağ değişimi yapıldı" }),
      }),
    );
    expect(updated.status).toBe("COMPLETED");
    expect(realtime.emitToTenant).toHaveBeenCalledWith("t1", "maintenanceorder.updated", {
      id: "mo1",
      status: "COMPLETED",
    });
  });
});
