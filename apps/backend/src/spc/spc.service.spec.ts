import { SpcService } from "./spc.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    part: { findFirst: jest.fn().mockResolvedValue({ id: "p1" }) },
    spcCharacteristic: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    spcMeasurement: { create: jest.fn(), findMany: jest.fn() },
    workOrder: { findFirst: jest.fn().mockResolvedValue({ id: "wo1" }) },
    ...overrides,
  };
  const realtime = { emitToTenant: jest.fn() };
  const nonConformance = { create: jest.fn().mockResolvedValue({ id: "nc1" }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new SpcService(prisma as any, realtime as any, nonConformance as any);
  return { service, prisma, realtime, nonConformance };
}

describe("SpcService.recordMeasurement", () => {
  it("limit içi ölçüm NonConformance açmaz", async () => {
    const { service, prisma, nonConformance } = buildService();
    prisma.spcCharacteristic.findFirst.mockResolvedValue({
      id: "c1",
      name: "Çap",
      unit: "mm",
      uslUpper: "10.5",
      lslLower: "9.5",
    });
    prisma.spcMeasurement.create.mockResolvedValue({ id: "m1", inSpec: true });

    const result = await service.recordMeasurement("t1", "u1", {
      characteristicId: "c1",
      workOrderId: "wo1",
      value: 10,
    });

    expect(prisma.spcMeasurement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ inSpec: true }) }),
    );
    expect(nonConformance.create).not.toHaveBeenCalled();
    expect(result.inSpec).toBe(true);
  });

  it("limit dışı ölçüm otomatik NonConformance açar", async () => {
    const { service, prisma, nonConformance } = buildService();
    prisma.spcCharacteristic.findFirst.mockResolvedValue({
      id: "c1",
      name: "Çap",
      unit: "mm",
      uslUpper: "10.5",
      lslLower: "9.5",
    });
    prisma.spcMeasurement.create.mockResolvedValue({ id: "m1", inSpec: false });

    await service.recordMeasurement("t1", "u1", { characteristicId: "c1", workOrderId: "wo1", value: 11 });

    expect(nonConformance.create).toHaveBeenCalledWith(
      "t1",
      "u1",
      expect.objectContaining({ workOrderId: "wo1", actionType: "GENERIC" }),
    );
  });

  it("limit tanımlı değilse inSpec null kalır ve NC açılmaz", async () => {
    const { service, prisma, nonConformance } = buildService();
    prisma.spcCharacteristic.findFirst.mockResolvedValue({ id: "c1", name: "Çap", unit: "mm", uslUpper: null, lslLower: null });
    prisma.spcMeasurement.create.mockResolvedValue({ id: "m1", inSpec: null });

    await service.recordMeasurement("t1", "u1", { characteristicId: "c1", value: 5 });

    expect(nonConformance.create).not.toHaveBeenCalled();
  });
});

describe("SpcService.stats", () => {
  it("2'den az ölçümde Cp/Cpk null döner", async () => {
    const { service, prisma } = buildService();
    prisma.spcCharacteristic.findFirst.mockResolvedValue({ id: "c1", uslUpper: "10", lslLower: "5" });
    prisma.spcMeasurement.findMany.mockResolvedValue([{ value: "7" }]);

    const result = await service.stats("t1", "c1");

    expect(result.cp).toBeNull();
    expect(result.cpk).toBeNull();
    expect(result.note).toContain("en az 2 ölçüm");
  });

  it("yeterli ölçüm ve limitle Cp/Cpk hesaplanır", async () => {
    const { service, prisma } = buildService();
    prisma.spcCharacteristic.findFirst.mockResolvedValue({ id: "c1", uslUpper: "10", lslLower: "0" });
    prisma.spcMeasurement.findMany.mockResolvedValue([{ value: "4" }, { value: "5" }, { value: "6" }]);

    const result = await service.stats("t1", "c1");

    expect(result.sampleSize).toBe(3);
    expect(result.mean).toBeCloseTo(5);
    expect(result.cp).not.toBeNull();
    expect(result.cpk).not.toBeNull();
  });
});
