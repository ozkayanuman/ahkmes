import { LotsService } from "./lots.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    lot: { findFirst: jest.fn() },
    materialConsumption: { findMany: jest.fn() },
    finishedGoodsEntry: { findMany: jest.fn() },
    ...overrides,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new LotsService(prisma as any);
  return { service, prisma };
}

describe("LotsService.trace", () => {
  it("MATERIAL lot için forward: tükettiği iş emirleri ve onların ürettiği lotlar döner", async () => {
    const { service, prisma } = buildService();
    prisma.lot.findFirst.mockResolvedValue({ id: "lot-mat-1", itemType: "MATERIAL", itemId: "mat-1" });
    prisma.materialConsumption.findMany.mockResolvedValue([
      {
        id: "mc1",
        quantity: 5,
        date: new Date("2026-01-01"),
        workOrder: {
          id: "wo1",
          woNo: "IE-2026-0001",
          status: "COMPLETED",
          part: { id: "p1", partNo: "PN1", name: "Parça 1" },
          finishedEntries: [{ id: "fg1", quantity: 10, date: new Date(), lotId: "lot-part-1", lot: { id: "lot-part-1" } }],
        },
      },
    ]);

    const result = await service.trace("t1", "lot-mat-1");

    expect(prisma.materialConsumption.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "t1", lotId: "lot-mat-1" } }),
    );
    expect(result.forward!.consumedByWorkOrders).toHaveLength(1);
    expect(result.forward!.consumedByWorkOrders[0].workOrder.woNo).toBe("IE-2026-0001");
    expect(result.forward!.consumedByWorkOrders[0].producedLots[0].lotId).toBe("lot-part-1");
  });

  it("PART lot için backward: üreten iş emri ve tükettiği malzeme lotları döner", async () => {
    const { service, prisma } = buildService();
    prisma.lot.findFirst.mockResolvedValue({ id: "lot-part-1", itemType: "PART", itemId: "p1" });
    prisma.finishedGoodsEntry.findMany.mockResolvedValue([
      {
        id: "fg1",
        quantity: 10,
        date: new Date("2026-01-02"),
        workOrder: {
          id: "wo1",
          woNo: "IE-2026-0001",
          status: "COMPLETED",
          consumptions: [
            { id: "mc1", material: { id: "mat-1", code: "M1", name: "Çelik" }, lot: { id: "lot-mat-1" } },
          ],
        },
      },
    ]);

    const result = await service.trace("t1", "lot-part-1");

    expect(prisma.finishedGoodsEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: "t1", lotId: "lot-part-1" } }),
    );
    expect(result.backward!.producedByWorkOrders).toHaveLength(1);
    expect(result.backward!.producedByWorkOrders[0].consumedLots[0].material.code).toBe("M1");
  });

  it("lot bulunamazsa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.lot.findFirst.mockResolvedValue(null);

    await expect(service.trace("t1", "missing")).rejects.toThrow();
  });
});
