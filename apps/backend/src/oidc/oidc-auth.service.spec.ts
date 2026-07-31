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

/** Gerçek IdP'ler (Google, Microsoft) authorization/token/jwks endpoint'lerini
 * issuer'dan FARKLI host'larda barındırabilir (bkz. oidc-providers.service.ts
 * yorumu) — bu yüzden testlerde bilinçli olarak issuer'dan farklı bir host
 * kullanılıyor, "aynı host" varsayımına geri dönülmediğini kanıtlamak için. */
function providerRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "p1",
    tenantId: "t1",
    issuer: ISSUER,
    authorizationEndpoint: "https://login.idp.example.com/authorize",
    tokenEndpoint: "https://token.idp.example.com/token",
    jwksUri: "https://keys.idp.example.com/jwks",
    clientId: CLIENT_ID,
    clientSecretEnc: require("../common/crypto").encryptSecret("shh", SECRET),
    scope: "openid email profile",
    emailClaim: "email",
    isActive: true,
    oidcProviderId: null,
    ...overrides,
  };
}

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
  const row = providerRow();

  beforeAll(async () => {
    const { publicKey, privateKey: pk } = await generateKeyPair("RS256");
    privateKey = pk;
    publicJwk = { ...(await exportJWK(publicKey)), kid, alg: "RS256", use: "sig" };
  });

  /** authorizeUrl/handleCallback artık discovery çekmiyor (sabitlenmiş
   * provider.tokenEndpoint/jwksUri kullanılır) — sadece token exchange ve
   * JWKS istekleri mock'lanır. */
  function mockTokenAndJwks(idTokenBody: string) {
    const mock = safeRequest.safeFetch as jest.Mock;
    mock.mockImplementation(async (url: string, options: { method: string; body?: string }) => {
      if (url === row.jwksUri) {
        return { status: 200, body: JSON.stringify({ keys: [publicJwk] }) };
      }
      if (url === row.tokenEndpoint && options.method === "POST") {
        return { status: 200, body: idTokenBody };
      }
      throw new Error(`beklenmeyen URL: ${url}`);
    });
  }

  async function validState(service: OidcAuthService, providerId: string) {
    const nonce = "test-nonce-value";
    const nonceHash = require("node:crypto").createHash("sha256").update(nonce).digest("hex");
    const state = await (
      service as unknown as { signState: (id: string, nonceHash: string) => Promise<string> }
    ).signState(providerId, nonceHash);
    return { state, nonce };
  }

  it("geçerli state + geçerli id_token + eşleşen OIDC kullanıcısı: token döner ve provider'a bağlar", async () => {
    const { service, prisma, authService } = buildService();
    prisma.oidcProvider.findFirst.mockResolvedValue(row);
    prisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "user@acme.com",
      name: "Kullanıcı",
      role: "OPERATOR",
      tenantId: "t1",
      isActive: true,
      authSource: "OIDC",
      oidcProviderId: null,
      locale: "tr",
      timezone: "Europe/Istanbul",
    });

    const idToken = await makeIdToken(privateKey, kid, {});
    mockTokenAndJwks(JSON.stringify({ id_token: idToken }));
    const { state, nonce } = await validState(service, "p1");

    const result = await service.handleCallback("p1", "auth-code", state, nonce);

    expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: "u1" }, data: { oidcProviderId: "p1" } });
    expect(authService.issueTokens).toHaveBeenCalledWith(
      "u1",
      "user@acme.com",
      "Kullanıcı",
      "OPERATOR",
      "t1",
      "tr",
      "Europe/Istanbul",
    );
    expect(result).toEqual({ accessToken: "app-access", refreshToken: "app-refresh" });
  });

  it("state başka bir providerId için imzalanmışsa reddedilir", async () => {
    const { service, prisma } = buildService();
    prisma.oidcProvider.findFirst.mockResolvedValue(row);
    const { state: stateForOtherProvider, nonce } = await validState(service, "p2");

    await expect(service.handleCallback("p1", "auth-code", stateForOtherProvider, nonce)).rejects.toThrow();
  });

  it("kullanıcı email'i eşleşmiyorsa reddedilir", async () => {
    const { service, prisma } = buildService();
    prisma.oidcProvider.findFirst.mockResolvedValue(row);
    prisma.user.findUnique.mockResolvedValue(null);
    const idToken = await makeIdToken(privateKey, kid, {});
    mockTokenAndJwks(JSON.stringify({ id_token: idToken }));
    const { state, nonce } = await validState(service, "p1");

    await expect(service.handleCallback("p1", "auth-code", state, nonce)).rejects.toThrow();
  });

  it("kullanıcı authSource=LOCAL ise OIDC girişini reddeder", async () => {
    const { service, prisma } = buildService();
    prisma.oidcProvider.findFirst.mockResolvedValue(row);
    prisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "user@acme.com",
      authSource: "LOCAL",
      isActive: true,
      oidcProviderId: null,
    });
    const idToken = await makeIdToken(privateKey, kid, {});
    mockTokenAndJwks(JSON.stringify({ id_token: idToken }));
    const { state, nonce } = await validState(service, "p1");

    await expect(service.handleCallback("p1", "auth-code", state, nonce)).rejects.toThrow();
  });

  it("kullanıcı zaten başka bir sağlayıcıya bağlıysa reddeder", async () => {
    const { service, prisma } = buildService();
    prisma.oidcProvider.findFirst.mockResolvedValue(row);
    prisma.user.findUnique.mockResolvedValue({
      id: "u1",
      email: "user@acme.com",
      authSource: "OIDC",
      isActive: true,
      oidcProviderId: "p-other",
    });
    const idToken = await makeIdToken(privateKey, kid, {});
    mockTokenAndJwks(JSON.stringify({ id_token: idToken }));
    const { state, nonce } = await validState(service, "p1");

    await expect(service.handleCallback("p1", "auth-code", state, nonce)).rejects.toThrow();
  });

  it("nonce cookie'si eksikse reddedilir (login CSRF koruması)", async () => {
    const { service, prisma } = buildService();
    prisma.oidcProvider.findFirst.mockResolvedValue(row);
    const { state } = await validState(service, "p1");

    await expect(service.handleCallback("p1", "auth-code", state, undefined)).rejects.toThrow();
  });

  it("nonce cookie'si state'teki hash ile eşleşmiyorsa reddedilir (saldırgan kendi akışının state'ini kurbana enjekte edemez)", async () => {
    const { service, prisma } = buildService();
    prisma.oidcProvider.findFirst.mockResolvedValue(row);
    const { state } = await validState(service, "p1");

    await expect(service.handleCallback("p1", "auth-code", state, "farkli-bir-nonce")).rejects.toThrow();
  });

  it("geçersiz imzalı id_token reddedilir (sahte IdP)", async () => {
    const { service, prisma } = buildService();
    prisma.oidcProvider.findFirst.mockResolvedValue(row);
    const { privateKey: forgedKey } = await generateKeyPair("RS256");
    const forgedIdToken = await makeIdToken(forgedKey, kid, {});
    mockTokenAndJwks(JSON.stringify({ id_token: forgedIdToken }));
    const { state, nonce } = await validState(service, "p1");

    await expect(service.handleCallback("p1", "auth-code", state, nonce)).rejects.toThrow();
  });
});

describe("OidcAuthService.authorizeUrl", () => {
  it("sağlayıcı bulunamazsa hata fırlatır", async () => {
    const { service, prisma } = buildService();
    prisma.oidcProvider.findFirst.mockResolvedValue(null);

    await expect(service.authorizeUrl("missing")).rejects.toThrow();
  });

  it("her çağrıda farklı, tahmin edilemez bir nonce üretir (login CSRF koruması için) — discovery'ye çıkmadan, sabitlenmiş endpoint'i kullanır", async () => {
    const { service, prisma } = buildService();
    prisma.oidcProvider.findFirst.mockResolvedValue(providerRow());
    (safeRequest.safeFetch as jest.Mock).mockClear();

    const first = await service.authorizeUrl("p1");
    const second = await service.authorizeUrl("p1");

    expect(safeRequest.safeFetch).not.toHaveBeenCalled();
    expect(first.nonce).not.toBe(second.nonce);
    expect(first.url).toContain("state=");
    expect(new URL(first.url).searchParams.get("state")).not.toBe(new URL(second.url).searchParams.get("state"));
    expect(new URL(first.url).origin + new URL(first.url).pathname).toBe("https://login.idp.example.com/authorize");
  });
});
