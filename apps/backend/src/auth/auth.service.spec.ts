import { SignJWT } from "jose";
import { AuthService } from "./auth.service";

const JWT_SECRET = "test-secret-min-32-chars-aaaaaaaaaaaaaaaa";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}, jwtOverride: any = {}) {
  const prisma = { user: { findUnique: jest.fn(), findFirst: jest.fn(), update: jest.fn() }, ...overrides };
  const jwt = { signAsync: jest.fn(), verifyAsync: jest.fn(), ...jwtOverride };
  const config = { get: jest.fn(), getOrThrow: jest.fn().mockReturnValue(JWT_SECRET) };
  const permissionGroups = { computeUserPages: jest.fn().mockResolvedValue("*") };
  const ldap = { verifyCredentials: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new AuthService(prisma as any, jwt as any, config as any, permissionGroups as any, ldap as any);
  return { service, prisma, ldap };
}

function signReauthEvidence(claims: Record<string, unknown>, expiresIn: string | number = "2m") {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(JWT_SECRET));
}

describe("AuthService.login", () => {
  it("authSource=OIDC kullanıcısı local şifre ile giriş yapamaz (sadece SSO akışı)", async () => {
    const { service, prisma, ldap } = buildService();
    prisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "user@acme.com",
      isActive: true,
      authSource: "OIDC",
      passwordHash: "irrelevant",
    });

    await expect(service.login({ email: "user@acme.com", password: "anything" })).rejects.toThrow();
    expect(ldap.verifyCredentials).not.toHaveBeenCalled();
  });
});

describe("AuthService.updateProfile", () => {
  it("locale/timezone günceller ve yeni token çifti döner", async () => {
    const jwt = { signAsync: jest.fn().mockResolvedValue("signed-jwt") };
    const { service, prisma } = buildService({}, jwt);
    prisma.user.update.mockResolvedValueOnce({
      id: "u1",
      email: "user@acme.com",
      name: "Kullanıcı",
      role: "OPERATOR",
      tenantId: "t1",
      locale: "en",
      timezone: "Europe/Istanbul",
    });
    prisma.user.update.mockResolvedValueOnce({ id: "u1" });

    const result = await service.updateProfile("u1", { locale: "en" });

    expect(prisma.user.update).toHaveBeenNthCalledWith(1, { where: { id: "u1" }, data: { locale: "en" } });
    expect(result).toEqual({ accessToken: "signed-jwt", refreshToken: "signed-jwt" });
  });
});

describe("AuthService.reauthenticate — OIDC dalı (AHK-006 kalanı)", () => {
  it("OidcAuthService'in ürettiği geçerli reauth kanıtını kabul eder", async () => {
    const { service, prisma } = buildService();
    prisma.user.findFirst.mockResolvedValue({ id: "u1", authSource: "OIDC" });
    const token = await signReauthEvidence({ sub: "u1", purpose: "reauth", authSource: "OIDC" });

    const result = await service.reauthenticate("t1", "u1", token);

    expect(result).toEqual({ userId: "u1", authSource: "OIDC", verifiedAt: expect.any(Date) });
  });

  it("başka bir kullanıcı için üretilmiş kanıtı reddeder (hesap değiştirme koruması)", async () => {
    const { service, prisma } = buildService();
    prisma.user.findFirst.mockResolvedValue({ id: "u1", authSource: "OIDC" });
    const tokenForOtherUser = await signReauthEvidence({ sub: "u2", purpose: "reauth", authSource: "OIDC" });

    await expect(service.reauthenticate("t1", "u1", tokenForOtherUser)).rejects.toThrow();
  });

  it("purpose alanı 'reauth' değilse reddeder", async () => {
    const { service, prisma } = buildService();
    prisma.user.findFirst.mockResolvedValue({ id: "u1", authSource: "OIDC" });
    const wrongPurposeToken = await signReauthEvidence({ sub: "u1", purpose: "login", authSource: "OIDC" });

    await expect(service.reauthenticate("t1", "u1", wrongPurposeToken)).rejects.toThrow();
  });

  it("süresi dolmuş kanıtı reddeder", async () => {
    const { service, prisma } = buildService();
    prisma.user.findFirst.mockResolvedValue({ id: "u1", authSource: "OIDC" });
    const expiredToken = await signReauthEvidence(
      { sub: "u1", purpose: "reauth", authSource: "OIDC" },
      Math.floor(Date.now() / 1000) - 5,
    );

    await expect(service.reauthenticate("t1", "u1", expiredToken)).rejects.toThrow();
  });

  it("düz metin şifreyi (rastgele string) reddeder", async () => {
    const { service, prisma } = buildService();
    prisma.user.findFirst.mockResolvedValue({ id: "u1", authSource: "OIDC" });

    await expect(service.reauthenticate("t1", "u1", "sadece-bir-sifre-degil")).rejects.toThrow();
  });
});
