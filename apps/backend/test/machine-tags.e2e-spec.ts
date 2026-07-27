import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("Automation Gateway — Machine Tag CRUD (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let machineId: string;
  let otherMachineId: string;
  let tagId: string;

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

    machineId = (
      await auth(api().post("/machines").send({ name: `Tag Testi ${STAMP}`, model: "Test" }))
    ).body.id;
    otherMachineId = (
      await auth(api().post("/machines").send({ name: `Tag Testi Diğer ${STAMP}`, model: "Test" }))
    ).body.id;
  });

  afterAll(async () => {
    await prisma.machineTag.deleteMany({ where: { machineId: { in: [machineId, otherMachineId] } } });
    await prisma.machine.deleteMany({ where: { id: { in: [machineId, otherMachineId] } } });
    await app.close();
  });

  it("tag oluşturur", async () => {
    const res = await auth(
      api()
        .post(`/machines/${machineId}/tags`)
        .send({ name: "CycleStatus", address: "ns=1;s=CycleStatus", dataType: "NUMBER" }),
    ).expect(201);
    tagId = res.body.id;
    expect(res.body.name).toBe("CycleStatus");
    expect(res.body.lastValue).toBeNull();
  });

  it("aynı isimde ikinci tag oluşturulamaz (409)", async () => {
    await auth(
      api()
        .post(`/machines/${machineId}/tags`)
        .send({ name: "CycleStatus", address: "ns=1;s=Baska", dataType: "STRING" }),
    ).expect(409);
  });

  it("tag listesi yalnızca ilgili makinenin tag'lerini döner", async () => {
    await auth(
      api()
        .post(`/machines/${otherMachineId}/tags`)
        .send({ name: "PartCount", address: "ns=1;s=PartCount", dataType: "NUMBER" }),
    ).expect(201);

    const list = await auth(api().get(`/machines/${machineId}/tags`)).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].name).toBe("CycleStatus");
  });

  it("tag günceller", async () => {
    const res = await auth(
      api().patch(`/machines/${machineId}/tags/${tagId}`).send({ address: "ns=2;s=CycleStatus" }),
    ).expect(200);
    expect(res.body.address).toBe("ns=2;s=CycleStatus");
  });

  it("başka makinenin tag'i bu makine altında güncellenemez (404)", async () => {
    const otherTag = await prisma.machineTag.findFirst({ where: { machineId: otherMachineId } });
    await auth(
      api().patch(`/machines/${machineId}/tags/${otherTag!.id}`).send({ address: "x" }),
    ).expect(404);
  });

  it("tag siler", async () => {
    await auth(api().delete(`/machines/${machineId}/tags/${tagId}`)).expect(200);
    const list = await auth(api().get(`/machines/${machineId}/tags`)).expect(200);
    expect(list.body).toHaveLength(0);
  });
});
