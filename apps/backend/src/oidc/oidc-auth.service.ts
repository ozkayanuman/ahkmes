import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createLocalJWKSet, jwtVerify, SignJWT } from "jose";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { decryptSecret } from "../common/crypto";
import { assertPublicUrl, safeFetch } from "../common/safe-request";

interface DiscoveryDoc {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

/**
 * Faz O: SSO/OIDC login akışı — LdapService.verifyCredentials()'ın OIDC
 * eşdeğeri. LDAP'tan farklı olarak burada kullanıcı adı/şifre değil,
 * tarayıcı yönlendirmeli authorization-code akışı var: authorizeUrl() IdP'ye
 * yönlendirme URL'i üretir, handleCallback() dönen kodu id_token'a çevirir
 * ve doğrular. Tüm dış istekler (discovery/token/JWKS) common/safe-request.ts
 * üzerinden SSRF korumalı gider (issuer ADMIN girişi olsa da — bkz. Faz J
 * "ADMIN-only endpoint'ler bile yaygın SSRF hedefi" dersi).
 */
@Injectable()
export class OidcAuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly authService: AuthService,
  ) {}

  private secretKey() {
    return this.config.getOrThrow<string>("JWT_SECRET");
  }

  private redirectUri(providerId: string) {
    const base = this.config.get<string>("PUBLIC_APP_URL") ?? "http://localhost:3000";
    return `${base}/auth/oidc/${providerId}/callback`;
  }

  /** Login sayfasındaki "X ile giriş yap" butonları için — sır içermez. */
  publicProviders() {
    return this.prisma.oidcProvider.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
  }

  private async findActiveProvider(id: string) {
    const provider = await this.prisma.oidcProvider.findFirst({ where: { id, isActive: true } });
    if (!provider) throw new NotFoundException("OIDC sağlayıcısı bulunamadı veya pasif");
    return provider;
  }

  private async discovery(issuer: string): Promise<DiscoveryDoc> {
    const url = `${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`;
    const res = await safeFetch(url, { method: "GET" }, "OIDC discovery belgesi");
    if (res.status !== 200) throw new BadRequestException("OIDC discovery belgesi alınamadı");
    try {
      return JSON.parse(res.body) as DiscoveryDoc;
    } catch {
      throw new BadRequestException("OIDC discovery belgesi geçersiz JSON");
    }
  }

  /**
   * "state" parametresi burada üretilir (çağıranın ürettiği bir değer kabul
   * edilmez) — cookie/sunucu-taraflı oturum kullanmadan CSRF/replay koruması
   * için kısa ömürlü (10dk), HS256 ile imzalı bir JWT (JWT_SECRET ile).
   * callback() bunu doğrular; sahte bir state ile providerId değiştirilip
   * başka bir sağlayıcının akışına enjekte edilmesi de böylece engellenir.
   */
  private async signState(providerId: string) {
    return new SignJWT({ providerId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(this.secretKey()));
  }

  private async verifyState(state: string, providerId: string) {
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(state, new TextEncoder().encode(this.secretKey())));
    } catch {
      throw new UnauthorizedException("Geçersiz veya süresi dolmuş state");
    }
    if (payload.providerId !== providerId) {
      throw new UnauthorizedException("state sağlayıcı ile eşleşmiyor");
    }
  }

  async authorizeUrl(providerId: string) {
    const provider = await this.findActiveProvider(providerId);
    const doc = await this.discovery(provider.issuer);
    assertPublicUrl(doc.authorization_endpoint, "Authorization endpoint");

    const state = await this.signState(provider.id);
    const url = new URL(doc.authorization_endpoint);
    url.searchParams.set("client_id", provider.clientId);
    url.searchParams.set("redirect_uri", this.redirectUri(provider.id));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", provider.scope);
    url.searchParams.set("state", state);
    return url.toString();
  }

  /**
   * User.authSource='OIDC' olarak ADMIN tarafından önceden oluşturulmuş
   * bir kullanıcı gerekir (JIT provisioning kapsamda değil — kullanıcı bu
   * seçeneği tercih etmedi). İlk başarılı girişte oidcProviderId bağlanır;
   * sonraki girişlerde başka bir sağlayıcıyla eşleşme reddedilir.
   */
  async handleCallback(providerId: string, code: string, state: string) {
    await this.verifyState(state, providerId);
    const provider = await this.findActiveProvider(providerId);
    const doc = await this.discovery(provider.issuer);
    assertPublicUrl(doc.token_endpoint, "Token endpoint");

    const clientSecret = decryptSecret(provider.clientSecretEnc, this.secretKey());
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri(provider.id),
      client_id: provider.clientId,
      client_secret: clientSecret,
    }).toString();
    const tokenRes = await safeFetch(
      doc.token_endpoint,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
      "Token endpoint",
    );
    if (tokenRes.status !== 200) throw new UnauthorizedException("OIDC token değişimi başarısız");

    let idToken: string | undefined;
    try {
      idToken = (JSON.parse(tokenRes.body) as { id_token?: string }).id_token;
    } catch {
      throw new UnauthorizedException("Token endpoint geçersiz yanıt döndürdü");
    }
    if (!idToken) throw new UnauthorizedException("IdP id_token döndürmedi");

    assertPublicUrl(doc.jwks_uri, "JWKS URL'i");
    const jwksRes = await safeFetch(doc.jwks_uri, { method: "GET" }, "JWKS URL'i");
    if (jwksRes.status !== 200) throw new UnauthorizedException("JWKS alınamadı");
    const jwks = createLocalJWKSet(JSON.parse(jwksRes.body));

    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: provider.issuer,
      audience: provider.clientId,
    }).catch(() => {
      throw new UnauthorizedException("id_token doğrulanamadı");
    });

    const email = payload[provider.emailClaim];
    if (typeof email !== "string") {
      throw new UnauthorizedException("id_token içinde beklenen email claim'i bulunamadı");
    }

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive || user.authSource !== "OIDC") {
      throw new UnauthorizedException("Bu email için OIDC girişine izin verilen bir kullanıcı bulunamadı");
    }
    if (user.oidcProviderId && user.oidcProviderId !== provider.id) {
      throw new UnauthorizedException("Bu kullanıcı başka bir OIDC sağlayıcısına bağlı");
    }
    if (!user.oidcProviderId) {
      await this.prisma.user.update({ where: { id: user.id }, data: { oidcProviderId: provider.id } });
    }

    return this.authService.issueTokens(user.id, user.email, user.name, user.role, user.tenantId);
  }
}
