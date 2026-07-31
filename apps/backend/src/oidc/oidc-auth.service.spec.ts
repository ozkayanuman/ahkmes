import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from "jose";
import { OidcAuthService } from "./oidc-auth.service";
import * as safeRequest from "../common/safe-request";

jest.mock("../common/safe-request", () => ({
  ...jest.requireActual("../common/safe-request"),
  safeFetch: jest.fn(),
}));

const SECRET = "test-secret-min-32-chars-aaaaaaaaaaaaaaaa";
const ISSUER = "https://idp.example.com";
const CLIENT_ID = "test-client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildService(overrides: any = {}) {
  const prisma = {
    oidcProvider: { findFirst: jest.fn(), findMany: jest.fn() },
    user: { findUnique: jest.fn(), update: jest.fn() },
    ...overrides,
  };
  const config = { get: jest.fn(), getOrThrow: jest.fn().mockReturnValue(SECRET) };
  const authService = { issueTokens: jest.fn().mockResolvedValue({ accessToken: "app-access", refreshToken: "app-refresh" }) };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const service = new OidcAuthService(prisma as any, config as any, authService as any);
  return { service, prisma, authService };
}

async function makeIdToken(privateKey: KeyLike, kid: string, claims: Record<string, unknown>) {
  return new SignJWT({ email: "user@acme.com", ...claims })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(ISSUER)
    .setAudience(CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);
}

describe("OidcAuthService.handleCallback", () => {
  let publicJwk: Record<string, unknown>;
  let privateKey: KeyLike;
  const kid = "test-key-1";

  beforeAll(async () => {
    const { publicKey, privateKey: pk } = await generateKeyPair("RS256");
    privateKey = pk;
    publicJwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  });

  function mockDiscoveryAndJwks(idTokenBody: string) {
    const mock = safeRequest.safeFetch as jest.Mock;
    mock.mockImplementation(async (url: string, options: { method: string; body?: string }) => {
      if (url.endsWith("/.well-known/openid-configuration")) {
        return {
          status: 200,
          body: JSON.stringify({
            authorization_endpoint: `${ISSUER}/authorize`,
            token_endpoint: `${ISSUER}/token`,
            jwks_uri: `${ISSUER}/jwks`,
          }),
        };
      }
      if (url === `${ISSUER}/jwks`) {
        return { status: 200, body: JSON.stringify({ keys: [publicJwk] }) };
      }
      if (url === `${ISSUER}/token` && options.method === "POST") {
        return { status: 200, body: idTokenBody };
      }
      throw new Error(`beklenmeyen URL: ${url}`);
    });
  }

  async function validState(service: OidcAuthService, providerId: string) {
    return (service as unknown as { signState: (id: string) => Promise<string> }).signState(providerId);
  }

  it("geçerli state + geçerli id_token + eşleşen OIDC kullanıcısı: token döner ve provider'a bağlar", async () => {
    const { service, prisma, authService } = buildService();
    prisma.oidcProvider.findFirst.mockResolvedValue({
      id: "p1",
      tenantId: "t1",
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecretEnc: require("../common/crypto").encryptSecret("shh", SECRET),
      scope: "openid email profile",
      emailClaim: "email",
      isActive: true,
    });
    prisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "user@acme.com",
      name: "Kullanıcı",
      role: "OPERATOR",
      tenantId: "t1",
      isActive: true,
      authSource: "OIDC",
      oidcProviderId: null,
    });

    const idToken = await makeIdToken(privateKey, kid, {});
    mockDiscoveryAndJwks(JSON.stringify({ id_token: idToken }));
    const state = await validState(service, "p1");

    const result = await service.handleCallback("p1", "auth-code", state);

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { oidcProviderId: "p1" } });
    expect(authService.issueTokens).toHaveBeenCalledWith("u1", "user@acme.com", "Kullanıcı", "OPERATOR", "t1");
    expect(result).toEqual({ accessToken: "app-access", refreshToken: "app-refresh" });
  });

  it("state başka bir providerId için imzalanmışsa reddedilir", async () => {
    const { service, prisma } = buildService();
    prisma.oidcProvider.findFirst.mockResolvedValue({
      id: "p1",
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecretEnc: require("../common/crypto").encryptSecret("shh", SECRET),
      scope: "openid",
      emailClaim: "email",
      isActive: true,
    });
    const stateForOtherProvider = await validState(service, "p2");

    await expect(service.handleCallback("p1", "auth-code", stateForOtherProvider)).rejects.toThrow();
  });

  it("kullanıcı email'i eşleşmiyorsa reddedilir", async () => {
    const { service, prisma } = buildService();
    prisma.oidcProvider.findFirst.mockResolvedValue({
      id: "p1",
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecretEnc: require("../common/crypto").encryptSecret("shh", SECRET),
      scope: "openid",
      emailClaim: "email",
      isActive: true,
    });
    prisma.user.findUnique.mockResolvedValue(null);
    const idToken = await makeIdToken(privateKey, kid, {});
    mockDiscoveryAndJwks(JSON.stringify({ id_token: idToken }));
    const state = await validState(service, "p1");

    await expect(service.handleCallback("p1", "auth-code", state)).rejects.toThrow();
  });

  it("kullanıcı authSource=LOCAL ise OIDC girişini reddeder", async () => {
    const { service, prisma } = buildService();
    prisma.oidcProvider.findFirst.mockResolvedValue({
      id: "p1",
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecretEnc: require("../common/crypto").encryptSecret("shh", SECRET),
      scope: "openid",
      emailClaim: "email",
      isActive: true,
    });
    prisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "user@acme.com",
      authSource: "LOCAL",
      isActive: true,
      oidcProviderId: null,
    });
    const idToken = await makeIdToken(privateKey, kid, {});
    mockDiscoveryAndJwks(JSON.stringify({ id_token: idToken }));
    const state = await validState(service, "p1");

    await expect(service.handleCallback("p1", "auth-code", state)).rejects.toThrow();
  });

  it("kullanıcı zaten başka bir sağlayıcıya bağlıysa reddeder", async () => {
    const { service, prisma } = buildService();
    prisma.oidcProvider.findFirst.mockResolvedValue({
      id: "p1",
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecretEnc: require("../common/crypto").encryptSecret("shh", SECRET),
      scope: "openid",
      emailClaim: "email",
      isActive: true,
    });
    prisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "user@acme.com",
      authSource: "OIDC",
      isActive: true,
      oidcProviderId: "p-other",
    });
    const idToken = await makeIdToken(privateKey, kid, {});
    mockDiscoveryAndJwks(JSON.stringify({ id_token: idToken }));
    const state = await validState(service, "p1");

    await expect(service.handleCallback("p1", "auth-code", state)).rejects.toThrow();
  });

  it("geçersiz imzalı id_token reddedilir (sahte IdP)", async () => {
    const { service, prisma } = buildService();
    prisma.oidcProvider.findFirst.mockResolvedValue({
      id: "p1",
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecretEnc: require("../common/crypto").encryptSecret("shh", SECRET),
      scope: "openid",
      emailClaim: "email",
      isActive: true,
    });
    const { privateKey: forgedKey } = await generateKeyPair("RS256");
    const forgedIdToken = await makeIdToken(forgedKey, kid, {});
    mockDiscoveryAndJwks(JSON.stringify({ id_token: forgedIdToken }));
    const state = await validState(service, "p1");

    await expect(service.handleCallback("p1", "auth-code", state)).rejects.toThrow();
  });
});

describe("OidcAuthService.authorizeUrl", () => {
  it("sağlayıcı bulunamazsa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.oidcProvider.findFirst.mockResolvedValue(null);

    await expect(service.authorizeUrl("missing")).rejects.toThrow();
  });
});
