import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("Documents — STEP/Talimat dosya deposu (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let partId: string;
  let docId: string;

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

    partId = (
      await auth(
        api().post("/parts").send({ partNo: `DOC-${STAMP}`, revision: "A", name: "Doküman Testi" }),
      )
    ).body.id;
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { entityId: partId } }).catch(() => undefined);
    await prisma.part.deleteMany({ where: { id: partId } }).catch(() => undefined);
    await app.close();
  });

  it("izin verilmeyen mime tipi 400 ile reddedilir", async () => {
    await auth(
      api()
        .post(`/documents?entityType=part&entityId=${partId}&docType=OTHER`)
        .attach("file", Buffer.from("<script>alert(1)</script>"), {
          filename: "evil.html",
          contentType: "text/html",
        }),
    ).expect(400);
  });

  it("izin verilen dosya yüklenir, listede görünür", async () => {
    const up = await auth(
      api()
        .post(`/documents?entityType=part&entityId=${partId}&docType=STEP`)
        .attach("file", Buffer.from("test step content"), {
          filename: "test.step",
          contentType: "application/octet-stream",
        }),
    ).expect(201);
    docId = up.body.id;
    expect(up.body.fileName).toBe("test.step");
    expect(up.body.docType).toBe("STEP");

    const list = await auth(api().get(`/documents?entityType=part&entityId=${partId}`)).expect(200);
    expect(list.body.some((d: { id: string }) => d.id === docId)).toBe(true);
  });

  it("signed URL alınır ve indirilen içerik yüklenenle eşleşir, indirme zorunlu (attachment)", async () => {
    const urlRes = await auth(api().get(`/documents/${docId}/url`)).expect(200);
    expect(urlRes.body.url).toContain("response-content-disposition=attachment");

    const download = await request(urlRes.body.url as string).get("").buffer(true);
    expect(download.status).toBe(200);
    expect(Buffer.from(download.body).toString("utf8")).toBe("test step content");
    expect(download.headers["content-disposition"]).toContain("attachment");
  });

  it("başka tenant/parça için filtrelenmiş liste boş döner", async () => {
    const list = await auth(
      api().get(`/documents?entityType=part&entityId=00000000-0000-0000-0000-000000000099`),
    ).expect(200);
    expect(list.body).toEqual([]);
  });

  it("silinir, sonrasında listede görünmez", async () => {
    await auth(api().delete(`/documents/${docId}`)).expect(200);
    const list = await auth(api().get(`/documents?entityType=part&entityId=${partId}`)).expect(200);
    expect(list.body.some((d: { id: string }) => d.id === docId)).toBe(false);
  });

  it("var olmayan dokümanın URL'i 404 döner", async () => {
    await auth(api().get(`/documents/${docId}/url`)).expect(404);
  });
});
