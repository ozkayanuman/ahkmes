import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

describe("Kullanıcı CSV toplu içe aktarma (e2e)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  const createdEmails = [`csv-a-${STAMP}@ahkmes.local`, `csv-b-${STAMP}@ahkmes.local`];

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
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { in: createdEmails } } }).catch(() => undefined);
    await app.close();
  });

  it("geçerli CSV'deki kullanıcıları oluşturur, şifresiz satır için rastgele şifre döner", async () => {
    const csv = [
      "email,name,role,password",
      `${createdEmails[0]},CSV Kullanıcı A,OPERATOR,`,
      `${createdEmails[1]},CSV Kullanıcı B,PLANNER,BelirliSifre123`,
      "bozuk-satir,,,", // eksik alanlar — hata olarak raporlanmalı, işlemi durdurmamalı
    ].join("\n");

    const res = await auth(api().post("/users/import"))
      .attach("file", Buffer.from(csv, "utf-8"), "kullanicilar.csv")
      .expect(201);

    expect(res.body.created).toHaveLength(2);
    const a = res.body.created.find((c: { email: string }) => c.email === createdEmails[0]);
    const b = res.body.created.find((c: { email: string }) => c.email === createdEmails[1]);
    expect(a.password).toBeDefined(); // rastgele üretildi, bir kez döndü
    expect(b.password).toBeUndefined(); // CSV'de zaten belirtilmişti, tekrar dönmez
    expect(res.body.errors.length).toBeGreaterThan(0);

    const login = await api().post("/auth/login").send({ email: createdEmails[1], password: "BelirliSifre123" });
    expect(login.body.accessToken).toBeDefined();
  });

  it("aynı e-posta ikinci kez içe aktarılırsa atlanır (hata listesine düşer)", async () => {
    const csv = ["email,name,role", `${createdEmails[0]},Tekrar,OPERATOR`].join("\n");
    const res = await auth(api().post("/users/import"))
      .attach("file", Buffer.from(csv, "utf-8"), "tekrar.csv")
      .expect(201);
    expect(res.body.created).toHaveLength(0);
    expect(res.body.errors[0]).toMatch(/zaten kayıtlı/);
  });
});
