import { TransferOrdersService } from "./transfer-orders.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = { $transaction: jest.fn(), ...overrides };
  const realtime = { emitToTenant: jest.fn() };
  const inventory = { record: jest.fn().mockResolvedValue({ id: "im1" }) };
  const service = new TransferOrdersService(prisma as any, realtime as any, inventory as any);
  return { service, prisma, realtime, inventory };
}

function buildTx() {
  return {
    bin: { findFirst: jest.fn().mockResolvedValue({ id: "bin" }) },
    transferOrder: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({
        id: "to1", toNo: "TRF-2026-0001", lines: [{ id: "tol1", itemType: "MATERIAL", itemId: "m1", lotId: null, qty: "5" }],
      }),
    },
  };
}

describe("TransferOrdersService.create", () => {
  it("aynı kaynak ve hedef rafı reddeder", async () => {
    const { service, prisma } = buildService();
    await expect(service.create("t1", "u1", { fromBinId: "bin1", toBinId: "bin1", lines: [{ itemType: "MATERIAL", itemId: "m1", qty: 1 }] })).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("transfer için kaynak ve hedef immutable hareketlerini üretir", async () => {
    const tx = buildTx();
    const { service, inventory, realtime } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });
    await service.create("t1", "u1", { fromBinId: "bin-from", toBinId: "bin-to", lines: [{ itemType: "MATERIAL", itemId: "m1", qty: 5 }] });
    expect(inventory.record).toHaveBeenNthCalledWith(1, tx, expect.objectContaining({ movementType: "TRANSFER_OUT", quantityDelta: -5, binId: "bin-from" }));
    expect(inventory.record).toHaveBeenNthCalledWith(2, tx, expect.objectContaining({ movementType: "TRANSFER_IN", quantityDelta: 5, binId: "bin-to" }));
    expect(realtime.emitToTenant).toHaveBeenCalledWith("t1", "transferorder.created", { id: "to1" });
  });
});
