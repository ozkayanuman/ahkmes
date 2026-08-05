import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import * as bcrypt from "bcryptjs";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("MES-OPERATOR-HMI-001 (PostgreSQL e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken = "";
  let crossToken = "";
  let tenantId = "";
  let adminId = "";
  let partId = "";
  let machineId = "";
  let workOrderId = "";
  let operationId = "";

  const api = () => request(app.getHttpServer());
  const as = (token: string, call: request.Test) => call.set("Authorization", `Bearer ${token}`);
  async function login(email: string, password: string) {
    return (await api().post("/auth/login").send({ email, password }).expect(201)).body.accessToken as string;
  }
  async function grant(action: string, role?: "ADMIN" | "PLANNER" | "FOREMAN" | "OPERATOR" | "SALES", userId?: string) {
    const exists = await prisma.actionPermissionGrant.findFirst({ where: { tenantId, action, ...(role ? { role } : { userId }) } });
    if (!exists) await prisma.actionPermissionGrant.create({ data: { tenantId, action, role, userId, createdById: adminId } });
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    tenantId = admin.tenantId;
    adminId = admin.id;
    for (const action of ["HMI_READ", "HMI_START", "HMI_COMPLETE", "TOOL_READ", "OPERATION_SETUP_MANAGE", "OPERATION_SETUP_VERIFY"]) await grant(action, "ADMIN");

    partId = (await prisma.part.create({ data: { tenantId, partNo: `HMI-${STAMP}`, revision: "A", name: "HMI test part" } })).id;
    machineId = (await prisma.machine.create({ data: { tenantId, name: `HMI CNC-${STAMP}`, model: "VMC", isActive: true } })).id;
    const nc = await prisma.ncProgram.create({ data: { tenantId, partId, version: 1, fileName: "hmi.nc", fileRef: "hmi.nc", storageKey: `tests/hmi-${STAMP}.nc`, mimeType: "text/plain", sizeBytes: 12, checksum: "a".repeat(64), status: "PUBLISHED", createdById: adminId, publishedById: adminId, publishedAt: new Date() } });
    const workOrder = await prisma.workOrder.create({ data: { tenantId, woNo: `HMI-WO-${STAMP}`, partId, quantity: 2, dueDate: new Date(Date.now() + 86_400_000), priority: 1, machineId } });
    workOrderId = workOrder.id;
    const operation = await prisma.workOrderOperation.create({ data: { tenantId, workOrderId, seq: 10, name: "CNC milling", machineId, ncProgramId: nc.id, ncProgramVersion: nc.version, ncProgramChecksum: nc.checksum, ncProgramFileName: nc.fileName, ncProgramStorageKey: nc.storageKey } });
    operationId = operation.id;

    const tool = await prisma.toolDefinition.create({ data: { tenantId, code: `HMI-TOOL-${STAMP}`, name: "HMI cutter", toolType: "END_MILL", lifePolicy: "CYCLE", maximumLife: 10, warningThreshold: 2, lifeUnit: "cycle" } });
    const fixture = await prisma.fixtureDefinition.create({ data: { tenantId, code: `HMI-FIX-${STAMP}`, name: "HMI vise", fixtureType: "VISE" } });
    const physicalTool = await prisma.physicalToolInstance.create({ data: { tenantId, toolDefinitionId: tool.id, serialNo: `HMI-T-${STAMP}`, remainingLife: 10 } });
    const physicalFixture = await prisma.physicalFixtureInstance.create({ data: { tenantId, fixtureDefinitionId: fixture.id, serialNo: `HMI-F-${STAMP}` } });
    await prisma.toolMachineCompatibility.create({ data: { tenantId, machineId, toolDefinitionId: tool.id } });
    await prisma.fixtureMachineCompatibility.create({ data: { tenantId, machineId, fixtureDefinitionId: fixture.id } });
    const toolRequirement = await prisma.operationToolRequirement.create({ data: { tenantId, workOrderOperationId: operationId, toolDefinitionId: tool.id } });
    const fixtureRequirement = await prisma.operationFixtureRequirement.create({ data: { tenantId, workOrderOperationId: operationId, fixtureDefinitionId: fixture.id } });
    await as(adminToken, api().post(`/tooling/operations/${operationId}/setup/assignments`).send({ toolAssignments: [{ requirementId: toolRequirement.id, physicalToolInstanceId: physicalTool.id }], fixtureAssignments: [{ requirementId: fixtureRequirement.id, physicalFixtureInstanceId: physicalFixture.id }] })).expect(201);
    await as(adminToken, api().post(`/tooling/operations/${operationId}/setup/verify`).send({})).expect(201);

    const crossTenant = await prisma.tenant.create({ data: { name: `HMI cross ${STAMP}` } });
    const crossUser = await prisma.user.create({ data: { tenantId: crossTenant.id, email: `hmi-cross-${STAMP}@ahkmes.local`, passwordHash: await bcrypt.hash("Cross1234!", 10), name: "Cross HMI", role: "SALES" } });
    await prisma.actionPermissionGrant.create({ data: { tenantId: crossTenant.id, action: "HMI_READ", userId: crossUser.id, createdById: crossUser.id } });
    crossToken = await login(crossUser.email, "Cross1234!");
  });

  afterAll(async () => { await app.close(); });

  it("lists only the tenant queue and exposes NC/setup compliance detail", async () => {
    const queue = await as(adminToken, api().get("/hmi/operations")).expect(200);
    expect(queue.body.some((item: { id: string }) => item.id === operationId)).toBe(true);
    const detail = await as(adminToken, api().get(`/hmi/operations/${operationId}`)).expect(200);
    expect(detail.body.ncProgram.status).toBe("PUBLISHED");
    expect(detail.body.setup.verification.status).toBe("VERIFIED");
    expect(detail.body.checklist.blockers).toEqual([]);
    expect(detail.body.setup.operation.toolRequirements[0].toolDefinition.code).toContain("HMI-TOOL");
    expect((await as(crossToken, api().get("/hmi/operations")).expect(200)).body.some((item: { id: string }) => item.id === operationId)).toBe(false);
    await as(crossToken, api().get(`/hmi/operations/${operationId}`)).expect(404);
  });

  it("uses canonical start and completion gates for a verified operation", async () => {
    const started = await as(adminToken, api().post(`/hmi/operations/${operationId}/start`).send({})).expect(201);
    expect(started.body.operation.id).toBe(operationId);
    const completed = await as(adminToken, api().post(`/hmi/operations/${operationId}/complete`).send({ goodCount: 2, scrapCount: 0, notes: "HMI completion" })).expect(201);
    expect(completed.body.status).toBe("COMPLETED");
    const run = await prisma.productionRun.findUniqueOrThrow({ where: { id: started.body.id } });
    expect(run.endedAt).not.toBeNull();
    expect(run.goodCount).toBe(2);
  });

  it("rejects a blocking setup and mutations without the required HMI action", async () => {
    const blockedWorkOrder = await prisma.workOrder.create({ data: { tenantId, woNo: `HMI-BLOCK-${STAMP}`, partId, quantity: 1, dueDate: new Date(Date.now() + 86_400_000), machineId } });
    const blocked = await prisma.workOrderOperation.create({ data: { tenantId, workOrderId: blockedWorkOrder.id, seq: 10, name: "Unverified CNC", machineId } });
    const fixture = await prisma.fixtureDefinition.findFirstOrThrow({ where: { tenantId } });
    await prisma.operationFixtureRequirement.create({ data: { tenantId, workOrderOperationId: blocked.id, fixtureDefinitionId: fixture.id } });
    const detail = await as(adminToken, api().get(`/hmi/operations/${blocked.id}`)).expect(200);
    expect(detail.body.checklist.blockers.length).toBeGreaterThan(0);
    await as(adminToken, api().post(`/hmi/operations/${blocked.id}/start`).send({})).expect(409);

    const readOnly = await prisma.user.create({ data: { tenantId, email: `hmi-read-${STAMP}@ahkmes.local`, passwordHash: await bcrypt.hash("Read1234!", 10), name: "HMI read only", role: "SALES" } });
    await prisma.actionPermissionGrant.create({ data: { tenantId, action: "HMI_READ", userId: readOnly.id, createdById: adminId } });
    const readToken = await login(readOnly.email, "Read1234!");
    await as(readToken, api().get("/hmi/operations")).expect(200);
    await as(readToken, api().post(`/hmi/operations/${blocked.id}/start`).send({})).expect(403);
    await as(readToken, api().post(`/hmi/operations/${operationId}/complete`).send({ goodCount: 0, scrapCount: 0 })).expect(403);
  });

  it("filters the queue by machine and status query parameters", async () => {
    const machine2 = await prisma.machine.create({ data: { tenantId, name: `HMI CNC2-${STAMP}`, model: "VMC", isActive: true } });
    const wo2 = await prisma.workOrder.create({ data: { tenantId, woNo: `HMI-WO2-${STAMP}`, partId, quantity: 1, dueDate: new Date(Date.now() + 86_400_000), machineId: machine2.id } });
    const pendingOp = await prisma.workOrderOperation.create({ data: { tenantId, workOrderId: wo2.id, seq: 10, name: "Pending on machine2", machineId: machine2.id } });
    const blockedOp = await prisma.workOrderOperation.create({ data: { tenantId, workOrderId: wo2.id, seq: 20, name: "Blocked on machine2", machineId: machine2.id, status: "BLOCKED" } });

    const byMachine = await as(adminToken, api().get("/hmi/operations").query({ machineId: machine2.id })).expect(200);
    const byMachineIds = byMachine.body.map((item: { id: string }) => item.id);
    expect(byMachineIds).toEqual(expect.arrayContaining([pendingOp.id, blockedOp.id]));
    expect(byMachineIds).not.toContain(operationId);

    const byStatus = await as(adminToken, api().get("/hmi/operations").query({ status: "BLOCKED" })).expect(200);
    const byStatusIds = byStatus.body.map((item: { id: string }) => item.id);
    expect(byStatusIds).toContain(blockedOp.id);
    expect(byStatusIds).not.toContain(pendingOp.id);
  });

  it("rejects completion without an active production run and blocks the queue for a user with HMI_START but no HMI_READ", async () => {
    const wo3 = await prisma.workOrder.create({ data: { tenantId, woNo: `HMI-WO3-${STAMP}`, partId, quantity: 1, dueDate: new Date(Date.now() + 86_400_000), machineId } });
    const notStarted = await prisma.workOrderOperation.create({ data: { tenantId, workOrderId: wo3.id, seq: 10, name: "Not started", machineId } });
    await as(adminToken, api().post(`/hmi/operations/${notStarted.id}/complete`).send({ goodCount: 1, scrapCount: 0 })).expect(409);

    // role "SALES" carries no HMI_* bootstrap grant from the migration (only ADMIN/PLANNER/FOREMAN/OPERATOR do),
    // so the only permission this user has is the explicit HMI_START grant below.
    const startOnly = await prisma.user.create({ data: { tenantId, email: `hmi-start-only-${STAMP}@ahkmes.local`, passwordHash: await bcrypt.hash("Start1234!", 10), name: "HMI start only", role: "SALES" } });
    await prisma.actionPermissionGrant.create({ data: { tenantId, action: "HMI_START", userId: startOnly.id, createdById: adminId } });
    const startOnlyToken = await login(startOnly.email, "Start1234!");
    await as(startOnlyToken, api().get("/hmi/operations")).expect(403);
  });

  it("rejects cross-tenant start and complete despite matching action grants in the caller's own tenant", async () => {
    const crossTenant = await prisma.tenant.findFirstOrThrow({ where: { name: `HMI cross ${STAMP}` } });
    const crossAdmin = await prisma.user.create({ data: { tenantId: crossTenant.id, email: `hmi-cross-admin-${STAMP}@ahkmes.local`, passwordHash: await bcrypt.hash("CrossAdmin1234!", 10), name: "Cross HMI admin", role: "ADMIN" } });
    for (const action of ["HMI_START", "HMI_COMPLETE"]) {
      await prisma.actionPermissionGrant.create({ data: { tenantId: crossTenant.id, action, userId: crossAdmin.id, createdById: crossAdmin.id } });
    }
    const crossAdminToken = await login(crossAdmin.email, "CrossAdmin1234!");
    await as(crossAdminToken, api().post(`/hmi/operations/${operationId}/start`).send({})).expect(404);
    await as(crossAdminToken, api().post(`/hmi/operations/${operationId}/complete`).send({ goodCount: 1, scrapCount: 0 })).expect(404);
  });
});
