import { InvoiceService } from "./invoice.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    invoice: { findFirst: jest.fn() },
    $transaction: jest.fn(),
    ...overrides,
  };
  const outbox = { record: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new InvoiceService(prisma as any, outbox as any);
  return { service, prisma, outbox };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function soFixture(overrides: any = {}) {
  return {
    id: "so1",
    lines: [
      {
        id: "sol1",
        partId: "p1",
        unitPrice: "25",
        shippedQty: "8",
        invoicedQty: "2",
        part: { id: "p1", partNo: "P-1" },
      },
    ],
    ...overrides,
  };
}

function buildTx(overrides: Record<string, unknown> = {}) {
  return {
    salesOrder: { findFirst: jest.fn().mockResolvedValue(soFixture()) },
    invoice: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "inv1", invNo: "FAT-2026-0001" }),
      update: jest.fn().mockResolvedValue({ id: "inv1", status: "CANCELLED" }),
    },
    salesOrderLine: { update: jest.fn().mockResolvedValue({}) },
    ...overrides,
  };
}

describe("InvoiceService.create", () => {
  it("faturalanabilir miktarı aşan istek reddedilir", async () => {
    const tx = buildTx();
    const { service } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });

    await expect(
      service.create("t1", "u1", { salesOrderId: "so1", lines: [{ salesOrderLineId: "sol1", qty: 7 }] }),
    ).rejects.toThrow();
    expect(tx.invoice.create).not.toHaveBeenCalled();
  });

  it("başarılı fatura: SalesOrderLine.unitPrice kopyalanır, invoicedQty artar", async () => {
    const tx = buildTx();
    const { service } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });

    const result = await service.create("t1", "u1", {
      salesOrderId: "so1",
      lines: [{ salesOrderLineId: "sol1", qty: 4 }],
    });

    expect(tx.invoice.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lines: { create: [expect.objectContaining({ salesOrderLineId: "sol1", qty: 4, unitPrice: "25" })] },
        }),
      }),
    );
    expect(tx.salesOrderLine.update).toHaveBeenCalledWith({
      where: { id: "sol1" },
      data: { invoicedQty: { increment: 4 } },
    });
    expect(result.id).toBe("inv1");
  });
});

describe("InvoiceService.cancel", () => {
  it("ISSUED olmayan fatura iptal edilemez", async () => {
    const { service, prisma } = buildService();
    prisma.invoice.findFirst.mockResolvedValue({ id: "inv1", status: "CANCELLED", lines: [] });

    await expect(service.cancel("t1", "inv1")).rejects.toThrow();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("iptalde invoicedQty geri düşer", async () => {
    const tx = buildTx();
    const { service, prisma } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });
    prisma.invoice.findFirst.mockResolvedValue({
      id: "inv1",
      status: "ISSUED",
      salesOrderId: "so1",
      lines: [{ salesOrderLineId: "sol1", qty: 4 }],
    });

    const updated = await service.cancel("t1", "inv1");

    expect(tx.salesOrderLine.update).toHaveBeenCalledWith({
      where: { id: "sol1" },
      data: { invoicedQty: { decrement: 4 } },
    });
    expect(updated.status).toBe("CANCELLED");
  });
});
