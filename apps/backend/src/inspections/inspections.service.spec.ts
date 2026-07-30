import { InspectionsService } from "./inspections.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    workOrder: { findFirst: jest.fn().mockResolvedValue({ id: "wo1" }) },
    $transaction: jest.fn(),
    ...overrides,
  };
  const realtime = { emitToTenant: jest.fn() };
  const nonConformance = { create: jest.fn().mockResolvedValue({ id: "nc1" }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new InspectionsService(prisma as any, realtime as any, nonConformance as any);
  return { service, prisma, realtime, nonConformance };
}

function buildTx() {
  return {
    inspection: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "ins1", insNo: "MUA-2026-0001" }),
    },
  };
}

describe("InspectionsService.create", () => {
  it("FAIL sonucunda NonConformance oluşturur ve inspection'a bağlar", async () => {
    const tx = buildTx();
    const { service, nonConformance, realtime } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });

    const result = await service.create("t1", "u1", {
      workOrderId: "wo1",
      checkpointName: "İlk Parça Kontrolü",
      result: "FAIL",
      notes: "Ölçü dışı",
    });

    expect(nonConformance.create).toHaveBeenCalledWith(
      "t1",
      "u1",
      expect.objectContaining({ workOrderId: "wo1", failureType: "Muayene hatası: İlk Parça Kontrolü" }),
    );
    expect(tx.inspection.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nonConformanceId: "nc1" }) }),
    );
    expect(result.id).toBe("ins1");
    expect(realtime.emitToTenant).toHaveBeenCalledWith("t1", "inspection.created", {
      id: "ins1",
      workOrderId: "wo1",
      result: "FAIL",
    });
  });

  it("PASS sonucunda NonConformance oluşturmaz", async () => {
    const tx = buildTx();
    const { service, nonConformance } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });

    await service.create("t1", "u1", {
      workOrderId: "wo1",
      checkpointName: "Son Kontrol",
      result: "PASS",
    });

    expect(nonConformance.create).not.toHaveBeenCalled();
    expect(tx.inspection.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nonConformanceId: undefined }) }),
    );
  });
});
