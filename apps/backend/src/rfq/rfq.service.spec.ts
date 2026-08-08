import { RfqService } from "./rfq.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    rFQ: { findFirst: jest.fn(), update: jest.fn(), create: jest.fn(), delete: jest.fn() },
    rFQLine: { create: jest.fn(), update: jest.fn(), delete: jest.fn() },
    customer: { findFirst: jest.fn().mockResolvedValue({ id: "c1" }) },
    $transaction: jest.fn(),
    ...overrides,
  };
  const outbox = { record: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new RfqService(prisma as any, outbox as any);
  return { service, prisma, outbox };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rfqFixture(overrides: any = {}) {
  return {
    id: "r1",
    rfqNo: "TAL-2026-0001",
    status: "SENT",
    customerId: "c1",
    lines: [{ id: "l1", part: { id: "p1" }, quantity: "5", dueDate: new Date("2026-08-01") }],
    ...overrides,
  };
}

describe("RfqService.convert", () => {
  it("SENT değilse hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.rFQ.findFirst.mockResolvedValue(rfqFixture({ status: "DRAFT" }));

    await expect(service.convert("t1", "r1", "u1", {})).rejects.toThrow();
  });

  it("Quote üretir ve RFQ'yu CONVERTED yapar", async () => {
    const tx = {
      quote: {
        create: jest.fn().mockResolvedValue({ id: "q1" }),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      rFQ: { update: jest.fn().mockResolvedValue({}) },
    };
    const { service, prisma, outbox } = buildService({ $transaction: jest.fn((cb) => cb(tx)) });
    prisma.rFQ.findFirst.mockResolvedValue(rfqFixture());

    const result = await service.convert("t1", "r1", "u1", {});

    expect(tx.quote.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          customerId: "c1",
          lines: { create: [expect.objectContaining({ partId: "p1", quantity: "5" })] },
        }),
      }),
    );
    expect(tx.rFQ.update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { status: "CONVERTED" } });
    expect(result.quote.id).toBe("q1");
    expect(outbox.record).toHaveBeenCalledWith(tx, "t1", "rfq", "r1", "rfq.updated", { id: "r1", status: "CONVERTED" });
  });

  it("dönüştürülecek satır seçilmezse (lineIds boş kesişim) hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.rFQ.findFirst.mockResolvedValue(rfqFixture());

    await expect(service.convert("t1", "r1", "u1", { lineIds: ["nonexistent"] })).rejects.toThrow();
  });
});
