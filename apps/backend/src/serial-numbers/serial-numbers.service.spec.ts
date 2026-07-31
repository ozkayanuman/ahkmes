import { SerialNumbersService } from "./serial-numbers.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    serialNumber: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), delete: jest.fn() },
    part: { findFirst: jest.fn() },
    workOrder: { findFirst: jest.fn() },
    lot: { findFirst: jest.fn() },
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new SerialNumbersService(prisma as any);
  return { service, prisma };
}

describe("SerialNumbersService.trace", () => {
  it("workOrderId yoksa üreten iş emri olmadığını döner", async () => {
    const { service, prisma } = buildService();
    prisma.serialNumber.findFirst.mockResolvedValue({ id: "s1", tenantId: "t1", workOrderId: null });

    const result = await service.trace("t1", "s1");

    expect(result.producedByWorkOrder).toBeNull();
    expect(prisma.workOrder.findFirst).not.toHaveBeenCalled();
  });

  it("workOrderId varsa üreten iş emrini ve tükettiği malzeme lotlarını döner", async () => {
    const { service, prisma } = buildService();
    prisma.serialNumber.findFirst.mockResolvedValue({ id: "s1", tenantId: "t1", workOrderId: "wo1" });
    prisma.workOrder.findFirst.mockResolvedValue({
      id: "wo1",
      woNo: "IE-2026-0001",
      status: "COMPLETED",
      part: { id: "p1", partNo: "PN1", name: "Parça 1" },
      consumptions: [
        { id: "mc1", material: { id: "mat-1", code: "M1", name: "Çelik" }, lot: { id: "lot-mat-1" } },
      ],
    });

    const result = await service.trace("t1", "s1");

    expect(prisma.workOrder.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "wo1", tenantId: "t1" } }),
    );
    expect(result.producedByWorkOrder!.woNo).toBe("IE-2026-0001");
    expect(result.producedByWorkOrder!.consumptions[0].material.code).toBe("M1");
  });

  it("seri numarası bulunamazsa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.serialNumber.findFirst.mockResolvedValue(null);

    await expect(service.trace("t1", "missing")).rejects.toThrow();
  });
});

describe("SerialNumbersService.scanByCode", () => {
  it("serialNo ile bulup trace() zincirini döner", async () => {
    const { service, prisma } = buildService();
    prisma.serialNumber.findFirst
      .mockResolvedValueOnce({ id: "s1", tenantId: "t1", serialNo: "SN-001", workOrderId: null })
      .mockResolvedValueOnce({ id: "s1", tenantId: "t1", workOrderId: null });

    const result = await service.scanByCode("t1", "SN-001");

    expect(prisma.serialNumber.findFirst).toHaveBeenNthCalledWith(1, { where: { tenantId: "t1", serialNo: "SN-001" } });
    expect(result.producedByWorkOrder).toBeNull();
  });

  it("koda ait seri numarası yoksa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.serialNumber.findFirst.mockResolvedValue(null);

    await expect(service.scanByCode("t1", "YOK")).rejects.toThrow();
  });
});

describe("SerialNumbersService.create", () => {
  it("parça yoksa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.part.findFirst.mockResolvedValue(null);

    await expect(
      service.create("t1", { serialNo: "SN-001", partId: "p1" }),
    ).rejects.toThrow();
    expect(prisma.serialNumber.create).not.toHaveBeenCalled();
  });

  it("geçerli veriyle seri numarası oluşturur", async () => {
    const { service, prisma } = buildService();
    prisma.part.findFirst.mockResolvedValue({ id: "p1" });
    prisma.serialNumber.create.mockResolvedValue({ id: "s1", serialNo: "SN-001", partId: "p1" });

    const result = await service.create("t1", { serialNo: "SN-001", partId: "p1" });

    expect(result.serialNo).toBe("SN-001");
    expect(prisma.serialNumber.create).toHaveBeenCalledWith({
      data: { serialNo: "SN-001", partId: "p1", tenantId: "t1" },
    });
  });
});
