import { QuotesService } from "./quotes.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    quote: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn(), delete: jest.fn() },
    customer: { findFirst: jest.fn() },
    quoteLine: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn(),
    ...overrides,
  };
  const outbox = { record: jest.fn() };
  const salesOrders = { createFromQuote: jest.fn().mockResolvedValue({ id: "so1", soNo: "SIP-2026-0001" }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new QuotesService(prisma as any, salesOrders as any, outbox as any);
  return { service, prisma, outbox, salesOrders };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function quoteFixture(overrides: any = {}) {
  return {
    id: "q1",
    quoteNo: "TKF-2026-0001",
    status: "APPROVED",
    customerId: "c1",
    currency: "TRY",
    lines: [
      {
        id: "l1",
        part: { id: "p1" },
        quantity: "10",
        unitPrice: "5",
        dueDate: new Date("2026-08-01"),
        workOrders: [],
        salesOrderLines: [],
      },
    ],
    ...overrides,
  };
}

describe("QuotesService.convert", () => {
  it("APPROVED değilse hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.quote.findFirst.mockResolvedValue(quoteFixture({ status: "DRAFT" }));

    await expect(service.convert("t1", "q1", "u1", {})).rejects.toThrow();
  });

  it("SalesOrder üretir ve zaten dönüştürülmüş satırları skippedLineIds'e koyar", async () => {
    const { service, prisma, salesOrders } = buildService();
    prisma.quote.findFirst.mockResolvedValue(
      quoteFixture({
        lines: [
          {
            id: "l1",
            part: { id: "p1" },
            quantity: "10",
            unitPrice: "5",
            dueDate: new Date("2026-08-01"),
            workOrders: [],
            salesOrderLines: [],
          },
          {
            id: "l2",
            part: { id: "p2" },
            quantity: "3",
            unitPrice: "2",
            dueDate: new Date("2026-08-02"),
            workOrders: [],
            salesOrderLines: [{ id: "sol-existing" }],
          },
        ],
      }),
    );

    const result = await service.convert("t1", "q1", "u1", {});

    expect(salesOrders.createFromQuote).toHaveBeenCalledWith(
      "t1",
      "u1",
      expect.objectContaining({ id: "q1", customerId: "c1", currency: "TRY" }),
      [expect.objectContaining({ id: "l1" })],
    );
    expect(result.salesOrder.id).toBe("so1");
    expect(result.skippedLineIds).toEqual(["l2"]);
  });

  it("tüm satırlar zaten dönüştürülmüşse hata fırlatır ve SalesOrder üretilmez", async () => {
    const { service, prisma, salesOrders } = buildService();
    prisma.quote.findFirst.mockResolvedValue(
      quoteFixture({
        lines: [
          {
            id: "l1",
            part: { id: "p1" },
            quantity: "10",
            unitPrice: "5",
            dueDate: new Date(),
            workOrders: [],
            salesOrderLines: [{ id: "sol-existing" }],
          },
        ],
      }),
    );

    await expect(service.convert("t1", "q1", "u1", {})).rejects.toThrow();
    expect(salesOrders.createFromQuote).not.toHaveBeenCalled();
  });
});
