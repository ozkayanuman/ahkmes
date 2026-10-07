import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

/**
 * Faz G+ General Ledger (e2e): hesap planı seed'i, taslak→kayıt→ters kayıt,
 * dönem kapanışı, mizan ve AR tahsilatından otomatik alt defter kaydı —
 * gerçek PostgreSQL üzerinde, (tenantId, sourceType, sourceId) tekilliği dahil.
 */
describe("GL — genel muhasebe (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let tenantId: string;
  let customerId: string;
  let paymentId: string;
  const createdEntryIds: string[] = [];

  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${adminToken}`);
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    adminToken = (await api().post("/auth/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).body.accessToken;
    tenantId = (await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } })).tenantId;
    customerId = (await auth(api().post("/customers").send({ name: `GL Müşteri ${STAMP}` })).expect(201)).body.id;
  });

  afterAll(async () => {
    await prisma.journalEntry.deleteMany({ where: { tenantId, OR: [{ id: { in: createdEntryIds } }, { sourceType: "CUSTOMER_PAYMENT", sourceId: paymentId }, { reversalOfId: { in: createdEntryIds } }] } }).catch(() => undefined);
    await prisma.customerPaymentAllocation.deleteMany({ where: { customerPaymentId: paymentId } }).catch(() => undefined);
    await prisma.customerPayment.deleteMany({ where: { id: paymentId } }).catch(() => undefined);
    await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => undefined);
    await prisma.fiscalPeriod.deleteMany({ where: { tenantId, year: 2031 } }).catch(() => undefined);
    await app.close();
  });

  let acc120: string;
  let acc600: string;
  let acc102: string;

  it("varsayılan hesap planı idempotent seed edilir ve eşleme tablosu dolar", async () => {
    const first = await auth(api().post("/gl/accounts/seed-default")).expect(201);
    expect(first.body.createdAccounts).toBeGreaterThanOrEqual(0);
    const second = await auth(api().post("/gl/accounts/seed-default")).expect(201);
    expect(second.body).toEqual({ createdAccounts: 0, mappedKeys: 0 });

    const accounts = await auth(api().get("/gl/accounts")).expect(200);
    const byCode = new Map(accounts.body.map((a: { code: string; id: string }) => [a.code, a.id]));
    acc120 = byCode.get("120") as string;
    acc600 = byCode.get("600") as string;
    acc102 = byCode.get("102") as string;
    expect(acc120 && acc600 && acc102).toBeTruthy();

    const mapping = await auth(api().get("/gl/posting-accounts")).expect(200);
    expect(mapping.body.map((m: { key: string }) => m.key).sort()).toEqual(["AP_PAYABLE", "AR_RECEIVABLE", "BANK", "PURCHASE_EXPENSE", "SALES_REVENUE"]);
  });

  it("dengesiz yevmiye 400, dengeli yevmiye taslak oluşur, kayıt edilir ve mizanda görünür", async () => {
    await auth(api().post("/gl/entries").send({
      entryDate: "2031-03-10T00:00:00.000Z", description: "Dengesiz",
      lines: [{ accountId: acc120, debit: 100, credit: 0 }, { accountId: acc600, debit: 0, credit: 90 }],
    })).expect(400);

    const draft = await auth(api().post("/gl/entries").send({
      entryDate: "2031-03-10T00:00:00.000Z", description: "Manuel satış kaydı",
      lines: [{ accountId: acc120, debit: 1000, credit: 0 }, { accountId: acc600, debit: 0, credit: 1000 }],
    })).expect(201);
    createdEntryIds.push(draft.body.id);
    expect(draft.body.status).toBe("DRAFT");
    expect(draft.body.jeNo).toMatch(/^YEV-\d{4}-\d{4}$/);

    const posted = await auth(api().post(`/gl/entries/${draft.body.id}/post`)).expect(201);
    expect(posted.body.status).toBe("POSTED");
    await auth(api().post(`/gl/entries/${draft.body.id}/post`)).expect(409);

    const tb = await auth(api().get("/gl/trial-balance?from=2031-03-01T00:00:00.000Z&to=2031-03-31T23:59:59.000Z")).expect(200);
    const row120 = tb.body.rows.find((r: { code: string }) => r.code === "120");
    const row600 = tb.body.rows.find((r: { code: string }) => r.code === "600");
    expect(row120).toMatchObject({ periodDebit: 1000, closingBalance: 1000 });
    expect(row600).toMatchObject({ periodCredit: 1000, closingBalance: -1000 });
    expect(tb.body.totals.periodDebit).toBe(tb.body.totals.periodCredit);

    const ledger = await auth(api().get(`/gl/accounts/${acc120}/ledger?from=2031-03-01T00:00:00.000Z&to=2031-03-31T23:59:59.000Z`)).expect(200);
    expect(ledger.body.rows.map((r: { balance: number }) => r.balance)).toEqual([1000]);
  });

  it("ters kayıt orijinali REVERSED yapar ve mizanı sıfırlar; kapalı döneme kayıt 409 döner", async () => {
    const original = createdEntryIds[0];
    const reversal = await auth(api().post(`/gl/entries/${original}/reverse`).send({ entryDate: "2031-03-12T00:00:00.000Z" })).expect(201);
    createdEntryIds.push(reversal.body.id);
    expect(reversal.body.reversalOf.id).toBe(original);
    expect((await auth(api().get(`/gl/entries/${original}`)).expect(200)).body.status).toBe("REVERSED");

    const tb = await auth(api().get("/gl/trial-balance?from=2031-03-01T00:00:00.000Z&to=2031-03-31T23:59:59.000Z")).expect(200);
    expect(tb.body.rows.find((r: { code: string }) => r.code === "120")).toMatchObject({ periodDebit: 1000, periodCredit: 1000, closingBalance: 0 });

    await auth(api().post("/gl/periods/close").send({ year: 2031, month: 3 })).expect(201);
    const late = await auth(api().post("/gl/entries").send({
      entryDate: "2031-03-20T00:00:00.000Z", description: "Kapalı döneme",
      lines: [{ accountId: acc120, debit: 5, credit: 0 }, { accountId: acc600, debit: 0, credit: 5 }],
    })).expect(201);
    createdEntryIds.push(late.body.id);
    await auth(api().post(`/gl/entries/${late.body.id}/post`)).expect(409);
    await auth(api().post("/gl/periods/reopen").send({ year: 2031, month: 3 })).expect(201);
    await auth(api().post(`/gl/entries/${late.body.id}/post`)).expect(201);
  });

  it("alt defter senkronu müşteri tahsilatını Dr 102 / Cr 120 olarak bir kez kaydeder; tekrar senkron çoğaltmaz", async () => {
    const admin = await prisma.user.findFirstOrThrow({ where: { email: ADMIN_EMAIL } });
    const payment = await prisma.customerPayment.create({
      data: { tenantId, cpNo: `GL-TAH-${STAMP}`, customerId, amount: 250, paymentDate: new Date("2031-04-02T00:00:00.000Z"), createdById: admin.id },
    });
    paymentId = payment.id;

    const sync = await auth(api().post("/gl/sync")).expect(201);
    expect(sync.body.posted.find((p: { sourceId: string }) => p.sourceId === paymentId)).toMatchObject({ sourceType: "CUSTOMER_PAYMENT", docNo: `GL-TAH-${STAMP}` });

    const entries = await auth(api().get("/gl/entries?sourceType=CUSTOMER_PAYMENT")).expect(200);
    const je = entries.body.find((e: { sourceId: string }) => e.sourceId === paymentId);
    expect(je.status).toBe("POSTED");
    expect(je.lines.map((l: { account: { code: string }; debit: string; credit: string }) => [l.account.code, Number(l.debit), Number(l.credit)])).toEqual([["102", 250, 0], ["120", 0, 250]]);

    const again = await auth(api().post("/gl/sync")).expect(201);
    expect(again.body.posted.find((p: { sourceId: string }) => p.sourceId === paymentId)).toBeUndefined();
    expect(await prisma.journalEntry.count({ where: { tenantId, sourceType: "CUSTOMER_PAYMENT", sourceId: paymentId } })).toBe(1);

    // Kapalı dönemdeki bir belge sessizce yutulmaz: nedeniyle raporlanır.
    await auth(api().post("/gl/periods/close").send({ year: 2031, month: 5 })).expect(201);
    const closedPayment = await prisma.customerPayment.create({
      data: { tenantId, cpNo: `GL-TAH-K-${STAMP}`, customerId, amount: 10, paymentDate: new Date("2031-05-02T00:00:00.000Z"), createdById: admin.id },
    });
    const third = await auth(api().post("/gl/sync")).expect(201);
    expect(third.body.skipped).toContainEqual({ sourceType: "CUSTOMER_PAYMENT", sourceId: closedPayment.id, docNo: `GL-TAH-K-${STAMP}`, reason: "PERIOD_CLOSED" });
    await prisma.customerPayment.delete({ where: { id: closedPayment.id } });
  });
});
