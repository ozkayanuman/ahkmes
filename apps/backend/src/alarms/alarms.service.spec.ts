import { AlarmsService } from "./alarms.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    machine: { findFirst: jest.fn().mockResolvedValue({ id: "m1" }) },
    alarmDefinition: { findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn(), findMany: jest.fn() },
    machineStatusEvent: { findFirst: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    ...overrides,
  };
  const realtime = { emitToTenant: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new AlarmsService(prisma as any, realtime as any);
  return { service, prisma, realtime };
}

describe("AlarmsService.acknowledge", () => {
  it("ALARM olmayan olay onaylanamaz", async () => {
    const { service, prisma } = buildService();
    prisma.machineStatusEvent.findFirst.mockResolvedValue({ id: "e1", type: "IDLE", acknowledgedAt: null });

    await expect(service.acknowledge("t1", "e1", "u1")).rejects.toThrow();
  });

  it("zaten onaylanmış alarm tekrar onaylanamaz", async () => {
    const { service, prisma } = buildService();
    prisma.machineStatusEvent.findFirst.mockResolvedValue({
      id: "e1",
      type: "ALARM",
      acknowledgedAt: new Date(),
    });

    await expect(service.acknowledge("t1", "e1", "u1")).rejects.toThrow();
  });

  it("onaylanmamış ALARM olayı onaylanır", async () => {
    const { service, prisma, realtime } = buildService();
    prisma.machineStatusEvent.findFirst.mockResolvedValue({ id: "e1", type: "ALARM", acknowledgedAt: null, machineId: "m1" });
    prisma.machineStatusEvent.update.mockResolvedValue({ id: "e1", acknowledgedById: "u1" });

    const result = await service.acknowledge("t1", "e1", "u1", "giderildi");

    expect(prisma.machineStatusEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "e1" },
        data: expect.objectContaining({ acknowledgedById: "u1", ackNote: "giderildi" }),
      }),
    );
    expect(realtime.emitToTenant).toHaveBeenCalled();
    expect(result.id).toBe("e1");
  });
});

describe("AlarmsService.pareto", () => {
  it("mesajları tekrar sayısına göre azalan sırada gruplar", async () => {
    const { service, prisma } = buildService();
    prisma.machineStatusEvent.findMany.mockResolvedValue([
      { message: "Servo hatası" },
      { message: "Alet kırığı" },
      { message: "Servo hatası" },
      { message: "Servo hatası" },
    ]);

    const result = await service.pareto("t1");

    expect(result[0]).toEqual({ message: "Servo hatası", count: 3 });
    expect(result[1]).toEqual({ message: "Alet kırığı", count: 1 });
  });
});
