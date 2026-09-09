import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import * as bcrypt from "bcryptjs";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("MES-TOOL-001 verified CNC setup (PostgreSQL e2e)", () => {
  let app: INestApplication; let prisma: PrismaService; let token = ""; let crossToken = "";
  let tenantId = ""; let userId = ""; let partId = ""; let machineId = ""; let ncId = ""; let workOrderId = ""; let operationId = "";
  let toolDefinitionId = ""; let toolInstanceId = ""; let fixtureDefinitionId = ""; let fixtureInstanceId = ""; let verificationId = "";
  const api = () => request(app.getHttpServer()); const as = (t: string, r: request.Test) => r.set("Authorization", `Bearer ${t}`);
  async function login(email = ADMIN_EMAIL, password = ADMIN_PASSWORD) { return (await api().post("/auth/login").send({ email, password }).expect(201)).body.accessToken as string; }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile(); app = moduleRef.createNestApplication(); await app.init(); prisma = app.get(PrismaService); token = await login();
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } }); tenantId = admin.tenantId; userId = admin.id;
    const crossTenant = await prisma.tenant.create({ data: { name: `Tooling cross ${STAMP}` } });
    const cross = await prisma.user.create({ data: { tenantId: crossTenant.id, email: `tooling-cross-${STAMP}@ahkmes.local`, passwordHash: await bcrypt.hash("Cross1234!", 10), name: "Cross", role: "ADMIN" } });
    await prisma.actionPermissionGrant.create({ data: { tenantId: crossTenant.id, action: "TOOL_READ", userId: cross.id, createdById: cross.id } });
    crossToken = await login(cross.email, "Cross1234!");
    partId = (await prisma.part.create({ data: { tenantId, partNo: `TOOL-${STAMP}`, revision: "A", name: "Tooling part" } })).id;
    machineId = (await prisma.machine.create({ data: { tenantId, name: `CNC-${STAMP}`, model: "VMC", isActive: true } })).id;
    ncId = (await prisma.ncProgram.create({ data: { tenantId, partId, version: 1, fileName: "tooling.nc", fileRef: "tooling.nc", storageKey: `tests/${STAMP}.nc`, mimeType: "text/plain", sizeBytes: 10, checksum: "a".repeat(64), status: "PUBLISHED", createdById: userId, publishedById: userId, publishedAt: new Date() } })).id;
    workOrderId = (await prisma.workOrder.create({ data: { tenantId, woNo: `TOOL-WO-${STAMP}`, partId, quantity: 1, dueDate: new Date(Date.now() + 86400000), machineId } })).id;
    operationId = (await prisma.workOrderOperation.create({ data: { tenantId, workOrderId, seq: 10, name: "CNC milling", machineId, ncProgramId: ncId, ncProgramVersion: 1, ncProgramChecksum: "a".repeat(64), ncProgramFileName: "tooling.nc", ncProgramStorageKey: `tests/${STAMP}.nc` } })).id;
  });
  afterAll(async () => { await app.close(); });

  async function createOperation(name: string, overrides: { machineId?: string; ncProgramId?: string | null; ncProgramChecksum?: string | null } = {}) {
    const wo = await prisma.workOrder.create({ data: { tenantId, woNo: `TOOL-${name}-${STAMP}-${Math.random().toString(36).slice(2)}`, partId, quantity: 1, dueDate: new Date(Date.now() + 86400000), machineId: overrides.machineId ?? machineId } });
    const operation = await prisma.workOrderOperation.create({ data: { tenantId, workOrderId: wo.id, seq: 10, name, machineId: overrides.machineId ?? machineId, ncProgramId: overrides.ncProgramId === undefined ? ncId : overrides.ncProgramId, ncProgramVersion: overrides.ncProgramId === undefined || overrides.ncProgramId === ncId ? 1 : null, ncProgramChecksum: overrides.ncProgramChecksum === undefined ? "a".repeat(64) : overrides.ncProgramChecksum, ncProgramFileName: overrides.ncProgramId === undefined || overrides.ncProgramId === ncId ? "tooling.nc" : null, ncProgramStorageKey: overrides.ncProgramId === undefined || overrides.ncProgramId === ncId ? `tests/${STAMP}.nc` : null } });
    return { wo, operation };
  }
  async function requirements(operationId: string, toolId = toolDefinitionId, fixtureId = fixtureDefinitionId, quantities = { tool: 1, fixture: 1 }) {
    const tool = await prisma.operationToolRequirement.create({ data: { tenantId, workOrderOperationId: operationId, toolDefinitionId: toolId, quantity: quantities.tool } });
    const fixture = await prisma.operationFixtureRequirement.create({ data: { tenantId, workOrderOperationId: operationId, fixtureDefinitionId: fixtureId, quantity: quantities.fixture } });
    return { tool, fixture };
  }
  async function assignAndVerify(operationId: string, req: { tool: { id: string }; fixture: { id: string } }, toolId = toolInstanceId, fixtureId = fixtureInstanceId, expected = 201) {
    await as(token, api().post(`/tooling/operations/${operationId}/setup/assignments`).send({ toolAssignments: [{ requirementId: req.tool.id, physicalToolInstanceId: toolId }], fixtureAssignments: [{ requirementId: req.fixture.id, physicalFixtureInstanceId: fixtureId }] })).expect(201);
    return as(token, api().post(`/tooling/operations/${operationId}/setup/verify`).send({})).expect(expected);
  }

  it("creates tenant-scoped masters, compatibility and verifies a usable CNC setup", async () => {
    toolDefinitionId = (await as(token, api().post("/tooling/tool-definitions").send({ code: `EM-${STAMP}`, name: "End mill", toolType: "END_MILL", lifePolicy: "CYCLE", maximumLife: 10, warningThreshold: 2, lifeUnit: "cycle" })).expect(201)).body.id;
    toolInstanceId = (await as(token, api().post("/tooling/physical-tools").send({ toolDefinitionId, serialNo: `T-${STAMP}`, remainingLife: 10 })).expect(201)).body.id;
    fixtureDefinitionId = (await as(token, api().post("/tooling/fixture-definitions").send({ code: `FX-${STAMP}`, name: "Vise", fixtureType: "VISE" })).expect(201)).body.id;
    fixtureInstanceId = (await as(token, api().post("/tooling/physical-fixtures").send({ fixtureDefinitionId, serialNo: `F-${STAMP}` })).expect(201)).body.id;
    await as(token, api().post("/tooling/tool-compatibilities").send({ machineId, toolDefinitionId })).expect(201);
    await as(token, api().post("/tooling/fixture-compatibilities").send({ machineId, fixtureDefinitionId })).expect(201);
    const toolReq = await as(token, api().post(`/tooling/operations/${operationId}/tool-requirements`).send({ toolDefinitionId, quantity: 1 })).expect(201);
    const fixtureReq = await as(token, api().post(`/tooling/operations/${operationId}/fixture-requirements`).send({ fixtureDefinitionId, quantity: 1 })).expect(201);
    await as(token, api().post(`/tooling/operations/${operationId}/setup/assignments`).send({ toolAssignments: [{ requirementId: toolReq.body.id, physicalToolInstanceId: toolInstanceId }], fixtureAssignments: [{ requirementId: fixtureReq.body.id, physicalFixtureInstanceId: fixtureInstanceId }] })).expect(201);
    const setup = await as(token, api().post(`/tooling/operations/${operationId}/setup/verify`).send({})).expect(201);
    verificationId = setup.body?.verification?.id ?? setup.body?.id;
    const current = await as(token, api().get(`/tooling/operations/${operationId}/setup`)).expect(200);
    expect(current.body.verification.status).toBe("VERIFIED"); expect(current.body.verification.snapshot.payload.ncProgram.checksum).toBe("a".repeat(64));
    expect((await prisma.physicalToolInstance.findUniqueOrThrow({ where: { id: toolInstanceId } })).status).toBe("RESERVED");
  });

  it("enforces start gate, immutable snapshot, tenant boundaries and stale manual-life concurrency", async () => {
    await as(crossToken, api().get(`/tooling/operations/${operationId}/setup`)).expect(404);
    await prisma.toolDefinition.update({ where: { id: toolDefinitionId }, data: { name: "Changed after setup" } });
    const setup = await as(token, api().get(`/tooling/operations/${operationId}/setup`)).expect(200);
    expect(setup.body.verification.snapshot.payload.assignments[0].tool.definition.code).toBe(`EM-${STAMP}`);
    const started = await as(token, api().post(`/work-orders/${workOrderId}/runs`).send({ operationId, machineId })).expect(201);
    expect((await prisma.physicalToolInstance.findUniqueOrThrow({ where: { id: toolInstanceId } })).status).toBe("IN_USE");
    const startedSetup = await as(token, api().get(`/tooling/operations/${operationId}/setup`)).expect(200);
    expect(startedSetup.body.verification.snapshot.payload.assignments[0].tool.definition.code).toBe(`EM-${STAMP}`);
    await as(token, api().post(`/runs/${started.body.id}/complete`).send({})).expect(201);
    await as(token, api().post(`/work-orders/${workOrderId}/operations/${operationId}/complete`).send({})).expect(201);
    await as(token, api().post(`/work-orders/${workOrderId}/operations/${operationId}/complete`).send({})).expect(201);
    const tool = await prisma.physicalToolInstance.findUniqueOrThrow({ where: { id: toolInstanceId } });
    expect(Number(tool.consumedLife)).toBe(1); expect(tool.status).toBe("AVAILABLE");
    const fixture = await prisma.physicalFixtureInstance.findUniqueOrThrow({ where: { id: fixtureInstanceId } });
    expect(Number(fixture.maintenanceCycleCount)).toBe(1); expect(Number(fixture.maintenancePartCount)).toBe(1);
    expect(await prisma.toolLifeEvent.count({ where: { physicalToolInstanceId: toolInstanceId, eventType: "OPERATION_COMPLETE" } })).toBe(1);
    await as(token, api().post(`/tooling/physical-tools/${toolInstanceId}/life-adjustments`).send({ consumedLife: 2, version: tool.version - 1, reason: "stale" })).expect(409);
    await as(token, api().post(`/tooling/physical-tools/${toolInstanceId}/life-adjustments`).send({ consumedLife: 2, version: tool.version, reason: "verified correction" })).expect(201);
    expect((await prisma.auditLog.count({ where: { entity: "PhysicalToolInstance", entityId: toolInstanceId } }))).toBeGreaterThan(0);
  });

  it("enforces action grants independently from entitlement and records life adjustment audit", async () => {
    const reader = await prisma.user.create({ data: { tenantId, email: `tooling-reader-${STAMP}@ahkmes.local`, passwordHash: await bcrypt.hash("Reader1234!", 10), name: "Tool reader", role: "SALES" } });
    await prisma.actionPermissionGrant.create({ data: { tenantId, action: "TOOL_READ", userId: reader.id, createdById: userId } });
    const readerToken = await login(reader.email, "Reader1234!");
    await as(readerToken, api().get("/tooling")).expect(200);
    await as(readerToken, api().post("/tooling/tool-definitions").send({ code: `DENY-${STAMP}`, name: "Denied", toolType: "END_MILL", lifePolicy: "CYCLE", maximumLife: 1, warningThreshold: 0, lifeUnit: "cycle" })).expect(403);
    await as(readerToken, api().post("/tooling/fixture-definitions").send({ code: `DENY-F-${STAMP}`, name: "Denied", fixtureType: "VISE" })).expect(403);
    await as(readerToken, api().post(`/tooling/operations/${operationId}/setup/assignments`).send({ toolAssignments: [], fixtureAssignments: [] })).expect(403);
    await as(readerToken, api().post(`/tooling/operations/${operationId}/setup/verify`).send({})).expect(403);
    const tool = await prisma.physicalToolInstance.findUniqueOrThrow({ where: { id: toolInstanceId } });
    await as(readerToken, api().post(`/tooling/physical-tools/${toolInstanceId}/life-adjustments`).send({ consumedLife: Number(tool.consumedLife), version: tool.version, reason: "not authorized" })).expect(403);
    const fixtureReader = await prisma.user.create({ data: { tenantId, email: `fixture-reader-${STAMP}@ahkmes.local`, passwordHash: await bcrypt.hash("Fixture1234!", 10), name: "Fixture reader", role: "SALES" } });
    await prisma.actionPermissionGrant.create({ data: { tenantId, action: "FIXTURE_READ", userId: fixtureReader.id, createdById: userId } });
    const fixtureReaderToken = await login(fixtureReader.email, "Fixture1234!");
    await as(fixtureReaderToken, api().get("/tooling/fixture-definitions")).expect(200);
    await as(fixtureReaderToken, api().post("/tooling/fixture-definitions").send({ code: `DENY-READ-${STAMP}`, name: "Denied", fixtureType: "VISE" })).expect(403);
    await as(token, api().post(`/tooling/physical-tools/${toolInstanceId}/life-adjustments`).send({ consumedLife: Number(tool.consumedLife), version: tool.version, reason: "" })).expect(400);
    await prisma.tenantModuleEntitlement.upsert({ where: { tenantId_module: { tenantId, module: "MES_CNC_TOOLING" } }, create: { tenantId, module: "MES_CNC_TOOLING", isEnabled: false }, update: { isEnabled: false } });
    await as(token, api().get("/tooling")).expect(403);
    await prisma.tenantModuleEntitlement.update({ where: { tenantId_module: { tenantId, module: "MES_CNC_TOOLING" } }, data: { isEnabled: true } });
    const audit = await prisma.auditLog.findFirst({ where: { tenantId, entity: "PhysicalToolInstance", entityId: toolInstanceId, action: "UPDATE" }, orderBy: { createdAt: "desc" } });
    expect(audit?.before).toBeTruthy(); expect(audit?.after).toBeTruthy(); expect((audit?.after as any)?.reason).toBe("verified correction");
  });

  it("rejects unavailable resources, missing setup, incompatible machine and cross-tenant references", async () => {
    const noSetup = await createOperation("missing setup");
    await requirements(noSetup.operation.id);
    await as(token, api().post(`/work-orders/${noSetup.wo.id}/runs`).send({ operationId: noSetup.operation.id, machineId })).expect(409);
    const noTooling = await createOperation("no tooling", { ncProgramId: null, ncProgramChecksum: null });
    await as(token, api().post(`/work-orders/${noTooling.wo.id}/runs`).send({ operationId: noTooling.operation.id, machineId })).expect(201);
    const draftNc = await prisma.ncProgram.create({ data: { tenantId, partId, version: 2, fileName: "draft.nc", fileRef: "draft.nc", storageKey: `tests/${STAMP}-draft.nc`, mimeType: "text/plain", sizeBytes: 10, checksum: "b".repeat(64), status: "DRAFT", createdById: userId } });
    const draft = await createOperation("draft NC", { ncProgramId: draftNc.id, ncProgramChecksum: draftNc.checksum });
    await as(token, api().post(`/work-orders/${draft.wo.id}/runs`).send({ operationId: draft.operation.id, machineId })).expect(409);

    const incompatibleMachine = await prisma.machine.create({ data: { tenantId, name: `NO-COMPAT-${STAMP}`, model: "VMC", isActive: true } });
    const wrongMachine = await createOperation("wrong machine", { machineId: incompatibleMachine.id }); const wrongReq = await requirements(wrongMachine.operation.id);
    await as(token, api().post(`/tooling/operations/${wrongMachine.operation.id}/setup/assignments`).send({ toolAssignments: [{ requirementId: wrongReq.tool.id, physicalToolInstanceId: toolInstanceId }], fixtureAssignments: [{ requirementId: wrongReq.fixture.id, physicalFixtureInstanceId: fixtureInstanceId }] })).expect(201);
    await as(token, api().post(`/tooling/operations/${wrongMachine.operation.id}/setup/verify`).send({})).expect(409);

    const fixtureOnlyMachine = await prisma.machine.create({ data: { tenantId, name: `TOOL-ONLY-${STAMP}`, model: "VMC", isActive: true } });
    await prisma.toolMachineCompatibility.create({ data: { tenantId, machineId: fixtureOnlyMachine.id, toolDefinitionId } });
    const fixtureMismatch = await createOperation("fixture mismatch", { machineId: fixtureOnlyMachine.id }); const fixtureMismatchReq = await requirements(fixtureMismatch.operation.id);
    await as(token, api().post(`/tooling/operations/${fixtureMismatch.operation.id}/setup/assignments`).send({ toolAssignments: [{ requirementId: fixtureMismatchReq.tool.id, physicalToolInstanceId: toolInstanceId }], fixtureAssignments: [{ requirementId: fixtureMismatchReq.fixture.id, physicalFixtureInstanceId: fixtureInstanceId }] })).expect(201);
    await as(token, api().post(`/tooling/operations/${fixtureMismatch.operation.id}/setup/verify`).send({})).expect(409);

    for (const status of ["EXPIRED", "BROKEN", "QUARANTINED", "RETIRED"]) {
      const instance = await prisma.physicalToolInstance.create({ data: { tenantId, toolDefinitionId, serialNo: `UNAVAILABLE-${status}-${STAMP}`, consumedLife: status === "EXPIRED" ? 10 : 0, remainingLife: status === "EXPIRED" ? 0 : 10, status: status as any } });
      const sample = await createOperation(`tool ${status}`); const req = await requirements(sample.operation.id);
      await as(token, api().post(`/tooling/operations/${sample.operation.id}/setup/assignments`).send({ toolAssignments: [{ requirementId: req.tool.id, physicalToolInstanceId: instance.id }], fixtureAssignments: [{ requirementId: req.fixture.id, physicalFixtureInstanceId: fixtureInstanceId }] })).expect(201);
      await as(token, api().post(`/tooling/operations/${sample.operation.id}/setup/verify`).send({})).expect(409);
    }
    for (const status of ["MAINTENANCE", "QUARANTINED", "RETIRED"]) {
      const instance = await prisma.physicalFixtureInstance.create({ data: { tenantId, fixtureDefinitionId, serialNo: `UNAVAILABLE-F-${status}-${STAMP}`, status: status as any } });
      const sample = await createOperation(`fixture ${status}`); const req = await requirements(sample.operation.id);
      await as(token, api().post(`/tooling/operations/${sample.operation.id}/setup/assignments`).send({ toolAssignments: [{ requirementId: req.tool.id, physicalToolInstanceId: toolInstanceId }], fixtureAssignments: [{ requirementId: req.fixture.id, physicalFixtureInstanceId: instance.id }] })).expect(201);
      await as(token, api().post(`/tooling/operations/${sample.operation.id}/setup/verify`).send({})).expect(409);
    }
    const crossMachine = await prisma.machine.create({ data: { tenantId: (await prisma.user.findUniqueOrThrow({ where: { email: `tooling-cross-${STAMP}@ahkmes.local` } })).tenantId, name: `CROSS-M-${STAMP}`, model: "VMC", isActive: true } });
    const crossTool = await prisma.toolDefinition.create({ data: { tenantId: crossMachine.tenantId, code: `CROSS-T-${STAMP}`, name: "Cross tool", toolType: "END_MILL", lifePolicy: "CYCLE", maximumLife: 10, warningThreshold: 1, lifeUnit: "cycle" } });
    const crossFixtureDefinition = await prisma.fixtureDefinition.create({ data: { tenantId: crossMachine.tenantId, code: `CROSS-F-${STAMP}`, name: "Cross fixture", fixtureType: "VISE" } });
    const crossFixture = await prisma.physicalFixtureInstance.create({ data: { tenantId: crossMachine.tenantId, fixtureDefinitionId: crossFixtureDefinition.id, serialNo: `CROSS-FI-${STAMP}` } });
    const crossPart = await prisma.part.create({ data: { tenantId: crossMachine.tenantId, partNo: `CROSS-P-${STAMP}`, revision: "A", name: "Cross part" } });
    const crossNc = await prisma.ncProgram.create({ data: { tenantId: crossMachine.tenantId, partId: crossPart.id, version: 1, fileName: "cross.nc", fileRef: "cross.nc", storageKey: `tests/cross-${STAMP}.nc`, mimeType: "text/plain", sizeBytes: 10, checksum: "c".repeat(64), status: "PUBLISHED", createdById: (await prisma.user.findUniqueOrThrow({ where: { email: `tooling-cross-${STAMP}@ahkmes.local` } })).id, publishedById: (await prisma.user.findUniqueOrThrow({ where: { email: `tooling-cross-${STAMP}@ahkmes.local` } })).id, publishedAt: new Date() } });
    await as(token, api().post("/tooling/tool-compatibilities").send({ machineId: crossMachine.id, toolDefinitionId })).expect(404);
    await as(token, api().post(`/tooling/operations/${noSetup.operation.id}/tool-requirements`).send({ toolDefinitionId: crossTool.id, quantity: 1 })).expect(404);
    await as(token, api().post(`/tooling/operations/${noSetup.operation.id}/setup/assignments`).send({ toolAssignments: [{ requirementId: (await prisma.operationToolRequirement.findFirstOrThrow({ where: { workOrderOperationId: noSetup.operation.id } })).id, physicalToolInstanceId: toolInstanceId }], fixtureAssignments: [{ requirementId: (await prisma.operationFixtureRequirement.findFirstOrThrow({ where: { workOrderOperationId: noSetup.operation.id } })).id, physicalFixtureInstanceId: crossFixture.id }] })).expect(404);
    await prisma.workOrderOperation.update({ where: { id: noSetup.operation.id }, data: { ncProgramId: crossNc.id, ncProgramVersion: 1, ncProgramChecksum: crossNc.checksum, ncProgramFileName: crossNc.fileName, ncProgramStorageKey: crossNc.storageKey } });
    await as(token, api().post(`/tooling/operations/${noSetup.operation.id}/setup/assignments`).send({ toolAssignments: [{ requirementId: (await prisma.operationToolRequirement.findFirstOrThrow({ where: { workOrderOperationId: noSetup.operation.id } })).id, physicalToolInstanceId: toolInstanceId }], fixtureAssignments: [{ requirementId: (await prisma.operationFixtureRequirement.findFirstOrThrow({ where: { workOrderOperationId: noSetup.operation.id } })).id, physicalFixtureInstanceId: fixtureInstanceId }] })).expect(201);
    await as(token, api().post(`/tooling/operations/${noSetup.operation.id}/setup/verify`).send({})).expect(404);
    await as(crossToken, api().get(`/tooling/operations/${noSetup.operation.id}/setup`)).expect(404);
  });

  it("uses PostgreSQL partial unique reservations under genuinely parallel verification requests", async () => {
    const sharedTool = await prisma.physicalToolInstance.create({ data: { tenantId, toolDefinitionId, serialNo: `PAR-T-${STAMP}`, remainingLife: 10 } });
    const fixtureA = await prisma.physicalFixtureInstance.create({ data: { tenantId, fixtureDefinitionId, serialNo: `PAR-FA-${STAMP}` } });
    const fixtureB = await prisma.physicalFixtureInstance.create({ data: { tenantId, fixtureDefinitionId, serialNo: `PAR-FB-${STAMP}` } });
    const a = await createOperation("parallel tool a"); const b = await createOperation("parallel tool b"); const ar = await requirements(a.operation.id); const br = await requirements(b.operation.id);
    await as(token, api().post(`/tooling/operations/${a.operation.id}/setup/assignments`).send({ toolAssignments: [{ requirementId: ar.tool.id, physicalToolInstanceId: sharedTool.id }], fixtureAssignments: [{ requirementId: ar.fixture.id, physicalFixtureInstanceId: fixtureA.id }] })).expect(201);
    await as(token, api().post(`/tooling/operations/${b.operation.id}/setup/assignments`).send({ toolAssignments: [{ requirementId: br.tool.id, physicalToolInstanceId: sharedTool.id }], fixtureAssignments: [{ requirementId: br.fixture.id, physicalFixtureInstanceId: fixtureB.id }] })).expect(201);
    const toolResults = await Promise.all([as(token, api().post(`/tooling/operations/${a.operation.id}/setup/verify`).send({})), as(token, api().post(`/tooling/operations/${b.operation.id}/setup/verify`).send({}))]);
    expect(toolResults.filter((r) => r.status === 201)).toHaveLength(1); expect(toolResults.filter((r) => r.status === 409)).toHaveLength(1); expect(JSON.stringify(toolResults.find((r) => r.status === 409)?.body)).not.toMatch(/P2002|Prisma/i);

    const sharedFixture = await prisma.physicalFixtureInstance.create({ data: { tenantId, fixtureDefinitionId, serialNo: `PAR-F-${STAMP}` } });
    const toolA = await prisma.physicalToolInstance.create({ data: { tenantId, toolDefinitionId, serialNo: `PAR-TA-${STAMP}`, remainingLife: 10 } }); const toolB = await prisma.physicalToolInstance.create({ data: { tenantId, toolDefinitionId, serialNo: `PAR-TB-${STAMP}`, remainingLife: 10 } });
    const c = await createOperation("parallel fixture a"); const d = await createOperation("parallel fixture b"); const cr = await requirements(c.operation.id); const dr = await requirements(d.operation.id);
    await as(token, api().post(`/tooling/operations/${c.operation.id}/setup/assignments`).send({ toolAssignments: [{ requirementId: cr.tool.id, physicalToolInstanceId: toolA.id }], fixtureAssignments: [{ requirementId: cr.fixture.id, physicalFixtureInstanceId: sharedFixture.id }] })).expect(201);
    await as(token, api().post(`/tooling/operations/${d.operation.id}/setup/assignments`).send({ toolAssignments: [{ requirementId: dr.tool.id, physicalToolInstanceId: toolB.id }], fixtureAssignments: [{ requirementId: dr.fixture.id, physicalFixtureInstanceId: sharedFixture.id }] })).expect(201);
    const fixtureResults = await Promise.all([as(token, api().post(`/tooling/operations/${c.operation.id}/setup/verify`).send({})), as(token, api().post(`/tooling/operations/${d.operation.id}/setup/verify`).send({}))]);
    expect(fixtureResults.filter((r) => r.status === 201)).toHaveLength(1); expect(fixtureResults.filter((r) => r.status === 409)).toHaveLength(1); expect(JSON.stringify(fixtureResults.find((r) => r.status === 409)?.body)).not.toMatch(/P2002|Prisma/i);
  });

  it("copies RecipeStep requirements into new work-order snapshots without mutating existing operations", async () => {
    const recipe = await prisma.recipeHeader.create({ data: { tenantId, partId, revision: `TOOL-${STAMP}`, steps: { create: { tenantId, seq: 10, name: "Recipe CNC", ncProgramId: ncId } } }, include: { steps: true } });
    const step = recipe.steps[0];
    await as(token, api().post(`/tooling/recipe-steps/${step.id}/tool-requirements`).send({ toolDefinitionId, quantity: 1, sequence: 1 })).expect(201);
    await as(token, api().post(`/tooling/recipe-steps/${step.id}/fixture-requirements`).send({ fixtureDefinitionId, quantity: 1, sequence: 1 })).expect(201);
    const first = await as(token, api().post("/work-orders").send({ partId, quantity: 1, dueDate: new Date(Date.now() + 86400000).toISOString(), machineId })).expect(201);
    const firstOperation = first.body.operations[0];
    expect(await prisma.operationToolRequirement.count({ where: { tenantId, workOrderOperationId: firstOperation.id } })).toBe(1);
    const extraDefinition = await prisma.toolDefinition.create({ data: { tenantId, code: `RECIPE-ALT-${STAMP}`, name: "Recipe alternative", toolType: "DRILL", lifePolicy: "CYCLE", maximumLife: 10, warningThreshold: 1, lifeUnit: "cycle" } });
    await as(token, api().post(`/tooling/recipe-steps/${step.id}/tool-requirements`).send({ toolDefinitionId: extraDefinition.id, quantity: 1, alternativeGroup: "ALT", sequence: 2 })).expect(201);
    const second = await as(token, api().post("/work-orders").send({ partId, quantity: 1, dueDate: new Date(Date.now() + 86400000).toISOString(), machineId })).expect(201);
    expect(await prisma.operationToolRequirement.count({ where: { tenantId, workOrderOperationId: firstOperation.id } })).toBe(1);
    expect(await prisma.operationToolRequirement.count({ where: { tenantId, workOrderOperationId: second.body.operations[0].id } })).toBe(2);
  });

  it("rejects stale life verification and evaluates alternative groups and minimum quantities", async () => {
    const staleTool = await prisma.physicalToolInstance.create({ data: { tenantId, toolDefinitionId, serialNo: `STALE-${STAMP}`, remainingLife: 10 } }); const staleFixture = await prisma.physicalFixtureInstance.create({ data: { tenantId, fixtureDefinitionId, serialNo: `STALE-F-${STAMP}` } });
    const stale = await createOperation("stale life"); const staleReq = await requirements(stale.operation.id);
    await as(token, api().post(`/tooling/operations/${stale.operation.id}/setup/assignments`).send({ toolAssignments: [{ requirementId: staleReq.tool.id, physicalToolInstanceId: staleTool.id }], fixtureAssignments: [{ requirementId: staleReq.fixture.id, physicalFixtureInstanceId: staleFixture.id }] })).expect(201);
    let verifyRequest: Promise<request.Response> | undefined;
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "PhysicalToolInstance" WHERE "id" = ${staleTool.id} FOR UPDATE`;
      verifyRequest = as(token, api().post(`/tooling/operations/${stale.operation.id}/setup/verify`).send({}));
      await new Promise((resolve) => setTimeout(resolve, 30));
      await tx.physicalToolInstance.update({ where: { id: staleTool.id }, data: { consumedLife: 10, remainingLife: 0, status: "EXPIRED", version: { increment: 1 } } });
    });
    await expect(verifyRequest!).resolves.toMatchObject({ status: 409 });

    const altToolA = await prisma.physicalToolInstance.create({ data: { tenantId, toolDefinitionId, serialNo: `ALT-A-${STAMP}`, remainingLife: 10 } }); const altToolB = await prisma.physicalToolInstance.create({ data: { tenantId, toolDefinitionId, serialNo: `ALT-B-${STAMP}`, remainingLife: 10 } }); const altFixture = await prisma.physicalFixtureInstance.create({ data: { tenantId, fixtureDefinitionId, serialNo: `ALT-F-${STAMP}` } });
    const alternative = await createOperation("alternative minimum");
    const altOne = await prisma.operationToolRequirement.create({ data: { tenantId, workOrderOperationId: alternative.operation.id, toolDefinitionId, quantity: 2, alternativeGroup: "CUTTER" } });
    const altFixtureReq = await prisma.operationFixtureRequirement.create({ data: { tenantId, workOrderOperationId: alternative.operation.id, fixtureDefinitionId, quantity: 1 } });
    await as(token, api().post(`/tooling/operations/${alternative.operation.id}/setup/assignments`).send({ toolAssignments: [{ requirementId: altOne.id, physicalToolInstanceId: altToolA.id }, { requirementId: altOne.id, physicalToolInstanceId: altToolB.id }], fixtureAssignments: [{ requirementId: altFixtureReq.id, physicalFixtureInstanceId: altFixture.id }] })).expect(201);
    await as(token, api().post(`/tooling/operations/${alternative.operation.id}/setup/verify`).send({})).expect(201);
    const insufficient = await createOperation("minimum insufficient"); const insufficientReq = await requirements(insufficient.operation.id, toolDefinitionId, fixtureDefinitionId, { tool: 2, fixture: 2 });
    const insufficientTool = await prisma.physicalToolInstance.create({ data: { tenantId, toolDefinitionId, serialNo: `MIN-T-${STAMP}`, remainingLife: 10 } }); const insufficientFixture = await prisma.physicalFixtureInstance.create({ data: { tenantId, fixtureDefinitionId, serialNo: `MIN-F-${STAMP}` } });
    await as(token, api().post(`/tooling/operations/${insufficient.operation.id}/setup/assignments`).send({ toolAssignments: [{ requirementId: insufficientReq.tool.id, physicalToolInstanceId: insufficientTool.id }], fixtureAssignments: [{ requirementId: insufficientReq.fixture.id, physicalFixtureInstanceId: insufficientFixture.id }] })).expect(201);
    await as(token, api().post(`/tooling/operations/${insufficient.operation.id}/setup/verify`).send({})).expect(409);

    const changedTool = await prisma.physicalToolInstance.create({ data: { tenantId, toolDefinitionId, serialNo: `CHANGED-T-${STAMP}`, remainingLife: 10 } }); const changedFixture = await prisma.physicalFixtureInstance.create({ data: { tenantId, fixtureDefinitionId, serialNo: `CHANGED-F-${STAMP}` } });
    const changed = await createOperation("assignment changed"); const changedReq = await requirements(changed.operation.id);
    await assignAndVerify(changed.operation.id, changedReq, changedTool.id, changedFixture.id);
    await prisma.physicalToolInstance.update({ where: { id: changedTool.id }, data: { status: "AVAILABLE" } });
    await as(token, api().post(`/work-orders/${changed.wo.id}/runs`).send({ operationId: changed.operation.id, machineId })).expect(409);
  });

  it("blocks a new setup when its previously verified NC revision is superseded", async () => {
    const secondWo = await prisma.workOrder.create({ data: { tenantId, woNo: `TOOL-WO2-${STAMP}`, partId, quantity: 1, dueDate: new Date(Date.now() + 86400000), machineId } });
    const op = await prisma.workOrderOperation.create({ data: { tenantId, workOrderId: secondWo.id, seq: 10, name: "CNC second", machineId, ncProgramId: ncId, ncProgramVersion: 1, ncProgramChecksum: "a".repeat(64), ncProgramFileName: "tooling.nc", ncProgramStorageKey: `tests/${STAMP}.nc` } });
    const tr = await prisma.operationToolRequirement.create({ data: { tenantId, workOrderOperationId: op.id, toolDefinitionId, quantity: 1 } }); const fr = await prisma.operationFixtureRequirement.create({ data: { tenantId, workOrderOperationId: op.id, fixtureDefinitionId, quantity: 1 } });
    await as(token, api().post(`/tooling/operations/${op.id}/setup/assignments`).send({ toolAssignments: [{ requirementId: tr.id, physicalToolInstanceId: toolInstanceId }], fixtureAssignments: [{ requirementId: fr.id, physicalFixtureInstanceId: fixtureInstanceId }] })).expect(201);
    await as(token, api().post(`/tooling/operations/${op.id}/setup/verify`).send({})).expect(201);
    await prisma.ncProgram.update({ where: { id: ncId }, data: { status: "SUPERSEDED" } });
    await as(token, api().post(`/work-orders/${secondWo.id}/runs`).send({ operationId: op.id, machineId })).expect(409);
  });

  it("evaluates fixture maintenance and calibration policies with real event idempotency", async () => {
    const definition = await as(token, api().post("/tooling/fixture-definitions").send({ code: `MAINT-${STAMP}`, name: "Maintained vise", fixtureType: "VISE" })).expect(201);
    const physical = await as(token, api().post("/tooling/physical-fixtures").send({ fixtureDefinitionId: definition.body.id, serialNo: `MAINT-F-${STAMP}` })).expect(201);
    const maintenancePolicy = await as(token, api().post("/tooling/fixture-maintenance/maintenance-policies").send({ fixtureDefinitionId: definition.body.id, policyType: "TIME", interval: 30, warningThreshold: 7, enforcement: "BLOCKING" })).expect(201);
    await as(token, api().post("/tooling/fixture-maintenance/calibration-policies").send({ fixtureDefinitionId: definition.body.id, intervalDays: 365, warningDays: 30, enforcement: "BLOCKING", certificateRequired: false })).expect(201);
    const before = await as(token, api().get(`/tooling/fixture-maintenance/fixtures/${physical.body.id}/evaluation`)).expect(200);
    expect(before.body.blockers.join(" ")).toMatch(/Bakım|kalibrasyon/);
    const scheduled = await as(token, api().post("/tooling/fixture-maintenance/events").send({ physicalFixtureInstanceId: physical.body.id, fixtureMaintenancePolicyId: maintenancePolicy.body.id, maintenanceType: "PM", idempotencyKey: `fixture-maint-${STAMP}` })).expect(201);
    const scheduledAgain = await as(token, api().post("/tooling/fixture-maintenance/events").send({ physicalFixtureInstanceId: physical.body.id, fixtureMaintenancePolicyId: maintenancePolicy.body.id, maintenanceType: "PM", idempotencyKey: `fixture-maint-${STAMP}` })).expect(201);
    expect(scheduledAgain.body.id).toBe(scheduled.body.id);
    const started = await as(token, api().post(`/tooling/fixture-maintenance/events/${scheduled.body.id}/start`).send({ version: scheduled.body.version })).expect(201);
    await as(token, api().post(`/tooling/fixture-maintenance/events/${scheduled.body.id}/complete`).send({ result: "PASS", version: started.body.version, idempotencyKey: `fixture-maint-complete-${STAMP}` })).expect(201);
    const calibrationPayload = { physicalFixtureInstanceId: physical.body.id, calibratedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 86400000).toISOString(), result: "PASS", idempotencyKey: `fixture-cal-${STAMP}` };
    const calibration = await as(token, api().post("/tooling/fixture-maintenance/calibration-records").send(calibrationPayload)).expect(201);
    const calibrationAgain = await as(token, api().post("/tooling/fixture-maintenance/calibration-records").send(calibrationPayload)).expect(201);
    expect(calibrationAgain.body.id).toBe(calibration.body.id);
    const after = await as(token, api().get(`/tooling/fixture-maintenance/fixtures/${physical.body.id}/evaluation`)).expect(200);
    expect(after.body.blockers).toEqual([]);
    expect(await prisma.auditLog.count({ where: { tenantId, entity: { in: ["FixtureMaintenanceEvent", "FixtureCalibrationRecord"] }, entityId: { in: [scheduled.body.id, calibration.body.id] } } })).toBeGreaterThanOrEqual(2);

    const freshTool = await prisma.toolDefinition.create({ data: { tenantId, code: `MAINT-T-${STAMP}`, name: "Policy test cutter", toolType: "END_MILL", lifePolicy: "CYCLE", maximumLife: 10, warningThreshold: 2, lifeUnit: "cycle" } });
    const freshToolInstance = await prisma.physicalToolInstance.create({ data: { tenantId, toolDefinitionId: freshTool.id, serialNo: `MAINT-TI-${STAMP}`, remainingLife: 10 } });
    await prisma.toolMachineCompatibility.create({ data: { tenantId, machineId, toolDefinitionId: freshTool.id } });
    await prisma.fixtureMachineCompatibility.create({ data: { tenantId, machineId, fixtureDefinitionId: definition.body.id } });
    const published = await prisma.ncProgram.create({ data: { tenantId, partId, version: 99, fileName: "policy.nc", fileRef: "policy.nc", storageKey: `tests/${STAMP}-policy.nc`, mimeType: "text/plain", sizeBytes: 1, checksum: "c".repeat(64), status: "PUBLISHED", createdById: userId, publishedById: userId, publishedAt: new Date() } });
    const policyOperation = await createOperation("fixture policy revalidation", { ncProgramId: published.id, ncProgramChecksum: published.checksum });
    const policyRequirements = await requirements(policyOperation.operation.id, freshTool.id, definition.body.id);
    await assignAndVerify(policyOperation.operation.id, policyRequirements, freshToolInstance.id, physical.body.id);
    await as(token, api().post("/tooling/fixture-maintenance/calibration-records").send({ physicalFixtureInstanceId: physical.body.id, calibratedAt: new Date().toISOString(), validUntil: new Date(Date.now() + 86400000).toISOString(), result: "FAIL", idempotencyKey: `fixture-cal-fail-${STAMP}` })).expect(201);
    await as(token, api().post(`/work-orders/${policyOperation.wo.id}/runs`).send({ operationId: policyOperation.operation.id, machineId })).expect(409);
  });

  it("uses policy-scoped CYCLE evidence, audited counter overrides and idempotent maintenance completion", async () => {
    const definition = await as(token, api().post("/tooling/fixture-definitions").send({ code: `CYCLE-${STAMP}`, name: "Cycle maintained fixture", fixtureType: "VISE" })).expect(201);
    const physical = await as(token, api().post("/tooling/physical-fixtures").send({ fixtureDefinitionId: definition.body.id, serialNo: `CYCLE-F-${STAMP}` })).expect(201);
    const policy = await as(token, api().post("/tooling/fixture-maintenance/maintenance-policies").send({ fixtureDefinitionId: definition.body.id, policyType: "CYCLE", interval: 2, warningThreshold: 1, enforcement: "BLOCKING" })).expect(201);
    const missing = await as(token, api().get(`/tooling/fixture-maintenance/fixtures/${physical.body.id}/evaluation`)).expect(200);
    expect(missing.body.maintenance.state).toBe("UNKNOWN"); expect(missing.body.blockers.length).toBeGreaterThan(0);

    const event = await as(token, api().post("/tooling/fixture-maintenance/events").send({ physicalFixtureInstanceId: physical.body.id, fixtureMaintenancePolicyId: policy.body.id, maintenanceType: "CYCLE_BASELINE", idempotencyKey: `cycle-schedule-${STAMP}` })).expect(201);
    const started = await as(token, api().post(`/tooling/fixture-maintenance/events/${event.body.id}/start`).send({ version: event.body.version })).expect(201);
    const completion = { result: "PASS", version: started.body.version, idempotencyKey: `cycle-complete-${STAMP}` };
    const completed = await as(token, api().post(`/tooling/fixture-maintenance/events/${event.body.id}/complete`).send(completion)).expect(201);
    const completedAgain = await as(token, api().post(`/tooling/fixture-maintenance/events/${event.body.id}/complete`).send(completion)).expect(201);
    expect(completedAgain.body.id).toBe(completed.body.id);
    const current = await as(token, api().get(`/tooling/fixture-maintenance/fixtures/${physical.body.id}/evaluation`)).expect(200);
    expect(current.body.maintenance.state).toBe("CURRENT");

    await as(token, api().post(`/tooling/fixture-maintenance/fixtures/${physical.body.id}/counter-adjustments`).send({ maintenanceCycleCount: 1, maintenancePartCount: 0, version: physical.body.version, reason: "stale" })).expect(409);
    const fresh = await prisma.physicalFixtureInstance.findUniqueOrThrow({ where: { id: physical.body.id } });
    await as(token, api().post(`/tooling/fixture-maintenance/fixtures/${physical.body.id}/counter-adjustments`).send({ maintenanceCycleCount: 1, maintenancePartCount: 0, version: fresh.version, reason: "verified cycle reconciliation" })).expect(201);
    const warning = await as(token, api().get(`/tooling/fixture-maintenance/fixtures/${physical.body.id}/evaluation`)).expect(200);
    expect(warning.body.maintenance.state).toBe("WARNING"); expect(warning.body.blockers).toEqual([]);
    const afterWarning = await prisma.physicalFixtureInstance.findUniqueOrThrow({ where: { id: physical.body.id } });
    await as(token, api().post(`/tooling/fixture-maintenance/fixtures/${physical.body.id}/counter-adjustments`).send({ maintenanceCycleCount: 2, maintenancePartCount: 0, version: afterWarning.version, reason: "verified overdue counter" })).expect(201);
    const overdue = await as(token, api().get(`/tooling/fixture-maintenance/fixtures/${physical.body.id}/evaluation`)).expect(200);
    expect(overdue.body.maintenance.state).toBe("OVERDUE"); expect(overdue.body.blockers.length).toBeGreaterThan(0);
    const audit = await prisma.auditLog.findFirst({ where: { tenantId, entity: "PhysicalFixtureInstance", entityId: physical.body.id, action: "UPDATE" }, orderBy: { createdAt: "desc" } });
    expect((audit?.after as any)?.reason).toBe("verified overdue counter");

    const policyAudit = await prisma.auditLog.findFirst({ where: { tenantId, entity: "FixtureMaintenancePolicy", entityId: policy.body.id, action: "CREATE" } });
    expect(policyAudit?.after).toBeTruthy();
    await as(token, api().patch(`/tooling/fixture-maintenance/maintenance-policies/${policy.body.id}`).send({ enforcement: "WARNING", version: policy.body.revision })).expect(200);
    await as(token, api().patch(`/tooling/fixture-maintenance/maintenance-policies/${policy.body.id}`).send({ enforcement: "BLOCKING", version: policy.body.revision })).expect(409);
  });

  it("allows only one genuinely concurrent maintenance start to reserve a physical fixture", async () => {
    const definition = await as(token, api().post("/tooling/fixture-definitions").send({ code: `RACE-${STAMP}`, name: "Maintenance race fixture", fixtureType: "VISE" })).expect(201);
    const physical = await as(token, api().post("/tooling/physical-fixtures").send({ fixtureDefinitionId: definition.body.id, serialNo: `RACE-F-${STAMP}` })).expect(201);
    const a = await as(token, api().post("/tooling/fixture-maintenance/events").send({ physicalFixtureInstanceId: physical.body.id, maintenanceType: "PM-A", idempotencyKey: `race-a-${STAMP}` })).expect(201);
    const b = await as(token, api().post("/tooling/fixture-maintenance/events").send({ physicalFixtureInstanceId: physical.body.id, maintenanceType: "PM-B", idempotencyKey: `race-b-${STAMP}` })).expect(201);
    const responses = await Promise.all([
      as(token, api().post(`/tooling/fixture-maintenance/events/${a.body.id}/start`).send({ version: a.body.version })),
      as(token, api().post(`/tooling/fixture-maintenance/events/${b.body.id}/start`).send({ version: b.body.version })),
    ]);
    expect(responses.filter((response) => response.status === 201)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(1);
    expect(JSON.stringify(responses.find((response) => response.status === 409)?.body)).not.toMatch(/P2002|Prisma/i);
  });
});
