import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

/**
 * MES-OPERATOR-HMI-002 (Milestone 2) — RecipeStep.instructionHtml: sanitize-html
 * ile temizlenmiş zengin iş talimatı, gömülü resimler için Document/entityId
 * kararlılığı (upsert), ve WorkOrderOperation'a immutable snapshot.
 */
describe("MES-OPERATOR-HMI-002 — iş talimatı editörü (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let partId: string;

  const auth = (r: request.Test) => r.set("Authorization", `Bearer ${adminToken}`);
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    adminToken = (await api().post("/auth/login").send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).body.accessToken;
    partId = (await auth(api().post("/parts").send({ partNo: `WI-${STAMP}`, revision: "A", name: "Talimat Testi" }))).body.id;

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: ADMIN_EMAIL } });
    const hasHmiRead = await prisma.actionPermissionGrant.findFirst({ where: { tenantId: admin.tenantId, action: "HMI_READ", role: "ADMIN" } });
    if (!hasHmiRead) {
      await prisma.actionPermissionGrant.create({ data: { tenantId: admin.tenantId, action: "HMI_READ", role: "ADMIN", createdById: admin.id } });
    }
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { entityType: "recipe-step" } }).catch(() => undefined);
    await prisma.recipeHeader.deleteMany({ where: { partId } }).catch(() => undefined);
    await prisma.part.deleteMany({ where: { id: partId } }).catch(() => undefined);
    await app.close();
  });

  it("kaydedilen talimat XSS payload'ından temizlenir", async () => {
    const created = await auth(
      api()
        .post("/recipes")
        .send({
          partId,
          revision: "A",
          steps: [{ seq: 1, name: "Tornalama", instructionHtml: '<p onclick="alert(1)">talimat</p><script>alert(document.cookie)</script>' }],
        }),
    ).expect(201);

    expect(created.body.steps[0].instructionHtml).toBe("<p>talimat</p>");
  });

  it("recipe'yi güncellemek adım id'sini korur, önceden yüklenen resim erişilebilir kalır", async () => {
    const created = await auth(
      api()
        .post("/recipes")
        .send({ partId, revision: "B", steps: [{ seq: 1, name: "Freze", instructionHtml: "<p>ilk</p>" }] }),
    ).expect(201);
    const recipeId = created.body.id;
    const stepId = created.body.steps[0].id;

    const upload = await auth(
      api()
        .post(`/documents?entityType=recipe-step&entityId=${stepId}&docType=WORK_INSTRUCTION`)
        .attach("file", Buffer.from("fake-png-bytes"), { filename: "sema.png", contentType: "image/png" }),
    ).expect(201);
    const documentId = upload.body.id;

    // Adımın başka bir alanını (talimat metnini) değiştirerek recipe'yi güncelle.
    const updated = await auth(
      api()
        .patch(`/recipes/${recipeId}`)
        .send({ steps: [{ id: stepId, seq: 1, name: "Freze", instructionHtml: '<p>güncellendi</p><img data-document-id="' + documentId + '">' }] }),
    ).expect(200);

    expect(updated.body.steps[0].id).toBe(stepId);
    expect(updated.body.steps[0].instructionHtml).toContain(`data-document-id="${documentId}"`);

    const url = await auth(api().get(`/documents/${documentId}/url`)).expect(200);
    expect(url.body.url).toBeTruthy();
  });

  it("gelen listede olmayan bir adım silinir, bu reçeteye ait olmayan bir id gönderilirse reddedilir", async () => {
    const created = await auth(
      api()
        .post("/recipes")
        .send({
          partId,
          revision: "C",
          steps: [
            { seq: 1, name: "Adım A" },
            { seq: 2, name: "Adım B" },
          ],
        }),
    ).expect(201);
    const recipeId = created.body.id;
    const [stepA] = created.body.steps;

    const afterRemoval = await auth(
      api()
        .patch(`/recipes/${recipeId}`)
        .send({ steps: [{ id: stepA.id, seq: 1, name: "Adım A" }] }),
    ).expect(200);
    expect(afterRemoval.body.steps).toHaveLength(1);
    expect(afterRemoval.body.steps[0].id).toBe(stepA.id);

    await auth(
      api()
        .patch(`/recipes/${recipeId}`)
        .send({ steps: [{ id: "00000000-0000-0000-0000-000000000099", seq: 1, name: "X" }] }),
    ).expect(404);
  });

  it("WorkOrder oluşturulunca talimat WorkOrderOperation'a immutable snapshot olarak kopyalanır", async () => {
    const created = await auth(
      api()
        .post("/recipes")
        .send({ partId, revision: "D", steps: [{ seq: 1, name: "Taşlama", instructionHtml: "<p>WO talimatı</p>" }] }),
    ).expect(201);

    const wo = await auth(
      api()
        .post("/work-orders")
        .send({ partId, quantity: 1, dueDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString() }),
    ).expect(201);

    const operations = await auth(api().get(`/work-orders/${wo.body.id}/operations`)).expect(200);
    expect(operations.body[0].instructionHtml).toBe("<p>WO talimatı</p>");

    const hmiDetail = await auth(api().get(`/hmi/operations/${operations.body[0].id}`)).expect(200);
    expect(hmiDetail.body.instructionHtml).toBe("<p>WO talimatı</p>");

    await prisma.workOrderOperation.deleteMany({ where: { workOrderId: wo.body.id } });
    await prisma.workOrder.deleteMany({ where: { id: wo.body.id } });
    await prisma.recipeHeader.deleteMany({ where: { id: created.body.id } });
  });
});
