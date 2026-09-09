import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();
const DUE = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

describe("Faz 0b — Teklif, İş Emri, Satınalma (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  let customerId: string;
  let partId: string;
  let supplierId: string;
  let materialId: string;

  let quoteId: string;
  let quoteLineIds: string[] = [];
  let salesOrderId: string;
  let salesOrderLineIds: string[] = [];
  let convertedWoIds: string[] = [];
  let manualWoId: string;
  let poId: string;
  let poLineIds: string[] = [];

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

    customerId = (
      await auth(api().post("/customers").send({ name: `F0B Müşteri ${STAMP}` }))
    ).body.id;
    partId = (
      await auth(
        api().post("/parts").send({ partNo: `F0B-${STAMP}`, revision: "A", name: "Mil" }),
      )
    ).body.id;
    supplierId = (
      await auth(api().post("/suppliers").send({ name: `F0B Tedarikçi ${STAMP}` }))
    ).body.id;
    materialId = (
      await auth(
        api()
          .post("/materials")
          .send({ code: `F0B-MAT-${STAMP}`, name: "Ç1040 Çubuk", type: "RAW", unit: "kg" }),
      )
    ).body.id;
  });

  afterAll(async () => {
    // Durum kuralları API'den silmeyi engelleyebilir — temizliği doğrudan Prisma ile yap
    const woIds = [...convertedWoIds, manualWoId].filter(Boolean);
    await prisma.workOrder.deleteMany({ where: { id: { in: woIds } } }).catch(() => undefined);
    if (salesOrderId) await prisma.salesOrder.deleteMany({ where: { id: salesOrderId } }).catch(() => undefined);
    if (quoteId) await prisma.quote.deleteMany({ where: { id: quoteId } }).catch(() => undefined);
    if (poId) await prisma.purchaseOrder.deleteMany({ where: { id: poId } }).catch(() => undefined);
    await prisma.material.deleteMany({ where: { id: materialId } }).catch(() => undefined);
    await prisma.supplier.deleteMany({ where: { id: supplierId } }).catch(() => undefined);
    await prisma.part.deleteMany({ where: { id: partId } }).catch(() => undefined);
    await prisma.customer.deleteMany({ where: { id: customerId } }).catch(() => undefined);
    await app.close();
  });

  describe("0b.1 Quote — CRUD + numaralandırma + durum makinesi", () => {
    it("POST /quotes — 2 satırlı teklif oluşturur, TKF numarası atar", async () => {
      const res = await auth(
        api()
          .post("/quotes")
          .send({
            customerId,
            lines: [
              { partId, quantity: 10, unitPrice: 250.5, dueDate: DUE },
              { partId, quantity: 5, unitPrice: 300, dueDate: DUE },
            ],
          }),
      ).expect(201);
      quoteId = res.body.id;
      quoteLineIds = res.body.lines.map((l: { id: string }) => l.id);
      expect(res.body.quoteNo).toMatch(/^TKF-\d{4}-\d{4}$/);
      expect(res.body.status).toBe("DRAFT");
      expect(res.body.lines).toHaveLength(2);
    });

    it("PATCH /quotes/:id/status — geçersiz geçiş DRAFT→APPROVED 409", async () => {
      await auth(api().patch(`/quotes/${quoteId}/status`).send({ status: "APPROVED" })).expect(
        409,
      );
    });

    it("POST /quotes/:id/convert — DRAFT teklif dönüştürülemez (409)", async () => {
      await auth(api().post(`/quotes/${quoteId}/convert`).send({})).expect(409);
    });

    it("DRAFT→SENT geçişi çalışır", async () => {
      const res = await auth(
        api().patch(`/quotes/${quoteId}/status`).send({ status: "SENT" }),
      ).expect(200);
      expect(res.body.status).toBe("SENT");
    });

    it("AuditLog — STATUS_CHANGE kaydı düşer", async () => {
      const log = await prisma.auditLog.findFirst({
        where: { entity: "quotes", entityId: quoteId, action: "STATUS_CHANGE" },
      });
      expect(log).not.toBeNull();
    });

    it("SENT teklife satır eklenemez (409)", async () => {
      await auth(
        api()
          .post(`/quotes/${quoteId}/lines`)
          .send({ partId, quantity: 1, unitPrice: 10, dueDate: DUE }),
      ).expect(409);
    });

    it("SENT→APPROVED geçişi çalışır", async () => {
      const res = await auth(
        api().patch(`/quotes/${quoteId}/status`).send({ status: "APPROVED" }),
      ).expect(200);
      expect(res.body.status).toBe("APPROVED");
    });
  });

  describe("0b.2 Teklif → Satış Siparişi → İş Emri dönüşümü", () => {
    it("POST /quotes/:id/convert — her satırdan satış siparişi satırı üretir", async () => {
      const res = await auth(api().post(`/quotes/${quoteId}/convert`).send({})).expect(201);
      salesOrderId = res.body.salesOrder.id;
      salesOrderLineIds = res.body.salesOrder.lines.map((line: { id: string }) => line.id);
      expect(res.body.salesOrder.soNo).toMatch(/^SIP-\d{4}-\d{4}$/);
      expect(res.body.salesOrder.lines).toHaveLength(2);
      for (const line of res.body.salesOrder.lines) {
        expect(quoteLineIds).toContain(line.quoteLineId);
      }
    });

    it("mükerrer dönüşüm 409", async () => {
      await auth(api().post(`/quotes/${quoteId}/convert`).send({})).expect(409);
    });

    it("POST /sales-orders/:id/release — her satırdan IE numaralı iş emri üretir", async () => {
      const res = await auth(api().post(`/sales-orders/${salesOrderId}/release`).send({})).expect(201);
      expect(res.body.workOrders).toHaveLength(2);
      convertedWoIds = res.body.workOrders.map((w: { id: string }) => w.id);
      for (const wo of res.body.workOrders) {
        expect(wo.woNo).toMatch(/^IE-\d{4}-\d{4}$/);
        expect(wo.status).toBe("PLANNED");
        expect(salesOrderLineIds).toContain(wo.salesOrderLineId);
      }
    });

    it("aynı satış siparişi satırları ikinci kez üretime alınamaz (409)", async () => {
      await auth(api().post(`/sales-orders/${salesOrderId}/release`).send({})).expect(409);
    });
  });

  describe("0b.3 WorkOrder — durum makinesi + manuel oluşturma", () => {
    it("POST /work-orders — manuel iş emri oluşturur", async () => {
      const res = await auth(
        api().post("/work-orders").send({ partId, quantity: 3, dueDate: DUE, priority: 2 }),
      ).expect(201);
      manualWoId = res.body.id;
      expect(res.body.woNo).toMatch(/^IE-\d{4}-\d{4}$/);
    });

    it("PLANNED→IN_PRODUCTION geçişi çalışır", async () => {
      const res = await auth(
        api().patch(`/work-orders/${convertedWoIds[0]}/status`).send({ status: "IN_PRODUCTION" }),
      ).expect(200);
      expect(res.body.status).toBe("IN_PRODUCTION");
    });

    it("IN_PRODUCTION→PLANNED geçersiz (409)", async () => {
      await auth(
        api().patch(`/work-orders/${convertedWoIds[0]}/status`).send({ status: "PLANNED" }),
      ).expect(409);
    });

    it("IN_PRODUCTION iş emrinde miktar değişemez (409)", async () => {
      await auth(api().patch(`/work-orders/${convertedWoIds[0]}`).send({ quantity: 99 })).expect(
        409,
      );
    });

    it("IN_PRODUCTION→COMPLETED geçişi çalışır; tamamlanan düzenlenemez", async () => {
      await auth(
        api().patch(`/work-orders/${convertedWoIds[0]}/status`).send({ status: "COMPLETED" }),
      ).expect(200);
      await auth(api().patch(`/work-orders/${convertedWoIds[0]}`).send({ notes: "x" })).expect(
        409,
      );
    });

    it("tezgah atama çalışır", async () => {
      const machines = await auth(api().get("/machines")).expect(200);
      const machineId = machines.body[0]?.id;
      expect(machineId).toBeDefined();
      const res = await auth(
        api().patch(`/work-orders/${manualWoId}`).send({ machineId }),
      ).expect(200);
      expect(res.body.machine.id).toBe(machineId);
    });
  });

  describe("0b.4 Purchasing — teslim alma → stok artışı", () => {
    it("POST /purchase-orders — SAT numaralı sipariş oluşturur", async () => {
      const res = await auth(
        api()
          .post("/purchase-orders")
          .send({
            supplierId,
            orderDate: new Date().toISOString(),
            lines: [
              { materialId, quantity: 100, unitPrice: 45 },
              { materialId, quantity: 50, unitPrice: 44 },
            ],
          }),
      ).expect(201);
      poId = res.body.id;
      poLineIds = res.body.lines.map((l: { id: string }) => l.id);
      expect(res.body.poNo).toMatch(/^SAT-\d{4}-\d{4}$/);
      expect(res.body.status).toBe("ORDERED");
    });

    it("kısmi teslim → stok artar, durum ORDERED kalır", async () => {
      const res = await auth(
        api()
          .post(`/purchase-orders/${poId}/receive`)
          .send({ lines: [{ lineId: poLineIds[0], receivedQty: 40 }] }),
      ).expect(201);
      expect(res.body.status).toBe("ORDERED");
      const mat = await auth(api().get(`/materials/${materialId}`)).expect(200);
      expect(Number(mat.body.stockQty)).toBe(40);
    });

    it("fazla teslim reddedilir (409), stok değişmez", async () => {
      await auth(
        api()
          .post(`/purchase-orders/${poId}/receive`)
          .send({ lines: [{ lineId: poLineIds[0], receivedQty: 100 }] }),
      ).expect(409);
      const mat = await auth(api().get(`/materials/${materialId}`)).expect(200);
      expect(Number(mat.body.stockQty)).toBe(40);
    });

    it("kalan miktarlar teslim alınınca PO RECEIVED olur, stok tamamlanır", async () => {
      const res = await auth(
        api()
          .post(`/purchase-orders/${poId}/receive`)
          .send({
            lines: [
              { lineId: poLineIds[0], receivedQty: 60 },
              { lineId: poLineIds[1], receivedQty: 50 },
            ],
          }),
      ).expect(201);
      expect(res.body.status).toBe("RECEIVED");
      const mat = await auth(api().get(`/materials/${materialId}`)).expect(200);
      expect(Number(mat.body.stockQty)).toBe(150);
    });

    it("RECEIVED sipariş tekrar teslim alınamaz (409)", async () => {
      await auth(
        api()
          .post(`/purchase-orders/${poId}/receive`)
          .send({ lines: [{ lineId: poLineIds[0], receivedQty: 1 }] }),
      ).expect(409);
    });
  });
});
