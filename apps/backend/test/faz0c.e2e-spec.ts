import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();
const DUE = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

/**
 * 0c.8 uçtan uca duman senaryosu:
 * teklif → onay → iş emri → PO → teslim → rezervasyon/tüketim → üretim koşusu → mamul girişi → iş emri tamamlama
 */
describe("Faz 0c — Tüketim, Üretim, Mamul, Dashboard (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  let customerId: string;
  let partId: string;
  let supplierId: string;
  let materialId: string;
  let quoteId: string;
  let woId: string;
  let poId: string;
  let runId: string;
  let consumptionIds: string[] = [];

  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${adminToken}`);
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const login = await api()
      .post("/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    adminToken = login.body.accessToken;

    customerId = (await auth(api().post("/customers").send({ name: `F0C Müşteri ${STAMP}` })))
      .body.id;
    partId = (
      await auth(api().post("/parts").send({ partNo: `F0C-${STAMP}`, revision: "A", name: "Kapak" }))
    ).body.id;
    supplierId = (await auth(api().post("/suppliers").send({ name: `F0C Tedarikçi ${STAMP}` })))
      .body.id;
    materialId = (
      await auth(
        api()
          .post("/materials")
          .send({ code: `F0C-MAT-${STAMP}`, name: "Al 6061", type: "RAW", unit: "kg", minStock: 5 }),
      )
    ).body.id;
  });

  afterAll(async () => {
    await prisma.materialConsumption
      .deleteMany({ where: { id: { in: consumptionIds } } })
      .catch(() => undefined);
    if (woId) {
      await prisma.productionRun.deleteMany({ where: { workOrderId: woId } }).catch(() => undefined);
      await prisma.finishedGoodsEntry
        .deleteMany({ where: { workOrderId: woId } })
        .catch(() => undefined);
      await prisma.workOrder.deleteMany({ where: { id: woId } }).catch(() => undefined);
    }
    await prisma.partStock.deleteMany({ where: { partId } }).catch(() => undefined);
    if (quoteId) await prisma.quote.deleteMany({ where: { id: quoteId } }).catch(() => undefined);
    if (poId) await prisma.purchaseOrder.deleteMany({ where: { id: poId } }).catch(() => undefined);
    await prisma.material.deleteMany({ where: { id: materialId } }).catch(() => undefined);
    await prisma.supplier.deleteMany({ where: { id: supplierId } }).catch(() => undefined);
    await prisma.part.deleteMany({ where: { id: partId } }).catch(() => undefined);
    await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => undefined);
    await app.close();
  });

  it("teklif → onay → iş emri", async () => {
    const quote = await auth(
      api()
        .post("/quotes")
        .send({ customerId, lines: [{ partId, quantity: 5, unitPrice: 90, dueDate: DUE }] }),
    ).expect(201);
    quoteId = quote.body.id;
    await auth(api().patch(`/quotes/${quoteId}/status`).send({ status: "SENT" })).expect(200);
    await auth(api().patch(`/quotes/${quoteId}/status`).send({ status: "APPROVED" })).expect(200);
    const conv = await auth(api().post(`/quotes/${quoteId}/convert`).send({})).expect(201);
    woId = conv.body.workOrders[0].id;
  });

  it("PO → teslim → hammadde stoğu 30", async () => {
    const po = await auth(
      api()
        .post("/purchase-orders")
        .send({
          supplierId,
          orderDate: new Date().toISOString(),
          lines: [{ materialId, quantity: 30, unitPrice: 12 }],
        }),
    ).expect(201);
    poId = po.body.id;
    await auth(
      api()
        .post(`/purchase-orders/${poId}/receive`)
        .send({ lines: [{ lineId: po.body.lines[0].id, receivedQty: 30 }] }),
    ).expect(201);
    const mat = await auth(api().get(`/materials/${materialId}`)).expect(200);
    expect(Number(mat.body.stockQty)).toBe(30);
  });

  describe("0c.1 Tüketim", () => {
    it("RESERVED kayıt stok düşürmez", async () => {
      const res = await auth(
        api()
          .post("/consumptions")
          .send({ workOrderId: woId, materialId, type: "RESERVED", quantity: 10 }),
      ).expect(201);
      consumptionIds.push(res.body.id);
      const mat = await auth(api().get(`/materials/${materialId}`)).expect(200);
      expect(Number(mat.body.stockQty)).toBe(30);
    });

    it("CONSUMED kayıt stok düşürür", async () => {
      const res = await auth(
        api()
          .post("/consumptions")
          .send({ workOrderId: woId, materialId, type: "CONSUMED", quantity: 10 }),
      ).expect(201);
      consumptionIds.push(res.body.id);
      const mat = await auth(api().get(`/materials/${materialId}`)).expect(200);
      expect(Number(mat.body.stockQty)).toBe(20);
    });

    it("yetersiz stok 409, stok değişmez", async () => {
      await auth(
        api()
          .post("/consumptions")
          .send({ workOrderId: woId, materialId, type: "CONSUMED", quantity: 999 }),
      ).expect(409);
      const mat = await auth(api().get(`/materials/${materialId}`)).expect(200);
      expect(Number(mat.body.stockQty)).toBe(20);
    });
  });

  describe("0c.2 ProductionRun", () => {
    it("koşu başlat → iş emri IN_PRODUCTION, source MANUAL", async () => {
      const res = await auth(api().post(`/work-orders/${woId}/runs`).send({})).expect(201);
      runId = res.body.id;
      expect(res.body.source).toBe("MANUAL");
      const wo = await auth(api().get(`/work-orders/${woId}`)).expect(200);
      expect(wo.body.status).toBe("IN_PRODUCTION");
    });

    it("aynı iş emrinde ikinci aktif koşu 409", async () => {
      await auth(api().post(`/work-orders/${woId}/runs`).send({})).expect(409);
    });

    it("adet/duruş girişi ve tamamlama", async () => {
      await auth(
        api().patch(`/runs/${runId}`).send({ goodCount: 3, scrapCount: 1, downtimeNote: "ayar" }),
      ).expect(200);
      const done = await auth(api().post(`/runs/${runId}/complete`).send({ goodCount: 4 })).expect(
        201,
      );
      expect(done.body.endedAt).not.toBeNull();
      expect(done.body.goodCount).toBe(4);
    });

    it("tamamlanmış koşu düzenlenemez (409)", async () => {
      await auth(api().patch(`/runs/${runId}`).send({ goodCount: 5 })).expect(409);
    });
  });

  describe("0c.3 Mamul girişi", () => {
    it("kısmi giriş → PartStock artar, öneri yok", async () => {
      const res = await auth(
        api().post("/finished-goods").send({ workOrderId: woId, quantity: 2 }),
      ).expect(201);
      expect(res.body.completionSuggested).toBe(false);
      expect(res.body.totalProduced).toBe(2);
    });

    it("kalan giriş → toplam 5, tamamlama önerilir; iş emri COMPLETED yapılır", async () => {
      const res = await auth(
        api().post("/finished-goods").send({ workOrderId: woId, quantity: 3 }),
      ).expect(201);
      expect(res.body.completionSuggested).toBe(true);
      expect(res.body.totalProduced).toBe(5);

      const stocks = await auth(api().get("/finished-goods/stocks")).expect(200);
      const stock = stocks.body.find((s: { part: { id: string } }) => s.part.id === partId);
      expect(Number(stock.qty)).toBe(5);

      await auth(api().patch(`/work-orders/${woId}/status`).send({ status: "COMPLETED" })).expect(
        200,
      );
    });

    it("tamamlanmış iş emrine mamul girişi 409", async () => {
      await auth(api().post("/finished-goods").send({ workOrderId: woId, quantity: 1 })).expect(
        409,
      );
    });
  });

  describe("0c.4 Dashboard", () => {
    it("özet endpoint sayım + listeler döner", async () => {
      const res = await auth(api().get("/dashboard")).expect(200);
      expect(res.body.workOrderCounts).toBeDefined();
      expect(Array.isArray(res.body.activeWorkOrders)).toBe(true);
      expect(Array.isArray(res.body.pendingQuotes)).toBe(true);
      expect(Array.isArray(res.body.criticalStock)).toBe(true);
      expect(Array.isArray(res.body.recentRuns)).toBe(true);
      // Bu senaryonun koşusu son koşularda görünmeli
      expect(
        res.body.recentRuns.some((r: { id: string }) => r.id === runId),
      ).toBe(true);
    });

    it("status-bar endpoint OEE/açık NC/aktif alarm özetini döner", async () => {
      const res = await auth(api().get("/dashboard/status-bar")).expect(200);
      expect(typeof res.body.openNonConformanceCount).toBe("number");
      expect(typeof res.body.activeAlarmCount).toBe("number");
      expect(res.body).toHaveProperty("oeeToday");
    });
  });
});
