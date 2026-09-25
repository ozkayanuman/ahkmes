import { ArService } from "./ar.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    customer: { findFirst: jest.fn().mockResolvedValue({ id: "c1" }) },
    invoice: { findFirst: jest.fn(), findMany: jest.fn() },
    customerPayment: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    $executeRaw: jest.fn().mockResolvedValue(0),
    $queryRawUnsafe: jest.fn().mockResolvedValue([]),
    ...overrides,
  };
  prisma.$transaction = jest.fn((cb: any) => cb(prisma));
  const outbox = { record: jest.fn() };
  const service = new ArService(prisma as any, outbox as any);
  return { service, prisma, outbox };
}

describe("ArService.createPayment", () => {
  it("fatura bakiyesini aşan tahsis reddedilir", async () => {
    const { service, prisma } = buildService();
    prisma.invoice.findFirst.mockResolvedValue({
      id: "inv1",
      invNo: "FAT-2026-0001",
      status: "ISSUED",
      lines: [{ qty: "2", unitPrice: "10" }],
      allocations: [],
    });

    await expect(
      service.createPayment("t1", "u1", { customerId: "c1", allocations: [{ invoiceId: "inv1", amount: 25 }] }),
    ).rejects.toThrow();
  });

  it("geçerli tahsis ödeme oluşturur, amount tahsis toplamıdır", async () => {
    const { service, prisma } = buildService();
    prisma.invoice.findFirst.mockResolvedValue({
      id: "inv1",
      invNo: "FAT-2026-0001",
      status: "ISSUED",
      lines: [{ qty: "2", unitPrice: "10" }],
      allocations: [],
    });
    prisma.customerPayment.create.mockResolvedValue({ id: "cp1", amount: 15 });

    await service.createPayment("t1", "u1", { customerId: "c1", allocations: [{ invoiceId: "inv1", amount: 15 }] });

    expect(prisma.customerPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 15 }) }),
    );
  });
});

describe("ArService bank reconciliation", () => {
  it("marks an unreconciled payment reconciled with the given bank reference", async () => {
    const { service, prisma } = buildService({
      customerPayment: { findFirst: jest.fn().mockResolvedValue({ id: "cp1", isReconciled: false }), update: jest.fn().mockResolvedValue({ id: "cp1", isReconciled: true }) },
    });

    await service.reconcilePayment("t1", "u1", "cp1", { bankReference: "EKSTRE-2026-09-001" });

    expect(prisma.customerPayment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "cp1" },
      data: expect.objectContaining({ isReconciled: true, reconciledById: "u1", bankReference: "EKSTRE-2026-09-001" }),
    }));
  });

  it("rejects reconciling an already-reconciled payment", async () => {
    const { service } = buildService({
      customerPayment: { findFirst: jest.fn().mockResolvedValue({ id: "cp1", isReconciled: true }) },
    });

    await expect(service.reconcilePayment("t1", "u1", "cp1", { bankReference: "X" })).rejects.toThrow();
  });

  it("unreconciles a payment, clearing the bank reference", async () => {
    const { service, prisma } = buildService({
      customerPayment: { findFirst: jest.fn().mockResolvedValue({ id: "cp1", isReconciled: true }), update: jest.fn().mockResolvedValue({ id: "cp1", isReconciled: false }) },
    });

    await service.unreconcilePayment("t1", "cp1");

    expect(prisma.customerPayment.update).toHaveBeenCalledWith(expect.objectContaining({
      data: { isReconciled: false, reconciledAt: null, reconciledById: null, bankReference: null },
    }));
  });
});

describe("ArService.summary", () => {
  it("müşteri bazında açık bakiyeyi azalan sırada döner", async () => {
    const { service, prisma } = buildService();
    prisma.invoice.findMany.mockResolvedValue([
      {
        lines: [{ qty: "2", unitPrice: "10" }],
        allocations: [{ amount: "5" }],
        salesOrder: { customerId: "c1", customer: { name: "Müşteri A" } },
      },
      {
        lines: [{ qty: "1", unitPrice: "100" }],
        allocations: [],
        salesOrder: { customerId: "c2", customer: { name: "Müşteri B" } },
      },
    ]);

    const result = await service.summary("t1");

    expect(result[0]).toEqual({ customerId: "c2", customerName: "Müşteri B", outstanding: 100 });
    expect(result[1]).toEqual({ customerId: "c1", customerName: "Müşteri A", outstanding: 15 });
  });
});
