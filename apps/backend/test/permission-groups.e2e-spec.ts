import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("Rol Grupları (PermissionGroup) — sayfa erişimi (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  let restrictedUserId: string;
  let restrictedToken: string;
  let groupId: string;

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

    const email = `pg-user-${STAMP}@ahkmes.local`;
    const created = await auth(
      api().post("/users").send({ email, password: "Restricted1234!", name: "Kısıtlı Kullanıcı", role: "OPERATOR" }),
    );
    restrictedUserId = created.body.id;
  });

  afterAll(async () => {
    if (groupId) await prisma.permissionGroup.deleteMany({ where: { id: groupId } }).catch(() => undefined);
    if (restrictedUserId) await prisma.user.deleteMany({ where: { id: restrictedUserId } }).catch(() => undefined);
    await app.close();
  });

  it("gruba atanmamış kullanıcı kısıtlamasız (*) erişime sahiptir — geriye dönük uyumluluk", async () => {
    const login = await api()
      .post("/auth/login")
      .send({ email: `pg-user-${STAMP}@ahkmes.local`, password: "Restricted1234!" });
    await request(app.getHttpServer())
      .get("/parts")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .expect(200);
  });

  it("sadece 'production' sayfasına izin veren grup oluşturulur ve kullanıcıya atanır", async () => {
    const res = await auth(
      api().post("/permission-groups").send({ name: `Operatör Test ${STAMP}`, pages: ["production"] }),
    ).expect(201);
    groupId = res.body.id;

    await auth(api().post(`/permission-groups/${groupId}/members`).send({ userId: restrictedUserId })).expect(
      201,
    );
  });

  it("grup ataması sonrası yeniden giriş yapan kullanıcı sadece izinli sayfaya erişebilir", async () => {
    const login = await api()
      .post("/auth/login")
      .send({ email: `pg-user-${STAMP}@ahkmes.local`, password: "Restricted1234!" });
    const token = login.body.accessToken;

    await request(app.getHttpServer()).get("/runs").set("Authorization", `Bearer ${token}`).expect(200);

    await request(app.getHttpServer()).get("/parts").set("Authorization", `Bearer ${token}`).expect(403);
    await request(app.getHttpServer()).get("/customers").set("Authorization", `Bearer ${token}`).expect(403);
  });

  it("üyelik kaldırılınca kullanıcı tekrar kısıtlamasız olur", async () => {
    await auth(api().delete(`/permission-groups/${groupId}/members/${restrictedUserId}`)).expect(200);
    const login = await api()
      .post("/auth/login")
      .send({ email: `pg-user-${STAMP}@ahkmes.local`, password: "Restricted1234!" });
    await request(app.getHttpServer())
      .get("/parts")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .expect(200);
  });
});
