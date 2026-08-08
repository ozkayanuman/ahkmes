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
