import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("Temel CRUD (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    adminToken = login.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${adminToken}`);

  describe("Customers + AuditLog", () => {
    let customerId: string;

    it("POST /customers — müşteri oluşturur", async () => {
      const res = await auth(
        request(app.getHttpServer())
          .post("/customers")
          .send({ name: `Test Müşteri ${STAMP}`, phone: "0312 000 0000" }),
      ).expect(201);
      customerId = res.body.id;
      expect(res.body.tenantId).toBeDefined();
    });

    it("AuditLog — CREATE kaydı düşer (0a.6 doğrulaması)", async () => {
      const log = await prisma.auditLog.findFirst({
        where: { entity: "customers", entityId: customerId, action: "CREATE" },
      });
      expect(log).not.toBeNull();
      expect((log?.after as { name?: string })?.name).toBe(`Test Müşteri ${STAMP}`);
    });

    it("PATCH /customers/:id — günceller ve audit before/after tutar", async () => {
      await auth(
        request(app.getHttpServer())
          .patch(`/customers/${customerId}`)
          .send({ notes: "güncellendi" }),
      ).expect(200);
      const log = await prisma.auditLog.findFirst({
        where: { entity: "customers", entityId: customerId, action: "UPDATE" },
        orderBy: { createdAt: "desc" },
      });
      expect((log?.before as { notes?: string | null })?.notes ?? null).toBeNull();
      expect((log?.after as { notes?: string })?.notes).toBe("güncellendi");
    });

    it("GET /customers?q= — arama çalışır", async () => {
      const res = await auth(
        request(app.getHttpServer()).get(`/customers?q=Test Müşteri ${STAMP}`),
      ).expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
    });

    it("DELETE /customers/:id — siler", async () => {
      await auth(request(app.getHttpServer()).delete(`/customers/${customerId}`)).expect(200);
    });
  });

  describe("Parts + NcProgram", () => {
    let partId: string;

    it("POST /parts — parça oluşturur", async () => {
      const res = await auth(
        request(app.getHttpServer())
          .post("/parts")
          .send({ partNo: `PRT-${STAMP}`, revision: "A", name: "Flanş" }),
      ).expect(201);
      partId = res.body.id;
    });

    it("POST /parts — aynı partNo+revision 409", async () => {
      await auth(
        request(app.getHttpServer())
          .post("/parts")
          .send({ partNo: `PRT-${STAMP}`, revision: "A", name: "Kopya" }),
      ).expect(409);
    });

    it("POST /parts/:id/nc-programs — versiyon 1'den başlar, artar", async () => {
      const v1 = await auth(
        request(app.getHttpServer())
          .post(`/parts/${partId}/nc-programs`)
          .send({ fileName: "flans_op10.nc", fileRef: "nc/flans_op10_v1.nc" }),
      ).expect(201);
      expect(v1.body.version).toBe(1);
      const v2 = await auth(
        request(app.getHttpServer())
          .post(`/parts/${partId}/nc-programs`)
          .send({ fileName: "flans_op10.nc", fileRef: "nc/flans_op10_v2.nc" }),
      ).expect(201);
      expect(v2.body.version).toBe(2);
    });

    it("POST /nc-programs/:id/file — gerçek G-kod dosyası yüklenir, indirilir (attachment)", async () => {
      const v1 = await auth(
        request(app.getHttpServer())
          .post(`/parts/${partId}/nc-programs`)
          .send({ fileName: "flans_op20.nc", fileRef: "manuel-referans" }),
      ).expect(201);
      const programId = v1.body.id;

      const rejected = await auth(
        request(app.getHttpServer())
          .post(`/nc-programs/${programId}/file`)
          .attach("file", Buffer.from("<script>alert(1)</script>"), {
            filename: "evil.html",
            contentType: "text/html",
          }),
      );
      expect(rejected.status).toBe(400);

      const gcode = "O1000\nG90 G54 G0 X0 Y0\nM30\n";
      const uploaded = await auth(
        request(app.getHttpServer())
          .post(`/nc-programs/${programId}/file`)
          .attach("file", Buffer.from(gcode), { filename: "flans_op20.nc", contentType: "text/plain" }),
      ).expect(201);
      expect(uploaded.body.sizeBytes).toBe(Buffer.byteLength(gcode));

      const urlRes = await auth(request(app.getHttpServer()).get(`/nc-programs/${programId}/url`)).expect(
        200,
      );
      expect(urlRes.body.url).toContain("response-content-disposition=attachment");

      const download = await request(urlRes.body.url as string).get("").buffer(true);
      expect(download.status).toBe(200);
      expect(Buffer.from(download.body).toString("utf8")).toBe(gcode);
      expect(download.headers["content-disposition"]).toContain("attachment");
    });
  });

  describe("Suppliers / Materials / Machines", () => {
    it("POST /suppliers — tedarikçi oluşturur", async () => {
      await auth(
        request(app.getHttpServer())
          .post("/suppliers")
          .send({ name: `Tedarikçi ${STAMP}` }),
      ).expect(201);
    });

    it("POST /materials — malzeme oluşturur (Decimal alanlar)", async () => {
      const res = await auth(
        request(app.getHttpServer())
          .post("/materials")
          .send({ code: `AL6061-${STAMP}`, name: "Alüminyum 6061", type: "RAW", unit: "kg", minStock: "10.5" }),
      ).expect(201);
      expect(Number(res.body.stockQty)).toBe(0);
    });

    it("GET /machines — seed edilen 2 tezgah listelenir", async () => {
      const res = await auth(request(app.getHttpServer()).get("/machines")).expect(200);
      expect(res.body.length).toBeGreaterThanOrEqual(2);
      expect(res.body[0].model).toBe("SMEC MCV-5500");
    });
  });

  describe("RBAC", () => {
    let salesToken: string;

    it("ADMIN yeni SALES kullanıcı oluşturur", async () => {
      await auth(
        request(app.getHttpServer())
          .post("/users")
          .send({
            email: `sales-${STAMP}@ahkmes.local`,
            password: "Sales1234!",
            name: "Satışçı",
            role: "SALES",
          }),
      ).expect(201);
      const login = await request(app.getHttpServer())
        .post("/auth/login")
        .send({ email: `sales-${STAMP}@ahkmes.local`, password: "Sales1234!" });
      salesToken = login.body.accessToken;
    });

    it("SALES /users erişemez (403) — rol reddi", async () => {
      await request(app.getHttpServer())
        .get("/users")
        .set("Authorization", `Bearer ${salesToken}`)
        .expect(403);
    });

    it("SALES müşteri oluşturabilir (201)", async () => {
      await request(app.getHttpServer())
        .post("/customers")
        .set("Authorization", `Bearer ${salesToken}`)
        .send({ name: `Sales Müşterisi ${STAMP}` })
        .expect(201);
    });

    it("SALES parça oluşturamaz (403)", async () => {
      await request(app.getHttpServer())
        .post("/parts")
        .set("Authorization", `Bearer ${salesToken}`)
        .send({ partNo: `X-${STAMP}`, revision: "A", name: "X" })
        .expect(403);
    });
  });
});
