import { MrpService } from "./mrp.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPrismaMock(overrides: any = {}) {
  return {
    workOrder: { findMany: jest.fn().mockResolvedValue([]) },
    machine: { findMany: jest.fn().mockResolvedValue([]) },
    workOrderOperation: { findMany: jest.fn().mockResolvedValue([]) },
    material: { findMany: jest.fn().mockResolvedValue([]) },
    partStock: { findMany: jest.fn().mockResolvedValue([]) },
    bomHeader: { findMany: jest.fn().mockResolvedValue([]) },
    purchaseOrderLine: { findMany: jest.fn().mockResolvedValue([]) },
    purchaseProposalLine: { findMany: jest.fn().mockResolvedValue([]) },
    productionProposal: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    purchaseProposal: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    },
    approvalRequest: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn(),
    ...overrides,
  };
}

function buildTxMock() {
  return {
    purchaseProposal: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "pp1", ppNo: "PPR-2026-0001" }),
    },
    productionProposal: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "prp1", prNo: "PRP-2026-0001" }),
    },
  };
}

function buildService(prisma: ReturnType<typeof buildPrismaMock>) {
  if (!prisma.$transaction.getMockImplementation()) prisma.$transaction.mockImplementation((cb: (tx: typeof prisma) => unknown) => cb(prisma));
  const realtime = { emitToTenant: jest.fn() };
  const notifications = { notifyRoles: jest.fn().mockResolvedValue(undefined) };
  const approvals = {
    request: jest.fn().mockResolvedValue({ id: "ar1" }),
    approve: jest.fn().mockResolvedValue({}),
    reject: jest.fn().mockResolvedValue({}),
    notifyDecision: jest.fn().mockResolvedValue(undefined),
  };
  const purchasing = { create: jest.fn().mockResolvedValue({ id: "po1" }), createInTransaction: jest.fn().mockResolvedValue({ id: "po1" }) };
  const workOrders = { create: jest.fn().mockResolvedValue({ id: "wo-new" }), createInTransaction: jest.fn().mockResolvedValue({ id: "wo-new" }) };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new MrpService(prisma as any, realtime as any, notifications as any, approvals as any, purchasing as any, workOrders as any);
  return { service, prisma, realtime, notifications, approvals, purchasing, workOrders };
}

describe("MrpService.run", () => {
  it("BOM patlatma: WorkOrder talebi BOM üzerinden Material shortfall üretir", async () => {
    const tx = buildTxMock();
    const prisma = buildPrismaMock({
      workOrder: {
        findMany: jest.fn().mockResolvedValue([{ id: "wo1", partId: "p1", quantity: "10", dueDate: new Date("2026-08-01") }]),
      },
      material: { findMany: jest.fn().mockResolvedValue([{ id: "m1", stockQty: "5", minStock: null }]) },
      bomHeader: {
        findMany: jest.fn().mockResolvedValue([
          { id: "bom1", partId: "p1", lines: [{ materialId: "m1", qtyPer: "2", scrapPct: null }] },
        ]),
      },
      $transaction: jest.fn((cb) => cb(tx)),
    });
    const { service } = buildService(prisma);

    const result = await service.run("t1", "u1");

    // gross = 10*2 = 20; net = 20 - 5(stok) = 15
    expect(tx.purchaseProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lines: { create: [expect.objectContaining({ materialId: "m1", qty: 15 })] },
        }),
      }),
    );
    expect(result.purchaseProposal?.id).toBe("pp1");
    // Part stock yok → 10 adet WorkOrder talebi de üretim önerisi olarak düşer
    expect(tx.productionProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ partId: "p1", qty: 10 }) }),
    );
    expect(result.productionProposals).toHaveLength(1);
  });

  it("Reorder-point: WorkOrder talebi olmadan minStock altına düşen Material için öneri üretir", async () => {
    const tx = buildTxMock();
    const prisma = buildPrismaMock({
      material: { findMany: jest.fn().mockResolvedValue([{ id: "m2", stockQty: "2", minStock: "10" }]) },
      $transaction: jest.fn((cb) => cb(tx)),
    });
    const { service } = buildService(prisma);

    const result = await service.run("t1", "u1");

    expect(tx.purchaseProposal.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lines: { create: [expect.objectContaining({ materialId: "m2", qty: 8 })] },
        }),
      }),
    );
    expect(result.productionProposals).toHaveLength(0);
  });

  it("Netleme: açık PO + zaten önerilmiş miktar shortfall'ı kapatıyorsa tekrar öneri üretmez", async () => {
    const prisma = buildPrismaMock({
      material: { findMany: jest.fn().mockResolvedValue([{ id: "m2", stockQty: "2", minStock: "10" }]) },
      purchaseOrderLine: {
        findMany: jest.fn().mockResolvedValue([{ materialId: "m2", quantity: "5", receivedQty: "0" }]),
      },
      purchaseProposalLine: {
        findMany: jest.fn().mockResolvedValue([{ materialId: "m2", qty: "3" }]),
      },
    });
    const { service } = buildService(prisma);

    // gross(10) - stok(2) - açıkPO(5) - zatenÖnerilmiş(3) = 0 → shortfall yok
    const result = await service.run("t1", "u1");

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(result.purchaseProposal).toBeNull();
    expect(result.productionProposals).toEqual([]);
  });

  it("Eksik BOM: Part için aktif BOM yoksa crash olmadan unresolvedPartIds'e eklenir", async () => {
    const prisma = buildPrismaMock({
      workOrder: {
        findMany: jest.fn().mockResolvedValue([{ id: "wo1", partId: "p3", quantity: "20", dueDate: new Date() }]),
      },
      partStock: { findMany: jest.fn().mockResolvedValue([{ partId: "p3", qty: "20" }]) },
      bomHeader: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const { service } = buildService(prisma);

    const result = await service.run("t1", "u1");

    expect(result.unresolvedPartIds).toEqual(["p3"]);
    expect(result.purchaseProposal).toBeNull();
    expect(result.productionProposals).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("MrpService.decidePurchaseProposal", () => {
  function proposalFixture() {
    return {
      id: "pp1",
      tenantId: "t1",
      ppNo: "PPR-2026-0001",
      status: "PENDING_APPROVAL",
      supplierId: null,
      lines: [{ materialId: "m1", qty: "15" }],
    };
  }

  it("approve: tedarikçi verilirse gerçek PurchaseOrder'a dönüştürür", async () => {
    const prisma = buildPrismaMock({
      purchaseProposal: {
        findFirst: jest.fn().mockResolvedValue(proposalFixture()),
        update: jest.fn().mockResolvedValue({ id: "pp1", status: "CONVERTED", convertedToId: "po1" }),
      },
      approvalRequest: { findFirst: jest.fn().mockResolvedValue({ id: "ar1" }) },
    });
    const { service, approvals, purchasing } = buildService(prisma);

    const updated = await service.decidePurchaseProposal("t1", "pp1", "u1", "PLANNER", "approve", undefined, "sup1");

    expect(approvals.approve).toHaveBeenCalledWith("t1", "ar1", "u1", "PLANNER", undefined, prisma, false);
    expect(purchasing.createInTransaction).toHaveBeenCalledWith(
      prisma,
      "t1",
      "u1",
      expect.objectContaining({
        supplierId: "sup1",
        lines: [{ materialId: "m1", quantity: 15, unitPrice: 0 }],
      }),
    );
    expect(prisma.purchaseProposal.update).toHaveBeenCalledWith({
      where: { id: "pp1" },
      data: { status: "CONVERTED", convertedToId: "po1", supplierId: "sup1" },
    });
    expect(updated.status).toBe("CONVERTED");
  });

  it("approve: tedarikçi seçilmemişse (öneri de tedarikçisizse) hata fırlatır ve PO oluşturmaz", async () => {
    const prisma = buildPrismaMock({
      purchaseProposal: { findFirst: jest.fn().mockResolvedValue(proposalFixture()) },
      approvalRequest: { findFirst: jest.fn().mockResolvedValue({ id: "ar1" }) },
    });
    const { service, purchasing } = buildService(prisma);

    await expect(service.decidePurchaseProposal("t1", "pp1", "u1", "PLANNER", "approve")).rejects.toThrow();
    expect(purchasing.createInTransaction).not.toHaveBeenCalled();
  });

  it("reject: öneri reddedilir, PurchaseOrder oluşturulmaz", async () => {
    const prisma = buildPrismaMock({
      purchaseProposal: {
        findFirst: jest.fn().mockResolvedValue(proposalFixture()),
        update: jest.fn().mockResolvedValue({ id: "pp1", status: "REJECTED" }),
      },
      approvalRequest: { findFirst: jest.fn().mockResolvedValue({ id: "ar1" }) },
    });
    const { service, approvals, purchasing } = buildService(prisma);

    const updated = await service.decidePurchaseProposal("t1", "pp1", "u1", "PLANNER", "reject", "uygun değil");

    expect(approvals.reject).toHaveBeenCalledWith("t1", "ar1", "u1", "PLANNER", "uygun değil", prisma, false);
    expect(purchasing.createInTransaction).not.toHaveBeenCalled();
    expect(updated.status).toBe("REJECTED");
  });
});

describe("MrpService.decideProductionProposal", () => {
  it("approve: gerçek WorkOrder'a dönüştürür", async () => {
    const proposal = { id: "prp1", tenantId: "t1", status: "PENDING_APPROVAL", partId: "p1", qty: "10", dueDate: new Date("2026-08-01") };
    const prisma = buildPrismaMock({
      productionProposal: {
        findFirst: jest.fn().mockResolvedValue(proposal),
        update: jest.fn().mockResolvedValue({ id: "prp1", status: "CONVERTED", convertedToId: "wo-new" }),
      },
      approvalRequest: { findFirst: jest.fn().mockResolvedValue({ id: "ar2" }) },
    });
    const { service, workOrders } = buildService(prisma);

    const updated = await service.decideProductionProposal("t1", "prp1", "u1", "PLANNER", "approve");

    expect(workOrders.createInTransaction).toHaveBeenCalledWith(prisma, "t1", {
      partId: "p1",
      quantity: 10,
      dueDate: proposal.dueDate,
      priority: 5,
    });
    expect(updated.status).toBe("CONVERTED");
  });
});

describe("MrpService.capacityReadiness", () => {
  it("atanmamış ve bloke operasyonları finite schedule uydurmadan görünür kılar", async () => {
    const dueDate = new Date("2026-08-15T00:00:00.000Z");
    const prisma = buildPrismaMock({
      machine: { findMany: jest.fn().mockResolvedValue([{ id: "m1", name: "MCV-5500" }]) },
      workOrderOperation: {
        findMany: jest.fn().mockResolvedValue([
          { id: "op1", name: "Kaba işleme", seq: 10, status: "PENDING", machineId: "m1", workOrder: { id: "wo1", woNo: "WO-1", dueDate, priority: 4 } },
          { id: "op2", name: "Final kontrol", seq: 20, status: "BLOCKED", machineId: null, workOrder: { id: "wo1", woNo: "WO-1", dueDate, priority: 4 } },
        ]),
      },
    });
    const { service } = buildService(prisma);

    const result = await service.capacityReadiness("t1");

    expect(result.readyForFiniteScheduling).toBe(false);
    expect(result.summary).toMatchObject({ activeOperationCount: 2, assignedOperationCount: 1, unassignedOperationCount: 1, blockedOperationCount: 1 });
    expect(result.machines[0]).toMatchObject({ id: "m1", operationCount: 1, workOrderCount: 1 });
    expect(result.unassignedOperations[0]).toMatchObject({ id: "op2", status: "BLOCKED" });
  });
});
