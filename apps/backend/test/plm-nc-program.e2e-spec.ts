import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import * as bcrypt from "bcryptjs";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("PLM-001 controlled NC release (PostgreSQL e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken = "";
  let authorToken = "";
  let publisherToken = "";
  let crossTenantToken = "";
  let partId = "";
  let programV1 = "";
  let programV2 = "";
  let programV3 = "";
  let programV4 = "";
  let recipeId = "";
  let workOrderId = "";
  let authorId = "";
  let publisherId = "";
  let crossTenantUserId = "";
  let crossTenantId = "";

  const api = () => request(app.getHttpServer());
  const as = (token: string, test: request.Test) => test.set("Authorization", `Bearer ${token}`);

  async function login(email: string, password: string) {
    return (await api().post("/auth/login").send({ email, password }).expect(201)).body.accessToken as string;
  }

  function upload(token: string, id: string, text: string, name: string) {
    return as(token, api().post(`/nc-programs/${id}/file`)
      .attach("file", Buffer.from(text), { filename: name, contentType: "text/plain" }));
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
    adminToken = await login(ADMIN_EMAIL, ADMIN_PASSWORD);

    const author = await as(adminToken, api().post("/users").send({
      email: `plm-author-${STAMP}@ahkmes.local`, password: "Author1234!", name: "PLM Author", role: "PLANNER",
    })).expect(201);
    authorId = author.body.id;
    const publisher = await as(adminToken, api().post("/users").send({
      email: `plm-publisher-${STAMP}@ahkmes.local`, password: "Publisher1234!", name: "PLM Publisher", role: "PLANNER",
    })).expect(201);
    publisherId = publisher.body.id;
    authorToken = await login(`plm-author-${STAMP}@ahkmes.local`, "Author1234!");
    publisherToken = await login(`plm-publisher-${STAMP}@ahkmes.local`, "Publisher1234!");

    const tenant = await prisma.tenant.create({ data: { name: `PLM Cross Tenant ${STAMP}` } });
    crossTenantId = tenant.id;
    const cross = await prisma.user.create({ data: {
      tenantId: tenant.id, email: `plm-cross-${STAMP}@ahkmes.local`, passwordHash: await bcrypt.hash("Cross1234!", 10), name: "Cross Tenant", role: "PLANNER",
    } });
    crossTenantUserId = cross.id;
    crossTenantToken = await login(cross.email, "Cross1234!");
  });

  afterAll(async () => {
    if (workOrderId) await prisma.productionRun.deleteMany({ where: { workOrderId } }).catch(() => undefined);
    if (workOrderId) await prisma.workOrder.deleteMany({ where: { id: workOrderId } }).catch(() => undefined);
    if (recipeId) await prisma.recipeHeader.deleteMany({ where: { id: recipeId } }).catch(() => undefined);
    const programIds = [programV1, programV2, programV3, programV4].filter(Boolean);
    await prisma.ncProgramSignature.deleteMany({ where: { ncProgramId: { in: programIds } } }).catch(() => undefined);
    await prisma.approvalRequest.deleteMany({ where: { entity: "nc-program", entityId: { in: programIds } } }).catch(() => undefined);
    await prisma.ncProgram.deleteMany({ where: { id: { in: programIds } } }).catch(() => undefined);
    if (partId) await prisma.part.deleteMany({ where: { id: partId } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { in: [authorId, publisherId, crossTenantUserId].filter(Boolean) } } }).catch(() => undefined);
    if (crossTenantId) await prisma.tenant.deleteMany({ where: { id: crossTenantId } }).catch(() => undefined);
    await app.close();
  });

  it("enforces checksum, approval/e-signature separation, immutable release and audit", async () => {
    partId = (await as(authorToken, api().post("/parts").send({ partNo: `PLM-NC-${STAMP}`, revision: "A", name: "PLM NC Parçası" })).expect(201)).body.id;
    const draft = await as(authorToken, api().post(`/parts/${partId}/nc-programs`).send({ fileName: "part-v1.nc", fileRef: "part-v1.nc" })).expect(201);
    programV1 = draft.body.id;
    await as(authorToken, api().post(`/nc-programs/${programV1}/publish`).send({ password: "Author1234!" })).expect(409);
    await as(authorToken, api().post("/recipes").send({ partId, revision: `DRAFT-${STAMP}`, steps: [{ seq: 10, name: "Taslak NC engeli", ncProgramId: programV1 }] })).expect(409);
    const uploaded = await upload(authorToken, programV1, "G01 X10 Y20", "part-v1.nc").expect(201);
    expect(uploaded.body.checksum).toMatch(/^[a-f0-9]{64}$/);
    await as(authorToken, api().post(`/nc-programs/${programV1}/submit-review`).send({ note: "İlk sürüm" })).expect(201);
    await as(authorToken, api().post(`/nc-programs/${programV1}/approve`).send({ password: "Author1234!" })).expect(403);
    await as(adminToken, api().post(`/nc-programs/${programV1}/approve`).send({ password: ADMIN_PASSWORD, note: "Teknik onay" })).expect(201);
    await as(publisherToken, api().post(`/nc-programs/${programV1}/publish`).send({ password: "Publisher1234!", note: "Yayın" })).expect(201);
    await upload(authorToken, programV1, "G01 X99", "changed.nc").expect(409);

    const published = await as(authorToken, api().get(`/parts/${partId}/nc-programs`)).expect(200);
    expect(published.body[0]).toMatchObject({ id: programV1, status: "PUBLISHED", checksumAlgorithm: "SHA-256" });
    const audit = await prisma.auditLog.findMany({ where: { entity: "nc-program", entityId: programV1 }, orderBy: { createdAt: "asc" } });
    expect(audit.some((a) => (a.after as { status?: string })?.status === "PUBLISHED")).toBe(true);
    expect(await prisma.ncProgramSignature.count({ where: { ncProgramId: programV1 } })).toBe(2);
  });

  it("blocks cross-tenant access and only lets a released revision enter route/work-order execution", async () => {
    await as(crossTenantToken, api().get(`/nc-programs/${programV1}/url`)).expect(404);
    recipeId = (await as(adminToken, api().post("/recipes").send({
      partId, revision: `NC-${STAMP}`, steps: [{ seq: 10, name: "CNC işleme", ncProgramId: programV1 }],
    })).expect(201)).body.id;
    workOrderId = (await as(adminToken, api().post("/work-orders").send({
      partId, quantity: 1, dueDate: new Date(Date.now() + 86400000).toISOString(),
    })).expect(201)).body.id;
    const operation = (await as(authorToken, api().get(`/work-orders/${workOrderId}/operations`)).expect(200)).body[0];
    expect(operation.ncProgram).toMatchObject({ id: programV1, status: "PUBLISHED" });
    await as(authorToken, api().post(`/work-orders/${workOrderId}/runs`).send({ operationId: operation.id })).expect(201);

    const v2 = await as(authorToken, api().post(`/nc-programs/${programV1}/revisions`).send({ fileName: "part-v2.nc", fileRef: "part-v2.nc" })).expect(201);
    programV2 = v2.body.id;
    await upload(authorToken, programV2, "G01 X11 Y21", "part-v2.nc").expect(201);
    await as(authorToken, api().post(`/nc-programs/${programV2}/submit-review`).send({})).expect(201);
    await as(adminToken, api().post(`/nc-programs/${programV2}/approve`).send({ password: ADMIN_PASSWORD })).expect(201);
    await as(publisherToken, api().post(`/nc-programs/${programV2}/publish`).send({ password: "Publisher1234!" })).expect(201);

    await as(adminToken, api().post("/work-orders").send({ partId, quantity: 1, dueDate: new Date(Date.now() + 86400000).toISOString() })).expect(409);
    await as(adminToken, api().patch(`/work-orders/${workOrderId}/operations/${operation.id}`).send({ ncProgramId: programV1 })).expect(409);
  });

  it("serializes concurrent release candidates so a scope has one active revision", async () => {
    const createCandidate = async (fileName: string) => {
      const candidate = await as(authorToken, api().post(`/nc-programs/${programV2}/revisions`).send({ fileName, fileRef: fileName })).expect(201);
      await upload(authorToken, candidate.body.id, `G01 ${fileName}`, fileName).expect(201);
      await as(authorToken, api().post(`/nc-programs/${candidate.body.id}/submit-review`).send({})).expect(201);
      await as(adminToken, api().post(`/nc-programs/${candidate.body.id}/approve`).send({ password: ADMIN_PASSWORD })).expect(201);
      return candidate.body.id as string;
    };
    programV3 = await createCandidate("part-v3.nc");
    programV4 = await createCandidate("part-v4.nc");
    const results = await Promise.all([
      as(publisherToken, api().post(`/nc-programs/${programV3}/publish`).send({ password: "Publisher1234!" })),
      as(publisherToken, api().post(`/nc-programs/${programV4}/publish`).send({ password: "Publisher1234!" })),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.ncProgram.count({ where: { partId, effectivityScope: "GLOBAL", status: "PUBLISHED" } })).toBe(1);
    const archivedCandidate = results[0].status === 409 ? programV3 : programV4;
    await as(authorToken, api().post(`/nc-programs/${archivedCandidate}/archive`).send({})).expect(201);
    expect((await prisma.ncProgram.findUniqueOrThrow({ where: { id: archivedCandidate } })).status).toBe("ARCHIVED");
  });
});
