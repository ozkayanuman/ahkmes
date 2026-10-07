import { BadRequestException, ConflictException } from "@nestjs/common";
import { GlService } from "./gl.service";

jest.mock("../common/numbering", () => ({ nextDocNo: jest.fn().mockResolvedValue("YEV-2026-0001") }));

const ACCOUNTS = {
  "acc-120": { id: "acc-120", code: "120", name: "Alıcılar", type: "ASSET", isActive: true, postingAllowed: true },
  "acc-600": { id: "acc-600", code: "600", name: "Yurtiçi Satışlar", type: "REVENUE", isActive: true, postingAllowed: true },
  "acc-102": { id: "acc-102", code: "102", name: "Bankalar", type: "ASSET", isActive: true, postingAllowed: true },
  "acc-1": { id: "acc-1", code: "1", name: "Dönen Varlıklar", type: "ASSET", isActive: true, postingAllowed: false },
  "acc-off": { id: "acc-off", code: "999", name: "Pasif", type: "ASSET", isActive: false, postingAllowed: true },
} as const;

function build() {
  const tx: any = {
    glAccount: { findMany: jest.fn().mockImplementation(({ where }: any) => Promise.resolve(where.id.in.map((id: string) => (ACCOUNTS as any)[id]).filter(Boolean))) },
    fiscalPeriod: { upsert: jest.fn().mockResolvedValue({ status: "OPEN" }) },
    journalEntry: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
  };
  const prisma: any = {
    $transaction: jest.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
    glAccount: { findMany: jest.fn(), findFirst: jest.fn() },
    glPostingAccount: { findMany: jest.fn() },
    journalEntry: { findMany: jest.fn(), findFirst: jest.fn(), count: jest.fn() },
    journalLine: { groupBy: jest.fn() },
    invoice: { findMany: jest.fn().mockResolvedValue([]) },
    supplierInvoice: { findMany: jest.fn().mockResolvedValue([]) },
    customerPayment: { findMany: jest.fn().mockResolvedValue([]) },
    supplierPayment: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { service: new GlService(prisma), prisma, tx };
}

describe("GlService — yevmiye doğrulama ve kayıt", () => {
  it("dengeli, yaprak ve aktif hesaplara yazılan taslak yevmiyeyi oluşturur", async () => {
    const { service, tx } = build();
    tx.journalEntry.create.mockResolvedValue({ id: "je-1", jeNo: "YEV-2026-0001", status: "DRAFT" });

    const result = await service.createEntry("t1", "u1", {
      entryDate: new Date("2026-10-07T00:00:00Z"),
      description: "Açılış",
      lines: [
        { accountId: "acc-120", debit: 100, credit: 0 },
        { accountId: "acc-600", debit: 0, credit: 100 },
      ],
    });

    expect(result).toMatchObject({ id: "je-1", status: "DRAFT" });
    expect(tx.journalEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "DRAFT", sourceType: "MANUAL", lines: { create: [expect.objectContaining({ lineNo: 1, debit: 100, credit: 0 }), expect.objectContaining({ lineNo: 2, debit: 0, credit: 100 })] } }),
    }));
  });

  it("borç/alacak eşit değilse, ana hesaba ya da pasif hesaba yazılıyorsa reddeder", async () => {
    const { service } = build();
    const base = { entryDate: new Date("2026-10-07T00:00:00Z"), description: "x" };

    await expect(service.createEntry("t1", "u1", { ...base, lines: [{ accountId: "acc-120", debit: 100, credit: 0 }, { accountId: "acc-600", debit: 0, credit: 90 }] })).rejects.toThrow(BadRequestException);
    await expect(service.createEntry("t1", "u1", { ...base, lines: [{ accountId: "acc-1", debit: 100, credit: 0 }, { accountId: "acc-600", debit: 0, credit: 100 }] })).rejects.toThrow(/Ana hesaba/);
    await expect(service.createEntry("t1", "u1", { ...base, lines: [{ accountId: "acc-off", debit: 100, credit: 0 }, { accountId: "acc-600", debit: 0, credit: 100 }] })).rejects.toThrow(/Pasif hesaba/);
  });

  it("kayıt (post) kapalı dönemde reddedilir, açık dönemde POSTED olur", async () => {
    const { service, tx } = build();
    tx.journalEntry.findFirst.mockResolvedValue({ id: "je-1", status: "DRAFT", entryDate: new Date("2026-09-15T00:00:00Z"), lines: [{ accountId: "acc-120", debit: 50, credit: 0 }, { accountId: "acc-600", debit: 0, credit: 50 }] });
    tx.fiscalPeriod.upsert.mockResolvedValueOnce({ status: "CLOSED" });

    await expect(service.postEntry("t1", "u1", "je-1")).rejects.toThrow(ConflictException);
    expect(tx.fiscalPeriod.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId_year_month: { tenantId: "t1", year: 2026, month: 9 } } }));

    tx.journalEntry.update.mockResolvedValue({ id: "je-1", status: "POSTED" });
    const posted = await service.postEntry("t1", "u1", "je-1");
    expect(posted.status).toBe("POSTED");
    expect(tx.journalEntry.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "POSTED", postedById: "u1" }) }));
  });

  it("ters kayıt: satırlar aynalanır, yeni kayıt POSTED, orijinal REVERSED olur; taslak ters kayıt alınamaz", async () => {
    const { service, tx } = build();
    tx.journalEntry.findFirst.mockResolvedValue({
      id: "je-1", jeNo: "YEV-2026-0001", description: "Satış", status: "POSTED", sourceType: "MANUAL",
      lines: [{ accountId: "acc-120", lineNo: 1, debit: 100, credit: 0, description: null }, { accountId: "acc-600", lineNo: 2, debit: 0, credit: 100, description: null }],
    });
    tx.journalEntry.create.mockResolvedValue({ id: "je-2", status: "POSTED" });

    await service.reverseEntry("t1", "u1", "je-1");

    expect(tx.journalEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "POSTED", reversalOfId: "je-1", sourceId: null, lines: { create: [expect.objectContaining({ debit: 0, credit: 100 }), expect.objectContaining({ debit: 100, credit: 0 })] } }),
    }));
    expect(tx.journalEntry.update).toHaveBeenCalledWith({ where: { id: "je-1" }, data: { status: "REVERSED" } });

    tx.journalEntry.findFirst.mockResolvedValue({ id: "je-3", status: "DRAFT", lines: [] });
    await expect(service.reverseEntry("t1", "u1", "je-3")).rejects.toThrow(ConflictException);
  });
});

describe("GlService — mizan", () => {
  it("açılış bakiyesi + dönem hareketleri = kapanış; hareketsiz hesaplar listelenmez; toplamlar tutar", async () => {
    const { service, prisma } = build();
    prisma.glAccount.findMany.mockResolvedValue([ACCOUNTS["acc-120"], ACCOUNTS["acc-600"], ACCOUNTS["acc-102"]]);
    prisma.journalLine.groupBy
      .mockResolvedValueOnce([{ accountId: "acc-120", _sum: { debit: 500, credit: 200 } }])
      .mockResolvedValueOnce([
        { accountId: "acc-120", _sum: { debit: 100, credit: 0 } },
        { accountId: "acc-600", _sum: { debit: 0, credit: 100 } },
      ]);

    const tb = await service.trialBalance("t1", new Date("2026-10-01T00:00:00Z"), new Date("2026-10-31T00:00:00Z"));

    expect(tb.rows).toEqual([
      expect.objectContaining({ code: "120", openingBalance: 300, periodDebit: 100, periodCredit: 0, closingBalance: 400 }),
      expect.objectContaining({ code: "600", openingBalance: 0, periodDebit: 0, periodCredit: 100, closingBalance: -100 }),
    ]);
    expect(tb.totals).toEqual({ openingBalance: 300, periodDebit: 100, periodCredit: 100, closingBalance: 300 });
  });
});

describe("GlService — alt defter senkronu", () => {
  it("eşleme eksikse atlar ve nedenini raporlar; eşleme varsa faturayı Dr 120 / Cr 600 olarak kaydeder; iptal edilmiş faturayı bir kez ters kaydeder", async () => {
    const { service, prisma, tx } = build();
    prisma.journalEntry.findMany.mockResolvedValue([]);
    prisma.invoice.findMany.mockResolvedValue([
      { id: "inv-1", invNo: "FAT-2026-0001", status: "ISSUED", issuedDate: new Date("2026-10-05T00:00:00Z"), lines: [{ qty: 2, unitPrice: 150 }] },
    ]);

    prisma.glPostingAccount.findMany.mockResolvedValueOnce([]);
    const noMap = await service.syncSubledgers("t1", "u1");
    expect(noMap.posted).toEqual([]);
    expect(noMap.skipped).toEqual([{ sourceType: "CUSTOMER_INVOICE", sourceId: "inv-1", docNo: "FAT-2026-0001", reason: "MAPPING_MISSING" }]);

    prisma.glPostingAccount.findMany.mockResolvedValue([{ key: "AR_RECEIVABLE", accountId: "acc-120" }, { key: "SALES_REVENUE", accountId: "acc-600" }]);
    tx.journalEntry.create.mockResolvedValue({ id: "je-1", jeNo: "YEV-2026-0001", status: "POSTED" });
    const posted = await service.syncSubledgers("t1", "u1");
    expect(posted.posted).toEqual([{ sourceType: "CUSTOMER_INVOICE", sourceId: "inv-1", docNo: "FAT-2026-0001", jeNo: "YEV-2026-0001" }]);
    expect(tx.journalEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        sourceType: "CUSTOMER_INVOICE", sourceId: "inv-1", status: "POSTED",
        lines: { create: [{ tenantId: "t1", accountId: "acc-120", lineNo: 1, debit: 300, credit: 0 }, { tenantId: "t1", accountId: "acc-600", lineNo: 2, debit: 0, credit: 300 }] },
      }),
    }));

    // Second sync after cancellation: the existing POSTED entry is reversed exactly once.
    prisma.journalEntry.findMany.mockResolvedValue([{ id: "je-1", jeNo: "YEV-2026-0001", sourceType: "CUSTOMER_INVOICE", sourceId: "inv-1", status: "POSTED" }]);
    prisma.invoice.findMany.mockResolvedValue([{ id: "inv-1", invNo: "FAT-2026-0001", status: "CANCELLED", issuedDate: new Date("2026-10-05T00:00:00Z"), lines: [{ qty: 2, unitPrice: 150 }] }]);
    tx.journalEntry.findFirst.mockResolvedValue({ id: "je-1", jeNo: "YEV-2026-0001", description: "Müşteri faturası FAT-2026-0001", status: "POSTED", sourceType: "CUSTOMER_INVOICE", lines: [{ accountId: "acc-120", lineNo: 1, debit: 300, credit: 0, description: null }, { accountId: "acc-600", lineNo: 2, debit: 0, credit: 300, description: null }] });
    tx.journalEntry.create.mockResolvedValue({ id: "je-2", jeNo: "YEV-2026-0002", status: "POSTED" });
    const reversed = await service.syncSubledgers("t1", "u1");
    expect(reversed.reversed).toEqual([{ sourceType: "CUSTOMER_INVOICE", sourceId: "inv-1", docNo: "FAT-2026-0001", jeNo: "YEV-2026-0002" }]);
    expect(reversed.posted).toEqual([]);

    // Third sync: already REVERSED → nothing happens.
    prisma.journalEntry.findMany.mockResolvedValue([{ id: "je-1", jeNo: "YEV-2026-0001", sourceType: "CUSTOMER_INVOICE", sourceId: "inv-1", status: "REVERSED" }]);
    tx.journalEntry.create.mockClear();
    const idle = await service.syncSubledgers("t1", "u1");
    expect(idle).toEqual({ posted: [], reversed: [], skipped: [] });
    expect(tx.journalEntry.create).not.toHaveBeenCalled();
  });

  it("ödemeler banka ↔ alıcı/satıcı hesaplarına yazılır ve kapalı dönem PERIOD_CLOSED olarak raporlanır", async () => {
    const { service, prisma, tx } = build();
    prisma.journalEntry.findMany.mockResolvedValue([]);
    prisma.glPostingAccount.findMany.mockResolvedValue([
      { key: "AR_RECEIVABLE", accountId: "acc-120" }, { key: "AP_PAYABLE", accountId: "acc-320" }, { key: "BANK", accountId: "acc-102" },
    ]);
    prisma.customerPayment.findMany.mockResolvedValue([{ id: "cp-1", cpNo: "TAH-2026-0001", amount: 75, paymentDate: new Date("2026-10-06T00:00:00Z") }]);
    prisma.supplierPayment.findMany.mockResolvedValue([{ id: "sp-1", spNo: "ODE-2026-0001", amount: 40, paymentDate: new Date("2026-08-06T00:00:00Z") }]);
    tx.fiscalPeriod.upsert.mockImplementation(({ where }: any) => Promise.resolve({ status: where.tenantId_year_month.month === 8 ? "CLOSED" : "OPEN" }));
    tx.journalEntry.create.mockResolvedValue({ id: "je-9", jeNo: "YEV-2026-0009", status: "POSTED" });

    const result = await service.syncSubledgers("t1", "u1");

    expect(result.posted).toEqual([{ sourceType: "CUSTOMER_PAYMENT", sourceId: "cp-1", docNo: "TAH-2026-0001", jeNo: "YEV-2026-0009" }]);
    expect(tx.journalEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lines: { create: [expect.objectContaining({ accountId: "acc-102", debit: 75 }), expect.objectContaining({ accountId: "acc-120", credit: 75 })] } }),
    }));
    expect(result.skipped).toEqual([{ sourceType: "SUPPLIER_PAYMENT", sourceId: "sp-1", docNo: "ODE-2026-0001", reason: "PERIOD_CLOSED" }]);
  });
});
