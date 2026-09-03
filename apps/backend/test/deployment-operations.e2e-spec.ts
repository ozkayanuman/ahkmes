import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL!;
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD!;

describe("CNC-V1-00 fresh deployment smoke", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let tenantId: string;
  let machineId: string;

  const api = () => request(app.getHttpServer());
  const auth = (test: request.Test) => test.set("Authorization", `Bearer ${token}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    const login = await api().post("/auth/login").send({ email: adminEmail, password: adminPassword }).expect(201);
    token = login.body.accessToken;
    tenantId = (await prisma.user.findUniqueOrThrow({ where: { email: adminEmail }, select: { tenantId: true } })).tenantId;
  });

  afterAll(async () => app.close());

  it("provisions a non-demo tenant with explicit legacy module configuration and no V2 commercial rights", async () => {
    expect(tenantId).toBeTruthy();
    expect(await prisma.tenantLicence.count({ where: { tenantId } })).toBe(0);
    expect(await prisma.tenantModuleEntitlement.count({ where: { tenantId } })).toBeGreaterThan(10);
    expect(await prisma.auditLog.count({ where: { tenantId, entity: "tenant-provisioning" } })).toBe(1);
    // Other smoke tests create a representative machine; the production
    // bootstrap invariant is that it creates none itself.
    await expect(prisma.machine.count({ where: { tenantId, name: { startsWith: "OPS machine" } } })).resolves.toBeLessThanOrEqual(1);
  });

  it("passes live/readiness/version, login, manufacturing and connector diagnostic smoke checks", async () => {
    expect((await api().get("/health/live").expect(200)).body).toEqual(expect.objectContaining({ status: "ok" }));
    expect((await api().get("/health/ready").expect(200)).body).toEqual(expect.objectContaining({ status: "ok" }));
    expect((await api().get("/health/info").expect(200)).body).toEqual(expect.objectContaining({ application: "ahkmes-backend" }));
    const part = await auth(api().post("/parts").send({ partNo: `OPS-${Date.now()}`, revision: "A", name: "Deployment smoke part" })).expect(201);
    expect(part.body.id).toBeTruthy();
    const machine = await auth(api().post("/machines").send({ name: `OPS machine ${Date.now()}`, model: "Smoke" })).expect(201);
    machineId = machine.body.id;
    const key = await auth(api().post(`/machines/${machineId}/connector-key`)).expect(201);
    await api().post(`/machines/${machineId}/connector-status`).set("X-Machine-Key", key.body.key).send({ adapter: "simulator", connectionState: "CONNECTED", reconnecting: false, configurationValid: true, lastSuccessfulCommunicationAt: new Date().toISOString() }).expect(201);
    expect((await auth(api().get(`/machines/${machineId}/connector-status`)).expect(200)).body).toEqual(expect.objectContaining({ machineId, connectionState: "CONNECTED", qualification: "SIMULATED" }));
    await expect(prisma.auditLog.count({ where: { tenantId } })).resolves.toBeGreaterThan(1);
  });
});
