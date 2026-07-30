import { CycleCountsService } from "./cycle-counts.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    bin: { findFirst: jest.fn().mockResolvedValue({ id: "bin1" }) },
    cycleCount: { findFirst: jest.fn() },
    $transaction: jest.fn(),
    ...overrides,
  };
  const realtime = { emitToTenant: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new CycleCountsService(prisma as any, realtime as any);
  return { service, prisma, realtime };
}

function buildCreateTx(overrides: Record<string, unknown> = {}) {
  return {
    stockBalance: { findFirst: jest.fn().mockResolvedValue({ id: "sb1", qty: "8" }) },
    cycleCount: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "cc1", ccNo: "SAY-2026-0001" }),
    },
    ...overrides,
  };
}

describe("CycleCountsService.create", () => {
  it("systemQty/varianceQty doğru hesaplanır", async () => {
    const tx = buildCreateTx();
    const { service } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });

    await service.create("t1", "u1", {
      binId: "bin1",
      lines: [{ itemType: "MATERIAL", itemId: "m1", countedQty: 5 }],
    });

    expect(tx.cycleCount.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lines: {
            create: [
              expect.objectContaining({ itemId: "m1", systemQty: 8, countedQty: 5, varianceQty: -3 }),
            ],
          },
        }),
      }),
    );
  });
});

describe("CycleCountsService.post", () => {
  it("OPEN olmayan sayım postalanamaz", async () => {
    const tx = {
      cycleCount: {
        findFirst: jest.fn().mockResolvedValue({ id: "cc1", status: "POSTED", binId: "bin1", lines: [] }),
      },
    };
    const { service } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });

    await expect(service.post("t1", "cc1")).rejects.toThrow();
  });

  it("mevcut StockBalance'ı sayılan miktara SET eder", async () => {
    const tx = {
      cycleCount: {
        findFirst: jest.fn().mockResolvedValue({
          id: "cc1",
          status: "OPEN",
          binId: "bin1",
          lines: [{ itemType: "MATERIAL", itemId: "m1", lotId: null, countedQty: "5" }],
        }),
        update: jest.fn().mockResolvedValue({ id: "cc1", status: "POSTED" }),
      },
      stockBalance: {
        findFirst: jest.fn().mockResolvedValue({ id: "sb1", qty: "8" }),
        update: jest.fn().mockResolvedValue({}),
        create: jest.fn(),
      },
    };
    const { service, realtime } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });

    const updated = await service.post("t1", "cc1");

    expect(tx.stockBalance.update).toHaveBeenCalledWith({ where: { id: "sb1" }, data: { qty: "5" } });
    expect(tx.stockBalance.create).not.toHaveBeenCalled();
    expect(updated.status).toBe("POSTED");
    expect(realtime.emitToTenant).toHaveBeenCalledWith("t1", "cyclecount.updated", { id: "cc1", status: "POSTED" });
  });

  it("StockBalance yoksa yeni satır oluşturur", async () => {
    const tx = {
      cycleCount: {
        findFirst: jest.fn().mockResolvedValue({
          id: "cc1",
          status: "OPEN",
          binId: "bin1",
          lines: [{ itemType: "MATERIAL", itemId: "m1", lotId: null, countedQty: "5" }],
        }),
        update: jest.fn().mockResolvedValue({ id: "cc1", status: "POSTED" }),
      },
      stockBalance: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const { service } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });

    await service.post("t1", "cc1");

    expect(tx.stockBalance.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ binId: "bin1", itemId: "m1", qty: "5" }) }),
    );
    expect(tx.stockBalance.update).not.toHaveBeenCalled();
  });
});
