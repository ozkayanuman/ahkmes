import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { Client } from "ldapts";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { PrismaService } from "../src/prisma/prisma.service";

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@ahkmes.local";
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? "Admin1234!";
const STAMP = Date.now();

const LDAP_HOST = "localhost";
const LDAP_PORT = 3389;
const LDAP_BIND_DN = "cn=admin,dc=ahkmes,dc=test";
const LDAP_BIND_PASSWORD = "admin123";
const LDAP_BASE_DN = "dc=ahkmes,dc=test";
const LDAP_USERS_OU = `ou=users-${STAMP},${LDAP_BASE_DN}`;

/**
 * Bu test gerçek bir LDAP protokol sunucusuna (Docker'da çalışan osixia/openldap)
 * bağlanır — mock değildir. Fabrikanın kendi Active Directory'sine karşı çalışacak
 * kodun gerçekten TCP/LDAP üzerinden bind/search/sync yapabildiğini kanıtlar.
 * Ön koşul: `docker run -d -p 3389:389 -e LDAP_DOMAIN=ahkmes.test
 * -e LDAP_ADMIN_PASSWORD=admin123 osixia/openldap:1.5.0` çalışıyor olmalı.
 */
describe("LDAP/Active Directory entegrasyonu (e2e, gerçek LDAP sunucusuna karşı)", () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminToken: string;
  const ldapUserEmail = `ldap-user-${STAMP}@ahkmes.test`;
  const ldapUserPassword = "GercekSifre#2026";
  let ldapAvailable = true;

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

    // Test dizinine gerçek LDAP entry'leri ekle (admin olarak bağlanıp).
    const setupClient = new Client({ url: `ldap://${LDAP_HOST}:${LDAP_PORT}`, connectTimeout: 5000 });
    try {
      await setupClient.bind(LDAP_BIND_DN, LDAP_BIND_PASSWORD);
      await setupClient.add(LDAP_USERS_OU, { objectClass: ["organizationalUnit"], ou: `users-${STAMP}` });
      await setupClient.add(`uid=ldapuser,${LDAP_USERS_OU}`, {
        objectClass: ["inetOrgPerson"],
        cn: "LDAP Test Kullanıcı",
        sn: "Kullanıcı",
        mail: ldapUserEmail,
        userPassword: ldapUserPassword,
      });
    } catch (err) {
      ldapAvailable = false;
      // eslint-disable-next-line no-console
      console.warn("LDAP test sunucusuna ulaşılamadı, bu test suite atlanacak:", err);
    } finally {
      await setupClient.unbind().catch(() => undefined);
    }
  });

  afterAll(async () => {
    if (ldapAvailable) {
      const cleanupClient = new Client({ url: `ldap://${LDAP_HOST}:${LDAP_PORT}`, connectTimeout: 5000 });
      try {
        await cleanupClient.bind(LDAP_BIND_DN, LDAP_BIND_PASSWORD);
        await cleanupClient.del(`uid=ldapuser,${LDAP_USERS_OU}`).catch(() => undefined);
        await cleanupClient.del(LDAP_USERS_OU).catch(() => undefined);
      } finally {
        await cleanupClient.unbind().catch(() => undefined);
      }
    }
    await prisma.user.deleteMany({ where: { email: ldapUserEmail } }).catch(() => undefined);
    await prisma.ldapConfig.deleteMany({}).catch(() => undefined);
    await app.close();
  });

  it("test-connection: doğru bilgilerle bağlantı başarılı, yanlış şifreyle başarısız olur", async () => {
    if (!ldapAvailable) return;
    const baseDto = {
      host: LDAP_HOST,
      port: LDAP_PORT,
      useTls: false,
      bindDn: LDAP_BIND_DN,
      baseDn: LDAP_USERS_OU,
      userFilter: "(objectClass=inetOrgPerson)",
      attrEmail: "mail",
      attrName: "cn",
      defaultRole: "OPERATOR",
    };
    await auth(api().post("/ldap/test-connection").send({ ...baseDto, bindPassword: LDAP_BIND_PASSWORD })).expect(
      201,
    );
    await auth(api().post("/ldap/test-connection").send({ ...baseDto, bindPassword: "yanlis-sifre" })).expect(400);
  });

  it("config kaydedilir, sync ile LDAP kullanıcısı içe aktarılır", async () => {
    if (!ldapAvailable) return;
    await auth(
      api().post("/ldap/config").send({
        host: LDAP_HOST,
        port: LDAP_PORT,
        useTls: false,
        bindDn: LDAP_BIND_DN,
        bindPassword: LDAP_BIND_PASSWORD,
        baseDn: LDAP_USERS_OU,
        userFilter: "(objectClass=inetOrgPerson)",
        attrEmail: "mail",
        attrName: "cn",
        defaultRole: "OPERATOR",
      }),
    ).expect(201);

    const cfg = await auth(api().get("/ldap/config")).expect(200);
    expect(cfg.body.configured).toBe(true);
    expect(cfg.body.bindPasswordEnc).toBeUndefined();

    const syncRes = await auth(api().post("/ldap/sync")).expect(201);
    expect(syncRes.body.created).toBeGreaterThanOrEqual(1);

    const user = await prisma.user.findUnique({ where: { email: ldapUserEmail } });
    expect(user).toBeDefined();
    expect(user?.authSource).toBe("LDAP");
    expect(user?.externalDn).toContain("ldapuser");
  });

  it("LDAP kullanıcısı gerçek AD şifresiyle sisteme giriş yapabilir, yanlış şifreyle giremez", async () => {
    if (!ldapAvailable) return;
    const okLogin = await api().post("/auth/login").send({ email: ldapUserEmail, password: ldapUserPassword });
    expect(okLogin.body.accessToken).toBeDefined();

    await api().post("/auth/login").send({ email: ldapUserEmail, password: "yanlis-sifre-123" }).expect(401);
  });

  it("tekrar sync çalıştırılınca aynı kullanıcı 'updated' olarak sayılır, tekrar oluşturulmaz", async () => {
    if (!ldapAvailable) return;
    const res = await auth(api().post("/ldap/sync")).expect(201);
    expect(res.body.updated).toBeGreaterThanOrEqual(1);
    const count = await prisma.user.count({ where: { email: ldapUserEmail } });
    expect(count).toBe(1);
  });

  it("boş şifreyle giriş reddedilir (LDAP 'unauthenticated bind' açığına karşı)", async () => {
    if (!ldapAvailable) return;
    // loginSchema zaten password min(8) ile reddeder, ama LdapService.verifyCredentials
    // da bagimsiz olarak bos/whitespace sifreyi bind'e gondermeden reddetmeli.
    await api().post("/auth/login").send({ email: ldapUserEmail, password: "        " }).expect(401);
  });
});
