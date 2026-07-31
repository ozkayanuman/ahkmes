import { OidcProvidersService } from "./oidc-providers.service";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    oidcProvider: { findMany: jest.fn(), create: jest.fn(), findFirst: jest.fn(), delete: jest.fn() },
    ...overrides,
  };
  const config = { getOrThrow: jest.fn().mockReturnValue("test-secret-min-32-chars-aaaaaaaaaaaa") };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new OidcProvidersService(prisma as any, config as any);
  return { service, prisma };
}

describe("OidcProvidersService.create", () => {
  it("clientSecret'i şifreler, yanıtta düz metin/şifreli alan döndürmez", async () => {
    const { service, prisma } = buildService();
    prisma.oidcProvider.create.mockResolvedValue({
      id: "p1",
      name: "Azure AD",
      issuer: "https://login.microsoftonline.com/common/v2.0",
      clientId: "abc",
      clientSecretEnc: "encrypted-value",
    });

    const result = await service.create("t1", {
      name: "Azure AD",
      issuer: "https://login.microsoftonline.com/common/v2.0",
      clientId: "abc",
      clientSecret: "super-secret",
      scope: "openid email profile",
      emailClaim: "email",
      defaultRole: "OPERATOR",
      isActive: true,
    });

    expect(result).not.toHaveProperty("clientSecretEnc");
    expect(result).not.toHaveProperty("clientSecret");
    const createCall = prisma.oidcProvider.create.mock.calls[0][0];
    expect(createCall.data.clientSecretEnc).not.toBe("super-secret");
    expect(createCall.data).not.toHaveProperty("clientSecret");
  });

  it("yerel/özel ağa işaret eden issuer'ı reddeder (SSRF guard)", async () => {
    const { service } = buildService();

    await expect(
      service.create("t1", {
        name: "Yerel",
        issuer: "http://localhost:9999",
        clientId: "abc",
        clientSecret: "x",
        scope: "openid",
        emailClaim: "email",
        defaultRole: "OPERATOR",
        isActive: true,
      }),
    ).rejects.toThrow();
  });
});

describe("OidcProvidersService.findAll", () => {
  it("clientSecretEnc alanını listeden çıkarır", async () => {
    const { service, prisma } = buildService();
    prisma.oidcProvider.findMany.mockResolvedValue([{ id: "p1", name: "X", clientSecretEnc: "secret" }]);

    const result = await service.findAll("t1");

    expect(result[0]).not.toHaveProperty("clientSecretEnc");
  });
});

describe("OidcProvidersService.remove", () => {
  it("bulunamazsa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.oidcProvider.findFirst.mockResolvedValue(null);

    await expect(service.remove("t1", "missing")).rejects.toThrow();
  });
});
