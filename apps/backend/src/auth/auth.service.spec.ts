import { AuthService } from "./auth.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}, jwtOverride: any = {}) {
  const prisma = { user: { findUnique: jest.fn(), update: jest.fn() }, ...overrides };
  const jwt = { signAsync: jest.fn(), verifyAsync: jest.fn(), ...jwtOverride };
  const config = { get: jest.fn() };
  const permissionGroups = { computeUserPages: jest.fn().mockResolvedValue("*") };
  const ldap = { verifyCredentials: jest.fn() };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new AuthService(prisma as any, jwt as any, config as any, permissionGroups as any, ldap as any);
  return { service, prisma, ldap };
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
