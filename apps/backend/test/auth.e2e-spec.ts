import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";

describe("Auth (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("POST /auth/login — doğru bilgilerle token döner", async () => {
    const res = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .expect(201);
    expect(typeof res.body.accessToken).toBe("string");
    expect(typeof res.body.refreshToken).toBe("string");
  });

  it("POST /auth/login — yanlış şifre 401", async () => {
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: ADMIN_EMAIL, password: "yanlis-sifre-123" })
      .expect(401);
  });

  it("POST /auth/login — geçersiz gövde 400", async () => {
    await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: "gecersiz", password: "x" })
      .expect(400);
  });

  it("GET /auth/me — token ile kullanıcı bilgisi döner", async () => {
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const res = await request(app.getHttpServer())
      .get("/auth/me")
      .set("Authorization", `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(res.body.email).toBe(ADMIN_EMAIL);
    expect(res.body.role).toBe("ADMIN");
    expect(res.body.tenantId).toBeDefined();
  });

  it("GET /auth/me — token yoksa 401", async () => {
    await request(app.getHttpServer()).get("/auth/me").expect(401);
  });

  it("POST /auth/refresh — geçerli refresh token yeni tokenlar döner", async () => {
    const login = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const res = await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: login.body.refreshToken })
      .expect(201);
    expect(typeof res.body.accessToken).toBe("string");
  });

  it("POST /auth/refresh — bozuk token 401", async () => {
    await request(app.getHttpServer())
      .post("/auth/refresh")
      .send({ refreshToken: "bozuk.token.degeri" })
      .expect(401);
  });
});
