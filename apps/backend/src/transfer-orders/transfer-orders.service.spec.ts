import { TransferOrdersService } from "./transfer-orders.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    $transaction: jest.fn(),
    ...overrides,
  };
  const realtime = { emitToTenant: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new TransferOrdersService(prisma as any, realtime as any);
  return { service, prisma, realtime };
}

function buildTx(overrides: Record<string, unknown> = {}) {
  return {
    bin: {
      findFirst: jest
        .fn()
        .mockResolvedValueOnce({ id: "bin-from" })
        .mockResolvedValueOnce({ id: "bin-to" }),
    },
    stockBalance: {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      create: jest.fn().mockResolvedValue({}),
    },
    transferOrder: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "to1", toNo: "TRF-2026-0001" }),
    },
    ...overrides,
  };
}

describe("TransferOrdersService.create", () => {
  it("kaynak ve hedef raf aynıysa reddedilir", async () => {
    const { service, prisma } = buildService();

    await expect(
      service.create("t1", "u1", {
        fromBinId: "bin1",
        toBinId: "bin1",
        lines: [{ itemType: "MATERIAL", itemId: "m1", qty: 1 }],
      }),
    ).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("yetersiz bakiyede transfer reddedilir", async () => {
    const tx = buildTx();
    tx.stockBalance.findFirst.mockResolvedValueOnce({ id: "sb1", qty: "3" }); // from balance
    const { service } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });

    await expect(
      service.create("t1", "u1", {
        fromBinId: "bin-from",
        toBinId: "bin-to",
        lines: [{ itemType: "MATERIAL", itemId: "m1", qty: 5 }],
      }),
    ).rejects.toThrow();
    expect(tx.stockBalance.update).not.toHaveBeenCalled();
  });

  it("başarılı transfer: kaynaktan düşer, hedefte mevcut bakiyeye eklenir", async () => {
    const tx = buildTx();
    tx.stockBalance.findFirst
      .mockResolvedValueOnce({ id: "sb-from", qty: "10" }) // from balance check
      .mockResolvedValueOnce({ id: "sb-to", qty: "2" }); // to balance existing
    const { service, realtime } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });

    const result = await service.create("t1", "u1", {
      fromBinId: "bin-from",
      toBinId: "bin-to",
      lines: [{ itemType: "MATERIAL", itemId: "m1", qty: 5 }],
    });

    expect(tx.stockBalance.update).toHaveBeenCalledWith({
      where: { id: "sb-from" },
      data: { qty: { decrement: 5 } },
    });
    expect(tx.stockBalance.update).toHaveBeenCalledWith({
      where: { id: "sb-to" },
      data: { qty: { increment: 5 } },
    });
    expect(result.id).toBe("to1");
    expect(realtime.emitToTenant).toHaveBeenCalledWith("t1", "transferorder.created", { id: "to1" });
  });

  it("hedefte bakiye yoksa yeni satır oluşturur", async () => {
    const tx = buildTx();
    tx.stockBalance.findFirst
      .mockResolvedValueOnce({ id: "sb-from", qty: "10" })
      .mockResolvedValueOnce(null); // no existing to balance
    const { service } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });

    await service.create("t1", "u1", {
      fromBinId: "bin-from",
      toBinId: "bin-to",
      lines: [{ itemType: "MATERIAL", itemId: "m1", qty: 5 }],
    });

    expect(tx.stockBalance.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ binId: "bin-to", itemId: "m1", qty: 5 }),
      }),
    );
  });
});
