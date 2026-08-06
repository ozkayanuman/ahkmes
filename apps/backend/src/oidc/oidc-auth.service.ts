import { Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createLocalJWKSet, jwtVerify, SignJWT } from "jose";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { AuthService } from "../auth/auth.service";
import { decryptSecret } from "../common/crypto";
import { assertPublicUrl, safeFetch } from "../common/safe-request";

/**
 * Faz O: SSO/OIDC login akışı — LdapService.verifyCredentials()'ın OIDC
 * eşdeğeri. LDAP'tan farklı olarak burada kullanıcı adı/şifre değil,
 * tarayıcı yönlendirmeli authorization-code akışı var: authorizeUrl() IdP'ye
 * yönlendirme URL'i üretir, handleCallback() dönen kodu id_token'a çevirir
 * ve doğrular. Discovery belgesi (authorization/token/jwks endpoint'leri)
 * SADECE sağlayıcı oluşturulurken (OidcProvidersService.create) çekilip
 * sabitlenir — burada tekrar çekilmez, sadece pinlenmiş değerler kullanılır
 * (bkz. schema.prisma OidcProvider yorumu). Token/JWKS istekleri
 * common/safe-request.ts üzerinden SSRF korumalı gider.
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

  private reauthRedirectUri(providerId: string) {
    const base = this.config.get<string>("PUBLIC_APP_URL") ?? "http://localhost:3000";
    return `${base}/auth/oidc/${providerId}/reauth/callback`;
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

  /**
   * Güvenlik incelemesi bulgusu (login CSRF): state sadece providerId taşıyıp
   * imzalıysa, saldırgan KENDİ hesabıyla meşru bir authorize akışı başlatıp
   * elde ettiği geçerli state+code çiftini kurbana enjekte edebilir (login
   * CSRF/session fixation) — imzalı olması sahteciliği değil, TARAYICI
   * BAĞLAMSIZLIĞINI engellemiyordu. Düzeltme: authorizeUrl() rastgele bir
   * nonce üretir, controller bunu HttpOnly cookie'ye yazar; state JWT'si
   * nonce'un kendisini değil SHA-256 hash'ini taşır (cookie XSS ile okunsa
   * bile state'i sahte üretmeye yetmez). callback() cookie'deki nonce'u
   * hash'leyip state'teki hash'le sabit-zamanlı karşılaştırır — sadece
   * authorize()'ı başlatan TARAYICI callback'i tamamlayabilir.
   */
  private async signState(providerId: string, nonceHash: string) {
    return new SignJWT({ providerId, nonceHash })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(new TextEncoder().encode(this.secretKey()));
  }

  private async verifyState(state: string, providerId: string, cookieNonce: string | undefined) {
    if (!cookieNonce) {
      throw new UnauthorizedException("Eksik oturum çerezi (state doğrulanamıyor)");
    }
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(state, new TextEncoder().encode(this.secretKey())));
    } catch {
      throw new UnauthorizedException("Geçersiz veya süresi dolmuş state");
    }
    if (payload.providerId !== providerId) {
      throw new UnauthorizedException("state sağlayıcı ile eşleşmiyor");
    }
    const expectedHash = createHash("sha256").update(cookieNonce).digest();
    const actualHash = Buffer.from(String(payload.nonceHash ?? ""), "hex");
    if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) {
      throw new UnauthorizedException("state çerezle eşleşmiyor");
    }
  }

  /** AHK-006 kalanı: `AuthService.reauthenticate()` LOCAL/LDAP için şifreyle
   * çalışır ama OIDC kullanıcıları için hiçbir yolu yoktu (`authSource`
   * "OIDC" ise `valid` hep false kalıp her zaman 401 dönüyordu) — yani OIDC
   * ile giren bir kullanıcı CAPA/MRP onayı gibi kritik kararları ASLA
   * veremiyordu. Çözüm IdP'nin `prompt=login` parametresiyle: mevcut SSO
   * oturumunu yok sayıp kullanıcıyı YENİDEN interaktif kimlik doğrulamaya
   * zorlar — bu "canlılık" kanıtının kendisidir. State normal login
   * akışından ayrı imzalanır (`purpose:"reauth"` + zaten oturum açmış
   * `userId`/`tenantId`), böylece callback IdP'den dönen email'i state'e
   * gömülü kimlikle karşılaştırıp HESAP DEĞİŞTİRMEYİ (başka bir OIDC
   * hesabıyla giriş yapıp o hesap için reauth kanıtı üretmeyi) engeller. */
  private async signReauthState(providerId: string, nonceHash: string, userId: string, tenantId: string) {
    return new SignJWT({ providerId, nonceHash, purpose: "reauth", userId, tenantId })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(new TextEncoder().encode(this.secretKey()));
  }

  private async verifyReauthState(state: string, providerId: string, cookieNonce: string | undefined) {
    if (!cookieNonce) {
      throw new UnauthorizedException("Eksik oturum çerezi (state doğrulanamıyor)");
    }
    let payload: Record<string, unknown>;
    try {
      ({ payload } = await jwtVerify(state, new TextEncoder().encode(this.secretKey())));
    } catch {
      throw new UnauthorizedException("Geçersiz veya süresi dolmuş state");
    }
    if (payload.purpose !== "reauth" || payload.providerId !== providerId) {
      throw new UnauthorizedException("state sağlayıcı/amaç ile eşleşmiyor");
    }
    const expectedHash = createHash("sha256").update(cookieNonce).digest();
    const actualHash = Buffer.from(String(payload.nonceHash ?? ""), "hex");
    if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) {
      throw new UnauthorizedException("state çerezle eşleşmiyor");
    }
    const userId = String(payload.userId ?? "");
    const tenantId = String(payload.tenantId ?? "");
    if (!userId || !tenantId) throw new UnauthorizedException("state kimlik bilgisi eksik");
    return { userId, tenantId };
  }

  /** Kısa ömürlü (2dk) imzalı kanıt — `AuthService.reauthenticate()`'in
   * OIDC dalı bunu doğrular (bkz. auth.service.ts). Oturum token'ı DEĞİLDİR,
   * sadece "bu kullanıcı az önce IdP'de canlı kimlik doğrulaması yaptı"
   * iddiasını taşır; CAPA/MRP onay endpoint'lerinde mevcut `password`
   * alanına bu değer yazılır (bkz. capa/mrp controller'ları — alan adı
   * değişmedi, OIDC için anlamı "reauth kanıtı" olarak genişledi). */
  private async signReauthEvidence(userId: string) {
    return new SignJWT({ sub: userId, purpose: "reauth", authSource: "OIDC" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("2m")
      .sign(new TextEncoder().encode(this.secretKey()));
  }

  async reauthorizeUrl(providerId: string, userId: string, tenantId: string) {
    const provider = await this.findActiveProvider(providerId);
    assertPublicUrl(provider.authorizationEndpoint, "Authorization endpoint");

    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId, isActive: true } });
    if (!user || user.authSource !== "OIDC" || user.oidcProviderId !== provider.id) {
      throw new UnauthorizedException("Bu kullanıcı bu OIDC sağlayıcısıyla yeniden kimlik doğrulayamaz");
    }

    const nonce = randomBytes(32).toString("base64url");
    const nonceHash = createHash("sha256").update(nonce).digest("hex");
    const state = await this.signReauthState(provider.id, nonceHash, userId, tenantId);

    const url = new URL(provider.authorizationEndpoint);
    url.searchParams.set("client_id", provider.clientId);
    url.searchParams.set("redirect_uri", this.reauthRedirectUri(provider.id));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", provider.scope);
    url.searchParams.set("state", state);
    url.searchParams.set("prompt", "login");
    return { url: url.toString(), nonce };
  }

  async handleReauthCallback(providerId: string, code: string, state: string, cookieNonce: string | undefined) {
    const { userId, tenantId } = await this.verifyReauthState(state, providerId, cookieNonce);
    const provider = await this.findActiveProvider(providerId);
    assertPublicUrl(provider.tokenEndpoint, "Token endpoint");

    const clientSecret = decryptSecret(provider.clientSecretEnc, this.secretKey());
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.reauthRedirectUri(provider.id),
      client_id: provider.clientId,
      client_secret: clientSecret,
    }).toString();
    const tokenRes = await safeFetch(
      provider.tokenEndpoint,
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

    assertPublicUrl(provider.jwksUri, "JWKS URL'i");
    const jwksRes = await safeFetch(provider.jwksUri, { method: "GET" }, "JWKS URL'i");
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

    // Kimlik state'teki (zaten oturum açmış) userId'den gelir — id_token'daki
    // email SADECE bu kullanıcının KENDİ hesabıyla mı giriş yaptığını
    // doğrulamak için kullanılır, farklı bir hesaba geçişe izin vermez.
    const user = await this.prisma.user.findFirst({ where: { id: userId, tenantId, isActive: true } });
    if (!user || user.authSource !== "OIDC" || user.oidcProviderId !== provider.id) {
      throw new UnauthorizedException("Kullanıcı bu sağlayıcıyla yeniden kimlik doğrulayamaz");
    }
    if (user.email !== email) {
      throw new UnauthorizedException("IdP'den dönen kimlik oturumdaki kullanıcıyla eşleşmiyor");
    }

    return { reauthToken: await this.signReauthEvidence(user.id) };
  }

  async authorizeUrl(providerId: string) {
    const provider = await this.findActiveProvider(providerId);
    assertPublicUrl(provider.authorizationEndpoint, "Authorization endpoint");

    const nonce = randomBytes(32).toString("base64url");
    const nonceHash = createHash("sha256").update(nonce).digest("hex");
    const state = await this.signState(provider.id, nonceHash);

    const url = new URL(provider.authorizationEndpoint);
    url.searchParams.set("client_id", provider.clientId);
    url.searchParams.set("redirect_uri", this.redirectUri(provider.id));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", provider.scope);
    url.searchParams.set("state", state);
    return { url: url.toString(), nonce };
  }

  /**
   * User.authSource='OIDC' olarak ADMIN tarafından önceden oluşturulmuş
   * bir kullanıcı gerekir (JIT provisioning kapsamda değil — kullanıcı bu
   * seçeneği tercih etmedi). İlk başarılı girişte oidcProviderId bağlanır;
   * sonraki girişlerde başka bir sağlayıcıyla eşleşme reddedilir.
   */
  async handleCallback(providerId: string, code: string, state: string, cookieNonce: string | undefined) {
    await this.verifyState(state, providerId, cookieNonce);
    const provider = await this.findActiveProvider(providerId);
    assertPublicUrl(provider.tokenEndpoint, "Token endpoint");

    const clientSecret = decryptSecret(provider.clientSecretEnc, this.secretKey());
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: this.redirectUri(provider.id),
      client_id: provider.clientId,
      client_secret: clientSecret,
    }).toString();
    const tokenRes = await safeFetch(
      provider.tokenEndpoint,
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

    assertPublicUrl(provider.jwksUri, "JWKS URL'i");
    const jwksRes = await safeFetch(provider.jwksUri, { method: "GET" }, "JWKS URL'i");
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

    return this.authService.issueTokens(user.id, user.email, user.name, user.role, user.tenantId, user.locale, user.timezone);
  }
}
