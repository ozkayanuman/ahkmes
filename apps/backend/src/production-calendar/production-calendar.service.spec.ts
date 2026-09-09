import { ProductionCalendarService } from "./production-calendar.service";

function buildPrisma() {
  const plant = { id: "p1", tenantId: "t1", timezone: "Europe/Istanbul" };
  const prisma: any = {
    plant: { findFirst: jest.fn().mockResolvedValue(plant) },
    plantProductionCalendar: { findMany: jest.fn().mockResolvedValue([{ id: "c1", name: "Ankara", weeklyWorkingDays: [1, 2, 3, 4, 5, 7], exceptions: [] }]), findFirst: jest.fn().mockResolvedValue({ id: "c1", name: "Ankara", weeklyWorkingDays: [1, 2, 3, 4, 5, 7], exceptions: [] }) },
    productionShift: { findMany: jest.fn().mockResolvedValue([{ id: "night", code: "N", name: "Night", startMinute: 1320, endMinute: 360, breaks: [] }]), create: jest.fn() },
    auditLog: { create: jest.fn().mockResolvedValue({ id: "audit" }) },
  };
  prisma.$transaction = jest.fn((callback: (tx: any) => unknown) => callback(prisma));
  return prisma;
}
describe("ProductionCalendarService.resolve", () => {
  it("resolves cross-midnight shift using the prior plant-local production date", async () => {
    const service = new ProductionCalendarService(buildPrisma() as any);
    const result = await service.resolve("t1", "p1", new Date("2026-08-10T01:00:00.000Z")); // 04:00 Istanbul, Monday
    expect(result.shift?.code).toBe("N");
    expect(result.isWorkingTime).toBe(true);
    expect(result.productionDate).toBe("2026-08-09");
  });
  it("uses only shifts bound to the active calendar or the plant default", async () => {
    const prisma = buildPrisma() as any;
    const service = new ProductionCalendarService(prisma);
    await service.resolve("t1", "p1", new Date("2026-08-10T08:00:00.000Z"));
    expect(prisma.productionShift.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ AND: expect.arrayContaining([expect.objectContaining({ OR: [{ calendarId: null }, { calendarId: "c1" }] })]) }),
    }));
  });
  it("offsets MRP release dates through weekends and explicit holidays", async () => {
    const prisma = buildPrisma() as any;
    prisma.plantProductionCalendar.findFirst.mockResolvedValue({ id: "c1", weeklyWorkingDays: [1, 2, 3, 4, 5], exceptions: [{ date: new Date("2026-08-14T00:00:00.000Z"), isWorking: false }] });
    const service = new ProductionCalendarService(prisma);
    // Monday Aug 17 minus 3 working days: Fri is an exception, then Thu/Wed/Tue.
    const result = await service.offsetWorkingDays("t1", "p1", new Date("2026-08-17T09:00:00.000Z"), -3);
    expect(result.toISOString().slice(0, 10)).toBe("2026-08-11");
  });

  it("resolves recurring breaks inside a cross-midnight shift in plant time", async () => {
    const prisma = buildPrisma() as any;
    prisma.productionShift.findMany.mockResolvedValue([{ id: "night", code: "N", name: "Night", startMinute: 1320, endMinute: 360, breaks: [{ id: "meal", name: "Meal", startMinute: 1410, endMinute: 0 }] }]);
    const service = new ProductionCalendarService(prisma);

    const [window] = await service.shiftWindowsForProductionDate("t1", "p1", "2026-08-09");

    expect(window.start?.toISOString()).toBe("2026-08-09T19:00:00.000Z");
    expect(window.end?.toISOString()).toBe("2026-08-10T03:00:00.000Z");
    expect(window.breaks).toEqual([
      expect.objectContaining({ id: "meal", start: new Date("2026-08-09T20:30:00.000Z"), end: new Date("2026-08-09T21:00:00.000Z") }),
    ]);
  });

  it("uses timezone conversion across a DST spring-forward shift", async () => {
    const prisma = buildPrisma() as any;
    prisma.plant.findFirst.mockResolvedValue({ id: "p1", tenantId: "t1", timezone: "Europe/Berlin" });
    prisma.productionShift.findMany.mockResolvedValue([{ id: "dst", code: "D", name: "DST", startMinute: 60, endMinute: 240, breaks: [] }]);
    const service = new ProductionCalendarService(prisma);

    const [window] = await service.shiftWindowsForProductionDate("t1", "p1", "2026-03-29");

    expect(window.start?.toISOString()).toBe("2026-03-29T00:00:00.000Z");
    expect(window.end?.toISOString()).toBe("2026-03-29T02:00:00.000Z");
    expect((window.end!.getTime() - window.start!.getTime()) / 3_600_000).toBe(2);
  });

  it("persists recurring breaks as children of the canonical production shift", async () => {
    const prisma = buildPrisma() as any;
    prisma.productionShift.create.mockResolvedValue({ id: "day", breaks: [{ id: "meal" }] });
    const service = new ProductionCalendarService(prisma);

    await service.createShift("t1", "u1", {
      plantId: "p1",
      code: "D",
      name: "Day",
      startMinute: 360,
      endMinute: 840,
      isActive: true,
      breaks: [{ name: "Meal", startMinute: 720, endMinute: 750 }],
    });

    expect(prisma.productionShift.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "t1",
        breaks: { create: [{ tenantId: "t1", name: "Meal", startMinute: 720, endMinute: 750 }] },
      }),
      include: { breaks: { orderBy: { startMinute: "asc" } } },
    });
  });

  it("rejects a recurring break that falls outside its shift window", async () => {
    const service = new ProductionCalendarService(buildPrisma() as any);

    await expect(service.createShift("t1", "u1", {
      plantId: "p1",
      code: "D",
      name: "Day",
      startMinute: 360,
      endMinute: 840,
      isActive: true,
      breaks: [{ name: "Invalid", startMinute: 830, endMinute: 900 }],
    })).rejects.toThrow("inside the shift window");
  });
});
