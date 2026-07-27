import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("Automation Gateway — Tag Değeri Telemetrisi (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let machineId: string;
  let machineKey: string;

  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${adminToken}`);
  const api = () => request(app.getHttpServer());
  const withKey = (r: request.Test) => r.set("X-Machine-Key", machineKey);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    const login = await api()
      .post("/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    adminToken = login.body.accessToken;

    machineId = (
      await auth(api().post("/machines").send({ name: `Tag Değeri Testi ${STAMP}`, model: "Test" }))
    ).body.id;
    await auth(
      api()
        .post(`/machines/${machineId}/tags`)
        .send({ name: "CycleStatus", address: "ns=1;s=CycleStatus", dataType: "NUMBER" }),
    ).expect(201);

    const keyRes = await auth(api().post(`/machines/${machineId}/connector-key`)).expect(201);
    machineKey = keyRes.body.key;
  });

  afterAll(async () => {
    await prisma.machineTag.deleteMany({ where: { machineId } });
    await prisma.machine.deleteMany({ where: { id: machineId } });
    await app.close();
  });

  it("geçersiz makine anahtarı ile tag değeri gönderilemez (401)", async () => {
    await api()
      .post(`/machines/${machineId}/tag-values`)
      .set("X-Machine-Key", "yanlis-anahtar")
      .send({ values: [{ tagName: "CycleStatus", value: "1" }] })
      .expect(401);
  });

  it("tanımlı tag için lastValue/lastValueAt güncellenir", async () => {
    const res = await withKey(
      api()
        .post(`/machines/${machineId}/tag-values`)
        .send({ values: [{ tagName: "CycleStatus", value: "1" }] }),
    ).expect(201);
    expect(res.body.applied).toBe(1);

    const tag = await prisma.machineTag.findFirst({ where: { machineId, name: "CycleStatus" } });
    expect(tag?.lastValue).toBe("1");
    expect(tag?.lastValueAt).not.toBeNull();
  });

  it("tanımsız tag adı sessizce atlanır (hata değil, applied=0)", async () => {
    const res = await withKey(
      api()
        .post(`/machines/${machineId}/tag-values`)
        .send({ values: [{ tagName: "BilinmeyenTag", value: "x" }] }),
    ).expect(201);
    expect(res.body.applied).toBe(0);
  });

  it("toplu değer gönderiminde birden fazla tag işlenebilir", async () => {
    await auth(
      api()
        .post(`/machines/${machineId}/tags`)
        .send({ name: "PartCount", address: "ns=1;s=PartCount", dataType: "NUMBER" }),
    ).expect(201);

    const res = await withKey(
      api()
        .post(`/machines/${machineId}/tag-values`)
        .send({
          values: [
            { tagName: "CycleStatus", value: "0" },
            { tagName: "PartCount", value: "42" },
          ],
        }),
    ).expect(201);
    expect(res.body.applied).toBe(2);

    const partCount = await prisma.machineTag.findFirst({ where: { machineId, name: "PartCount" } });
    expect(partCount?.lastValue).toBe("42");
  });
});
