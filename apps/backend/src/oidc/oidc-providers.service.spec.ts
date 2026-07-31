import { OidcProvidersService } from "./oidc-providers.service";
import * as safeRequest from "../common/safe-request";

jest.mock("../common/safe-request", () => ({
  ...jest.requireActual("../common/safe-request"),
  safeFetch: jest.fn(),
}));

const ISSUER = "https://login.microsoftonline.com/common/v2.0";

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

function mockDiscovery(overrides: Partial<Record<"authorization_endpoint" | "token_endpoint" | "jwks_uri", string>> = {}) {
  const mock = safeRequest.safeFetch as jest.Mock;
  mock.mockResolvedValue({
    status: 200,
    body: JSON.stringify({
      authorization_endpoint: overrides.authorization_endpoint ?? `${ISSUER}/authorize`,
      token_endpoint: overrides.token_endpoint ?? "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      jwks_uri: overrides.jwks_uri ?? `${ISSUER}/discovery/keys`,
    }),
  });
}

describe("OidcProvidersService.create", () => {
  it("discovery belgesini çeker, endpoint'leri sabitler ve clientSecret'i şifreler (yanıtta düz metin/şifreli alan yok)", async () => {
    const { service, prisma } = buildService();
    mockDiscovery();
    prisma.oidcProvider.create.mockResolvedValue({
      id: "p1",
      name: "Azure AD",
      issuer: ISSUER,
      clientId: "abc",
      clientSecretEnc: "encrypted-value",
    });

    const result = await service.create("t1", {
      name: "Azure AD",
      issuer: ISSUER,
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
    // Farklı host'taki (Microsoft'un gerçek token endpoint deseni) uç noktalar
    // pinlenirken host eşleştirmesi ARANMAZ, sadece https şart koşulur.
    expect(createCall.data.authorizationEndpoint).toBe(`${ISSUER}/authorize`);
    expect(createCall.data.tokenEndpoint).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/token");
    expect(createCall.data.jwksUri).toBe(`${ISSUER}/discovery/keys`);
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

  it("http (https olmayan) issuer'ı reddeder", async () => {
    const { service } = buildService();

    await expect(
      service.create("t1", {
        name: "Http",
        issuer: "http://example.com",
        clientId: "abc",
        clientSecret: "x",
        scope: "openid",
        emailClaim: "email",
        defaultRole: "OPERATOR",
        isActive: true,
      }),
    ).rejects.toThrow();
  });

  it("discovery belgesindeki endpoint https değilse reddeder", async () => {
    const { service } = buildService();
    mockDiscovery({ token_endpoint: "http://insecure.example.com/token" });

    await expect(
      service.create("t1", {
        name: "InsecureEndpoint",
        issuer: ISSUER,
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
