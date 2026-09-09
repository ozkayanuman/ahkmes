import { ProductionService } from "./production.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    productionRun: {
      findFirst: jest.fn().mockResolvedValue({
        id: "run1",
        tenantId: "t1",
        workOrderId: "wo1",
        machineId: "m1",
        startedAt: new Date("2026-01-01T00:00:00Z"),
        endedAt: null,
      }),
      update: jest.fn().mockResolvedValue({ id: "run1" }),
    },
    workOrder: { update: jest.fn() },
    machine: { updateMany: jest.fn(), update: jest.fn() },
    ...overrides,
  };
  prisma.$transaction = jest.fn((cb: any) => cb(prisma));
  const outbox = { record: jest.fn() };
  const nonConformance = { hasOpenNonConformance: jest.fn().mockResolvedValue(false) };
  const service = new ProductionService(prisma as any, nonConformance as any, outbox as any);
  return { service, prisma };
}

describe("ProductionService.complete", () => {
  it("makineye bağlı koşu bitince Machine.runtimeHours süre kadar artırılır", async () => {
    const { service, prisma } = buildService();
    prisma.productionRun.findFirst.mockResolvedValue({
      id: "run1",
      tenantId: "t1",
      workOrderId: "wo1",
      machineId: "m1",
      startedAt: new Date("2026-01-01T00:00:00Z"),
      endedAt: null,
    });

    await service.complete("t1", "run1", { goodCount: 5 });

    expect(prisma.machine.update).toHaveBeenCalledWith({
      where: { id: "m1" },
      data: { runtimeHours: { increment: expect.any(Number) } },
    });
    const call = prisma.machine.update.mock.calls[0][0];
    expect(call.data.runtimeHours.increment).toBeGreaterThan(0);
  });

  it("makinesiz koşu bitince Machine.runtimeHours güncellenmez", async () => {
    const { service, prisma } = buildService();
    prisma.productionRun.findFirst.mockResolvedValue({
      id: "run1",
      tenantId: "t1",
      workOrderId: "wo1",
      machineId: null,
      startedAt: new Date("2026-01-01T00:00:00Z"),
      endedAt: null,
    });

    await service.complete("t1", "run1", { goodCount: 5 });

    expect(prisma.machine.update).not.toHaveBeenCalled();
  });
});

describe("ProductionService maintenance gate", () => {
  it("checks the resolved machine inside the canonical start transaction before creating a run", async () => {
    const prisma: any = {
      workOrder: { findFirst: jest.fn().mockResolvedValue({ id: "wo1", status: "PLANNED", engineeringReleaseRequired: false, machineId: "m1" }), update: jest.fn() },
      productionRun: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn() },
      workOrderOperation: { findMany: jest.fn().mockResolvedValue([]) },
      machine: { findFirst: jest.fn().mockResolvedValue({ id: "m1" }) },
    };
    prisma.$transaction = jest.fn((callback: any) => callback(prisma));
    const maintenanceAvailability = { assertProductionAvailable: jest.fn().mockRejectedValue(new Error("MACHINE_MAINTENANCE_BLOCK")) };
    const service = new ProductionService(prisma, {} as any, { record: jest.fn() } as any, undefined, undefined, undefined, undefined, undefined, undefined, maintenanceAvailability as any);

    await expect(service.start("t1", "u1", "wo1", {})).rejects.toThrow("MACHINE_MAINTENANCE_BLOCK");

    expect(maintenanceAvailability.assertProductionAvailable).toHaveBeenCalledWith("t1", "m1", expect.any(Date), prisma);
    expect(prisma.productionRun.create).not.toHaveBeenCalled();
  });

  it("re-checks maintenance availability inside the locked resume transition", async () => {
    const prisma: any = {
      productionExecutionEvent: { findFirst: jest.fn().mockResolvedValue(null) },
      workOrderOperation: {
        findFirst: jest.fn().mockResolvedValue({ id: "op1", status: "PAUSED", workOrderId: "wo1", machineId: null, workOrder: { id: "wo1", machineId: "m1" } }),
        update: jest.fn(),
      },
      productionRun: { findFirst: jest.fn().mockResolvedValue({ id: "run1" }) },
      $queryRaw: jest.fn(),
    };
    prisma.$transaction = jest.fn((callback: any) => callback(prisma));
    const maintenanceAvailability = { assertProductionAvailable: jest.fn().mockRejectedValue(new Error("MACHINE_OUT_OF_SERVICE")) };
    const service = new ProductionService(prisma, {} as any, { record: jest.fn() } as any, undefined, undefined, undefined, undefined, undefined, undefined, maintenanceAvailability as any);

    await expect(service.resume("t1", "u1", "op1", { idempotencyKey: "resume-1" })).rejects.toThrow("MACHINE_OUT_OF_SERVICE");

    expect(maintenanceAvailability.assertProductionAvailable).toHaveBeenCalledWith("t1", "m1", expect.any(Date), prisma);
    expect(prisma.workOrderOperation.update).not.toHaveBeenCalled();
  });
});
