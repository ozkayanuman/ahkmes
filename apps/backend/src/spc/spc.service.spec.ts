import { SpcService } from "./spc.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
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
  prisma.$transaction = jest.fn((cb: any) => cb(prisma));
  const outbox = { record: jest.fn() };
  const nonConformance = { create: jest.fn().mockResolvedValue({ id: "nc1" }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new SpcService(prisma as any, nonConformance as any, outbox as any);
  return { service, prisma, outbox, nonConformance };
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

describe("SpcService.controlChart", () => {
  function rowsFor(values: number[]) {
    return values.map((value, i) => ({
      id: `m${i + 1}`,
      value: String(value),
      measuredAt: new Date(2026, 0, i + 1),
    }));
  }

  it("8'den az ölçümde limitler hesaplanmaz, boş ihlal listesi döner", async () => {
    const { service, prisma } = buildService();
    prisma.spcCharacteristic.findFirst.mockResolvedValue({ id: "c1" });
    prisma.spcMeasurement.findMany.mockResolvedValue(rowsFor([10, 10, 10]));

    const result = await service.controlChart("t1", "c1");

    expect(result.sampleSize).toBe(3);
    expect(result.centerLine).toBeNull();
    expect(result.violations).toEqual([]);
    expect(result.note).toContain("en az 8 ölçüm");
  });

  it("kararlı bir süreçte hiçbir Nelson kuralı ihlal edilmez", async () => {
    const { service, prisma } = buildService();
    prisma.spcCharacteristic.findFirst.mockResolvedValue({ id: "c1" });
    // Merkez etrafında küçük, dengeli salınım — hiçbir kural tetiklenmemeli.
    prisma.spcMeasurement.findMany.mockResolvedValue(rowsFor([10, 10.5, 9.5, 10.2, 9.8, 10.1, 9.9, 10.3, 9.7, 10]));

    const result = await service.controlChart("t1", "c1");

    expect(result.centerLine).not.toBeNull();
    expect(result.violations).toEqual([]);
  });

  it("Kural 1: tek nokta 3-sigma dışında ise tespit edilir", async () => {
    const { service, prisma } = buildService();
    prisma.spcCharacteristic.findFirst.mockResolvedValue({ id: "c1" });
    // İstikrarlı bir taban çizgisi + son noktada büyük bir sıçrama.
    prisma.spcMeasurement.findMany.mockResolvedValue(
      rowsFor([10, 10.1, 9.9, 10, 10.1, 9.9, 10, 9.9, 50]),
    );

    const result = await service.controlChart("t1", "c1");

    const rule1 = result.violations.filter((v) => v.rule === 1);
    expect(rule1).toHaveLength(1);
    expect(rule1[0].measurementId).toBe("m9");
  });

  it("Kural 2: 9 ardışık nokta merkez hattının aynı tarafında ise tespit edilir", async () => {
    const { service, prisma } = buildService();
    prisma.spcCharacteristic.findFirst.mockResolvedValue({ id: "c1" });
    // İlk 5 nokta merkezi belirler (ortalamayı ~10'a çeker), sonraki 9 nokta hep üstünde.
    prisma.spcMeasurement.findMany.mockResolvedValue(
      rowsFor([10, 9, 10, 9, 10, 10.4, 10.3, 10.5, 10.2, 10.4, 10.3, 10.5, 10.2, 10.4]),
    );

    const result = await service.controlChart("t1", "c1");

    expect(result.violations.some((v) => v.rule === 2)).toBe(true);
  });
});
