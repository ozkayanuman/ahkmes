import { ApService } from "./ap.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma: any = {
    purchaseOrder: { findFirst: jest.fn() },
    purchaseOrderLine: { update: jest.fn() },
    supplierInvoice: { findFirst: jest.fn(), findMany: jest.fn(), create: jest.fn(), update: jest.fn() },
    supplier: { findFirst: jest.fn().mockResolvedValue({ id: "s1" }) },
    supplierPayment: { create: jest.fn(), findFirst: jest.fn().mockResolvedValue(null) },
    ...overrides,
  };
  prisma.$transaction = jest.fn((cb: any) => cb(prisma));
  const realtime = { emitToTenant: jest.fn() };
  const service = new ApService(prisma as any, realtime as any);
  return { service, prisma, realtime };
}

describe("ApService.createInvoice", () => {
  it("faturalanabilir miktar aşılırsa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: "po1",
      supplierId: "s1",
      lines: [{ id: "l1", receivedQty: "5", invoicedQty: "3", material: { code: "M1" } }],
    });

    await expect(
      service.createInvoice("t1", "u1", {
        purchaseOrderId: "po1",
        lines: [{ purchaseOrderLineId: "l1", qty: 5 }],
      }),
    ).rejects.toThrow();
  });

  it("geçerli miktarda fatura oluşturur ve invoicedQty artırır", async () => {
    const { service, prisma } = buildService();
    prisma.purchaseOrder.findFirst.mockResolvedValue({
      id: "po1",
      supplierId: "s1",
      lines: [{ id: "l1", receivedQty: "5", invoicedQty: "2", unitPrice: "10", material: { code: "M1" } }],
    });
    prisma.supplierInvoice.create.mockResolvedValue({ id: "si1" });

    await service.createInvoice("t1", "u1", {
      purchaseOrderId: "po1",
      lines: [{ purchaseOrderLineId: "l1", qty: 3 }],
    });

    expect(prisma.purchaseOrderLine.update).toHaveBeenCalledWith({
      where: { id: "l1" },
      data: { invoicedQty: { increment: 3 } },
    });
  });
});

describe("ApService.createPayment", () => {
  it("fatura bakiyesini aşan tahsis reddedilir", async () => {
    const { service, prisma } = buildService();
    prisma.supplierInvoice.findFirst.mockResolvedValue({
      id: "si1",
      sinNo: "TF-2026-0001",
      status: "ISSUED",
      lines: [{ qty: "2", unitPrice: "10" }],
      allocations: [],
    });

    await expect(
      service.createPayment("t1", "u1", {
        supplierId: "s1",
        allocations: [{ supplierInvoiceId: "si1", amount: 25 }],
      }),
    ).rejects.toThrow();
  });

  it("geçerli tahsis ödeme oluşturur, amount tahsis toplamıdır", async () => {
    const { service, prisma } = buildService();
    prisma.supplierInvoice.findFirst.mockResolvedValue({
      id: "si1",
      sinNo: "TF-2026-0001",
      status: "ISSUED",
      lines: [{ qty: "2", unitPrice: "10" }],
      allocations: [],
    });
    prisma.supplierPayment.create.mockResolvedValue({ id: "sp1", amount: 15 });

    await service.createPayment("t1", "u1", {
      supplierId: "s1",
      allocations: [{ supplierInvoiceId: "si1", amount: 15 }],
    });

    expect(prisma.supplierPayment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ amount: 15 }) }),
    );
  });
});

describe("ApService.summary", () => {
  it("tedarikçi bazında açık bakiyeyi azalan sırada döner", async () => {
    const { service, prisma } = buildService();
    prisma.supplierInvoice.findMany.mockResolvedValue([
      {
        supplierId: "s1",
        supplier: { name: "Tedarikçi A" },
        lines: [{ qty: "2", unitPrice: "10" }],
        allocations: [{ amount: "5" }],
      },
      {
        supplierId: "s2",
        supplier: { name: "Tedarikçi B" },
        lines: [{ qty: "1", unitPrice: "100" }],
        allocations: [],
      },
    ]);

    const result = await service.summary("t1");

    expect(result[0]).toEqual({ supplierId: "s2", supplierName: "Tedarikçi B", outstanding: 100 });
    expect(result[1]).toEqual({ supplierId: "s1", supplierName: "Tedarikçi A", outstanding: 15 });
  });
});
